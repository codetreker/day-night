import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createInstalledDeadlineMock } from "../fixtures/installed-operation-limits.js";

const temporary = path.resolve(import.meta.dirname, "../../../../.tmp/installed-deadline-tests");
const directories: string[] = [];
const fixture = async (): Promise<string> => {
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, "Deadline 中文 "));
  directories.push(directory);
  return directory;
};
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("installed CLI deadline mocking", () => {
  it("changes only the target module's default deadlines, preserves explicit limits and cancellation, and leaves its artifact unchanged", async () => {
    const directory = await fixture();
    const entryPath = path.resolve(import.meta.dirname, "../../dist/main.js");
    const operationPath = path.join(path.dirname(entryPath), "api/operation.js");
    const originalSource = await readFile(operationPath, "utf8");
    const installedDirectory = path.join(directory, "installed");
    await symlink(path.dirname(entryPath), installedDirectory, "junction");
    const unrelatedPath = path.join(directory, "unrelated-operation.mjs");
    await copyFile(operationPath, unrelatedPath);
    const preload = await createInstalledDeadlineMock(directory, path.join(installedDirectory, "main.js"), { totalMs: 50, requestMs: 20 });
    const result = spawnSync(process.execPath, ["--import", preload, "--input-type", "module", "--eval", `
import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createOperation, DEFAULT_OPERATION_LIMITS, OperationError } from ${JSON.stringify(pathToFileURL(operationPath).href)};
import { createOperation as unrelatedOperation } from ${JSON.stringify(pathToFileURL(unrelatedPath).href)};
const expected = { totalMs: 300000, requestMs: 30000, responseBytes: 134217728, totalBytes: 268435456 };
deepStrictEqual(DEFAULT_OPERATION_LIMITS, expected);
const production = unrelatedOperation();
deepStrictEqual(production.limits, expected);
production.dispose();
const mocked = createOperation();
deepStrictEqual(mocked.limits, { ...expected, totalMs: 50, requestMs: 20 });
await delay(70);
throws(() => mocked.check(), (error) => error instanceof OperationError && error.kind === "deadline");
mocked.dispose();
const explicit = createOperation({ limits: { totalMs: 200, requestMs: 100, totalBytes: 5 } });
deepStrictEqual(explicit.limits, { ...expected, totalMs: 200, requestMs: 100, totalBytes: 5 });
explicit.dispose();
const source = new AbortController();
const cancelled = createOperation({ signal: source.signal });
const reason = new Error("caller cancellation");
source.abort(reason);
throws(() => cancelled.check(), (error) => error instanceof OperationError && error.kind === "cancelled" && error.cause === reason);
cancelled.dispose();
strictEqual(Object.isFrozen(DEFAULT_OPERATION_LIMITS), true);
`], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect({ status: result.status, signal: result.signal, error: result.error, stderr: result.stderr }).toEqual({ status: 0, signal: null, error: undefined, stderr: "" });
    expect(await readFile(operationPath, "utf8")).toBe(originalSource);
  });

  it("fails before substituting deadlines when the installed production defaults differ", async () => {
    const directory = await fixture();
    await mkdir(path.join(directory, "api"));
    const operationPath = path.join(directory, "api/operation.js");
    await writeFile(path.join(directory, "package.json"), '{"type":"module"}\n');
    await writeFile(operationPath, "export const DEFAULT_OPERATION_LIMITS = { totalMs: 42 }; export const createOperation = () => {};\n");
    const preload = await createInstalledDeadlineMock(directory, path.join(directory, "main.js"), { totalMs: 50, requestMs: 20 });
    const result = spawnSync(process.execPath, ["--import", preload, "--input-type", "module", "--eval", `await import(${JSON.stringify(pathToFileURL(operationPath).href)});`], { encoding: "utf8", timeout: 5_000, windowsHide: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AssertionError");
  });
});
