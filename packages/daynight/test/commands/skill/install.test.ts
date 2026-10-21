import * as fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillAgents } from "../../../src/commands/skill/agents.js";
import { captureInstalledSkill, installSkillTargets, SkillInstallationError } from "../../../src/commands/skill/install.js";
import { planSkillTargets } from "../../../src/commands/skill/targets.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });
const signal = (): AbortSignal => new AbortController().signal;
const codex = skillAgents[0];
const claude = skillAgents[2];
const fixture = async () => {
  const temporary = path.resolve(import.meta.dirname, "../../../../../.tmp/skill-unit");
  await fs.mkdir(temporary, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temporary, "install 中文-"));
  directories.push(directory);
  const packageDirectory = path.join(directory, "package");
  const source = path.join(packageDirectory, "dist/commands/skill/skills/daynight");
  await fs.mkdir(path.join(source, "references"), { recursive: true });
  await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: daynight\ndescription: Track project work\n---\nRead references/commands.md\n");
  await fs.writeFile(path.join(source, "references/commands.md"), "Current commands\n");
  await fs.writeFile(path.join(source, "resource.bin"), Buffer.from([0, 255, 128]));
  const base = path.join(directory, "home");
  await fs.mkdir(base);
  return { directory, packageDirectory, source, base };
};
const link = async (target: string, filename: string): Promise<void> => fs.symlink(target, filename, process.platform === "win32" ? "junction" : "dir");

