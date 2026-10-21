import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import which from "which";
import { parseApiJson } from "../../src/api/json.js";
import type { Project, Task } from "../../src/api/types.js";
import type { InstalledCliReceipt } from "../fixtures/installed-cli.js";
import { terminateInstalledProcess } from "../fixtures/installed-cli.js";
import { createSkillFixture, skillPipe, skillTerminal } from "../fixtures/skill-terminal.js";
import type { NativeHostName, NativeHostResult } from "./host.js";

type Trace = { readonly actor: "model" | "contender"; readonly tool: "daynight" | "gh" | "node"; readonly args: string[]; readonly prUrl?: string; readonly startedAt: number; readonly finishedAt: number; readonly code: number | null; readonly stdout: string; readonly stderr: string };
type CommandResult = { readonly code: number | null; readonly stdout: string; readonly stderr: string };
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) : args[index + 1];
};
const repeatedOption = (args: readonly string[], name: string): string[] => args.flatMap((argument, index) => argument === name && args[index + 1] !== undefined ? [args[index + 1]!] : argument.startsWith(`${name}=`) ? [argument.slice(name.length + 1)] : []);
const absent = async (file: string): Promise<boolean> => { try { await lstat(file); return false; } catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return true; throw cause; } };
type ChildIdentity = { readonly pid: number; readonly startTime: string };
type ProcessIdentity = ChildIdentity & { readonly group: number; readonly state: string };
const processIdentity = async (pid: number): Promise<ProcessIdentity | undefined> => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8"), fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
    assert(fields[0] !== undefined && fields[2] !== undefined && fields[19] !== undefined, "Linux process identity is incomplete.");
    return { pid, group: Number(fields[2]), startTime: fields[19], state: fields[0] };
  } catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined; throw cause; }
};
export const reapForwardedChildren = async (registry: string, ownerToken: string): Promise<void> => {
  const registrations: ChildIdentity[] = [];
  for (const file of await readdir(registry)) {
    const identity = JSON.parse(await readFile(path.join(registry, file), "utf8")) as ChildIdentity;
    assert(Number.isSafeInteger(identity.pid) && identity.pid > 1 && /^[0-9]+$/.test(identity.startTime), "Native child registry contains an invalid identity.");
    registrations.push(identity);
  }
  const owned = async (): Promise<ProcessIdentity[]> => {
    const processes: ProcessIdentity[] = [];
    for (const name of await readdir("/proc")) {
      if (!/^[0-9]+$/.test(name)) continue;
      const identity = await processIdentity(Number(name));
      if (identity === undefined) continue;
      if (registrations.some((record) => record.pid === identity.pid && record.startTime === identity.startTime && identity.group === identity.pid)) { processes.push(identity); continue; }
      try {
        const environment = await readFile(`/proc/${name}/environ`);
        if (environment.toString().split("\0").includes(`DAYNIGHT_NATIVE_OWNER=${ownerToken}`)) processes.push(identity);
      } catch (cause) { if (!(cause instanceof Error && "code" in cause && ["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(String(cause.code)))) throw cause; }
    }
    return processes;
  };
  const failures: unknown[] = [];
  const candidates = await owned();
  for (const group of new Set(candidates.filter((identity) => identity.state !== "Z").map((identity) => identity.group))) {
    const members = candidates.filter((identity) => identity.group === group);
    let currentOwner = false;
    for (const member of members) {
      const current = await processIdentity(member.pid);
      if (current !== undefined && current.startTime === member.startTime && current.group === group) { currentOwner = true; break; }
    }
    if (!currentOwner) continue;
    try { process.kill(-group, "SIGKILL"); }
    catch (cause) { if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) failures.push(cause); }
  }
  const deadline = Date.now() + 5_000;
  let remaining = await owned();
  while (remaining.length !== 0 && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 25)); remaining = await owned(); }
  if (remaining.length !== 0) failures.push(new Error(`Owned native child processes were not reaped: ${remaining.map((identity) => `${identity.pid}:${identity.state}`).join(", ")}.`));
  if (failures.length !== 0) throw new AggregateError(failures, "Forwarded native fixture child cleanup failed.");
  for (const file of await readdir(registry)) await rm(path.join(registry, file));
};
const tree = async (directory: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name), relative = path.relative(directory, file).replaceAll("\\", "/");
      if (entry.isDirectory()) { files[`${relative}/`] = "directory"; await visit(file); }
      else { assert(entry.isFile(), `Unexpected non-file skill resource: ${relative}`); files[relative] = createHash("sha256").update(await readFile(file)).digest("hex"); }
    }
  };
  await visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
};
const execute = async (file: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<CommandResult> => {
  const child = spawn(file, [...args], { cwd, env: environment, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (part: string) => { stdout += part; });
  child.stderr!.setEncoding("utf8").on("data", (part: string) => { stderr += part; });
  let failure: Error | undefined;
  child.once("error", (cause) => { failure = cause; });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([closed, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), 30_000); })]);
    if (code === "timeout") { await terminateInstalledProcess(child, closed); throw new Error(`Native fixture command exceeded thirty seconds: ${path.basename(file)} ${args[0]}`); }
    if (failure !== undefined) throw failure;
    return { code, stdout, stderr };
  } finally { if (timer !== undefined) clearTimeout(timer); }
};
const taskVersions = (stdout: string): readonly { readonly id: string; readonly version: string }[] => {
  try {
    const decoded = parseApiJson(stdout);
    const items: unknown[] = Array.isArray(decoded) ? decoded : [decoded];
    return items.flatMap((item) => typeof item === "object" && item !== null && "id" in item && "version" in item && typeof item.id === "string" && typeof item.version === "bigint" ? [{ id: item.id, version: item.version.toString() }] : []);
  } catch {
    return [...stdout.matchAll(/^ID: ([a-f0-9-]+)\n[\s\S]*?^Version: ([0-9]+)$/gm)].map((match) => ({ id: match[1]!, version: match[2]! }));
  }
};
const baselineAcceptanceRun = (entry: Trace, workingDirectory: string): boolean => {
  if (entry.code !== 0 || entry.args[0] !== "--test") return false;
  const files = entry.args.slice(1).map((argument) => path.resolve(workingDirectory, argument));
  const baseline = path.join(workingDirectory, "baseline.test.mjs"), division = path.join(workingDirectory, "division.test.mjs");
  if (files.length !== 0 && (!files.includes(baseline) || files.some((file) => file !== baseline && file !== division))) return false;
  return /^ok [0-9]+ - delivered addition baseline\r?$/m.test(entry.stdout)
    && /^# tests [1-9][0-9]*\r?$/m.test(entry.stdout)
    && /^# pass [1-9][0-9]*\r?$/m.test(entry.stdout)
    && /^# fail 0\r?$/m.test(entry.stdout)
    && /^# cancelled 0\r?$/m.test(entry.stdout);
};

