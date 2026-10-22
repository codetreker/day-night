import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { login, startAuthFixture } from "./auth-fixture.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".tmp", "auth-helper-tests");
const directory = async (t: { after: (callback: () => Promise<void>) => void }) => {
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "owned-"));
  t.after(async () => { await rm(path, { recursive: true, force: true }); });
  return path;
};
const binary = () => {
  const value = process.env.DAYNIGHT_TEST_UNIAUTH_FIXTURE;
  assert.ok(value, "Prepare the pinned UniAuth fixture before helper tests");
  return value;
};

test("real fixture registers its process before readiness and consumes private metadata", async (t) => {
  const path = await directory(t);
  let registered = false;
  let processId: number | undefined;
  const fixture = await startAuthFixture({
    binary: binary(), directory: path, callbackURL: "http://127.0.0.1:8787/auth/callback",
    onSpawn: async (child) => {
      assert.ok(child.pid);
      processId = child.pid;
      await new Promise<void>((resolve) => setImmediate(resolve));
      registered = true;
    },
  });
  t.after(() => fixture.close());
  assert.equal(registered, true);
  assert.equal(fixture.child.pid, processId);
  assert.equal(new URL(fixture.origin).hostname, "127.0.0.1");
  await assert.rejects(stat(join(path, "ready.json")), { code: "ENOENT" });
  const response = await fetch(`${fixture.origin}/auth/providers`, {
    method: "POST", redirect: "manual", headers: {
      Authorization: `Basic ${Buffer.from(`${fixture.appId}:${fixture.appSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    }, body: JSON.stringify({ redirect_uri: "http://127.0.0.1:8787/auth/callback" }), signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: ["github"] });
  await fixture.close();
  assert.ok(fixture.child.exitCode !== null);
});

test("aborting process registration reaps the owned real fixture", async (t) => {
  const path = await directory(t);
  const controller = new AbortController();
  const reason = new Error("fixture registration cancelled");
  let child: import("node:child_process").ChildProcess | undefined;
  await assert.rejects(startAuthFixture({
    binary: binary(), directory: path, callbackURL: "http://127.0.0.1:8787/auth/callback", signal: controller.signal,
    onSpawn: async (value) => { child = value; controller.abort(reason); },
  }), (error) => error === reason);
  assert.ok(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("an aborted login never invokes the provided browser transport", async () => {
  const reason = new Error("login cancelled");
  let calls = 0;
  await assert.rejects(login({ origin: "http://127.0.0.1:8787", signal: AbortSignal.abort(reason), fetch: async () => {
    calls += 1;
    throw new Error("unexpected request");
  } }), (error) => error === reason);
  assert.equal(calls, 0);
});
