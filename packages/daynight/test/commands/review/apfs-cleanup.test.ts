import { describe, expect, it } from "vitest";
import { cleanupApfsFixture, type ApfsCleanupDependencies, type CleanupRecord } from "../../fixtures/apfs-cleanup.js";

const fixture = { directory: "/fixtures/apfs", mountDirectory: "/fixtures/apfs/mounted volume", attachmentAttempted: true };
const busy = (): Error => Object.assign(new Error("hdiutil detach failed"), {
  code: 1, stdout: "", stderr: 'hdiutil: couldn\'t eject "disk7" - Resource busy\n',
});
const result = { stdout: "", stderr: "" };
type Step = { command: string; duration?: number; result?: typeof result; error?: Error };

const scripted = (steps: Step[], clockTick = 0): {
  dependencies: ApfsCleanupDependencies;
  calls: { command: string; args: readonly string[]; timeout: number; env: NodeJS.ProcessEnv }[];
  records: CleanupRecord[];
  removed: string[];
  delays: number[];
  elapsed: () => number;
} => {
  let elapsed = 0;
  let index = 0;
  const calls: ReturnType<typeof scripted>["calls"] = [];
  const records: CleanupRecord[] = [];
  const removed: string[] = [];
  const delays: number[] = [];
  return {
    calls, records, removed, delays, elapsed: () => elapsed,
    dependencies: {
      execute: async (command, args, options) => {
        calls.push({ command, args, timeout: options.timeout, env: options.env });
        const step = steps[index++];
        expect(step?.command).toBe(command);
        expect(options.timeout).toBeGreaterThan(0);
        expect(Number.isInteger(options.timeout)).toBe(true);
        elapsed += step?.duration ?? 0;
        if (step?.error !== undefined) throw step.error;
        return step?.result ?? result;
      },
      now: () => { const current = elapsed; elapsed += clockTick; return current; },
      delay: async (milliseconds) => { delays.push(milliseconds); elapsed += milliseconds; },
      report: (record) => { records.push(record); },
      remove: async (directory) => { removed.push(directory); },
    },
  };
};