export const createNativeFixture = async (options: {
  readonly rootDirectory: string;
  readonly receipt: InstalledCliReceipt;
  readonly serviceUrl: string;
  readonly host: NativeHostName;
  readonly scope: "user" | "project";
  readonly openPrUrl: string;
  readonly mergedPrUrl: string;
  readonly expectUncertainCreate?: boolean;
}): Promise<{
  readonly projectId: string;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly stateDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly prompt: string;
  verify(result: NativeHostResult): Promise<Readonly<Record<string, unknown>>>;
  cleanup(): Promise<void>;
}> => {
  const root = options.rootDirectory;
  assert(process.platform === "linux", "Native Agent acceptance requires Linux process identity and cancellation verification.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const childRegistry = path.join(root, "owned-children"), ownerToken = randomUUID();
  await mkdir(childRegistry);
  try {
    const fixture = await createSkillFixture(path.join(root, "installation"), ["codex", "copilot", "claude"]);
    const primary = path.join(root, "primary"), workingDirectory = path.join(root, "linked-worktree"), stateDirectory = path.join(root, "host-state");
    await mkdir(primary); await mkdir(stateDirectory);
    const gitPath = await which("git"), ghPath = await which("gh");
    const git = async (args: readonly string[], cwd = primary): Promise<void> => { const result = await execute(gitPath, args, cwd, fixture.environment); assert(result.code === 0, `Native fixture Git failed: ${result.stderr}`); };
    const repoUrl = `https://github.com/daynight-native-acceptance/fixture-${randomUUID()}.git`;
    await git(["init", "--initial-branch=fixture"]);
    await git(["remote", "add", "origin", repoUrl]);
    await git(["worktree", "add", "--orphan", "-b", "native-development", workingDirectory]);
    const homeDirectory = fixture.home;
    await mkdir(path.join(homeDirectory, ".daynight"));
    await writeFile(path.join(homeDirectory, ".daynight/config.yml"), `serverUrl: ${options.serviceUrl}\n`, { mode: 0o600 });
    const seed = async (args: readonly string[]): Promise<string> => {
      const result = await skillPipe(options.receipt, fixture, args, workingDirectory);
      assert(result.code === 0, `Real native fixture setup failed: ${result.stderr}`);
      return result.stdout;
    };
    await seed(["project", "create", `Native ${options.host} ${options.scope}`, "--repo", repoUrl]);
    const projects = parseApiJson(await seed(["project", "list", "--json"])) as Project[];
    const project = projects.find((candidate) => candidate.repoUrl === repoUrl);
    assert(project !== undefined, "Native fixture project was not persisted by the real service.");
    const create = async (title: string, description: string, dependencies: readonly string[] = []): Promise<Task> => {
      const stdout = await seed(["task", "create", "--project", project.id, "--title", title, "--description", description, ...dependencies.flatMap((id) => ["--depends-on", id])]);
      const id = /^ID: ([a-f0-9-]+)$/m.exec(stdout)?.[1];
      assert(id !== undefined, "Created fixture task has no confirmed identifier.");
      return parseApiJson(await seed(["task", "show", id, "--project", project.id, "--json"])) as Task;
    };
    const primaryTask = await create("Implement precise division", `Implement divide(a, b) in arithmetic.mjs; run node --test. Division by zero throws RangeError, normal quotients work, and zero signs are preserved. Delivery PR: ${options.openPrUrl}. This PR must be merged before this development task can be done. Maintain its URL and title in the PR reference list and pending delivery work in the description.`);
    const blocked = await create("Publish division usage examples", "Write public usage examples only after the division implementation is delivered. This outcome is not authorized for implementation in this maintenance request.", [primaryTask.id]);
    const baseline = await create("Verify the delivered addition baseline", `The existing add(a, b) implementation and baseline.test.mjs are the accepted delivered source. Run its real tests and inspect delivery PR ${options.mergedPrUrl} on its hosting platform. If the PR is merged and tests pass, maintain its URL and title in the PR reference list, record the merge commit and acceptance evidence in the description, then complete this record. No source change is needed for this baseline.`);
    await seed(["task", "update", baseline.id, "--project", project.id, "--if-version", baseline.version.toString(), "--status", "in_progress"]);
    const successor = await create("Schedule addition follow-up review", "Ready once the delivered baseline is verified; leave it queued because execution is outside this maintenance request.", [baseline.id]);
    const conflictMarker = "Preserve the sign of zero when dividing zero. Concurrent acceptance clarification: retain this requirement in the task record and verify Object.is(divide(-0, 2), -0).";
    await writeFile(path.join(workingDirectory, "arithmetic.mjs"), "export const add = (left, right) => left + right;\nexport const divide = (_left, _right) => { throw new Error('Division implementation pending'); };\n");
    await writeFile(path.join(workingDirectory, "baseline.test.mjs"), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './arithmetic.mjs';\ntest('delivered addition baseline', () => { assert.equal(add(2, 3), 5); assert.equal(add(-2, 2), 0); });\n");
    await writeFile(path.join(workingDirectory, "division.test.mjs"), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { divide } from './arithmetic.mjs';\ntest('division quotients', () => { assert.equal(divide(8, 2), 4); assert.equal(divide(3, 2), 1.5); assert.equal(divide(-8, 2), -4); });\ntest('division by either zero sign is rejected', () => { assert.throws(() => divide(1, 0), RangeError); assert.throws(() => divide(1, -0), RangeError); });\ntest('division preserves zero signs', () => { assert.equal(Object.is(divide(-0, 2), -0), true); assert.equal(Object.is(divide(0, -2), -0), true); assert.equal(Object.is(divide(-0, -2), 0), true); });\n");
    const testHashes = Object.fromEntries(await Promise.all(["baseline.test.mjs", "division.test.mjs"].map(async (file) => [file, createHash("sha256").update(await readFile(path.join(workingDirectory, file))).digest("hex")] as const)));
    await writeFile(path.join(workingDirectory, "README.md"), `# Arithmetic maintenance\n\nThis repository is tracked in Daynight. Its Git origin identifies the associated project on the configured service.\n\nImplement the authorized precise-division outcome in arithmetic.mjs and run the Node test suite. The supplied baseline.test.mjs and division.test.mjs acceptance files are immutable; edit arithmetic.mjs only. Its existing work record is titled "Implement precise division". Delivery uses ${options.openPrUrl}; review and test success require preserving the pending PR delivery status until the hosting platform confirms merge. This request authorizes local implementation and work-record maintenance, not GitHub mutations or beginning queued successor work.\n\nAlso verify the already delivered addition baseline. Its active verification record is ${baseline.id}. Run baseline.test.mjs and inspect ${options.mergedPrUrl} on the actual hosting platform. Reconcile this record from observed acceptance and merge facts, retaining delivery references. After this verification, update the existing "Publish division usage examples" work record to add the verified baseline as a prerequisite while preserving its precise-division prerequisite. Keep that examples work queued.\n\nCreate a durable follow-up titled "Document rounding policy" for documenting decimal rounding behavior, with acceptance criteria and the precise-division work record as its prerequisite. Leave the follow-up queued. Recheck which work becomes ready after verification. Preserve complete existing requirements when updating records, including concurrent clarifications.\n`);
    const down = "\u001b[B";
    const actions = [{ waitFor: "Install the Daynight skill for which agents?", keys: [" ", down, " ", down, " ", "\r"] }, { waitFor: "Where should the skill be installed?", keys: options.scope === "project" ? [down, "\r"] : ["\r"] }];
    const installation = await skillTerminal(options.receipt, fixture, actions, workingDirectory);
    assert(installation.code === 0, `Actual native skill installation failed: ${installation.stderr}`);
    const scopeRoot = options.scope === "user" ? homeDirectory : workingDirectory;
    const targets = [path.join(scopeRoot, ".agents/skills/daynight"), path.join(scopeRoot, ".claude/skills/daynight")];
    const sourceTree = await tree(path.join(path.dirname(options.receipt.entryPath), "commands/skill/skills/daynight"));
    for (const target of targets) {
      assert(JSON.stringify(await tree(target)) === JSON.stringify(sourceTree), "Installed native skill differs from its packed source.");
      await writeFile(path.join(target, "stale-resource.txt"), "remove on reinstall\n");
      await writeFile(path.join(target, "SKILL.md"), "locally edited skill\n");
      await mkdir(path.join(path.dirname(target), "sibling"));
      await writeFile(path.join(path.dirname(target), "sibling/preserved.txt"), "preserved\n");
    }
    const reinstallation = await skillTerminal(options.receipt, fixture, actions, workingDirectory);
    assert(reinstallation.code === 0, `Actual native skill reinstallation failed: ${reinstallation.stderr}`);
    for (const target of targets) {
      assert(JSON.stringify(await tree(target)) === JSON.stringify(sourceTree), "Repeated native installation retained edits or stale resources.");
      assert(await readFile(path.join(path.dirname(target), "sibling/preserved.txt"), "utf8") === "preserved\n", "Repeated native installation changed a sibling skill.");
    }
    assert(await absent(fixture.agentLog), "Agent detection executed a fixture launcher.");
    assert(await absent(path.join(workingDirectory, ".daynight/project.yml")), "Native fixture unexpectedly has a pre-seeded worktree binding.");
    for (const host of ["codex", "copilot", "claude"]) await rm(path.join(fixture.tools, host));
    const trace = path.join(root, "commands.jsonl"), configurationPath = path.join(root, "wrapper.json");
    await writeFile(trace, "", { mode: 0o600 });
    await writeFile(configurationPath, JSON.stringify({ trace, childRegistry, ownerToken, home: homeDirectory, nodePath: options.receipt.nodePath, entryPath: options.receipt.entryPath, ghPath, prUrls: [options.openPrUrl, options.mergedPrUrl], primaryTaskId: primaryTask.id, baselineTaskId: baseline.id, projectId: project.id, conflictLock: path.join(root, "conflict-once"), conflictMarker }), { mode: 0o600 });
    await rm(path.join(fixture.tools, "node"));
    for (const tool of ["daynight", "gh", "node"] as const) {
      const source = `#!${process.execPath}\nimport { run } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "fixture-cli.mjs")).href)};\nawait run(${JSON.stringify(configurationPath)}, ${JSON.stringify(tool)});\n`;
      const script = path.join(fixture.tools, tool);
      await writeFile(script, source, { mode: 0o755 });
    }
    assert(process.env.PATH !== undefined && process.env.HOME !== undefined, "Native fixture requires the operator's executable path and read-only GitHub configuration location.");
    const environment: NodeJS.ProcessEnv = { ...fixture.environment, PATH: `${fixture.tools}${path.delimiter}${process.env.PATH}`, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR ?? path.join(process.env.HOME, ".config/gh") };
    const prompt = "Implement the authorized arithmetic maintenance described in README, run its tests and reconcile the associated work records. Report remaining delivery work.";
    return {
      projectId: project.id, workingDirectory, homeDirectory, stateDirectory, environment, prompt,
      verify: async (result) => {
        assert(result.host === options.host, "Native host result does not match the fixture.");
        assert(result.events.some((event) => event.kind === "skill" && /daynight/i.test(event.text)), "The native host did not demonstrate actual Daynight skill activation.");
        assert(result.events.some((event) => event.kind === "command" && /\bnode[^\n]*\s--test\b/.test(event.text)), "The native host did not execute the real Node acceptance tests.");
        for (const [file, expectedHash] of Object.entries(testHashes)) assert(createHash("sha256").update(await readFile(path.join(workingDirectory, file))).digest("hex") === expectedHash, `The native host changed immutable acceptance file ${file}.`);
        const tests = await execute(process.execPath, ["--test"], workingDirectory, environment);
        assert(tests.code === 0, `Native arithmetic acceptance failed: ${tests.stdout}\n${tests.stderr}`);
        const entries = (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Trace);
        const model = entries.filter((entry) => entry.actor === "model");
        const tasks = model.filter((entry) => entry.tool === "daynight" && entry.args[0] === "task");
        const testRuns = model.filter((entry) => entry.tool === "node");
        const baselineRuns = testRuns.filter((entry) => baselineAcceptanceRun(entry, workingDirectory));
        assert(testRuns.some((entry) => entry.code === 0), "Native host did not run a successful real Node test command.");
        const divisionStart = tasks.find((entry) => entry.args[1] === "update" && entry.args[2] === primaryTask.id && option(entry.args, "--status") === "in_progress" && entry.code === 0);
        const divisionTests = testRuns.filter((entry) => !entry.args.some((argument) => /(?:^|[/\\])baseline\.test\.mjs$/.test(argument)) || entry.args.some((argument) => /(?:^|[/\\])division\.test\.mjs$/.test(argument)));
        assert(divisionStart !== undefined && divisionTests.length > 0 && divisionTests.every((entry) => entry.startedAt > divisionStart.finishedAt), "Division tests began before the primary task was confirmed in progress.");
        const ready = tasks.filter((entry) => entry.args[1] === "ready" && entry.code === 0);
        assert(ready.length >= 2, "Native host must query bounded ready work at start and after completion.");
        assert(tasks.some((entry) => entry.args[1] === "show" && entry.args[2] === primaryTask.id && entry.code === 0), "Native host did not read the selected division task.");
        if (options.expectUncertainCreate !== true) assert(tasks.some((entry) => entry.args[1] === "create" && entry.code === 0), "Native host did not create a durable follow-up through the actual CLI.");
        const observed = new Map<string, string>();
        for (const entry of [...tasks].sort((left, right) => left.startedAt - right.startedAt)) {
          if (entry.args[1] === "update") {
            const expected = option(entry.args, "--if-version");
            assert(expected !== undefined && /^[0-9]+$/.test(expected), "Native task update omitted an exact explicit observed version.");
            assert(observed.get(entry.args[2]!) === expected, "Native task update did not use the version from its observed task facts.");
          }
          if (entry.code === 0) for (const task of taskVersions(entry.stdout)) observed.set(task.id, task.version);
        }
        const conflicts = tasks.filter((entry) => entry.args[1] === "update" && entry.args[2] === primaryTask.id && entry.code !== 0 && /version_conflict/.test(entry.stderr));
        const contenders = entries.filter((entry) => entry.actor === "contender" && entry.code === 0);
        assert(conflicts.length === 1 && contenders.length === 1 && repeatedOption(contenders[0]!.args, "--depends-on").includes(baseline.id), "Native host did not encounter the real version conflict from its concurrently added prerequisite.");
        assert(tasks.some((entry) => entry.args[1] === "show" && entry.args[2] === primaryTask.id && entry.startedAt > conflicts[0]!.finishedAt && entry.stdout.includes(conflictMarker) && entry.stdout.includes(baseline.id)), "Native host did not reread the concurrent prerequisite and acceptance clarification after conflict.");
        for (const url of [options.openPrUrl, options.mergedPrUrl]) assert(model.some((entry) => entry.tool === "gh" && entry.prUrl === url && entry.code === 0), `Native host did not inspect the actual hosting state for ${url}.`);
        const current = async (id: string): Promise<Task> => parseApiJson(await seed(["task", "show", id, "--project", project.id, "--json"])) as Task;
        const [division, blockedTask, baselineTask, successorTask] = await Promise.all([current(primaryTask.id), current(blocked.id), current(baseline.id), current(successor.id)]);
        assert(!tasks.some((entry) => entry.args[1] === "update" && entry.args[2] === primaryTask.id && option(entry.args, "--status") === "done"), "Native host attempted premature completion of the open-PR development task.");
        assert(division.status === "in_progress" && division.dependsOn.length === 1 && division.dependsOn[0] === baseline.id, "Open-PR division work must remain in progress while preserving its concurrently added baseline prerequisite.");
        assert(blockedTask.status === "todo" && !blockedTask.ready && blockedTask.blockedBy.includes(primaryTask.id), "Open delivery incorrectly unblocked or started dependent work.");
        const mergedView = await execute(ghPath, ["pr", "view", options.mergedPrUrl, "--json", "state,mergeCommit,url,title"], workingDirectory, environment);
        assert(mergedView.code === 0, `Cannot independently verify the delivered baseline PR: ${mergedView.stderr}`);
        const mergedFacts = JSON.parse(mergedView.stdout) as { state: string; mergeCommit: { oid: string } | null; url: string; title: string };
        assert(mergedFacts.state === "MERGED" && mergedFacts.mergeCommit !== null && /^[0-9a-f]{40}$/i.test(mergedFacts.mergeCommit.oid), "Baseline delivery is not platform-confirmed merged.");
        const openView = await execute(ghPath, ["pr", "view", options.openPrUrl, "--json", "state,url,title"], workingDirectory, environment);
        assert(openView.code === 0, `Cannot independently verify the pending division PR: ${openView.stderr}`);
        const openFacts = JSON.parse(openView.stdout) as { state: string; url: string; title: string };
        assert(openFacts.state === "OPEN", "Pending-delivery acceptance requires a platform-confirmed open PR.");
        assert(division.properties.pullRequests.some((reference) => reference.url === options.openPrUrl && reference.title === openFacts.title), "Open-PR division work lacks its actual PR URL and title in the reference list.");
        assert(baselineTask.status === "done" && baselineTask.properties.pullRequests.some((reference) => reference.url === options.mergedPrUrl && reference.title === mergedFacts.title) && baselineTask.description.includes(mergedFacts.mergeCommit.oid), "Merged baseline lacks confirmed completion, its actual PR reference, or retained merge commit.");
        const completion = tasks.find((entry) => entry.args[1] === "update" && entry.args[2] === baseline.id && option(entry.args, "--status") === "done" && entry.code === 0);
        assert(completion !== undefined && ready.some((entry) => entry.startedAt > completion.finishedAt), "Native host did not refresh bounded readiness after confirmed completion.");
        assert(divisionStart.startedAt > completion.finishedAt, "Native host started division before its concurrent baseline prerequisite was confirmed complete.");
        const completionAttempts = tasks.filter((entry) => entry.args[1] === "update" && entry.args[2] === baseline.id && option(entry.args, "--status") === "done");
        for (const attempt of completionAttempts) {
          assert(baselineRuns.some((entry) => entry.finishedAt < attempt.startedAt), "Baseline completion was attempted before an unfiltered native test run executed and passed the immutable addition baseline.");
          assert(model.some((entry) => entry.tool === "gh" && entry.prUrl === options.mergedPrUrl && entry.code === 0 && entry.finishedAt < attempt.startedAt), "Baseline completion was attempted before observing its real merged delivery PR.");
        }
        assert(!tasks.some((entry) => entry.args[1] === "update" && [blocked.id, successor.id].includes(entry.args[2]!) && option(entry.args, "--status") !== undefined && option(entry.args, "--status") !== "todo"), "Native host attempted to start or complete queued successor work outside its authorized scope.");
        const expectedDependencies = [primaryTask.id, baseline.id].sort();
        assert(JSON.stringify([...blockedTask.dependsOn].sort()) === JSON.stringify(expectedDependencies), "Examples work did not preserve division while adding the verified baseline prerequisite.");
        assert(tasks.some((entry) => entry.args[1] === "update" && entry.args[2] === blocked.id && entry.code === 0 && entry.startedAt > completion.finishedAt && JSON.stringify(repeatedOption(entry.args, "--depends-on").sort()) === JSON.stringify(expectedDependencies)), "Native host did not replace the examples dependency set with both observed prerequisites after baseline verification.");
        assert(successorTask.status === "todo" && successorTask.ready && successorTask.blockedBy.length === 0, "Verified baseline did not unlock its queued successor correctly.");
        const all = parseApiJson(await seed(["task", "list", "--project", project.id, "--json"])) as Task[];
        const followups = all.filter((task) => task.title === "Document rounding policy");
        assert(followups.length === 1 && followups[0]!.status === "todo" && followups[0]!.dependsOn.includes(primaryTask.id) && !followups[0]!.ready && followups[0]!.description.length > 30, "Durable rounding follow-up lacks its queued dependency or acceptance description.");
        let uncertainCreateReconciled = false;
        if (options.expectUncertainCreate === true) {
          const creates = tasks.filter((entry) => entry.args[1] === "create" && option(entry.args, "--title") !== undefined && !entry.args.includes("--help"));
          assert(creates.length === 1 && option(creates[0]!.args, "--title") === "Document rounding policy", "Native host repeated or replaced an uncertain create before establishing its unique persisted result.");
          const uncertain = creates[0]!;
          assert(uncertain.code !== 0 && /Remote mutation outcome is unconfirmed/.test(uncertain.stderr), "Expected real failed CLI create did not report its unconfirmed mutation outcome.");
          assert(option(uncertain.args, "--description") === followups[0]!.description && JSON.stringify(repeatedOption(uncertain.args, "--depends-on").sort()) === JSON.stringify([...followups[0]!.dependsOn].sort()), "Persisted uncertain-create candidate does not match the complete intended description and dependency set.");
          const intendedTitles = repeatedOption(uncertain.args, "--pull-request-title"), intendedReferences = repeatedOption(uncertain.args, "--pull-request-url").map((url, index) => ({ url, title: intendedTitles[index] }));
          assert(JSON.stringify(intendedReferences) === JSON.stringify(followups[0]!.properties.pullRequests), "Persisted uncertain-create candidate does not match the intended PR reference properties.");
          const inventory = tasks.find((entry) => entry.args[1] === "list" && entry.code === 0 && entry.startedAt > uncertain.finishedAt && option(entry.args, "--status") === undefined && !entry.args.includes("--ready") && taskVersions(entry.stdout).some((task) => task.id === followups[0]!.id));
          assert(inventory !== undefined, "Native host did not reconcile the uncertain create against the full real task inventory.");
          assert(tasks.some((entry) => entry.args[1] === "show" && entry.args[2] === followups[0]!.id && entry.code === 0 && entry.startedAt > inventory.finishedAt), "Native host did not inspect the unique persisted candidate after reconciling its uncertain create.");
          uncertainCreateReconciled = true;
        }
        assert(await absent(path.join(primary, ".daynight/project.yml")), "Native host wrote the binding into the primary checkout.");
        assert(!await absent(path.join(workingDirectory, ".daynight/project.yml")), "Native host did not discover and bind its fresh linked worktree.");
        return { host: options.host, scope: options.scope, nativeVersion: result.version, packageVersion: options.receipt.packageVersion, sourceTreeSha256: createHash("sha256").update(JSON.stringify(sourceTree)).digest("hex"), acceptanceTestSha256: testHashes, projectId: project.id, taskIds: { primary: primaryTask.id, blocked: blocked.id, baseline: baseline.id, successor: successor.id, followup: followups[0]!.id }, proof: { automaticallyActivated: true, freshWorktreeDiscovered: true, realService: true, overwriteAndSiblingPreservation: true, readyQueries: ready.length, selectedReads: tasks.filter((entry) => entry.args[1] === "show").length, observedVersionUpdates: tasks.filter((entry) => entry.args[1] === "update").length, realVersionConflicts: conflicts.length, concurrentPrerequisitePreserved: true, primaryStartedAfterPrerequisiteCompletion: true, openPrRemainsInProgress: true, mergedPrCompleted: true, completionAfterNativeTestAndPlatformRead: true, divisionTestsAfterInProgress: true, queuedSuccessorStatusesPreserved: true, completeDependencyReplacement: true, dependencyReadinessVerified: true, uncertainCreateReconciled, nativeTestRuns: testRuns.length, immutableAcceptanceTests: true, arithmeticTestsPassed: true } };
      },
      cleanup: async () => { await reapForwardedChildren(childRegistry, ownerToken); await rm(root, { recursive: true, force: true }); },
    };
  } catch (cause) {
    try { await rm(root, { recursive: true, force: true }); } catch (cleanupError) { throw new AggregateError([cause, cleanupError], "Native fixture preparation and cleanup failed."); }
    throw cause;
  }
};
