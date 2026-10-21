import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exactCodexConfigCat, readOwnedCodexConfig } from "./codex-config-read.js";

const workingDirectory = path.resolve("fixture/repository");
it.each([
  "cat .git/config",
  "cat -- '.git/config'",
  "/bin/bash -c 'command -v git; command -v daynight; cat .git/config'",
  "/bin/bash -c 'ls -la; if test -f .git/config; then cat .git/config; fi; type -a git'",
  "/bin/bash -lc 'cat .git/config && true'",
])("recognizes the exact owned config read in %s", (command) => {
  expect(exactCodexConfigCat(command, workingDirectory)).toBe(path.join(workingDirectory, ".git/config"));
});

it.each([
  "echo cat .git/config",
  "echo 'cat .git/config'",
  "echo '; cat .git/config;'",
  "cat ../repository/.git/config",
  "cat /other/.git/config",
  "cat missing; true",
  "echo ignored #; cat .git/config",
  "echo $(cat .git/config)",
  "printf '%s' 'cat .git/config'",
  "cat .git/config > hidden",
  "cd /other; cat .git/config",
  "source script; cat .git/config",
  "eval harmless; cat .git/config",
])("rejects command text that does not prove an exact owned config read: %s", (command) => {
  expect(exactCodexConfigCat(command, workingDirectory)).toBeUndefined();
});

describe("owned config evidence candidates", () => {
  let root: string;
  beforeEach(async () => {
    const temporary = path.resolve(import.meta.dirname, "../../../../.tmp");
    await mkdir(temporary, { recursive: true });
    root = await mkdtemp(path.join(temporary, "codex-config-"));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("skips .git/config below a linked worktree's .git file", async () => {
    await writeFile(path.join(root, ".git"), "gitdir: ../primary/.git/worktrees/linked\n");
    const command = "if test -f .git/config; then cat .git/config; fi; cat README.md";
    const candidate = exactCodexConfigCat(command, root);
    expect(candidate).toBe(path.join(root, ".git/config"));
    expect(readOwnedCodexConfig(candidate!, root)).toBeUndefined();
  });

  it("skips a missing .git/config file", async () => {
    await mkdir(path.join(root, ".git"));
    expect(readOwnedCodexConfig(path.join(root, ".git/config"), root)).toBeUndefined();
  });

  it("reads an existing bounded regular .git/config file", async () => {
    await mkdir(path.join(root, ".git"));
    const contents = '[remote "origin"]\n\turl = https://example.test/owned.git\n';
    await writeFile(path.join(root, ".git/config"), contents);
    expect(readOwnedCodexConfig(path.join(root, ".git/config"), root)).toBe(contents);
  });

  it("skips an existing config directory and an oversized config file", async () => {
    await mkdir(path.join(root, ".git/config"), { recursive: true });
    expect(readOwnedCodexConfig(path.join(root, ".git/config"), root)).toBeUndefined();
    await rm(path.join(root, ".git/config"), { recursive: true });
    await writeFile(path.join(root, ".git/config"), "x".repeat(16 * 1024 + 1));
    expect(readOwnedCodexConfig(path.join(root, ".git/config"), root)).toBeUndefined();
  });
});
