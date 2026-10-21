import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliCancelledError } from "../../../src/cli/cancellation.js";
import type { CliContext } from "../../../src/cli/context.js";
import type { CliPrompt, PromptMultipleSelection, PromptSelection } from "../../../src/cli/prompts.js";
import { skillAgents } from "../../../src/commands/skill/agents.js";
import { runSkillCommand } from "../../../src/commands/skill/command.js";
import type { SkillCommandDependencies } from "../../../src/commands/skill/command.js";
import { SkillInstallationError } from "../../../src/commands/skill/install.js";
import { planSkillTargets } from "../../../src/commands/skill/targets.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const fixture = async () => {
  const temporary = path.resolve(import.meta.dirname, "../../../../../.tmp/skill-command");
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, "command-")); directories.push(directory);
  const selections: unknown[] = [];
  const prompt: CliPrompt = {
    isInteractive: true, ask: async () => { throw new Error("Unexpected free-text question"); }, close: vi.fn(),
    selectMany: async <Value>(question: PromptMultipleSelection<Value>): Promise<Value[]> => { selections.push(question); return ["codex", "copilot", "claude"] as Value[]; },
    select: async <Value>(question: PromptSelection<Value>): Promise<Value> => { selections.push(question); return "user" as Value; },
  };
  const context: CliContext = { version: "1.2.3", packageDirectory: "installed package", homeDirectory: () => directory, workingDirectory: () => "outside Git", stdoutBytes: vi.fn(async () => {}), stdout: vi.fn(), stderr: vi.fn(), prompt };
  const dependencies: SkillCommandDependencies = {
    detectAgents: vi.fn(async () => [...skillAgents]), projectRoot: vi.fn(async () => directory),
    captureBundle: vi.fn(async () => []), planTargets: vi.fn(planSkillTargets),
    install: vi.fn(async (targets, _bundle, _signal, installed) => { for (const target of targets) installed(target); }),
  };
  return { directory, selections, context, dependencies, prompt };
};

describe("interactive skill command", () => {
  it.each([[], ["--help"], ["install", "--help"]])("renders isolated help for %j", async (...args) => {
    const { context, dependencies, prompt, directory } = await fixture();
    await runSkillCommand(args, context, dependencies);
    expect(context.stdout).toHaveBeenCalledWith(expect.stringContaining("Usage: daynight skill"));
    expect(dependencies.detectAgents).not.toHaveBeenCalled();
    expect(dependencies.captureBundle).not.toHaveBeenCalled();
    expect(prompt.close).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([["install", "--agent", "codex"], ["install", "extra"], ["remove"]])("rejects unsupported arguments before detection %j", async (...args) => {
    const { context, dependencies } = await fixture();
    await expect(runSkillCommand(args, context, dependencies)).rejects.toThrow();
    expect(dependencies.detectAgents).not.toHaveBeenCalled();
  });

  it("passes typed detected choices in fixed order, uses default User, and reports each shared target", async () => {
    const { context, dependencies, selections, prompt } = await fixture();
    context.workingDirectory = () => { throw new Error("User scope must not inspect Git or cwd"); };
    await runSkillCommand(["install"], context, dependencies);
    expect(selections).toEqual([
      { message: "Install the Daynight skill for which agents?", choices: [{ name: "Codex", value: "codex" }, { name: "Copilot CLI", value: "copilot" }, { name: "Claude Code", value: "claude" }], requiredMessage: "Select at least one agent." },
      { message: "Where should the skill be installed?", choices: [{ name: "User", value: "user" }, { name: "Project", value: "project" }], default: "user" },
    ]);
    expect(dependencies.projectRoot).not.toHaveBeenCalled();
    expect(dependencies.captureBundle).toHaveBeenCalledWith("installed package");
    expect(context.stdout).toHaveBeenCalledTimes(3);
    expect(context.stdout).toHaveBeenCalledWith(expect.stringContaining("Installed Copilot CLI: User skill at"));
    expect(context.stdout).toHaveBeenCalledWith(expect.stringContaining("package 1.2.3; shared installation"));
    expect(context.stderr).not.toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalledOnce();
  });

  it("resolves Project scope through root-only discovery and reports a failed and unattempted target", async () => {
    const { context, dependencies, prompt } = await fixture();
    prompt.select = async <Value>(): Promise<Value> => "project" as Value;
    dependencies.install = async (targets, _bundle, _signal, _installed) => { throw new SkillInstallationError([], targets[0], targets.slice(1), "copy failed", { cause: new Error("disk full") }); };
    await expect(runSkillCommand(["install"], context, dependencies)).rejects.toThrow("copy failed");
    expect(dependencies.projectRoot).toHaveBeenCalledWith("outside Git", expect.any(AbortSignal));
    expect(context.stderr).toHaveBeenCalledWith(expect.stringContaining("Failed Codex: Project skill at"));
    expect(context.stderr).toHaveBeenCalledWith(expect.stringContaining("Failed Copilot CLI: Project skill at"));
    expect(context.stderr).toHaveBeenCalledWith(expect.stringContaining("Not attempted Claude Code: Project skill at"));
    expect(context.stdout).not.toHaveBeenCalled();
  });

  it("fails before detection when input is not interactive", async () => {
    const { context, dependencies, directory } = await fixture();
    context.prompt = { ...context.prompt!, isInteractive: false };
    await expect(runSkillCommand(["install"], context, dependencies)).rejects.toThrow("interactive terminal");
    expect(dependencies.detectAgents).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it("fails with no agents before questions or reads", async () => {
    const { context, dependencies, selections, directory } = await fixture();
    dependencies.detectAgents = async () => [];
    await expect(runSkillCommand(["install"], context, dependencies)).rejects.toThrow("No supported agent launchers");
    expect(selections).toEqual([]);
    expect(dependencies.captureBundle).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(["agents", "scope", "after-scope", "after-preflight"])("cancels at %s before installation writes", async (phase) => {
    const { context, dependencies, prompt, directory } = await fixture();
    const controller = new AbortController();
    const cancelled = new CliCancelledError();
    if (phase === "agents") prompt.selectMany = async () => { throw cancelled; };
    if (phase === "scope") prompt.select = async () => { throw cancelled; };
    if (phase === "after-scope") prompt.select = async <Value>() => { controller.abort(cancelled); return "user" as Value; };
    if (phase === "after-preflight") dependencies.planTargets = async (...args) => { const targets = await planSkillTargets(...args); controller.abort(cancelled); return targets; };
    await expect(runSkillCommand(["install"], context, dependencies, controller.signal)).rejects.toBe(cancelled);
    expect(dependencies.install).not.toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalledOnce();
    expect(context.stdout).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
});
