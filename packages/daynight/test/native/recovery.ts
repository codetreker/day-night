import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseApiJson } from "../../src/api/json.js";
import type { Project, Task } from "../../src/api/types.js";
import type { InstalledCliReceipt } from "../fixtures/installed-cli.js";
import { createSkillFixture, skillPipe, skillTerminal } from "../fixtures/skill-terminal.js";
import { reapForwardedChildren } from "./fixture.js";
import type { NativeHostResult } from "./host.js";
import type { NativeService } from "./service.js";

export type NativeRecoveryKind = "unlinked" | "ambiguous" | "service_failure";
type Trace = { readonly tool: "daynight" | "git"; readonly args: string[]; readonly code: number | null; readonly stdout: string; readonly stderr: string; readonly rejected: boolean };
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const optionalHash = async (file: string): Promise<string | null> => {
  try { return hash(await readFile(file)); }
  catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null; throw cause; }
};
const tree = async (directory: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name), relative = path.relative(directory, file).replaceAll("\\", "/");
      if (entry.isDirectory()) { files[`${relative}/`] = "directory"; await visit(file); }
      else { assert(entry.isFile(), `Unexpected native recovery skill resource: ${relative}.`); files[relative] = hash(await readFile(file)); }
    }
  };
  await visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
};

