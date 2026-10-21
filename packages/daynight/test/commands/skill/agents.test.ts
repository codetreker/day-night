import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectSkillAgents } from "../../../src/commands/skill/agents.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("static agent detection", () => {
  it("looks up only the fixed launchers in stable order and preserves lookup failures", async () => {
    const lookup = vi.fn(async (command: string) => command === "copilot" ? "/bin/copilot" : null);
    expect((await detectSkillAgents(lookup)).map(({ id }) => id)).toEqual(["copilot"]);
    expect(lookup.mock.calls.map(([command]) => command)).toEqual(["codex", "copilot", "claude"]);
    const failure = new Error("Cannot inspect PATH");
    await expect(detectSkillAgents(async () => { throw failure; })).rejects.toBe(failure);
  });

  it("uses native PATH lookup without launching an executable", async () => {
    const temporary = path.resolve(import.meta.dirname, "../../../../../.tmp/agent-detection");
    await mkdir(temporary, { recursive: true });
    const directory = await mkdtemp(path.join(temporary, "PATH space 中文-"));
    directories.push(directory);
    const marker = path.join(directory, "executed");
    const launcher = path.join(directory, process.platform === "win32" ? "codex.cmd" : "codex");
    await writeFile(launcher, process.platform === "win32" ? `@echo called > "${marker}"\r\n` : `#!/bin/sh\nprintf called > '${marker.replaceAll("'", "'\\''")}'\n`);
    await chmod(launcher, 0o755);
    vi.stubEnv("PATH", directory);
    if (process.platform === "win32") { vi.stubEnv("Path", directory); vi.stubEnv("PATHEXT", ".COM;.EXE;.BAT;.CMD"); }
    expect((await detectSkillAgents()).map(({ id }) => id)).toEqual(["codex"]);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    if (process.platform !== "win32") {
      await chmod(launcher, 0o644);
      expect(await detectSkillAgents()).toEqual([]);
    }
  });
});
