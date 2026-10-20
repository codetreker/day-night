import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProcessSupervisor, processGroupIsExecuting } from "../../../src/commands/review/processes.js";
import { formatError } from "../../../src/platform/diagnostics.js";
import type { CopilotAttemptOutcome } from "../../../src/commands/review/adapters/copilot.js";
import type { ReviewState } from "../../../src/commands/review/model.js";

const review = (pid: number | null): ReviewState => ({ id: "review", host: "github.com", githubId: "1", number: 1, revision: 1,
  headSha: "a".repeat(40), baseRef: "main", baseSha: "b".repeat(40), status: "running", attemptCount: 1, maxAttempts: 3,
  retryAt: null, processOwner: "owner", processId: pid, processIdentity: pid === null ? null : "identity", stdoutLogPath: "out", stderrLogPath: "err", lastError: null, createdAt: 1, updatedAt: 1 });
const outcome = (): CopilotAttemptOutcome => ({ attempt: { reviewId: "review", attempt: 1 }, sessionId: "session", sessionMode: "create", stdoutLogPath: "out", stderrLogPath: "err", completed: false,
  directProcessClosed: true, captureComplete: true, exitCode: 7, signal: null, lastNonemptyLine: null, interruption: null, launchFailure: null, errors: [] });
const waitForFile = async (file: string): Promise<string> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { return await readFile(file, "utf8"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error(`Fixture did not create ${file}.`);
};
let directory: string;
beforeAll(async () => {
  const temporary = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(temporary, { recursive: true }); directory = await mkdtemp(path.join(temporary, "processes-"));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("current-run process supervision", () => {
  it.each(["", "12 42 Z\n13 99 S\n", "12 42 Z+\n13 42 Z\n"])("excludes a denied group only when scoped status has no executing members: %j", async (status) => {
    const denied = Object.assign(new Error("group permission denied"), { code: "EPERM" });
    const readStatus = vi.fn(async () => status);
    await expect(processGroupIsExecuting(42, { probe: () => { throw denied; }, readStatus })).resolves.toBe(false);
    expect(readStatus).toHaveBeenCalledOnce();
  });

  it.each(["12 42 S\n", "12 42 Z\n13 42 R+\n"])("preserves the original permission denial for an executing group: %j", async (status) => {
    const denied = Object.assign(new Error("group permission denied"), { code: "EPERM" });
    await expect(processGroupIsExecuting(42, { probe: () => { throw denied; }, readStatus: async () => status })).rejects.toBe(denied);
  });

  it("distinguishes an absent group from probe, inspection, and parse failures", async () => {
    const absent = Object.assign(new Error("absent group"), { code: "ESRCH" });
    const readStatus = vi.fn(async () => "12 42 S\n");
    await expect(processGroupIsExecuting(42, { probe: () => { throw absent; }, readStatus })).resolves.toBe(false);
    expect(readStatus).not.toHaveBeenCalled();
    const probeFailure = Object.assign(new Error("invalid probe"), { code: "EINVAL" });
    await expect(processGroupIsExecuting(42, { probe: () => { throw probeFailure; }, readStatus })).rejects.toBe(probeFailure);
    expect(readStatus).not.toHaveBeenCalled();
    const denied = Object.assign(new Error("group permission denied"), { code: "EPERM" });
    const inspectionFailure = new Error("ps failed");
    await expect(processGroupIsExecuting(42, { probe: () => { throw denied; }, readStatus: async () => { throw inspectionFailure; } })).rejects.toBe(inspectionFailure);
    await expect(processGroupIsExecuting(42, { probe: () => { throw denied; }, readStatus: async () => "malformed status" })).rejects.toThrow("Cannot interpret");
  });

  it("retains unsafe execution when a denied probe finds an executing POSIX group", async () => {
    const denied = Object.assign(new Error("group permission denied"), { code: "EPERM" });
    await expect(processGroupIsExecuting(42, { probe: () => { throw denied; }, readStatus: async () => "12 42 S\n" })).rejects.toBe(denied);
    if (process.platform !== "win32") {
      const supervisor = createProcessSupervisor({ graceMs: 1_000 });
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout!.resume(); child.stderr!.resume();
      await once(child, "spawn"); supervisor.onProcess(child, { reviewId: "review", attempt: 1 });
      const kill = process.kill.bind(process);
      const closed = once(child, "close");
      const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (pid === -child.pid! && signal === 0) throw denied;
        return kill(pid, signal);
      });
      try {
        const result = await supervisor.stop(child, { reviewId: "review", attempt: 1 }).catch((error: unknown) => error);
        expect(formatError(result)).toContain("Caused by: group permission denied");
        expect(supervisor.safeToReleaseLock).toBe(false);
      } finally {
        probe.mockRestore();
        kill(-child.pid!, "SIGKILL");
        await closed;
      }
    }
  });

  it("accepts a normal fully drained nonzero foreground exit for retry", async () => {
    const supervisor = createProcessSupervisor({ graceMs: 1_000 });
    const child = spawn(process.execPath, ["-e", "process.stdout.write('done'); process.exitCode = 7"], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.resume(); child.stderr!.resume();
    await once(child, "spawn"); supervisor.onProcess(child, { reviewId: "review", attempt: 1 });
    await once(child, "close");
    await expect(supervisor.exclude(review(child.pid!), outcome())).resolves.toEqual({ processesExcluded: true });
    expect(supervisor.safeToReleaseLock).toBe(true);
  });

  it.each([false, true])("terminates a managed native wrapper tree (ignore TERM=%s)", async (ignoreTerm) => {
    const marker = path.join(directory, `tree-${ignoreTerm}.txt`);
    const fixture = path.join(directory, `tree-${ignoreTerm}.cjs`);
    await writeFile(fixture, `const {spawn}=require('node:child_process');const fs=require('node:fs');\nif(process.argv[2]==='leaf'){setInterval(()=>fs.writeFileSync(process.argv[3],String(Date.now())),15);}else{const leaf=spawn(process.execPath,[__filename,'leaf',process.argv[2]],{stdio:'ignore'});process.on('SIGTERM',()=>{${ignoreTerm ? "" : "if(leaf.exitCode!==null||leaf.signalCode!==null)process.exit(0);else leaf.once('close',()=>process.exit(0));"}});setInterval(()=>{},1000);}`);
    let file = process.execPath;
    let args = [fixture, marker];
    if (process.platform === "win32") {
      file = path.join(directory, `wrapper-${ignoreTerm}.cmd`);
      await writeFile(file, `@echo off\r\n"${process.execPath}" "${fixture}" "${marker}"\r\n`);
      args = [];
    }
    const supervisor = createProcessSupervisor({ graceMs: process.platform === "win32" ? 3_000 : 300 });
    const child = crossSpawn(file, args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout!.resume(); child.stderr!.resume();
    await once(child, "spawn"); supervisor.onProcess(child, { reviewId: "review", attempt: 1 });
    try {
      await waitForFile(marker);
      await supervisor.stop(child, { reviewId: "review", attempt: 1 });
      const stoppedValue = await readFile(marker, "utf8");
      await new Promise((resolve) => { setTimeout(resolve, 80); });
      expect(await readFile(marker, "utf8")).toBe(stoppedValue);
      await expect(supervisor.exclude(review(child.pid!))).resolves.toEqual({ processesExcluded: true });
    } finally {
      if (child.exitCode === null && child.signalCode === null) await supervisor.stop(child, { reviewId: "review", attempt: 1 });
    }
  }, 15_000);

  it("retains uncertainty for persisted process identities and never targets their PIDs", async () => {
    const supervisor = createProcessSupervisor();
    await expect(supervisor.exclude(review(process.pid))).rejects.toThrow("not launched by this CLI");
    expect(supervisor.safeToReleaseLock).toBe(false);
    await expect(supervisor.recover(review(process.pid))).rejects.toThrow("instance-lock owner's confirmation");
    const recovered = createProcessSupervisor({ previousProcessesExcluded: true });
    await expect(recovered.recover(review(null))).resolves.toEqual({ processesExcluded: true, operationsStopped: true });
  });

  it("requires Windows foreground completion evidence after the root has already disappeared", async () => {
    const supervisor = createProcessSupervisor({ graceMs: 1_000 });
    const child = spawn(process.execPath, ["-e", "process.exitCode = 1"], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.resume(); child.stderr!.resume();
    await once(child, "spawn"); supervisor.onProcess(child, { reviewId: "review", attempt: 1 });
    await once(child, "close");
    const incomplete = { ...outcome(), captureComplete: false };
    if (process.platform === "win32") {
      const result = await supervisor.exclude(review(child.pid!), incomplete).catch((error: unknown) => error);
      expect(formatError(result)).toContain("Cannot confirm that the current agent and its foreground tools have stopped; execution state was retained.");
      expect(formatError(result)).toContain("Caused by: The Windows agent exited before its current process tree could be terminated; operator recovery is required.");
      expect(supervisor.safeToReleaseLock).toBe(false);
    } else await expect(supervisor.exclude(review(child.pid!), incomplete)).resolves.toEqual({ processesExcluded: true });
  });
});
