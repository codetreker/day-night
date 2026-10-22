import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { withPreparationLock } from "./preparation-lock.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".tmp", "preparation-lock-tests");
const lockPath = async (t: { after: (callback: () => Promise<void>) => void }) => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "owned-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return join(directory, "preparation.sqlite");
};

test("concurrent preparations cannot overlap their shared checkout operation", async (t) => {
  const path = await lockPath(t);
  const events: string[] = [];
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const first = withPreparationLock(path, async () => {
    events.push("first entered");
    entered();
    await delay(30);
    events.push("first finished");
  });
  await started;
  await Promise.all([first, withPreparationLock(path, async () => { events.push("second entered"); })]);
  assert.deepEqual(events, ["first entered", "first finished", "second entered"]);
});

test("failed preparation releases the gate and preserves its error", async (t) => {
  const path = await lockPath(t);
  const reason = new Error("controlled preparation failure");
  await assert.rejects(withPreparationLock(path, async () => { throw reason; }), (error) => error === reason);
  assert.equal(await withPreparationLock(path, async () => "next preparation"), "next preparation");
});

test("waiting preparation observes cancellation without entering", async (t) => {
  const path = await lockPath(t);
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const held = withPreparationLock(path, async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); });
  await waiting;
  let called = false;
  const cancelled = withPreparationLock(path, async () => { called = true; }, { signal: controller.signal });
  await delay(10);
  controller.abort(new Error("cancel waiting preparation"));
  await assert.rejects(cancelled, { name: "AbortError" });
  release();
  await held;
  assert.equal(called, false);
});

test("another process owns the gate until exit and a crashed owner leaves no stale lock", async (t) => {
  const path = await lockPath(t);
  const source = 'import { DatabaseSync } from "node:sqlite"; const database = new DatabaseSync(process.argv[1]); database.exec("BEGIN IMMEDIATE"); process.stdout.write("locked\\n"); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source, path], { stdio: ["ignore", "pipe", "inherit"] });
  const closed = new Promise<void>((resolve) => { child.once("close", () => resolve()); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  });
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Lock-owner process did not become ready.")), 5_000);
    child.once("error", (error) => { clearTimeout(deadline); reject(error); });
    child.stdout!.once("data", (data: Buffer) => {
      clearTimeout(deadline);
      if (data.toString() === "locked\n") resolve();
      else reject(new Error("Lock-owner readiness changed."));
    });
  });
  await assert.rejects(withPreparationLock(path, async () => { throw new Error("unexpected lock acquisition"); }, { timeoutMs: 0 }), /preparation lock deadline exceeded/);
  child.kill("SIGKILL");
  await closed;
  assert.equal(await withPreparationLock(path, async () => "recovered"), "recovered");
});
