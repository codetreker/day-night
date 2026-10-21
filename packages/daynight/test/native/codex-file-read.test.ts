import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexArtifactReadEvidence, readOwnedCodexArtifact } from "./codex-file-read.js";

const workingDirectory = path.resolve("fixture/repository");
const skillFilename = path.join(workingDirectory, ".agents/skills/daynight/SKILL.md");
const configFilename = path.join(workingDirectory, ".git/config");
const skillContents = "---\nname: daynight\n---\n# Daynight\nUse the project task record.\n";
const configContents = '[remote "origin"]\n\turl = https://example.test/owned.git\n';
const artifacts = [{ filename: skillFilename, contents: skillContents }, { filename: configFilename, contents: configContents }];
const expectedRead = (filename: string, contents: string) => ({ filename, sha256: createHash("sha256").update(contents).digest("hex") });
const item = (command: string, output = skillContents) => ({ command, cwd: workingDirectory, commandActions: [{ type: "unknown" }], status: "completed", exitCode: 0, aggregatedOutput: output });

it.each([
  "cat .agents/skills/daynight/SKILL.md",
  "cat -- '.agents/skills/daynight/SKILL.md'",
  '/bin/bash -lc "pwd; rg --files -g AGENTS.md -g \'SKILL.md\'; cat .agents/skills/daynight/SKILL.md"',
  String.raw`/bin/bash -lc "pwd; rg --files -g AGENTS.md -g 'SKILL.md' -g 'package.json' -g 'README*' -g '*daynight*' -g '*day-night*' -g '"'!node_modules'"' -g '"'!.git'"'; cat .agents/skills/daynight/SKILL.md"`,
])("proves a complete successful installed skill read in %s", (command) => {
  expect(codexArtifactReadEvidence(item(command, `preceding output\n${skillContents}following output\n`), artifacts)).toEqual([expectedRead(skillFilename, skillContents)]);
});

it.each([
  "/bin/bash -c 'command -v git; command -v daynight; cat .git/config'",
  "/bin/bash -c 'ls -la; if test -f .git/config; then cat .git/config; fi; type -a git'",
])("uses the same matcher for a complete known config read in %s", (command) => {
  expect(codexArtifactReadEvidence(item(command, configContents), artifacts)).toEqual([expectedRead(configFilename, configContents)]);
});

it("proves multiple exact artifacts read by one literal cat invocation", () => {
  expect(codexArtifactReadEvidence(item("cat .agents/skills/daynight/SKILL.md .git/config", `${skillContents}${configContents}`), artifacts)).toEqual([expectedRead(skillFilename, skillContents), expectedRead(configFilename, configContents)]);
});

it("accepts structured exact read metadata with full actual contents", () => {
  expect(codexArtifactReadEvidence({ ...item("native file reader"), commandActions: [{ type: "read", path: skillFilename }] }, artifacts)).toEqual([expectedRead(skillFilename, skillContents)]);
});

it.each([
  "echo cat .agents/skills/daynight/SKILL.md",
  "echo 'cat .agents/skills/daynight/SKILL.md'",
  "echo '; cat .agents/skills/daynight/SKILL.md;'",
  "cat ../repository/.agents/skills/daynight/SKILL.md",
  "cat /other/daynight/SKILL.md",
  "cat missing; true",
  "echo ignored #; cat .agents/skills/daynight/SKILL.md",
  "echo $(cat .agents/skills/daynight/SKILL.md)",
  "cat .agents/skills/daynight/SKILL.md > hidden",
  "cd /other; cat .agents/skills/daynight/SKILL.md",
  "source script; cat .agents/skills/daynight/SKILL.md",
  "eval harmless; cat .agents/skills/daynight/SKILL.md",
  "rg --files -g SKILL.md",
])("rejects command text without an exact installed-artifact read: %s", (command) => {
  expect(codexArtifactReadEvidence(item(command), artifacts)).toEqual([]);
});

it("rejects partial output and a failed native read even when the path or body matches", () => {
  const command = "cat .agents/skills/daynight/SKILL.md";
  expect(codexArtifactReadEvidence(item(command, skillContents.slice(0, -8)), artifacts)).toEqual([]);
  expect(codexArtifactReadEvidence({ ...item(command), exitCode: 1 }, artifacts)).toEqual([]);
  expect(codexArtifactReadEvidence({ ...item(command), status: "failed" }, artifacts)).toEqual([]);
});

it("rejects a structured read of a different copy with identical contents", () => {
  expect(codexArtifactReadEvidence({ ...item("native file reader"), commandActions: [{ type: "read", path: "/other/daynight/SKILL.md" }] }, artifacts)).toEqual([]);
});

describe("known owned artifact preloading", () => {
  let root: string;
  beforeEach(async () => {
    const temporary = path.resolve(import.meta.dirname, "../../../../.tmp");
    await mkdir(temporary, { recursive: true });
    root = await mkdtemp(path.join(temporary, "codex-artifact-"));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("omits optional config beneath a linked worktree's .git file", async () => {
    await writeFile(path.join(root, ".git"), "gitdir: ../primary/.git/worktrees/linked\n");
    expect(readOwnedCodexArtifact(path.join(root, ".git/config"), root)).toBeUndefined();
  });

  it("omits a missing optional config", async () => {
    await mkdir(path.join(root, ".git"));
    expect(readOwnedCodexArtifact(path.join(root, ".git/config"), root)).toBeUndefined();
  });

  it("preloads an existing bounded regular owned artifact", async () => {
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".git/config"), configContents);
    expect(readOwnedCodexArtifact(path.join(root, ".git/config"), root)).toBe(configContents);
  });

  it("omits a directory, an oversized file and an external path", async () => {
    await mkdir(path.join(root, ".git/config"), { recursive: true });
    expect(readOwnedCodexArtifact(path.join(root, ".git/config"), root)).toBeUndefined();
    await rm(path.join(root, ".git/config"), { recursive: true });
    await writeFile(path.join(root, ".git/config"), "x".repeat(16 * 1024 + 1));
    expect(readOwnedCodexArtifact(path.join(root, ".git/config"), root)).toBeUndefined();
    expect(readOwnedCodexArtifact(path.join(root, "../external"), root)).toBeUndefined();
  });
});
