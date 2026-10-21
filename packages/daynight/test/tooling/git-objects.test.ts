import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { rawGit } from "../helpers/git-fixtures.js";
import { writeGitSnapshot } from "../helpers/git-objects.js";

const directories: string[] = [];
const fixture = () => {
  const root = path.resolve(import.meta.dirname, "../../../../.tmp/git-object-tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, "Objects 中文 "));
  directories.push(directory);
  const git = (args: string[], input?: string) => rawGit(directory, args, input);
  git(["init", "--bare", "--initial-branch=main"]);
  const state = () => ({ refs: git(["for-each-ref"]), head: readFileSync(path.join(directory, "HEAD")), config: readFileSync(path.join(directory, "config")) });
  return { git, state };
};
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("native Git snapshot objects", () => {
  it("preserves commit identities, arbitrary UTF-8 paths, modes and ordered parents without changing repository state", () => {
    const f = fixture();
    const base = writeGitSnapshot(f.git, [
      { path: ".gitattributes", mode: "100644", contents: "* -text\n" },
      { path: "file.txt", mode: "100644", contents: "base\n" },
    ], "base\n\n");
    expect(base).toBe("48fca934feebfa751ab209a719a98c3b56f85022");
    const empty = writeGitSnapshot(f.git, [], "empty\n");
    expect(empty).toBe("682708aa6c0618e549ddcbad38ab0d1921fd7147");
    f.git(["update-ref", "refs/heads/main", base]);
    f.git(["update-ref", "refs/tags/empty", empty]);
    const before = f.state();
    const merge = writeGitSnapshot(f.git, [
      { path: "中文/line\n\"\\.txt", mode: "100644", contents: "UTF8 中文\n" },
      { path: "executable", mode: "100755", contents: "#!/bin/sh\n" },
      { path: "link", mode: "120000", contents: "target" },
      { path: "tree", mode: "040000", object: f.git(["rev-parse", `${base}^{tree}`]) },
      { path: "module", mode: "160000", object: "f".repeat(40) },
    ], "merge\n", [base, empty]);
    expect(merge).toBe("a1c0f7438d9039b6d4078b21a93f2e4453e64ba3");
    expect(f.git(["rev-list", "--parents", "-n", "1", merge])).toBe(`${merge} ${base} ${empty}`);
    expect(f.git(["show", `${merge}:中文/line\n\"\\.txt`])).toBe("UTF8 中文");
    expect(f.git(["ls-tree", merge, "module"])).toBe(`160000 commit ${"f".repeat(40)}\tmodule`);
    expect(f.state()).toEqual(before);
  });

  it("exposes native Git errors for missing parent objects", () => {
    const f = fixture(); const before = f.state();
    expect(() => writeGitSnapshot(f.git, [], "missing parent\n", ["f".repeat(40)])).toThrow();
    expect(f.state()).toEqual(before);
  });
});
