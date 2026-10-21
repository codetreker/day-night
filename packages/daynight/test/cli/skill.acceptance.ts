import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInstalledCli, terminateInstalledProcess } from "../fixtures/installed-cli.js";
import { createSkillFixture, skillPipe, skillTerminal, skillTerminalEvidence, skillTerminalSessionsClosed } from "../fixtures/skill-terminal.js";
import type { SkillFixture, TerminalAction } from "../fixtures/skill-terminal.js";

const agentsPrompt = "Install the Daynight skill for which agents?";
const scopePrompt = "Where should the skill be installed?";
const down = "\u001b[B";
let installed: Awaited<ReturnType<typeof createInstalledCli>>;
let sequence = 0;
const scenarios: string[] = [];
const evidencePath = path.resolve(import.meta.dirname, "../../../../.tmp/skill-install-evidence.json");
beforeAll(async () => { await rm(evidencePath, { force: true }); installed = await createInstalledCli(); });
afterAll(async () => {
  if (installed === undefined) return;
  const failures: unknown[] = [];
  try { await installed.cleanup(); } catch (cause) { failures.push(cause); }
  let installationRemoved = false;
  try { await lstat(installed.receipt.root); }
  catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") installationRemoved = true; else failures.push(cause); }
  const { packageVersion, tarballSha256, entrySha256, source } = installed.receipt;
  const terminalSessionsClosed = skillTerminalSessionsClosed();
  await writeFile(evidencePath, `${JSON.stringify({ schemaVersion: 1, success: scenarios.length === 8 && failures.length === 0 && installationRemoved && terminalSessionsClosed, platform: process.platform, nodeVersion: process.version, artifact: { packageVersion, tarballSha256, entrySha256, source }, scenarios, terminals: skillTerminalEvidence, cleanup: { installationRemoved, terminalSessionsClosed, errors: failures.length } }, null, 2)}\n`, { mode: 0o600 });
  if (failures.length !== 0) throw new AggregateError(failures, "Installed skill acceptance cleanup failed.");
  expect(installationRemoved).toBe(true);
  expect(terminalSessionsClosed).toBe(true);
});

const fresh = (agents: readonly string[]): Promise<SkillFixture> => createSkillFixture(path.join(installed.receipt.root, `skill terminal ${sequence++}`), agents);
const selection = (keys: readonly string[] = [" ", "\r"], project = false): TerminalAction[] => [
  { waitFor: agentsPrompt, keys },
  { waitFor: scopePrompt, keys: project ? [down, "\r"] : ["\r"] },
];
const tree = async (directory: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const relative = path.relative(directory, file).replaceAll("\\", "/");
      if (entry.isDirectory()) { files[`${relative}/`] = "directory"; await visit(file); }
      else files[relative] = createHash("sha256").update(await readFile(file)).digest("hex");
    }
  };
  await visit(directory);
  return files;
};
const bundle = (): string => path.join(path.dirname(installed.receipt.entryPath), "commands/skill/skills/daynight");
const expectBundle = async (target: string): Promise<void> => { expect(await tree(target)).toEqual(await tree(bundle())); };
const untouched = async (fixture: SkillFixture): Promise<void> => {
  await expect(readFile(fixture.agentLog)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(path.join(fixture.home, ".daynight"))).rejects.toMatchObject({ code: "ENOENT" });
};
const git = async (fixture: SkillFixture, args: readonly string[], cwd: string): Promise<void> => {
  const child = crossSpawn("git", [...args], { cwd, env: fixture.environment, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr!.on("data", (data: Buffer) => { output += data.toString(); });
  let failure: Error | undefined;
  child.once("error", (cause) => { failure = cause; });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([closed, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), 15_000); })]);
    if (code === "timeout") { await terminateInstalledProcess(child, closed); throw new Error(`Fixture Git exceeded fifteen seconds: ${output}`); }
    if (failure !== undefined) throw failure;
    if (code !== 0) throw new Error(`Fixture Git ${args.join(" ")} failed (${String(code)}): ${output}`);
  } finally { if (timer !== undefined) clearTimeout(timer); }
};