export const createRecoveryFixture = async (options: {
  readonly rootDirectory: string;
  readonly receipt: InstalledCliReceipt;
  readonly service: NativeService;
  readonly kind: NativeRecoveryKind;
}): Promise<{
  readonly workingDirectory: string;
  readonly fixtureDirectory: string;
  readonly homeDirectory: string;
  readonly stateDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly prompt: string;
  readonly skillEntrypoints: readonly string[];
  readonly expectedSkillContents: string;
  verify(result: NativeHostResult): Promise<Readonly<Record<string, unknown>>>;
  cleanup(): Promise<void>;
}> => {
  const root = options.rootDirectory;
  assert(process.platform === "linux", "Native recovery acceptance requires Linux process identity verification.");
  assert(path.isAbsolute(root), "Native recovery fixture root must be absolute.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const childRegistry = path.join(root, "owned-children"), ownerToken = randomUUID();
  await mkdir(childRegistry);
  let unavailableProject: string | undefined;
  const restoreService = (): void => {
    if (unavailableProject !== undefined) { options.service.setProjectReadUnavailable(unavailableProject, false); unavailableProject = undefined; }
  };
  const cleanup = async (): Promise<void> => {
    const failures: unknown[] = [];
    try { restoreService(); } catch (cause) { failures.push(cause); }
    try { await reapForwardedChildren(childRegistry, ownerToken); } catch (cause) { failures.push(cause); }
    if (failures.length === 0) await rm(root, { recursive: true, force: true });
    if (failures.length !== 0) throw new AggregateError(failures, "Native recovery fixture cleanup failed.");
  };
  try {
    const fixture = await createSkillFixture(path.join(root, "installation"), ["codex", "copilot", "claude"]);
    const workingDirectory = path.join(root, "repository"), stateDirectory = path.join(root, "host-state");
    await mkdir(workingDirectory); await mkdir(stateDirectory);
    const { runNativeServiceCommand } = await import("./service.js");
    const repoUrl = `https://github.com/daynight-native-acceptance/recovery-${randomUUID()}.git`;
    for (const args of [["init", "--initial-branch=fixture"], ["remote", "add", "origin", repoUrl]]) await runNativeServiceCommand("Recovery fixture Git setup", "git", args, { cwd: workingDirectory, env: fixture.environment });
    const homeDirectory = fixture.home, configPath = path.join(homeDirectory, ".daynight/config.yml");
    await mkdir(path.dirname(configPath));
    await writeFile(configPath, `serverUrl: ${options.service.url}\n`, { mode: 0o600 });
    const seed = async (args: readonly string[]): Promise<string> => {
      const result = await skillPipe(options.receipt, fixture, args, workingDirectory);
      assert(result.code === 0, `Actual recovery fixture setup/read failed: ${result.stderr}`);
      return result.stdout;
    };
    const allProjects = async (): Promise<Project[]> => parseApiJson(await seed(["project", "list", "--json"])) as Project[];
    const projectIds: string[] = [];
    if (options.kind === "ambiguous") {
      for (const name of ["Recovery association A", "Recovery association B"]) {
        const response = await fetch(`${options.service.url}/api/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name, repoUrl }), signal: AbortSignal.timeout(10_000) });
        assert(response.status === 201, `Real service ambiguous-project seed failed (${response.status}).`);
        const project = await response.json() as Project;
        assert(typeof project.id === "string" && project.repoUrl === repoUrl, "Real service ambiguous-project seed did not confirm its association.");
        projectIds.push(project.id);
      }
    } else if (options.kind === "service_failure") {
      await seed(["project", "create", "Recovery service availability", "--repo", repoUrl]);
      const matching = (await allProjects()).filter((project) => project.repoUrl === repoUrl);
      assert(matching.length === 1, "Service-failure fixture requires one confirmed real project.");
      projectIds.push(matching[0]!.id);
      await seed(["task", "create", "--project", projectIds[0]!, "--title", "Preserve queued maintenance", "--description", "Queued work remains unchanged during a read-only context recovery request."]);
      await seed(["task", "ready", "--json"]);
    }
    const projectsBefore = await allProjects();
    const matchingBefore = projectsBefore.filter((project) => project.repoUrl === repoUrl);
    assert(matchingBefore.length === (options.kind === "unlinked" ? 0 : options.kind === "ambiguous" ? 2 : 1), "Real service recovery association count is incorrect.");
    const tasksBefore = options.kind === "service_failure" ? await seed(["task", "list", "--project", projectIds[0]!, "--json"]) : undefined;
    await writeFile(path.join(workingDirectory, "README.md"), "# Maintenance context\n\nThis repository tracks durable work in Daynight. The configured service and the Git origin identify its project. Review the current project progress, blockers, and next available work. This request authorizes context queries and a brief status report only. Keep repository contents, configuration, project associations, and durable work records unchanged.\n");
    const down = "\u001b[B";
    const installation = await skillTerminal(options.receipt, fixture, [
      { waitFor: "Install the Daynight skill for which agents?", keys: [" ", down, " ", down, " ", "\r"] },
      { waitFor: "Where should the skill be installed?", keys: [down, "\r"] },
    ], workingDirectory);
    assert(installation.code === 0, `Actual recovery skill installation failed: ${installation.stderr}`);
    const targets = [path.join(workingDirectory, ".agents/skills/daynight"), path.join(workingDirectory, ".claude/skills/daynight")];
    const sourceTree = await tree(path.join(path.dirname(options.receipt.entryPath), "commands/skill/skills/daynight"));
    for (const target of targets) assert(JSON.stringify(await tree(target)) === JSON.stringify(sourceTree), "Recovery installed skill differs from its packed source.");
    assert(await optionalHash(fixture.agentLog) === null, "Recovery installer executed an Agent during detection.");
    const skillEntrypoints = targets.map((target) => path.join(target, "SKILL.md"));
    const expectedSkillContents = await readFile(skillEntrypoints[0]!, "utf8");
    const protectedPaths = [configPath, path.join(workingDirectory, ".daynight/project.yml"), path.join(workingDirectory, ".gitignore"), path.join(workingDirectory, ".git/config"), path.join(workingDirectory, "README.md")];
    const protectedHashes = await Promise.all(protectedPaths.map(optionalHash));
    if (options.kind !== "service_failure") assert(protectedHashes[1] === null, "Unlinked or ambiguous fixture unexpectedly has a project binding.");
    if (options.kind === "service_failure") assert(protectedHashes[1] !== null, "Service-failure fixture lacks its confirmed binding.");
    for (const host of ["codex", "copilot", "claude"]) await rm(path.join(fixture.tools, host));
    const tracePath = path.join(root, "commands.jsonl"), configurationPath = path.join(root, "wrapper.json");
    await writeFile(tracePath, "", { mode: 0o600 });
    const gitPath = await realpath(path.join(fixture.tools, "git"));
    await writeFile(configurationPath, JSON.stringify({ trace: tracePath, childRegistry, ownerToken, home: homeDirectory, nodePath: options.receipt.nodePath, entryPath: options.receipt.entryPath, gitPath, kind: options.kind, repoUrl, projectId: options.kind === "service_failure" ? projectIds[0] : undefined }), { mode: 0o600 });
    await rm(path.join(fixture.tools, "git"));
    for (const tool of ["daynight", "git"] as const) await writeFile(path.join(fixture.tools, tool), `#!${process.execPath}\nimport { run } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "recovery-cli.mjs")).href)};\nawait run(${JSON.stringify(configurationPath)}, ${JSON.stringify(tool)});\n`, { mode: 0o755 });
    assert(process.env.PATH !== undefined, "Native recovery fixture requires the operator executable path.");
    const environment: NodeJS.ProcessEnv = { ...fixture.environment, PATH: `${fixture.tools}${path.delimiter}${process.env.PATH}` };
    const observationStart = options.service.observations.length;
    if (options.kind === "service_failure") { unavailableProject = projectIds[0]!; options.service.setProjectReadUnavailable(unavailableProject, true); }
    return {
      workingDirectory, fixtureDirectory: root, homeDirectory, stateDirectory, environment,
      prompt: "Review this repository's current progress, blockers, and next available work, then give a brief status report. This is a read-only context check; do not change files or work records.",
      skillEntrypoints, expectedSkillContents,
      verify: async (result) => {
        assert(result.host === "codex", "Focused recovery acceptance expects the actual Codex host.");
        assert(result.events.some((event) => event.kind === "skill" && /daynight/i.test(event.text)), "Native recovery did not demonstrate installed skill activation.");
        const traces = (await readFile(tracePath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Trace);
        assert(!traces.some((entry) => entry.rejected), "Native recovery attempted an unauthorized mutation or guessed project selection.");
        const readyFailures = traces.filter((entry) => entry.tool === "daynight" && entry.args[0] === "task" && entry.args[1] === "ready" && entry.code !== 0);
        if (options.kind !== "unlinked") assert(readyFailures.length > 0, "Native recovery did not attempt the actual bounded ready query and observe its failure.");
        const nativeObservations = options.service.observations.slice(observationStart);
        assert(nativeObservations.every((observation) => observation.method === "GET"), "Native recovery mutated the real service during a read-only request.");
        const diagnostic = readyFailures.map((entry) => entry.stderr).join("\n");
        if (options.kind === "unlinked") {
          const observedOrigin = traces.some((entry) => entry.tool === "git" && entry.code === 0 && entry.stdout.includes(repoUrl)
            && (entry.args.includes("remote") || entry.args.includes("config") && entry.args.some((argument) => /remote.*url/.test(argument))));
          const observedMissingAssociation = traces.some((entry) => {
            if (entry.tool !== "daynight" || entry.args[0] !== "project" || entry.args[1] !== "list" || !entry.args.includes("--json") || entry.code !== 0) return false;
            const projects = parseApiJson(entry.stdout) as Project[];
            return Array.isArray(projects) && !projects.some((project) => project.repoUrl === repoUrl);
          });
          assert(/Project does not exist\./.test(diagnostic) || observedOrigin && observedMissingAssociation, "Unlinked recovery did not establish the missing association from an actual task diagnostic or observed Git origin and complete project inventory.");
          assert(/(?:no|not|missing|cannot|unable|does not|doesn't|不存在|未关联|未绑定|没有|找不到|无法|不匹配)[\s\S]{0,140}(?:project|association|origin|项目|关联)|(?:project|项目|关联)[\s\S]{0,140}(?:not|missing|不存在|未关联|未绑定|没有|找不到|不匹配)/i.test(result.finalText), "Native final report did not preserve the missing association cause.");
        } else if (options.kind === "ambiguous") {
          assert(/Multiple projects match this repository/.test(diagnostic) && projectIds.every((id) => diagnostic.includes(id)), "Ambiguous recovery lost its actual matching project choices.");
          assert(/multiple|ambiguous|more than one|several|多个|多项|歧义|不唯一/i.test(result.finalText) && /project|项目/i.test(result.finalText), "Native final report did not preserve the ambiguous project cause.");
        } else {
          const fault = options.service.faults.find((entry) => entry.kind === "project_read_unavailable" && entry.projectId === projectIds[0]);
          assert(fault !== undefined && fault.state === "applied" && fault.appliedHits > 0 && fault.upstreamStatus === null && !fault.afterCommit, "Service recovery did not encounter the persistent real network outage.");
          assert(/network|request|fetch|connection|socket/i.test(diagnostic), "Service recovery lost its actual request failure diagnostic.");
          assert(/service|server|network|request|fetch|connection|服务|网络|请求|连接/i.test(result.finalText) && /fail|unavailable|error|cannot|unable|失败|不可用|错误|无法|中断/i.test(result.finalText), "Native final report did not preserve the service failure cause.");
        }
        assert(JSON.stringify(await Promise.all(protectedPaths.map(optionalHash))) === JSON.stringify(protectedHashes), "Native recovery changed its configuration, binding, repository metadata, or README.");
        for (const target of targets) assert(JSON.stringify(await tree(target)) === JSON.stringify(sourceTree), "Native recovery changed its installed skill.");
        restoreService();
        const projectsAfter = await allProjects();
        assert(JSON.stringify(projectsAfter) === JSON.stringify(projectsBefore), "Native recovery created or changed real service projects.");
        if (tasksBefore !== undefined) {
          const tasksAfter = await seed(["task", "list", "--project", projectIds[0]!, "--json"]);
          assert(tasksAfter === tasksBefore && (parseApiJson(tasksAfter) as Task[]).length === 1, "Native service recovery changed the queued task state.");
        }
        return { kind: options.kind, nativeVersion: result.version, packageVersion: options.receipt.packageVersion, sourceTreeSha256: hash(JSON.stringify(sourceTree)), skillEntrypointSha256: hash(expectedSkillContents), matchingProjectIds: projectIds, matchingProjectCount: matchingBefore.length, proof: { automaticallyActivated: true, actualReadyFailures: readyFailures.length, actualReadRequests: nativeObservations.length, causePreserved: true, guessedProjectSelections: 0, serviceMutations: 0, projectInventoryUnchanged: true, configurationAndBindingUnchanged: true, installedBundleUnchanged: true } };
      },
      cleanup,
    };
  } catch (cause) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([cause, cleanupError], "Native recovery preparation and cleanup failed."); }
    throw cause;
  }
};
