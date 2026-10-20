import path from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { executeCommand } from "../../../src/commands/review/adapters/github.js";
import { commit, createGitTestFixtures, proof } from "../../helpers/git-fixtures.js";

import { createSparseFixture } from "../../helpers/git-sparse-fixtures.js";
import type { SparseMode } from "../../helpers/git-sparse-fixtures.js";

const fixtures = createGitTestFixtures("git-sparse-primary");
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
    { cone: true, sparseIndex: false, worktreeConfig: false },
    { cone: true, sparseIndex: true, worktreeConfig: false },
    { cone: false, sparseIndex: false, worktreeConfig: false },
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