it("isolates help, argument errors, noninteractive refusal and unavailable-agent detection from installation and configuration", async () => {
  const fixture = await fresh(["codex", "copilot", "claude"]);
  await mkdir(path.join(fixture.home, ".daynight"));
  const configuration = path.join(fixture.home, ".daynight/config.yml");
  await writeFile(configuration, "serverUrl: [\n");
  for (const args of [["--help"], ["skill", "--help"], ["skill", "install", "--help"], ["skill", "install", "--scope", "user"]]) {
    const result = await skillPipe(installed.receipt, fixture, args);
    expect(result.code, result.stderr).toBe(args.includes("--scope") ? 2 : 0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(agentsPrompt);
    expect(await readFile(configuration, "utf8")).toBe("serverUrl: [\n");
    expect(await readdir(fixture.home)).toEqual([".daynight"]);
  }
  const noninteractive = await skillPipe(installed.receipt, fixture, ["skill", "install"]);
  expect(noninteractive.code).toBe(1);
  expect(noninteractive.stdout).toBe("");
  expect(noninteractive.stderr).toContain("interactive terminal");
  expect(await readdir(fixture.home)).toEqual([".daynight"]);
  await expect(readFile(fixture.agentLog)).rejects.toMatchObject({ code: "ENOENT" });

  const none = await fresh([]);
  const unavailable = await skillTerminal(installed.receipt, none, []);
  expect(unavailable.code, unavailable.stderr).toBe(1);
  expect(unavailable.stdout).toBe("");
  expect(unavailable.stderr).toContain("No supported agent launchers were detected");
  expect(unavailable.stderr).not.toContain(agentsPrompt);
  expect(await readdir(none.home)).toEqual([]);
  await untouched(none);
  scenarios.push("help-argument-errors-noninteractive-and-zero-agents");
});

it("requires an explicit checkbox selection and installs the complete bundle to default User scope outside Git", async () => {
  const fixture = await fresh(["claude"]);
  const result = await skillTerminal(installed.receipt, fixture, [
    { waitFor: agentsPrompt, keys: ["\r"] },
    { waitFor: "Select at least one agent.", keys: [" ", "\r"] },
    { waitFor: scopePrompt, keys: ["\r"] },
  ]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toContain("Claude Code");
  expect(result.stderr).not.toContain("Copilot CLI");
  expect(result.stderr).not.toContain("Codex");
  expect(result.stdout).toContain("Installed Claude Code: User skill at");
  expect(result.stdout).toContain(installed.receipt.packageVersion);
  expect(result.stdout).not.toContain(agentsPrompt);
  expect(result.stdout).not.toContain(scopePrompt);
  const target = path.join(fixture.home, ".claude/skills/daynight");
  expect(result.stdout).toContain(target);
  await expectBundle(target);
  await expect(lstat(path.join(fixture.home, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
  await untouched(fixture);
  scenarios.push("single-agent-explicit-checkbox-and-default-user-scope");
});

it("drives native checkbox arrows and Project selection from a new no-origin repository subdirectory, sharing Codex and Copilot output", async () => {
  const fixture = await fresh(["codex", "copilot", "claude"]);
  const project = path.join(fixture.root, "fresh project 中文");
  const subdirectory = path.join(project, "source/subdirectory");
  await mkdir(subdirectory, { recursive: true });
  await git(fixture, ["init", "--initial-branch=fixture"], project);
  const result = await skillTerminal(installed.receipt, fixture, selection([" ", down, " ", "\r"], true), subdirectory);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("Installed Codex: Project skill at");
  expect(result.stdout).toContain("Installed Copilot CLI: Project skill at");
  expect(result.stdout).toContain("shared installation");
  expect(result.stdout).not.toContain("Installed Claude Code");
  const target = path.join(project, ".agents/skills/daynight");
  expect(result.stdout.split(target)).toHaveLength(3);
  await expectBundle(target);
  expect(await readdir(path.dirname(target))).toEqual(["daynight"]);
  await expect(lstat(path.join(project, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(fixture.home)).toEqual([]);
  await untouched(fixture);
  scenarios.push("multiple-agents-project-subdirectory-no-origin-and-shared-target");
});

it("replaces modified and stale files while preserving sibling skills and reuses existing parent-directory aliases", async () => {
  const fixture = await fresh(["codex", "copilot", "claude"]);
  const parent = path.join(fixture.home, ".agents/skills");
  await mkdir(path.join(parent, "sibling"), { recursive: true });
  await writeFile(path.join(parent, "sibling/SKILL.md"), "untouched sibling\n");
  const first = await skillTerminal(installed.receipt, fixture, selection());
  expect(first.code, first.stderr).toBe(0);
  const target = path.join(parent, "daynight");
  await writeFile(path.join(target, "SKILL.md"), "locally modified\n");
  await writeFile(path.join(target, "obsolete.txt"), "old bundle file\n");
  await mkdir(path.join(target, "obsolete-empty-directory"));
  await mkdir(path.join(fixture.home, ".claude"));
  await symlink(parent, path.join(fixture.home, ".claude/skills"), process.platform === "win32" ? "junction" : "dir");
  const repeated = await skillTerminal(installed.receipt, fixture, selection([" ", down, " ", down, " ", "\r"]));
  expect(repeated.code, repeated.stderr).toBe(0);
  expect(repeated.stdout).toContain("Installed Codex: User skill at");
  expect(repeated.stdout).toContain("Installed Copilot CLI: User skill at");
  expect(repeated.stdout).toContain("Installed Claude Code: User skill at");
  expect(repeated.stdout.match(/shared installation/g)).toHaveLength(2);
  expect((await lstat(path.join(fixture.home, ".claude/skills"))).isSymbolicLink()).toBe(true);
  await expectBundle(target);
  expect(await readFile(path.join(parent, "sibling/SKILL.md"), "utf8")).toBe("untouched sibling\n");
  expect(await readdir(parent)).toEqual(["daynight", "sibling"]);
  await untouched(fixture);
  scenarios.push("overwrite-sibling-preservation-and-parent-alias");
});

it("uses the current linked worktree root for Project scope without a Daynight association", async () => {
  const fixture = await fresh(["codex"]);
  const primary = path.join(fixture.root, "primary repository");
  const linked = path.join(fixture.root, "linked worktree 中文");
  await mkdir(primary);
  await git(fixture, ["init", "--initial-branch=fixture"], primary);
  await git(fixture, ["worktree", "add", "--orphan", "-b", "linked-fixture", linked], primary);
  const result = await skillTerminal(installed.receipt, fixture, selection(undefined, true), linked);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain(path.join(linked, ".agents/skills/daynight"));
  await expectBundle(path.join(linked, ".agents/skills/daynight"));
  await expect(lstat(path.join(primary, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(path.join(linked, ".daynight"))).rejects.toMatchObject({ code: "ENOENT" });
  await untouched(fixture);
  scenarios.push("linked-worktree-without-project-association");
});

it.each(["agent", "scope"])("handles real Ctrl+C at the %s selector with no installed directory or stdout result", async (stage) => {
  const fixture = await fresh(["codex", "copilot", "claude"]);
  const actions: TerminalAction[] = stage === "agent"
    ? [{ waitFor: agentsPrompt, keys: ["\u0003"] }]
    : [{ waitFor: agentsPrompt, keys: [" ", "\r"] }, { waitFor: scopePrompt, keys: ["\u0003"] }];
  const result = await skillTerminal(installed.receipt, fixture, actions);
  expect(result.code, result.stderr).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Operation cancelled.");
  expect(await readdir(fixture.home)).toEqual([]);
  await untouched(fixture);
  scenarios.push(`ctrl-c-${stage}-selection`);
});

it("hands native stdin from setup text questions to a choice and back without consuming answers or arrow keys", async () => {
  const fixture = await fresh([]);
  const result = await skillTerminal(installed.receipt, fixture, [
    { waitFor: "First input: ", keys: ["first-value\r"] },
    { waitFor: "Choose a value?", keys: [down, "\r"] },
    { waitFor: "Last input: ", keys: ["last-value\r"] },
  ], fixture.home, {
    launcherPath: process.execPath,
    args: [path.resolve(import.meta.dirname, "../fixtures/skill-terminal-handoff.mjs"), path.join(path.dirname(installed.receipt.entryPath), "cli/prompts.js")],
  });
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ first: "first-value", choice: "two", last: "last-value" });
  expect(await readdir(fixture.home)).toEqual([]);
  await untouched(fixture);
  scenarios.push("native-readline-select-readline-handoff");
});
