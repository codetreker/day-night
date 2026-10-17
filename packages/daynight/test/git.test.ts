import path from "node:path";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitManager } from "../src/git.js";
import { executeCommand } from "../src/github.js";
import type { CommandExecutor, GitHubClient } from "../src/github.js";
import { openStore } from "../src/store.js";
import type { PullRequestObservation, Store } from "../src/store.js";

const fixtures = path.resolve(import.meta.dirname, "../../../.tmp/git-tests");
const directories: string[] = [];
const stores = new Set<Store>();
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proof = { processesExcluded: true, operationsStopped: true } as const;
const nativeEnvironment = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
const rawGit = (directory: string, args: string[], input?: string): string => execFileSync("git", ["-C", directory, ...args], {
  encoding: "utf8", env: nativeEnvironment(), timeout: 20_000, ...(input === undefined ? {} : { input }), stdio: ["pipe", "pipe", "pipe"],
}).trim();
const overwriteExistingFile = (target: string, contents: string): void => {
  const descriptor = openSync(target, "r+");
  try {
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, contents);
  } finally { closeSync(descriptor); }
};
const commit = (bare: string, contents: string, parent?: string, extraTree?: string): string => {
  const blob = rawGit(bare, ["hash-object", "-w", "--stdin"], contents);
  const attributes = rawGit(bare, ["hash-object", "-w", "--stdin"], "* -text\n");
  const tree = rawGit(bare, ["mktree"], `100644 blob ${attributes}\t.gitattributes\n100644 blob ${blob}\tfile.txt\n${extraTree === undefined ? "" : extraTree}`);
  return rawGit(bare, ["hash-object", "-t", "commit", "-w", "--stdin"],
    `tree ${tree}\n${parent === undefined ? "" : `parent ${parent}\n`}author Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Fixture <fixture@example.invalid> 1700000000 +0000\n\n${contents}\n`);
};
const fixture = (gitConfiguration: readonly string[] = []) => {
  mkdirSync(fixtures, { recursive: true });
  const directory = mkdtempSync(path.join(fixtures, "Git 中文 "));
  directories.push(directory);
  const upstream = path.join(directory, "source.git");
  mkdirSync(upstream);
  rawGit(upstream, ["init", "--bare", "--initial-branch=main"]);
  const base = commit(upstream, "base\n");
  const head = commit(upstream, "PR\n", base);
  rawGit(upstream, ["update-ref", "refs/heads/main", base]);
  rawGit(upstream, ["update-ref", "refs/pull/101/head", head]);
  const configuration = { remote: "https://github.com/owner/repo.git", coordinate: "github.com/owner/repo", host: "github.com", owner: "owner", name: "repo", path: path.join(directory, "checkout") };
  const repository = { host: "github.com", githubId: "42", owner: "owner", name: "repo" };
  let observation: PullRequestObservation = { number: 101, state: "open", draft: false, headSha: head, baseRef: "main", baseSha: base };
  let onGet: (() => void) | undefined;
  const client: GitHubClient = {
    resolveRepository: async (config) => ({ ...repository, githubId: config.owner === "owner" && config.name === "repo" ? "42" : "43", host: config.host }),
    listPullRequestNumbers: async () => [101],
    listOpenPullRequests: async () => [observation],
    getPullRequest: async () => { onGet?.(); return { ...observation }; },
  };
  const calls: { file: string; args: readonly string[] }[] = [];
  let intercept: CommandExecutor | undefined;
  const execute: CommandExecutor = async (file, args, options) => {
    calls.push({ file, args });
    if (intercept !== undefined) return intercept(file, args, options);
    if (file === "gh") return { stdout: "fixture-secret\n", stderr: "", error: null };
    const result = await executeCommand(file, [...gitConfiguration, "-c", "protocol.file.allow=always", "-c", `url.${pathToFileURL(upstream).href}.insteadOf=https://${configuration.host}/owner/repo.git`, ...args], options);
    if (result.error !== null && args.includes("clone")) process.stderr.write(`Local Git clone fixture failure: ${result.stderr}\n`);
    return result;
  };
  const store = openStore(path.join(directory, "state.sqlite"));
  stores.add(store);
  store.registerRepository({ ...repository, remote: configuration.remote, localPath: configuration.path });
  store.initializeRepository(repository, 100, 1);
  store.observePullRequest(repository, observation, 2);
  let nextId = 1;
  const reserve = () => {
    const review = store.reserveReview({ ...repository, number: 101 }, { reviewId: uuid(nextId++), sessionId: uuid(500), maxAttempts: 3 }, 10);
    if (review === null) throw new Error("Expected a review reservation.");
    return review;
  };
  const manager = createGitManager({ temporaryDirectory: path.join(directory, "tmp"), client, execute, now: () => 20 });
  const update = (partial: Partial<PullRequestObservation>) => { observation = { ...observation, ...partial }; store.observePullRequest(repository, observation, 15); };
  const nextRevision = (reviewId: string, nextHead: string) => {
    update({ headSha: nextHead });
    store.supersedeReview(reviewId, proof, 16);
    rawGit(upstream, ["update-ref", "refs/pull/101/head", nextHead]);
    return reserve();
  };
  return { directory, upstream, base, head, configuration, repository, client, store, calls, execute, manager, reserve, update, nextRevision,
    setIntercept: (value: CommandExecutor | undefined) => { intercept = value; }, setOnGet: (value: (() => void) | undefined) => { onGet = value; } };
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local Git repositories and review snapshots", () => {
  it("clones missing code, validates identity, and prepares a fixed detached PR worktree", async () => {
    const f = fixture();
    const local = await f.manager.ensureRepository(f.configuration);
    expect(readFileSync(path.join(local.root, "file.txt"), "utf8")).toBe("base\n");
    const review = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, review.id, proof);
    expect(prepared).toMatchObject({ kind: "prepared", path: path.join(local.root, ".worktrees", "pr-101"), headSha: f.head, baseSha: f.base, mergeBaseSha: f.base });
    if (prepared.kind !== "prepared") throw new Error("Expected prepared worktree.");
    expect(rawGit(prepared.path, ["rev-parse", "HEAD"])).toBe(f.head);
    expect(rawGit(prepared.path, ["rev-parse", "--symbolic-full-name", "HEAD"])).toBe("HEAD");
    expect(rawGit(local.root, ["worktree", "list", "--porcelain"])).toContain(`locked daynight:${uuid(500)}`);
    expect(f.store.getReview(review.id)?.baseSha).toBe(f.base);
    expect(f.store.getPullRequest(review)?.worktreePath).toBe(prepared.path);
    expect(rawGit(local.root, ["rev-parse", "HEAD"])).toBe(f.base);
  }, 60_000);

  it("rejects a different local clone of the same GitHub repository than the durable registration", async () => {
    const f = fixture(); await f.manager.ensureRepository(f.configuration);
    const other = await f.manager.ensureRepository({ ...f.configuration, path: path.join(f.directory, "other-clone") });
    await expect(f.manager.prepareWorktree(f.store, other, f.reserve().id, proof)).rejects.toThrow("durable repository registration");
    expect(existsSync(path.join(other.root, ".worktrees"))).toBe(false);
  }, 60_000);

  it("preserves the existing checkout, branch refs, remote refs, FETCH_HEAD and sibling worktrees", async () => {
    const f = fixture();
    const local = await f.manager.ensureRepository(f.configuration);
    writeFileSync(path.join(local.root, "file.txt"), "user changes\n");
    writeFileSync(path.join(local.root, ".git", "FETCH_HEAD"), "user fetch sentinel\n");
    rawGit(local.root, ["update-ref", "refs/remotes/origin/main", f.base]);
    const sibling = path.join(local.root, ".worktrees", "manual");
    rawGit(local.root, ["worktree", "add", "--detach", sibling, f.base]);
    writeFileSync(path.join(sibling, "manual.txt"), "retained");
    const beforeRefs = rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes", "refs/tags"]);
    await f.manager.ensureRepository(f.configuration);
    await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof);
    expect(readFileSync(path.join(local.root, "file.txt"), "utf8")).toBe("user changes\n");
    expect(readFileSync(path.join(local.root, ".git", "FETCH_HEAD"), "utf8")).toBe("user fetch sentinel\n");
    expect(rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes", "refs/tags"])).toBe(beforeRefs);
    expect(readFileSync(path.join(sibling, "manual.txt"), "utf8")).toBe("retained");
  }, 60_000);

  it("rejects mismatched origin, a nested upward-discovered root, bare roots and empty collisions", async () => {
    const f = fixture();
    const local = await f.manager.ensureRepository(f.configuration);
    rawGit(local.root, ["config", "remote.origin.url", "git@github.com:other/repo.git"]);
    await expect(f.manager.ensureRepository(f.configuration)).rejects.toThrow("different GitHub repository");
    rawGit(local.root, ["config", "remote.origin.url", f.configuration.remote]);
    const child = path.join(local.root, "child"); mkdirSync(child);
    await expect(f.manager.ensureRepository({ ...f.configuration, path: child })).rejects.toThrow("exact Git worktree root");
    await expect(f.manager.ensureRepository({ ...f.configuration, path: f.upstream })).rejects.toThrow();
    const empty = path.join(f.directory, "empty"); mkdirSync(empty);
    await expect(f.manager.ensureRepository({ ...f.configuration, path: empty })).rejects.toThrow();
    expect(readdirSync(empty)).toEqual([]);
  }, 60_000);

  it("accepts SSH origin identity without requiring SSH transport and preserves HTTPS API ports", async () => {
    const f = fixture();
    const local = await f.manager.ensureRepository(f.configuration);
    rawGit(local.root, ["config", "remote.origin.url", "ssh://git@github.com:2222/owner/repo.git"]);
    await expect(f.manager.ensureRepository({ ...f.configuration, remote: "git@github.com:owner/repo.git" })).resolves.toMatchObject({ repository: f.repository });
    expect(f.calls.filter((call) => call.args.includes("clone")).every((call) => call.args.includes(f.configuration.remote))).toBe(true);
    const ported = { ...f.configuration, host: "github.example:8443", coordinate: "github.example:8443/owner/repo", remote: "https://github.example:8443/owner/repo.git", path: path.join(f.directory, "ported") };
    const mapped: CommandExecutor = async (file, args, options) => file === "gh" ? { stdout: "fixture-secret\n", stderr: "", error: null } : executeCommand(file, ["-c", "protocol.file.allow=always", "-c", `url.${pathToFileURL(f.upstream).href}.insteadOf=${ported.remote}`, ...args], options);
    const manager = createGitManager({ temporaryDirectory: path.join(f.directory, "tmp"), client: { resolveRepository: async () => ({ ...f.repository, host: ported.host }), listPullRequestNumbers: async () => [], listOpenPullRequests: async () => [], getPullRequest: async () => { throw new Error("unused"); } }, execute: mapped });
    expect((await manager.ensureRepository(ported)).configuration.host).toBe("github.example:8443");
    expect(rawGit(ported.path, ["config", "--local", "--get", "remote.origin.url"])).toBe(ported.remote);
  }, 60_000);

  it("pins retries to the original base and retains their branch and local context", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, review.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    f.store.startAttempt(review.id, { processOwner: uuid(700), stdoutLogPath: path.join(f.directory, "out"), stderrLogPath: path.join(f.directory, "err") }, 30);
    f.store.retryReview({ reviewId: review.id, attempt: 1 }, proof, { error: "retry", retryAt: 40 }, 40);
    f.store.reserveReview(review, { reviewId: uuid(900), sessionId: uuid(901), maxAttempts: 3 }, 40);
    rawGit(prepared.path, ["checkout", "-b", "agent-context"]);
    writeFileSync(path.join(prepared.path, "context.txt"), "retain retry context");
    const newBase = commit(f.upstream, "main advanced\n", f.base);
    rawGit(f.upstream, ["update-ref", "refs/heads/main", newBase]); f.update({ baseSha: newBase });
    expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toEqual(prepared);
    expect(readFileSync(path.join(prepared.path, "context.txt"), "utf8")).toBe("retain retry context");
    expect(rawGit(prepared.path, ["branch", "--show-current"])).toBe("agent-context");
    expect(f.calls.filter((call) => call.args.includes("fetch"))).toHaveLength(1);
  }, 60_000);

  it("clears owned dirty files and nested generated clones for a new revision without resetting a shared branch", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    rawGit(prepared.path, ["checkout", "-b", "agent-shared"]);
    writeFileSync(path.join(prepared.path, "file.txt"), "dirty"); writeFileSync(path.join(prepared.path, "junk"), "junk");
    const nested = path.join(prepared.path, "generated-clone"); mkdirSync(nested); rawGit(nested, ["init"]);
    const nextHead = commit(f.upstream, "new PR\n", f.head); const next = f.nextRevision(first.id, nextHead);
    const second = await f.manager.prepareWorktree(f.store, local, next.id, proof);
    expect(second).toMatchObject({ kind: "prepared", path: prepared.path, headSha: nextHead });
    expect(rawGit(local.root, ["rev-parse", "refs/heads/agent-shared"])).toBe(f.head);
    expect(existsSync(path.join(prepared.path, "junk"))).toBe(false);
    expect(existsSync(nested)).toBe(false);
    expect(rawGit(prepared.path, ["rev-parse", "--symbolic-full-name", "HEAD"])).toBe("HEAD");
  }, 60_000);

  it("returns changed for remote head, Draft, closure, and target changes before worktree mutation", async () => {
    for (const changed of [{ headSha: "a".repeat(40) }, { draft: true }, { state: "closed" as const }, { baseRef: "other" }]) {
      const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
      f.setOnGet(() => f.update(changed));
      expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toEqual({ kind: "changed" });
      expect(existsSync(path.join(local.root, ".worktrees", "pr-101"))).toBe(false);
      expect(f.store.getReview(review.id)?.status).toBe("preparing");
    }
  }, 60_000);

  it("detects force-push races between API capture and fetch without preparing the stale head", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const pushed = commit(f.upstream, "force push\n", f.base); rawGit(f.upstream, ["update-ref", "refs/pull/101/head", pushed]);
    expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toEqual({ kind: "changed" });
    expect(f.store.getReview(review.id)?.baseSha).toBeNull();
  }, 60_000);
});

