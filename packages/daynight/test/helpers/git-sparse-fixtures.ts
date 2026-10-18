import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect } from "vitest";
import { commit, rawGit } from "./git-fixtures.js";
import type { GitFixtureFactory } from "./git-fixtures.js";

export type SparseMode = { cone: boolean; sparseIndex: boolean; worktreeConfig: boolean };
export const createSparseFixture = async (fixture: GitFixtureFactory, mode: SparseMode) => {
  const f = fixture();
  const contents = (value: string): string => rawGit(f.upstream, ["hash-object", "-w", "--stdin"], value);
  const extra = (value: string, added = false): string => {
    const hiddenTree = rawGit(f.upstream, ["mktree"], `100644 blob ${contents(value)}\thidden.txt\n${added ? `100644 blob ${contents("new hidden path\n")}\tnew.txt\n` : ""}`);
    const visibleTree = rawGit(f.upstream, ["mktree"], `100644 blob ${contents("visible\n")}\tvisible.txt\n`);
    return `100644 blob ${contents(value)}\thidden.txt\n040000 tree ${hiddenTree}\thidden\n040000 tree ${visibleTree}\tvisible\n`;
  };
  const base = commit(f.upstream, "base sparse\n", f.base, extra("base hidden\n"));
  const head = commit(f.upstream, "PR sparse\n", base, extra("initial hidden change\n"));
  rawGit(f.upstream, ["update-ref", "refs/heads/main", base]); rawGit(f.upstream, ["update-ref", "refs/pull/101/head", head]);
  f.update({ headSha: head, baseSha: base });
  const local = await f.manager.ensureRepository(f.configuration);
  const patterns = mode.cone ? ["visible"] : ["/file.txt", "/.gitattributes", "/visible/"];
  rawGit(local.root, ["sparse-checkout", "set", mode.cone ? "--cone" : "--no-cone", mode.sparseIndex ? "--sparse-index" : "--no-sparse-index", ...patterns]);
  if (!mode.worktreeConfig) {
    rawGit(local.root, ["config", "--local", "core.sparseCheckout", "true"]);
    rawGit(local.root, ["config", "--local", "core.sparseCheckoutCone", String(mode.cone)]);
    rawGit(local.root, ["config", "--local", "index.sparse", String(mode.sparseIndex)]);
    rawGit(local.root, ["config", "--local", "extensions.worktreeConfig", "false"]);
  }
  expect(rawGit(local.root, ["config", "--bool", "--get", "index.sparse"])).toBe(String(mode.sparseIndex));
  if (mode.sparseIndex) expect(rawGit(local.root, ["ls-files", "--sparse", "--stage"]).split("\n").some((entry) => entry.startsWith("040000 "))).toBe(true);
  const snapshot = () => {
    const files: Record<string, Buffer> = {}; const directories: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === ".worktrees") continue;
        const target = path.join(directory, entry.name); const relative = path.relative(local.root, target);
        if (entry.isDirectory()) { directories.push(relative); walk(target); }
        else files[relative] = readFileSync(target);
      }
    };
    walk(local.root);
    return { files, directories: directories.sort(), head: readFileSync(path.join(local.commonDirectory, "HEAD")), index: readFileSync(path.join(local.commonDirectory, "index")),
      skipBits: rawGit(local.root, ["ls-files", "--sparse", "-v"]),
      refs: rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes", "refs/tags"]),
      metadata: Object.fromEntries(["config", "config.worktree", path.join("info", "sparse-checkout")].map((name) => {
        const target = path.join(local.commonDirectory, name); return [name, existsSync(target) ? readFileSync(target) : null];
      })) };
  };
  expect(existsSync(path.join(local.root, "hidden", "hidden.txt"))).toBe(false);
  return { ...f, local, sparseHead: head, sparseExtra: extra, snapshot };
};