describe("APFS fixture cleanup", () => {
  it("detaches normally before removing the fixture and preserves the ordinary detach timeout", async () => {
    const script = scripted([{ command: "/usr/bin/hdiutil" }]);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.calls).toEqual([{
      command: "/usr/bin/hdiutil", args: ["detach", fixture.mountDirectory],
      timeout: 30_000, env: { ...process.env, LC_ALL: "C" },
    }]);
    expect(script.removed).toEqual([fixture.directory]);
    expect(script.records).toEqual([]);
    expect(script.delays).toEqual([]);
  });

  it("removes fixture directories without mount commands when attachment was never attempted", async () => {
    const script = scripted([]);
    await cleanupApfsFixture({ ...fixture, attachmentAttempted: false }, script.dependencies);
    await cleanupApfsFixture({ ...fixture, directory: undefined, attachmentAttempted: false }, script.dependencies);
    expect(script.calls).toEqual([]);
    expect(script.removed).toEqual([fixture.directory]);
  });

  it("preserves an uncertain attachment when ordinary detach cannot confirm cleanup", async () => {
    const uncertain = Object.assign(new Error("attach timed out and detach could not find the mount"), {
      code: 1, stdout: "", stderr: "hdiutil: detach failed - No such file or directory",
    });
    const script = scripted([{ command: "/usr/bin/hdiutil", error: uncertain }]);
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toBe(uncertain);
    expect(script.calls[0]?.args).toEqual(["detach", fixture.mountDirectory]);
    expect(script.removed).toEqual([]);
  });

  it("reports exact-volume holders and device metadata before ordinary busy recovery", async () => {
    const initial = busy();
    const holders = { stdout: "p123\ncFinder\nf4\ntDIR\nn/fixtures/apfs/mounted volume\n", stderr: "" };
    const device = { stdout: "<plist><dict><key>DeviceIdentifier</key><string>disk7s1</string></dict></plist>", stderr: "" };
    const script = scripted([
      { command: "/usr/bin/hdiutil", error: initial },
      { command: "/usr/sbin/lsof", result: holders },
      { command: "/usr/sbin/diskutil", result: device },
      { command: "/usr/bin/hdiutil" },
    ]);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.calls.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: "/usr/bin/hdiutil", args: ["detach", fixture.mountDirectory] },
      { command: "/usr/sbin/lsof", args: ["-nP", "-Fpcfnt", "+f", "--", fixture.mountDirectory] },
      { command: "/usr/sbin/diskutil", args: ["info", "-plist", fixture.mountDirectory] },
      { command: "/usr/bin/hdiutil", args: ["detach", fixture.mountDirectory] },
    ]);
    expect(script.records).toMatchObject([
      { kind: "busy", failure: { code: 1, stderr: (initial as Error & { stderr: string }).stderr } },
      { kind: "diagnostic", command: "/usr/sbin/lsof", result: holders },
      { kind: "diagnostic", command: "/usr/sbin/diskutil", result: device },
    ]);
    expect(script.delays).toEqual([1_000]);
    expect(script.removed).toEqual([fixture.directory]);
    expect(script.calls.every(({ env }) => env.LC_ALL === "C")).toBe(true);
  });

  it("bounds persistent busy cleanup by three ordinary detach attempts and retains the mounted fixture", async () => {
    const failures = [busy(), busy(), busy()] as const;
    const script = scripted([
      { command: "/usr/bin/hdiutil", error: failures[0] },
      { command: "/usr/sbin/lsof" },
      { command: "/usr/sbin/diskutil" },
      { command: "/usr/bin/hdiutil", error: failures[1] },
      { command: "/usr/bin/hdiutil", error: failures[2] },
    ]);
    const failure = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ cause: failures[0], errors: failures });
    expect((failure as Error).message).toContain('"command":"/usr/sbin/lsof"');
    expect(script.records.filter(({ kind }) => kind === "busy")).toHaveLength(3);
    expect(script.calls.filter(({ command }) => command === "/usr/bin/hdiutil")).toHaveLength(3);
    expect(script.delays).toEqual([1_000, 1_000]);
    expect(script.elapsed()).toBe(2_000);
    expect(script.removed).toEqual([]);
  });

  it("charges diagnostics to the original deadline and never removes a fixture when time expires", async () => {
    const initial = busy();
    const diagnosticFailure = Object.assign(new Error("metadata timed out"), { code: "ETIMEDOUT", stdout: "partial", stderr: "" });
    const script = scripted([
      { command: "/usr/bin/hdiutil", duration: 28_000, error: initial },
      { command: "/usr/sbin/lsof", duration: 1_000 },
      { command: "/usr/sbin/diskutil", duration: 1_000, error: diagnosticFailure },
    ]);
    const failure = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(failure).toMatchObject({ cause: initial, errors: [initial, diagnosticFailure] });
    expect(script.calls.map(({ timeout }) => timeout)).toEqual([30_000, 2_000, 1_000]);
    expect(script.elapsed()).toBe(30_000);
    expect(script.delays).toEqual([]);
    expect(script.removed).toEqual([]);
    expect(script.records[2]).toMatchObject({ failure: { code: "ETIMEDOUT", stdout: "partial" } });
  });

  it("exposes unavailable diagnostics while still allowing an ordinary detach to succeed", async () => {
    const noVisibleHandles = Object.assign(new Error("lsof exited 1"), { code: 1, stdout: "", stderr: "" });
    const denied = Object.assign(new Error("diskutil denied"), { code: 1, stdout: "partial metadata", stderr: "permission denied" });
    const script = scripted([
      { command: "/usr/bin/hdiutil", error: busy() },
      { command: "/usr/sbin/lsof", error: noVisibleHandles },
      { command: "/usr/sbin/diskutil", error: denied },
      { command: "/usr/bin/hdiutil" },
    ]);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.records).toMatchObject([
      { kind: "busy" },
      { kind: "diagnostic", failure: { code: 1, stdout: "", stderr: "" } },
      { kind: "diagnostic", failure: { code: 1, stdout: "partial metadata", stderr: "permission denied" } },
    ]);
    expect(script.removed).toEqual([fixture.directory]);
  });

  it("preserves an unrelated detach failure without retrying or removing its mounted fixture", async () => {
    const denied = Object.assign(new Error("cannot detach"), { code: 16, stdout: "", stderr: "permission denied" });
    const script = scripted([{ command: "/usr/bin/hdiutil", error: denied }]);
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toBe(denied);
    expect(script.calls).toHaveLength(1);
    expect(script.records).toEqual([]);
    expect(script.delays).toEqual([]);
    expect(script.removed).toEqual([]);
  });

  it("stops retrying on an unrelated later error and retains the original busy error", async () => {
    const initial = busy();
    const denied = Object.assign(new Error("cannot detach"), { stderr: "permission denied" });
    const script = scripted([
      { command: "/usr/bin/hdiutil", error: initial },
      { command: "/usr/sbin/lsof" },
      { command: "/usr/sbin/diskutil" },
      { command: "/usr/bin/hdiutil", error: denied },
    ]);
    const failure = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(failure).toMatchObject({ cause: initial, errors: [initial, denied] });
    expect(script.calls).toHaveLength(4);
    expect(script.removed).toEqual([]);
  });

  it("passes positive integer timeouts when the monotonic clock has fractional milliseconds", async () => {
    const script = scripted([
      { command: "/usr/bin/hdiutil", error: busy() },
      { command: "/usr/sbin/lsof" },
      { command: "/usr/sbin/diskutil" },
      { command: "/usr/bin/hdiutil" },
    ], 0.125);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.calls.every(({ timeout }) => Number.isInteger(timeout) && timeout > 0)).toBe(true);
    expect(script.calls[0]?.timeout).toBe(29_999);
    expect(script.calls[3]?.timeout).toBeLessThan(29_000);
  });
});