describe("complete skill installation", () => {
  it("captures the installed package once and overwrites edited and obsolete content without touching siblings", async () => {
    const { packageDirectory, source, base } = await fixture();
    const targets = await planSkillTargets(base, skillAgents);
    expect(targets).toHaveLength(2);
    const first = targets[0]!;
    await fs.mkdir(first.path, { recursive: true });
    await fs.writeFile(path.join(first.path, "SKILL.md"), "Local edits");
    await fs.writeFile(path.join(first.path, "obsolete"), "old");
    await fs.mkdir(path.join(first.parent, "another"));
    await fs.writeFile(path.join(first.parent, "another/SKILL.md"), "other skill");
    const bundle = await captureInstalledSkill(packageDirectory);
    await fs.writeFile(path.join(source, "references/commands.md"), "Changed after capture");
    const installed = vi.fn();
    await installSkillTargets(targets, bundle, signal(), installed);
    expect(installed).toHaveBeenCalledTimes(2);
    for (const target of targets) {
      expect((await fs.readdir(target.path)).sort()).toEqual(["SKILL.md", "references", "resource.bin"]);
      expect(await fs.readFile(path.join(target.path, "references/commands.md"), "utf8")).toBe("Current commands\n");
      expect(await fs.readFile(path.join(target.path, "resource.bin"))).toEqual(Buffer.from([0, 255, 128]));
    }
    expect(await fs.readFile(path.join(first.parent, "another/SKILL.md"), "utf8")).toBe("other skill");
  });

  it("deduplicates linked parent directories and replaces only a target leaf link", async () => {
    const { packageDirectory, base, directory } = await fixture();
    await fs.mkdir(path.join(base, ".agents/skills"), { recursive: true });
    await fs.mkdir(path.join(base, ".claude"));
    await link(path.join(base, ".agents/skills"), path.join(base, ".claude/skills"));
    const outside = path.join(directory, "leaf contents");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep"), "external");
    const leaf = path.join(base, ".agents/skills/daynight");
    await link(outside, leaf);
    const targets = await planSkillTargets(base, skillAgents);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.agents.map(({ id }) => id)).toEqual(["codex", "copilot", "claude"]);
    await installSkillTargets(targets, await captureInstalledSkill(packageDirectory), signal(), vi.fn());
    expect((await fs.lstat(leaf)).isSymbolicLink()).toBe(false);
    expect((await fs.lstat(path.join(base, ".claude/skills"))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(outside, "keep"), "utf8")).toBe("external");
  });

  it.each([false, true])("rejects nested physical targets before writing, reversed=%s", async (reversed) => {
    const { base } = await fixture();
    await fs.mkdir(path.join(base, ".claude/skills/daynight"), { recursive: true });
    await fs.mkdir(path.join(base, ".agents"));
    await link(path.join(base, ".claude/skills/daynight"), path.join(base, ".agents/skills"));
    await expect(planSkillTargets(base, reversed ? [claude, codex] : [codex, claude])).rejects.toThrow("overlapping skill targets");
    expect(await fs.readdir(path.join(base, ".claude/skills/daynight"))).toEqual([]);
  });

  it("leaves no directories when cancelled before the first mutation", async () => {
    const { packageDirectory, base } = await fixture();
    const targets = await planSkillTargets(base, [codex]);
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(installSkillTargets(targets, await captureInstalledSkill(packageDirectory), controller.signal, vi.fn())).rejects.toMatchObject({ failed: undefined, unattempted: targets });
    expect(await fs.readdir(base)).toEqual([]);
  });

  it("cleans staging and newly created empty parents after cancellation during copy", async () => {
    const { packageDirectory, base } = await fixture();
    const targets = await planSkillTargets(base, [codex]);
    const controller = new AbortController();
    const writeFile = vi.fn<typeof fs.writeFile>().mockImplementation(async (...args) => { await fs.writeFile(...args); controller.abort(new Error("cancelled while copying")); });
    await expect(installSkillTargets(targets, await captureInstalledSkill(packageDirectory), controller.signal, vi.fn(), { ...fs, writeFile })).rejects.toBeInstanceOf(SkillInstallationError);
    expect(await fs.readdir(base)).toEqual([]);
  });

  it("finishes publishing after cancellation arrives during removal and preserves the successful outcome", async () => {
    const { packageDirectory, base } = await fixture();
    const targets = await planSkillTargets(base, [codex]);
    const controller = new AbortController();
    const cancelled = new Error("cancelled during removal");
    const rm = vi.fn<typeof fs.rm>().mockImplementation(async (...args) => { await fs.rm(...args); if (args[0] === targets[0]!.path) controller.abort(cancelled); });
    const installed = vi.fn();
    await expect(installSkillTargets(targets, await captureInstalledSkill(packageDirectory), controller.signal, installed, { ...fs, rm })).rejects.toBe(cancelled);
    expect(installed).toHaveBeenCalledWith(targets[0]);
    expect(await fs.readFile(path.join(targets[0]!.path, "references/commands.md"), "utf8")).toBe("Current commands\n");
  });

  it("preserves successful targets, reports removal-before-rename failure and does not attempt later targets", async () => {
    const { packageDirectory, base, directory } = await fixture();
    const targets = await planSkillTargets(base, [codex, claude]);
    await fs.mkdir(targets[1]!.path, { recursive: true });
    await fs.writeFile(path.join(targets[1]!.path, "old"), "old");
    const third = (await planSkillTargets(path.join(directory, "later"), [codex]))[0]!;
    targets.push(third);
    const failure = new Error("rename permission denied");
    const rename = vi.fn<typeof fs.rename>().mockImplementation(async (...args) => { if (args[1] === targets[1]!.path) throw failure; await fs.rename(...args); });
    const installed = vi.fn();
    let error: unknown;
    try { await installSkillTargets(targets, await captureInstalledSkill(packageDirectory), signal(), installed, { ...fs, rename }); }
    catch (cause) { error = cause; }
    expect(error).toMatchObject({ completed: [targets[0]], failed: targets[1], unattempted: [third], cause: { message: expect.stringContaining("target may now be absent"), cause: failure } });
    expect(installed).toHaveBeenCalledTimes(1);
    await expect(fs.lstat(targets[1]!.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(path.join(directory, "later"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(targets[1]!.parent)).toEqual([]);
    expect(await fs.readFile(path.join(targets[0]!.path, "references/commands.md"), "utf8")).toBe("Current commands\n");
  });

  it("retains cleanup failure and original copy failure in the error chain", async () => {
    const { packageDirectory, base } = await fixture();
    const targets = await planSkillTargets(base, [codex]);
    const writeFailure = new Error("disk full");
    const cleanupFailure = new Error("stage is busy");
    const writeFile = vi.fn<typeof fs.writeFile>().mockRejectedValue(writeFailure);
    const rm = vi.fn<typeof fs.rm>().mockRejectedValue(cleanupFailure);
    let error: unknown;
    try { await installSkillTargets(targets, await captureInstalledSkill(packageDirectory), signal(), vi.fn(), { ...fs, writeFile, rm }); }
    catch (cause) { error = cause; }
    expect(error).toMatchObject({ cause: { message: "Skill installation cleanup failed.", errors: [{ cause: cleanupFailure }], cause: { cause: writeFailure } } });
  });
});

describe("installed bundle validation", () => {
  it.each([
    ["wrong name", "---\nname: another\ndescription: Track tasks\n---\n"],
    ["empty description", "---\nname: daynight\ndescription: ''\n---\n"],
    ["invalid YAML", "---\nname: [\n---\n"],
    ["invalid UTF8", Buffer.from([0xff])],
  ])("rejects %s without creating targets", async (_name, contents) => {
    const { packageDirectory, source, base } = await fixture();
    await fs.writeFile(path.join(source, "SKILL.md"), contents);
    await expect(captureInstalledSkill(packageDirectory)).rejects.toThrow("Cannot capture installed Daynight skill bundle");
    expect(await fs.readdir(base)).toEqual([]);
  });

  it("rejects a source link without following its external content", async () => {
    const { packageDirectory, source, directory, base } = await fixture();
    await link(base, path.join(source, "external"));
    await expect(captureInstalledSkill(packageDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("must not contain symbolic links") } });
    await fs.rm(path.join(source, "external"));
    await fs.rename(source, path.join(directory, "real bundle"));
    await link(path.join(directory, "real bundle"), source);
    await expect(captureInstalledSkill(packageDirectory)).rejects.toMatchObject({ cause: { message: expect.stringContaining("without symbolic links") } });
  });
});