describe("owned worktree lifecycle and destructive-operation guards", () => {
  it("preserves every unregistered existing path, including an empty directory", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const target = path.join(local.root, ".worktrees", "pr-101"); mkdirSync(target, { recursive: true });
    await expect(f.manager.prepareWorktree(f.store, local, review.id, proof)).rejects.toThrow("Unowned");
    expect(readdirSync(target)).toEqual([]);
    expect(f.store.getPullRequest(review)?.worktreePath).toBeNull();
    rmSync(target, { recursive: true });
    rawGit(local.root, ["worktree", "add", "--detach", target, f.base]);
    await expect(f.manager.prepareWorktree(f.store, local, review.id, proof)).rejects.toThrow("Unowned");
    expect(rawGit(target, ["rev-parse", "HEAD"])).toBe(f.base);
  }, 60_000);

  it("rejects a missing ownership marker and a lost .git pointer before force checkout or deletion", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    const next = f.nextRevision(first.id, commit(f.upstream, "new\n", f.head));
    rawGit(local.root, ["worktree", "unlock", prepared.path]);
    await expect(f.manager.prepareWorktree(f.store, local, next.id, proof)).rejects.toThrow("ownership lock");
    rawGit(local.root, ["worktree", "lock", "--reason", `daynight:${uuid(500)}`, prepared.path]);
    rmSync(path.join(prepared.path, ".git"));
    writeFileSync(path.join(prepared.path, "sentinel"), "preserved");
    await expect(f.manager.prepareWorktree(f.store, local, next.id, proof)).rejects.toThrow("managed Git pointer");
    expect(readFileSync(path.join(prepared.path, "sentinel"), "utf8")).toBe("preserved");
    expect(rawGit(local.root, ["rev-parse", "HEAD"])).toBe(f.base);
  }, 60_000);

  it("reconciles an absent leaf with its matching durable ownership lock, without pruning siblings", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, review.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    const sibling = path.join(local.root, ".worktrees", "manual-missing"); rawGit(local.root, ["worktree", "add", "--detach", sibling, f.base]); rmSync(sibling, { recursive: true });
    rmSync(prepared.path, { recursive: true });
    expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toEqual(prepared);
    expect(rawGit(local.root, ["worktree", "list", "--porcelain"])).toContain(sibling.replaceAll("\\", "/"));
  }, 60_000);

  it("requires process exclusion and the current preparing reservation before any force operation", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    await expect(f.manager.prepareWorktree(f.store, local, review.id, { processesExcluded: false } as unknown as typeof proof)).rejects.toThrow("excluded");
    f.store.markInterrupted(review.id, "unknown previous process", 30);
    await expect(f.manager.prepareWorktree(f.store, local, review.id, proof)).rejects.toThrow("preparing review");
    expect(existsSync(path.join(local.root, ".worktrees", "pr-101"))).toBe(false);
  }, 60_000);

  it("blocks nested linked worktrees with the same or a foreign common directory", async () => {
    for (const foreign of [false, true]) {
      const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
      const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
      if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
      const nested = path.join(prepared.path, "manual-nested");
      rawGit(foreign ? f.upstream : local.root, ["worktree", "add", "--detach", nested, f.base]);
      writeFileSync(path.join(nested, "sentinel"), "manual work");
      const next = f.nextRevision(first.id, commit(f.upstream, "next\n", f.head));
      await expect(f.manager.prepareWorktree(f.store, local, next.id, proof)).rejects.toThrow(/nested/i);
      expect(readFileSync(path.join(nested, "sentinel"), "utf8")).toBe("manual work");
      f.update({ state: "closed" }); f.store.supersedeReview(next.id, proof, 30);
      await expect(f.manager.cleanupWorktree(f.store, local, first, proof)).rejects.toThrow(/nested/i);
      expect(f.store.getPullRequest(first)?.cleanupPending).toBe(true);
      expect(f.store.getPullRequest(first)?.cleanupError).toMatch(/nested/i);
    }
  }, 60_000);

  it("cleans only closed owned worktrees and keeps review refs, session history and siblings", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, review.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    const sibling = path.join(local.root, ".worktrees", "manual"); rawGit(local.root, ["worktree", "add", "--detach", sibling, f.base]);
    f.update({ state: "merged" });
    await expect(f.manager.cleanupWorktree(f.store, local, review, proof)).rejects.toThrow("active review");
    f.store.supersedeReview(review.id, proof, 30);
    expect(await f.manager.cleanupWorktree(f.store, local, review, proof)).toEqual({ kind: "cleaned" });
    expect(existsSync(prepared.path)).toBe(false); expect(existsSync(sibling)).toBe(true);
    expect(f.store.getPullRequest(review)).toMatchObject({ worktreePath: null, cleanupPending: false, sessionId: uuid(500) });
    expect(rawGit(local.root, ["rev-parse", `refs/daynight/reviews/${review.id}/head`])).toBe(f.head);
    expect(f.store.listReviews(review)).toHaveLength(1);
    f.update({ state: "open" }); const reopened = f.reserve();
    expect(await f.manager.prepareWorktree(f.store, local, reopened.id, proof)).toMatchObject({ kind: "prepared", path: prepared.path });
    expect(f.store.getPullRequest(review)?.sessionId).toBe(uuid(500));
  }, 60_000);

  it("preserves a remotely reopened PR and retries cleanup after Git already removed its leaf", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, review.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    f.update({ state: "closed" }); f.store.supersedeReview(review.id, proof, 30);
    f.setOnGet(() => f.update({ state: "open" }));
    expect(await f.manager.cleanupWorktree(f.store, local, review, proof)).toEqual({ kind: "reopened" });
    expect(existsSync(prepared.path)).toBe(true);
    f.setOnGet(undefined); f.update({ state: "closed" });
    rawGit(local.root, ["worktree", "remove", "--force", "--force", prepared.path]);
    expect(await f.manager.cleanupWorktree(f.store, local, review, proof)).toEqual({ kind: "cleaned" });
    expect(f.store.getPullRequest(review)?.worktreePath).toBeNull();
  }, 60_000);

  it("preserves physical root aliases while rejecting symlinked managed containers and leaves", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration);
    const alias = path.join(f.directory, "root-alias");
    symlinkSync(local.root, alias, process.platform === "win32" ? "junction" : "dir");
    expect((await f.manager.ensureRepository({ ...f.configuration, path: alias })).root).toBe(realpathSync(local.root));
    const outside = path.join(f.directory, "outside"); mkdirSync(outside);
    const container = path.join(local.root, ".worktrees"); symlinkSync(outside, container, process.platform === "win32" ? "junction" : "dir");
    const review = f.reserve();
    await expect(f.manager.prepareWorktree(f.store, local, review.id, proof)).rejects.toThrow("ordinary directory");
    expect(readdirSync(outside)).toEqual([]);
    rmSync(container); mkdirSync(container);
    symlinkSync(outside, path.join(container, "pr-101"), process.platform === "win32" ? "junction" : "dir");
    await expect(f.manager.prepareWorktree(f.store, local, review.id, proof)).rejects.toThrow("ordinary directory");
    expect(readdirSync(outside)).toEqual([]);
  }, 60_000);
});

