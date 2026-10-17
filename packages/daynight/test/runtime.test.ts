import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseConfiguration } from "../src/config.js";
import { resolveRuntimePaths } from "../src/paths.js";
import { createCopilotRunner } from "../src/copilot.js";
import { createGitManager } from "../src/git.js";
import { createGitHubClient } from "../src/github.js";
import { createProcessSupervisor } from "../src/processes.js";
import { acquireInstanceLock, formatCoordinatorEvent, runForegroundReview } from "../src/runtime.js";
import { openStore } from "../src/store.js";
import type { RuntimeDependencies } from "../src/runtime.js";

let directory: string;
beforeAll(async () => {
  const temporary = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(temporary, { recursive: true }); directory = await mkdtemp(path.join(temporary, "runtime-"));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
const dependencies = (coordinate: RuntimeDependencies["coordinate"]): RuntimeDependencies => ({
  openStore, createClient: createGitHubClient, createGit: createGitManager, createRunner: createCopilotRunner, createProcesses: createProcessSupervisor, coordinate,
});
const input = (name: string) => {
  const paths = resolveRuntimePaths(path.join(directory, name));
  return { paths, configuration: parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../repo}]", paths) };
};

describe("foreground runtime ownership", () => {
  it("rejects a second owner and never automatically removes a stale lock", async () => {
    const lockFile = path.join(directory, "singleton.lock");
    const lock = await acquireInstanceLock(lockFile, "first");
    expect(JSON.parse(await readFile(lockFile, "utf8"))).toMatchObject({ owner: "first", pid: process.pid });
    await expect(acquireInstanceLock(lockFile)).rejects.toThrow("confirm that its CLI and all review agents have stopped");
    await lock.release();
    await writeFile(lockFile, JSON.stringify({ owner: "dead", pid: 999999999, startedAt: "2000-01-01" }));
    await expect(acquireInstanceLock(lockFile)).rejects.toThrow("manually remove the stale lock");
    expect(JSON.parse(await readFile(lockFile, "utf8"))).toMatchObject({ owner: "dead" });
  });

  it("stays running until its signal stops admission and releases only its own lock after coordinator shutdown", async () => {
    const { configuration, paths } = input("normal");
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const events: string[] = [];
    const coordinate: RuntimeDependencies["coordinate"] = async ({ signal, store, processes }) => {
      expect(store.listActiveReviews()).toEqual([]);
      entered();
      await new Promise<void>((resolve) => { signal.addEventListener("abort", () => { events.push("stopped"); resolve(); }, { once: true }); });
      return { safeToReleaseLock: true };
    };
    const running = runForegroundReview(configuration, paths, { signal: controller.signal, dependencies: dependencies(coordinate), log: () => {} });
    await ready;
    expect(JSON.parse(await readFile(paths.lockFile, "utf8"))).toMatchObject({ pid: process.pid });
    await expect(acquireInstanceLock(paths.lockFile)).rejects.toThrow("Cannot acquire instance lock");
    controller.abort();
    await running;
    expect(events).toEqual(["stopped"]);
    await expect(readFile(paths.lockFile)).rejects.toMatchObject({ code: "ENOENT" });
    const reopened = openStore(paths.databaseFile); reopened.close();
  });

  it("retains the lock after uncertainty until an operator excludes the previous processes and removes it", async () => {
    const { configuration, paths } = input("uncertain");
    await expect(runForegroundReview(configuration, paths, { dependencies: dependencies(async () => ({ safeToReleaseLock: false })), log: () => {} })).rejects.toThrow("Instance lock");
    await expect(acquireInstanceLock(paths.lockFile)).rejects.toThrow("stale lock");
    await rm(paths.lockFile);
    const coordinate = vi.fn<RuntimeDependencies["coordinate"]>(async ({ processes }) => {
      const proof = await processes.recover({} as Parameters<typeof processes.recover>[0]);
      expect(proof).toEqual({ processesExcluded: true, operationsStopped: true });
      return { safeToReleaseLock: true };
    });
    await runForegroundReview(configuration, paths, { dependencies: dependencies(coordinate), log: () => {} });
    expect(coordinate).toHaveBeenCalledOnce();
  });

  it("releases a newly acquired lock if database startup fails before review operations", async () => {
    const { configuration, paths } = input("database-failure");
    const deps = dependencies(async () => ({ safeToReleaseLock: true }));
    deps.openStore = () => { throw new Error("broken SQLite"); };
    await expect(runForegroundReview(configuration, paths, { dependencies: deps, log: () => {} })).rejects.toThrow("broken SQLite");
    await expect(readFile(paths.lockFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to unlink an instance lock whose ownership changed", async () => {
    const file = path.join(directory, "changed.lock");
    const lock = await acquireInstanceLock(file, "owner");
    await writeFile(file, "other-owner");
    await expect(lock.release()).rejects.toThrow("no longer belongs");
    expect(await readFile(file, "utf8")).toBe("other-owner");
  });

  it("formats durable execution context and retry time", () => {
    expect(formatCoordinatorEvent({ level: "error", phase: "retry", message: "missing marker", repository: "o/r", number: 4,
      reviewId: "uuid", revision: 2, attempt: 1, retryAt: 1_000 })).toBe("o/r PR 4 review=uuid revision=2 attempt=1 retry: missing marker retryAt=1970-01-01T00:00:01.000Z");
  });

  it("reports the affected repository and the complete original error chain", () => {
    expect(formatCoordinatorEvent({ level: "error", phase: "poll", repository: "o/r", message: "Polling failed.",
      error: new Error("Cannot read PRs", { cause: new AggregateError([new Error("HTTP 403"), new Error("Rate limited")], "API rejected") }) }))
      .toBe("o/r poll: Polling failed.\nCannot read PRs\nCaused by: API rejected\nHTTP 403\nRate limited");
  });
});
