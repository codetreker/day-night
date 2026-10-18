import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { executeCommand } from "../src/github.js";
import { commit, createGitTestFixtures, proof, rawGit, uuid } from "./helpers/git-fixtures.js";

import { createSparseFixture } from "./helpers/git-sparse-fixtures.js";
import type { SparseMode } from "./helpers/git-sparse-fixtures.js";

const fixtures = createGitTestFixtures("git-sparse-worktree");
const { fixture } = fixtures;
beforeAll(fixtures.initialize);
afterEach(() => {
  vi.unstubAllEnvs();
  fixtures.cleanup();
});
afterAll(fixtures.dispose);

const sparseFixture = (mode: SparseMode) => createSparseFixture(fixture, mode);

describe("complete review checkouts from sparse primary worktrees", () => {
  it.each([
    { cone: true, sparseIndex: false, worktreeConfig: true },
    { cone: true, sparseIndex: true, worktreeConfig: true },
    { cone: false, sparseIndex: false, worktreeConfig: true },
  ])("materializes hidden changes for cone=$cone sparseIndex=$sparseIndex worktreeConfig=$worktreeConfig", async (mode) => {
    const f = await sparseFixture(mode); const before = f.snapshot(); const first = f.reserve();
    const prepared = await f.manager.prepareWorktree(f.store, f.local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    expect(readFileSync(path.join(prepared.path, "hidden", "hidden.txt"), "utf8")).toBe("initial hidden change\n");
    expect(readFileSync(path.join(prepared.path, "hidden.txt"), "utf8")).toBe("initial hidden change\n");
    expect(f.snapshot()).toEqual(before);
    const head = commit(f.upstream, "next sparse PR\n", f.sparseHead, f.sparseExtra("next hidden change\n", true));
    const next = f.nextRevision(first.id, head);
    const updated = await f.manager.prepareWorktree(f.store, f.local, next.id, proof);
    if (updated.kind !== "prepared") throw new Error("Expected preparation.");
    expect(readFileSync(path.join(updated.path, "hidden", "hidden.txt"), "utf8")).toBe("next hidden change\n");
    expect(readFileSync(path.join(updated.path, "hidden", "new.txt"), "utf8")).toBe("new hidden path\n");
    const downstream = await executeCommand("git", ["-C", updated.path, "reset", "--hard", "HEAD"], {
      timeoutMs: 20_000, maxBufferBytes: 1024, environment: updated.gitEnvironment,
    });
    expect(downstream.error).toBeNull();
    expect(readFileSync(path.join(updated.path, "hidden", "new.txt"), "utf8")).toBe("new hidden path\n");
    expect(f.snapshot()).toEqual(before);
  }, 60_000);
});

describe("complete review checkouts from sparse primary worktrees", () => {
  it("materializes an existing unlaunched owned sparse index without changing primary sparse state", async () => {
    const f = await sparseFixture({ cone: true, sparseIndex: true, worktreeConfig: true });
    const first = f.reserve(); const prepared = await f.manager.prepareWorktree(f.store, f.local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    rawGit(prepared.path, ["sparse-checkout", "set", "--cone", "--sparse-index", "visible"]);
    expect(existsSync(path.join(prepared.path, "hidden", "hidden.txt"))).toBe(false);
    const before = f.snapshot();
    expect(await f.manager.prepareWorktree(f.store, f.local, first.id, proof)).toMatchObject({ kind: "prepared" });
    expect(readFileSync(path.join(prepared.path, "hidden", "hidden.txt"), "utf8")).toBe("initial hidden change\n");
    expect(rawGit(prepared.path, ["ls-files", "-v"]).split("\n").some((entry) => entry.startsWith("S "))).toBe(false);
    expect(f.snapshot()).toEqual(before);
  }, 60_000);
});

describe("sparse same-target retry context", () => {
  it("retains a launched attempt's owned sparse index, pattern and local context", async () => {
    const f = await sparseFixture({ cone: true, sparseIndex: true, worktreeConfig: true });
    const first = f.reserve(); const prepared = await f.manager.prepareWorktree(f.store, f.local, first.id, proof);
    if (prepared.kind !== "prepared") throw new Error("Expected preparation.");
    f.store.startAttempt(first.id, { processOwner: uuid(700), stdoutLogPath: path.join(f.directory, "out"), stderrLogPath: path.join(f.directory, "err") }, 30);
    rawGit(prepared.path, ["sparse-checkout", "set", "--cone", "--sparse-index", "visible"]);
    writeFileSync(path.join(prepared.path, "review-context.txt"), "retain context");
    const admin = rawGit(prepared.path, ["rev-parse", "--absolute-git-dir"]);
    const ownIndex = readFileSync(path.join(admin, "index")); const pattern = readFileSync(path.join(admin, "info", "sparse-checkout"));
    const ownConfig = readFileSync(path.join(admin, "config.worktree")); const primary = f.snapshot();
    f.store.retryReview({ reviewId: first.id, attempt: 1 }, proof, { error: "retry", retryAt: 40 }, 40);
    f.store.reserveReview(first, { reviewId: uuid(900), sessionId: uuid(901), maxAttempts: 3 }, 40);
    expect(await f.manager.prepareWorktree(f.store, f.local, first.id, proof)).toMatchObject({ kind: "prepared" });
    expect(readFileSync(path.join(admin, "index"))).toEqual(ownIndex);
    expect(readFileSync(path.join(admin, "info", "sparse-checkout"))).toEqual(pattern);
    expect(readFileSync(path.join(admin, "config.worktree"))).toEqual(ownConfig);
    expect(readFileSync(path.join(prepared.path, "review-context.txt"), "utf8")).toBe("retain context");
    expect(existsSync(path.join(prepared.path, "hidden", "hidden.txt"))).toBe(false);
    expect(f.snapshot()).toEqual(primary);
  }, 60_000);
});