describe("Git failures, history and invocation boundaries", () => {
  it("removes only a completed failed clone's exclusive destination and permits a clean retry", async () => {
    const f = fixture();
    f.setIntercept(async (_file, args) => {
      expect(args).toContain("clone");
      writeFileSync(path.join(f.configuration.path, "partial"), "partial clone");
      return { stdout: "", stderr: "credential-secret", error: Object.assign(new Error("credential-secret"), { code: 128 }) };
    });
    let failure: unknown;
    try { await f.manager.ensureRepository(f.configuration); } catch (error) { failure = error; }
    expect(String(failure)).toContain("failed exclusive destination was removed");
    expect(JSON.stringify(failure)).not.toContain("credential-secret");
    expect(existsSync(f.configuration.path)).toBe(false);
    f.setIntercept(undefined);
    expect((await f.manager.ensureRepository(f.configuration)).root).toBe(realpathSync(f.configuration.path));
  }, 60_000);

  it("retains a partial clone after cancellation or unknown process termination", async () => {
    for (const failure of [Object.assign(new Error("timeout"), { code: 128, killed: true, signal: "SIGTERM" }), Object.assign(new Error("truncated"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })]) {
      const f = fixture();
      f.setIntercept(async () => {
        writeFileSync(path.join(f.configuration.path, "partial"), "retained for recovery");
        return { stdout: "", stderr: "", error: failure };
      });
      await expect(f.manager.ensureRepository(f.configuration)).rejects.toThrow("process outcome is uncertain");
      expect(readFileSync(path.join(f.configuration.path, "partial"), "utf8")).toBe("retained for recovery");
      f.setIntercept(undefined);
      await expect(f.manager.ensureRepository(f.configuration)).rejects.toThrow();
    }
  }, 60_000);

  it("does not start Git commands for an already aborted operation", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(f.manager.ensureRepository(f.configuration, controller.signal)).rejects.toThrow("cancelled");
    expect(f.calls).toEqual([]);
    expect(existsSync(f.configuration.path)).toBe(false);
  }, 60_000);

  it("clears inherited Git redirection, injected config and traces and disables checkout hooks", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration);
    const hookMarker = path.join(f.directory, "hook-executed");
    mkdirSync(path.join(local.root, ".git", "hooks"));
    writeFileSync(path.join(local.root, ".git", "hooks", "post-checkout"), `#!/bin/sh\nprintf 'hook' > '${hookMarker.replaceAll("\\", "/")}'\n`, { mode: 0o755 });
    const trace = path.join(f.directory, "trace-secret");
    vi.stubEnv("GIT_DIR", f.upstream); vi.stubEnv("GIT_WORK_TREE", f.directory); vi.stubEnv("GIT_TRACE", trace);
    vi.stubEnv("GIT_CONFIG_COUNT", "1"); vi.stubEnv("GIT_CONFIG_KEY_0", "core.bare"); vi.stubEnv("GIT_CONFIG_VALUE_0", "true");
    const review = f.reserve();
    expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toMatchObject({ kind: "prepared" });
    expect(existsSync(hookMarker)).toBe(false); expect(existsSync(trace)).toBe(false);
    expect(rawGit(local.root, ["rev-parse", "HEAD"])).toBe(f.base);
  }, 60_000);

  it("unshallows existing history only through explicit private fetches and finds the real merge base", async () => {
    const f = fixture();
    const main = commit(f.upstream, "advanced main\n", f.base); rawGit(f.upstream, ["update-ref", "refs/heads/main", main]); f.update({ baseSha: main });
    rawGit(f.directory, ["-c", "protocol.file.allow=always", "clone", "--depth=1", pathToFileURL(f.upstream).href, f.configuration.path]);
    rawGit(f.configuration.path, ["config", "remote.origin.url", f.configuration.remote]);
    expect(rawGit(f.configuration.path, ["rev-parse", "--is-shallow-repository"])).toBe("true");
    const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const beforeRefs = rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes"]);
    expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toMatchObject({ kind: "prepared", headSha: f.head, baseSha: main, mergeBaseSha: f.base });
    expect(rawGit(local.root, ["rev-parse", "--is-shallow-repository"])).toBe("false");
    expect(rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes"])).toBe(beforeRefs);
  }, 60_000);

  it("reconciles immutable partial pins without switching to a newly advanced base", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    rawGit(local.root, ["fetch", "--no-tags", f.upstream, "+refs/pull/101/head:refs/private/head"]);
    rawGit(local.root, ["update-ref", `refs/daynight/reviews/${review.id}/head`, f.head]);
    rawGit(local.root, ["update-ref", `refs/daynight/reviews/${review.id}/base`, f.base]);
    const nextBase = commit(f.upstream, "new main\n", f.base); rawGit(f.upstream, ["update-ref", "refs/heads/main", nextBase]); f.update({ baseSha: nextBase });
    expect(await f.manager.prepareWorktree(f.store, local, review.id, proof)).toMatchObject({ kind: "prepared", baseSha: f.base });
    expect(f.calls.filter((call) => call.args.includes("fetch"))).toHaveLength(0);
  }, 60_000);

  it("retains cleanup intent and error after a completed failure, then reconciles a successful retry", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const review = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, review.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    f.update({ state: "closed" }); f.store.supersedeReview(review.id, proof, 30);
    f.setIntercept(async () => ({ stdout: "", stderr: "", error: Object.assign(new Error("disk failed"), { code: 128 }) }));
    await expect(f.manager.cleanupWorktree(f.store, local, review, proof)).rejects.toThrow();
    expect(f.store.getPullRequest(review)).toMatchObject({ worktreePath: prepared.path, cleanupPending: true });
    expect(f.store.getPullRequest(review)?.cleanupError).toBeTypeOf("string");
    f.setIntercept(undefined);
    expect(await f.manager.cleanupWorktree(f.store, local, review, proof)).toEqual({ kind: "cleaned" });
  }, 60_000);
});

describe("initialized owned submodules", () => {
  it("empties initialized tracked submodule files for a new revision while preserving primary files and shared config", async () => {
    const f = fixture();
    const moduleSource = path.join(f.directory, "module.git"); mkdirSync(moduleSource); rawGit(moduleSource, ["init", "--bare", "--initial-branch=main"]);
    const moduleHead = commit(moduleSource, "module contents\n"); rawGit(moduleSource, ["update-ref", "refs/heads/main", moduleHead]);
    const modulesBlob = rawGit(f.upstream, ["hash-object", "-w", "--stdin"], `[submodule "module"]\n\tpath = module\n\turl = ${pathToFileURL(moduleSource).href}\n`);
    const extra = `100644 blob ${modulesBlob}\t.gitmodules\n160000 commit ${moduleHead}\tmodule\n`;
    const main = commit(f.upstream, "main module\n", f.base, extra); rawGit(f.upstream, ["update-ref", "refs/heads/main", main]);
    const head = commit(f.upstream, "PR module\n", main, extra); rawGit(f.upstream, ["update-ref", "refs/pull/101/head", head]); f.update({ headSha: head, baseSha: main });
    const local = await f.manager.ensureRepository(f.configuration);
    rawGit(local.root, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);
    writeFileSync(path.join(local.root, "module", "file.txt"), "primary submodule dirty");
    rawGit(local.root, ["config", "fetch.recurseSubmodules", "true"]);
    const primaryModuleRefs = rawGit(path.join(local.root, "module"), ["for-each-ref", "--format=%(refname) %(objectname)"]);
    const nextModuleHead = commit(moduleSource, "new remote module\n", moduleHead);
    rawGit(moduleSource, ["update-ref", "refs/heads/main", nextModuleHead]);
    const first = f.reserve(); const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    expect(rawGit(path.join(local.root, "module"), ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(primaryModuleRefs);
    rawGit(prepared.path, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);
    rawGit(path.join(prepared.path, "module"), ["checkout", "-b", "module-agent-context"]);
    writeFileSync(path.join(prepared.path, "module", "file.txt"), "dirty module"); writeFileSync(path.join(prepared.path, "module", "artifact"), "discard");
    const moduleAdmin = rawGit(path.join(prepared.path, "module"), ["rev-parse", "--absolute-git-dir"]);
    const refs = rawGit(path.join(prepared.path, "module"), ["for-each-ref", "--format=%(refname) %(objectname)"]);
    const sharedConfig = readFileSync(path.join(local.commonDirectory, "config"), "utf8");
    const nextHead = commit(f.upstream, "next PR module\n", head, extra); const next = f.nextRevision(first.id, nextHead);
    expect(await f.manager.prepareWorktree(f.store, local, next.id, proof)).toMatchObject({ kind: "prepared", headSha: nextHead });
    expect(readdirSync(path.join(prepared.path, "module"))).toEqual([]);
    expect(readFileSync(path.join(local.root, "module", "file.txt"), "utf8")).toBe("primary submodule dirty");
    expect(rawGit(path.join(local.root, "module"), ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(primaryModuleRefs);
    expect(readFileSync(path.join(local.commonDirectory, "config"), "utf8")).toBe(sharedConfig);
    expect(rawGit(f.directory, [`--git-dir=${moduleAdmin}`, "for-each-ref", "--format=%(refname) %(objectname)"])).toBe(refs);
    rawGit(prepared.path, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);
    expect(readFileSync(path.join(prepared.path, "module", "file.txt"), "utf8")).toBe("module contents\n");
    f.update({ state: "closed" }); f.store.supersedeReview(next.id, proof, 30);
    expect(await f.manager.cleanupWorktree(f.store, local, next, proof)).toEqual({ kind: "cleaned" });
    expect(readFileSync(path.join(local.root, "module", "file.txt"), "utf8")).toBe("primary submodule dirty");
  }, 60_000);
});

describe("Git configuration and revision-transition regressions", () => {
  it("uses origin even when the prepared Git configuration chooses a different default remote name", async () => {
    const f = fixture(["-c", "clone.defaultRemoteName=upstream"]);
    const local = await f.manager.ensureRepository(f.configuration);
    expect(rawGit(local.root, ["remote"])).toBe("origin");
    expect(rawGit(local.root, ["config", "--local", "remote.origin.url"])).toBe(f.configuration.remote);
    expect(await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof)).toMatchObject({ kind: "prepared" });
  }, 60_000);

  it("empties stale untracked contents when the target revision introduces a tracked gitlink", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    const modulePath = path.join(prepared.path, "module"); mkdirSync(modulePath);
    writeFileSync(path.join(modulePath, "stale.txt"), "old untracked contents");
    const modulesBlob = rawGit(f.upstream, ["hash-object", "-w", "--stdin"], `[submodule "module"]\n\tpath = module\n\turl = ${pathToFileURL(f.upstream).href}\n`);
    const extra = `100644 blob ${modulesBlob}\t.gitmodules\n160000 commit ${f.base}\tmodule\n`;
    const nextHead = commit(f.upstream, "new gitlink\n", f.head, extra); const next = f.nextRevision(first.id, nextHead);
    expect(await f.manager.prepareWorktree(f.store, local, next.id, proof)).toMatchObject({ kind: "prepared", headSha: nextHead });
    expect(readdirSync(modulePath)).toEqual([]);
    expect(rawGit(prepared.path, ["status", "--porcelain"])).toBe("");
  }, 60_000);

  it("preserves prepared TLS trust and global-config locations in actual native command environments", async () => {
    const f = fixture();
    const caFile = path.join(f.directory, "private-ca.pem"); writeFileSync(caFile, "fixture CA");
    const caDirectory = path.join(f.directory, "trusted-certificates"); mkdirSync(caDirectory);
    const globalConfig = path.join(f.directory, "prepared.gitconfig"); writeFileSync(globalConfig, "[http]\n\tversion = HTTP/1.1\n");
    vi.stubEnv("GIT_SSL_CAINFO", caFile); vi.stubEnv("GIT_SSL_CAPATH", caDirectory);
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig); vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    const observed: string[][] = [];
    const execute: CommandExecutor = async (file, args, options) => {
      const native = await executeCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify(['GIT_SSL_CAINFO','GIT_SSL_CAPATH','GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM'].map(name => process.env[name])))"], options);
      if (native.error !== null) throw native.error;
      observed.push(JSON.parse(native.stdout) as string[]);
      return f.execute(file, args, options);
    };
    const manager = createGitManager({ temporaryDirectory: path.join(f.directory, "tmp"), client: f.client, execute });
    const local = await manager.ensureRepository(f.configuration);
    expect(await manager.prepareWorktree(f.store, local, f.reserve().id, proof)).toMatchObject({ kind: "prepared" });
    expect(observed.length).toBeGreaterThan(0);
    for (const variables of observed) expect(variables).toEqual([caFile, caDirectory, globalConfig, "1"]);
  }, 60_000);

  it("honors committed fixture byte attributes while normal Git autocrlf conversion is enabled", async () => {
    const f = fixture(["-c", "core.autocrlf=true"]); const local = await f.manager.ensureRepository(f.configuration);
    expect(readFileSync(path.join(local.root, "file.txt"), "utf8")).toBe("base\n");
    const prepared = await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    expect(readFileSync(path.join(prepared.path, "file.txt"), "utf8")).toBe("PR\n");
    expect(rawGit(prepared.path, ["check-attr", "text", "--", "file.txt"])).toBe("file.txt: text: unset");
  }, 60_000);

  it("passes physical clone and inspection paths to Git and safely removes a failed aliased destination", async () => {
    const f = fixture(); const physicalParent = path.join(f.directory, "physical"); mkdirSync(physicalParent);
    const aliasParent = path.join(f.directory, "parent-alias"); symlinkSync(physicalParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
    const configuration = { ...f.configuration, path: path.join(aliasParent, "checkout") };
    f.store.registerRepository({ ...f.repository, remote: configuration.remote, localPath: configuration.path });
    const local = await f.manager.ensureRepository(configuration);
    const clone = f.calls.find((call) => call.args.includes("clone"));
    expect(clone?.args.at(-1)).toBe(realpathSync(configuration.path));
    await f.manager.ensureRepository(configuration);
    expect(f.calls.filter((call) => call.args.includes("-C")).every((call) => call.args[call.args.indexOf("-C") + 1] === local.root)).toBe(true);
    const failed = { ...configuration, path: path.join(aliasParent, "failed") };
    f.setIntercept(async (_file, args) => {
      expect(args.at(-1)).toBe(realpathSync(failed.path));
      writeFileSync(path.join(failed.path, "partial"), "partial");
      return { stdout: "", stderr: "", error: Object.assign(new Error("fixture clone failed"), { code: 128 }) };
    });
    await expect(f.manager.ensureRepository(failed)).rejects.toThrow("failed exclusive destination was removed");
    expect(existsSync(failed.path)).toBe(false); expect(existsSync(aliasParent)).toBe(true); expect(existsSync(local.root)).toBe(true);
  }, 60_000);

  it("preserves leading boundary spaces and internal spaces on every native platform", async () => {
    const f = fixture();
    const configuration = { ...f.configuration, path: path.join(f.directory, " checkout boundary", " repo with spaces") };
    f.store.registerRepository({ ...f.repository, remote: configuration.remote, localPath: configuration.path });
    const local = await f.manager.ensureRepository(configuration);
    expect(local.root).toBe(realpathSync(configuration.path));
    const prepared = await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof);
    expect(prepared).toMatchObject({ kind: "prepared", path: path.join(local.root, ".worktrees", "pr-101") });
  }, 60_000);

  it("preserves supported trailing-space paths and rejects protected Windows names without touching existing data", async () => {
    const f = fixture(["-c", "core.protectNTFS=true"]);
    const directory = path.join(f.directory, " checkout boundary ");
    mkdirSync(directory);
    writeFileSync(path.join(directory, "sentinel"), "existing parent contents");
    const configuration = { ...f.configuration, path: path.join(directory, " repo ") };
    f.store.registerRepository({ ...f.repository, remote: configuration.remote, localPath: configuration.path });
    if (process.platform === "win32" && path.basename(realpathSync(directory)).endsWith(" ")) {
      await expect(f.manager.ensureRepository(configuration)).rejects.toThrow("Cannot clone repository into");
      expect(existsSync(configuration.path)).toBe(false);
      expect(readFileSync(path.join(directory, "sentinel"), "utf8")).toBe("existing parent contents");
      expect(readdirSync(directory)).toEqual(["sentinel"]);
      return;
    }
    const local = await f.manager.ensureRepository(configuration);
    expect(local.root).toBe(realpathSync(configuration.path));
    expect(await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof)).toMatchObject({ kind: "prepared", path: path.join(local.root, ".worktrees", "pr-101") });
  }, 60_000);
});

describe("raw captured commit interpretation", () => {
  it("checks out original PR objects while preserving a local replacement and the user's replacement view", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration);
    const replacement = commit(f.upstream, "LOCAL REPLACEMENT\n", f.base);
    rawGit(f.upstream, ["update-ref", "refs/heads/local-replacement", replacement]);
    rawGit(local.root, ["fetch", "--no-tags", f.upstream, "+refs/pull/101/head:refs/private/head", "+refs/heads/local-replacement:refs/private/replacement"]);
    rawGit(local.root, ["replace", f.head, replacement]);
    const replacementRefs = rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/replace"]);
    const config = readFileSync(path.join(local.commonDirectory, "config"), "utf8");
    expect(rawGit(local.root, ["show", `${f.head}:file.txt`])).toBe("LOCAL REPLACEMENT");
    const prepared = await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    expect(readFileSync(path.join(prepared.path, "file.txt"), "utf8")).toBe("PR\n");
    expect(rawGit(local.root, ["show", `${f.head}:file.txt`])).toBe("LOCAL REPLACEMENT");
    expect(rawGit(local.root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/replace"])).toBe(replacementRefs);
    expect(readFileSync(path.join(local.commonDirectory, "config"), "utf8")).toBe(config);
    expect(readFileSync(path.join(local.root, "file.txt"), "utf8")).toBe("base\n");
    expect(prepared.gitEnvironment.GIT_NO_REPLACE_OBJECTS).toBe("1");
    const downstream = await executeCommand("git", ["-C", prepared.path, "show", `${f.head}:file.txt`], {
      timeoutMs: 20_000, maxBufferBytes: 1024, environment: prepared.gitEnvironment,
    });
    expect(downstream.error).toBeNull(); expect(downstream.stdout).toBe("PR\n");
  }, 60_000);

  it("computes the original merge base while leaving a default local graft file and user graph view intact", async () => {
    const f = fixture();
    const main = commit(f.upstream, "main advanced\n", f.base); rawGit(f.upstream, ["update-ref", "refs/heads/main", main]); f.update({ baseSha: main });
    const local = await f.manager.ensureRepository(f.configuration);
    rawGit(local.root, ["fetch", "--no-tags", f.upstream, "+refs/pull/101/head:refs/private/head"]);
    const info = path.join(local.commonDirectory, "info"); mkdirSync(info);
    const graft = `${f.head} ${main}\n`; const graftFile = path.join(info, "grafts"); writeFileSync(graftFile, graft);
    expect(rawGit(local.root, ["merge-base", f.head, main])).toBe(main);
    const prepared = await f.manager.prepareWorktree(f.store, local, f.reserve().id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    expect(prepared.mergeBaseSha).toBe(f.base);
    expect(readFileSync(graftFile, "utf8")).toBe(graft);
    expect(rawGit(local.root, ["merge-base", f.head, main])).toBe(main);
    expect(readFileSync(path.join(local.root, "file.txt"), "utf8")).toBe("main advanced\n");
    const isolatedGraft = prepared.gitEnvironment.GIT_GRAFT_FILE;
    expect(isolatedGraft).toBeTypeOf("string");
    expect(readFileSync(isolatedGraft!, "utf8")).toBe("");
    const downstream = await executeCommand("git", ["-C", prepared.path, "merge-base", f.head, main], {
      timeoutMs: 20_000, maxBufferBytes: 1024, environment: prepared.gitEnvironment,
    });
    expect(downstream.error).toBeNull(); expect(downstream.stdout.trim()).toBe(f.base);
  }, 60_000);
});

describe("linked administrative authority and external dependencies", () => {
  it("rejects pointers to primary or sibling Git administration without changing their HEAD, index, branches or files", async () => {
    for (const redirect of ["primary", "sibling"] as const) {
      const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
      const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
      if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
      const sibling = path.join(f.directory, "manual-sibling"); rawGit(local.root, ["worktree", "add", "-b", "manual-sibling", sibling, f.base]);
      const snapshot = (root: string) => {
        const admin = rawGit(root, ["rev-parse", "--absolute-git-dir"]);
        const status = rawGit(root, ["--no-optional-locks", "status", "--porcelain"]);
        return { head: readFileSync(path.join(admin, "HEAD")), index: readFileSync(path.join(admin, "index")),
          refs: rawGit(root, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]), contents: readFileSync(path.join(root, "file.txt")),
          status, staged: rawGit(root, ["ls-files", "--stage", "-z"]), commit: rawGit(root, ["rev-parse", "HEAD"]) };
      };
      for (const root of [local.root, sibling]) { writeFileSync(path.join(root, "file.txt"), `${root === sibling ? "sibling" : "primary"} staged`); rawGit(root, ["add", "file.txt"]); }
      const primaryBefore = snapshot(local.root); const siblingBefore = snapshot(sibling);
      const ownedAdmin = rawGit(prepared.path, ["rev-parse", "--absolute-git-dir"]);
      const destination = redirect === "primary" ? local.commonDirectory : rawGit(sibling, ["rev-parse", "--absolute-git-dir"]);
      overwriteExistingFile(path.join(prepared.path, ".git"), `gitdir: ${destination.split(path.sep).join("/")}\n`);
      const next = f.nextRevision(first.id, commit(f.upstream, "next PR\n", f.head));
      await expect(f.manager.prepareWorktree(f.store, local, next.id, proof)).rejects.toThrow("own administrative registration");
      expect(snapshot(local.root)).toEqual(primaryBefore); expect(snapshot(sibling)).toEqual(siblingBefore);
      f.update({ state: "closed" }); f.store.supersedeReview(next.id, proof, 30);
      await expect(f.manager.cleanupWorktree(f.store, local, next, proof)).rejects.toThrow("own administrative registration");
      expect(snapshot(local.root)).toEqual(primaryBefore); expect(snapshot(sibling)).toEqual(siblingBefore);
      expect(existsSync(ownedAdmin)).toBe(true); expect(existsSync(prepared.path)).toBe(true);
    }
  }, 60_000);

  it("accepts a valid relative administrative backpointer and explicitly binds force commands to that administration", async () => {
    const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    const admin = rawGit(prepared.path, ["rev-parse", "--absolute-git-dir"]);
    rawGit(local.root, ["worktree", "repair", "--relative-paths", prepared.path]);
    expect(path.isAbsolute(readFileSync(path.join(admin, "gitdir"), "utf8").trim())).toBe(false);
    expect(path.isAbsolute(readFileSync(path.join(prepared.path, ".git"), "utf8").trim().slice("gitdir: ".length))).toBe(false);
    const next = f.nextRevision(first.id, commit(f.upstream, "new relative PR\n", f.head));
    expect(await f.manager.prepareWorktree(f.store, local, next.id, proof)).toMatchObject({ kind: "prepared" });
    for (const call of f.calls.filter((call) => call.args.includes("checkout") || call.args.includes("clean"))) {
      expect(call.args[call.args.indexOf("--git-dir") + 1]).toBe(admin);
      expect(call.args[call.args.indexOf("--work-tree") + 1]).toBe(prepared.path);
    }
  }, 60_000);

  it("preserves external linked worktrees owned by nested ordinary or bare Git repositories", async () => {
    for (const bare of [false, true]) {
      const f = fixture(); const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
      const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
      if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
      const nested = path.join(prepared.path, bare ? "bare-store" : "generated-clone");
      rawGit(f.directory, ["clone", ...(bare ? ["--bare"] : []), f.upstream, nested]);
      const external = path.join(f.directory, "external-manual"); rawGit(nested, ["worktree", "add", "--detach", external, f.base]);
      writeFileSync(path.join(external, "manual.txt"), "external work retained");
      const externalAdmin = rawGit(external, ["rev-parse", "--absolute-git-dir"]);
      const before = { head: readFileSync(path.join(externalAdmin, "HEAD")), index: readFileSync(path.join(externalAdmin, "index")),
        status: rawGit(external, ["status", "--porcelain"]), refs: rawGit(external, ["for-each-ref", "--format=%(refname) %(objectname)"]) };
      const next = f.nextRevision(first.id, commit(f.upstream, "next external dependency\n", f.head));
      await expect(f.manager.prepareWorktree(f.store, local, next.id, proof)).rejects.toThrow("external worktree");
      f.update({ state: "closed" }); f.store.supersedeReview(next.id, proof, 30);
      await expect(f.manager.cleanupWorktree(f.store, local, next, proof)).rejects.toThrow("external worktree");
      expect(readFileSync(path.join(externalAdmin, "HEAD"))).toEqual(before.head);
      expect(readFileSync(path.join(externalAdmin, "index"))).toEqual(before.index);
      expect(rawGit(external, ["status", "--porcelain"])).toBe(before.status);
      expect(rawGit(external, ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(before.refs);
      expect(readFileSync(path.join(external, "manual.txt"), "utf8")).toBe("external work retained");
      expect(rawGit(external, ["rev-parse", "HEAD"])).toBe(f.base);
    }
  }, 60_000);

  it("protects external worktrees whose common module administration would be removed with the owned admin directory", async () => {
    const f = fixture();
    const modulesBlob = rawGit(f.upstream, ["hash-object", "-w", "--stdin"], `[submodule "module"]\n\tpath = module\n\turl = ${pathToFileURL(f.upstream).href}\n`);
    const extra = `100644 blob ${modulesBlob}\t.gitmodules\n160000 commit ${f.base}\tmodule\n`;
    const head = commit(f.upstream, "PR module dependency\n", f.head, extra); rawGit(f.upstream, ["update-ref", "refs/pull/101/head", head]); f.update({ headSha: head });
    const local = await f.manager.ensureRepository(f.configuration); const first = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    rawGit(prepared.path, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);
    const module = path.join(prepared.path, "module"); const moduleAdmin = rawGit(module, ["rev-parse", "--absolute-git-dir"]);
    const external = path.join(f.directory, "external-module-worktree"); rawGit(module, ["worktree", "add", "--detach", external, f.base]);
    const externalAdmin = rawGit(external, ["rev-parse", "--absolute-git-dir"]); const externalIndex = readFileSync(path.join(externalAdmin, "index"));
    const next = f.nextRevision(first.id, commit(f.upstream, "next module dependency\n", head, extra));
    expect(await f.manager.prepareWorktree(f.store, local, next.id, proof)).toMatchObject({ kind: "prepared" });
    expect(rawGit(external, ["rev-parse", "HEAD"])).toBe(f.base);
    f.update({ state: "closed" }); f.store.supersedeReview(next.id, proof, 30);
    await expect(f.manager.cleanupWorktree(f.store, local, next, proof)).rejects.toThrow("external worktree");
    expect(existsSync(moduleAdmin)).toBe(true); expect(readFileSync(path.join(externalAdmin, "index"))).toEqual(externalIndex);
    rmSync(prepared.path, { recursive: true });
    await expect(f.manager.cleanupWorktree(f.store, local, next, proof)).rejects.toThrow("external worktree");
    expect(rawGit(external, ["rev-parse", "HEAD"])).toBe(f.base); expect(rawGit(external, ["status", "--porcelain"])).toBe("");
    expect(f.store.getPullRequest(next)?.cleanupPending).toBe(true);
  }, 60_000);
});
