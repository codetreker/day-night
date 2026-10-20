import { describe, expect, it } from "vitest";
import {
  cleanupApfsFixture, createApfsFinalizer, executeApfsCommand, verifyApfsImageOwnership,
  type ApfsCleanupDependencies, type CleanupRecord, type VerifiedApfsImage,
} from "../../fixtures/apfs-cleanup.js";

const directory = "/fixtures/apfs";
const mountDirectory = `${directory}/mounted volume`;
const imageFile = `${directory}/filesystem.sparseimage`;
const device = "/dev/disk5";
const entities = (root = device, mounted = true): Record<string, unknown>[] => [
  { "dev-entry": "/dev/disk8", "content-hint": "EF57347C-0000-11AA-AA11-00306543ECAC" },
  { "dev-entry": root, "content-hint": "GUID_partition_scheme" },
  { "dev-entry": "/dev/disk8s1", "content-hint": "41504653-0000-11AA-AA11-00306543ECAC", ...(mounted ? { "mount-point": mountDirectory } : {}) },
];
const attachmentPlist = JSON.stringify({ "system-entities": entities() });
const ownership: VerifiedApfsImage = { imageFile, rootDevice: device, inventoryVisibilityVerified: true };
const fixture = { directory, mountDirectory, imageFile, attachmentAttempted: true, attachmentPlist, ownership };
const image = (root = device, mounted = true, file = imageFile): Record<string, unknown> => ({
  "image-path": file, "system-entities": entities(root, mounted), "image-alias": { data: "binary alias" },
});
const inventory = (...images: Record<string, unknown>[]): string => JSON.stringify({ images });
const busy = (): Error => Object.assign(new Error("hdiutil detach failed"), { code: 16, stdout: "", stderr: 'hdiutil: couldn\'t eject "disk5" - Resource busy\n' });
const failure = (message: string): Error => Object.assign(new Error(message), { code: 1, stdout: "", stderr: message });
type Call = { command: string; args: readonly string[]; options: Parameters<ApfsCleanupDependencies["execute"]>[2]; at: number };
type Scenario = {
  inventory?: (elapsed: number, infoCalls: number, detachCalls: number) => string;
  detach?: (attempt: number, elapsed: number) => Error | undefined;
  diagnostic?: (call: Call) => Error | undefined;
  cost?: (call: Call) => number;
  clockTick?: number;
  keepAfterSuccess?: boolean;
};
const simulated = (scenario: Scenario = {}) => {
  let elapsed = 0;
  let infoCalls = 0;
  let detachCount = 0;
  let present = true;
  let active = false;
  const calls: Call[] = [];
  const records: CleanupRecord[] = [];
  const removed: string[] = [];
  const delays: number[] = [];
  const dependencies: ApfsCleanupDependencies = {
    execute: async (command, args, options) => {
      expect(active).toBe(false);
      active = true;
      const call = { command, args, options, at: elapsed };
      calls.push(call);
      try {
        await Promise.resolve();
        expect(options.timeout).toBeGreaterThan(0);
        expect(Number.isInteger(options.timeout)).toBe(true);
        expect(options.env.LC_ALL).toBe("C");
        expect(options.maxBuffer).toBe(64 * 1024);
        expect(options.encoding).toBe("utf8");
        const cost = scenario.cost?.(call) ?? 0;
        elapsed += Math.min(cost, options.timeout);
        if (cost > options.timeout) throw failure("command timed out within cleanup deadline");
        if (command === "/usr/bin/plutil") {
          expect(args[0]).toBe("-extract");
          expect(args.slice(3)).toEqual(["-expect", args[4], ...(args[2] === "raw" ? ["-n"] : []), "-o", "-", "-"]);
          let value: unknown = JSON.parse(options.input!);
          for (const key of args[1]!.split(".")) value = (value as Record<string, unknown>)[key];
          if (args[4] === "array" && !Array.isArray(value)) throw failure(`Expected array at ${args[1]}`);
          if (args[4] === "string" && typeof value !== "string") throw failure(`Expected string at ${args[1]}`);
          return { stdout: args[2] === "json" ? JSON.stringify(value) : Array.isArray(value) ? String(value.length) : value as string, stderr: "" };
        }
        if (command === "/usr/bin/hdiutil" && args[0] === "info") {
          infoCalls += 1;
          return { stdout: scenario.inventory?.(elapsed, infoCalls, detachCount) ?? (present ? inventory(image()) : inventory()), stderr: "" };
        }
        if (command === "/usr/bin/hdiutil" && args[0] === "detach") {
          detachCount += 1;
          const error = scenario.detach?.(detachCount, elapsed);
          if (error !== undefined) throw error;
          if (!scenario.keepAfterSuccess) present = false;
          return { stdout: "", stderr: "" };
        }
        const error = scenario.diagnostic?.(call);
        if (error !== undefined) throw error;
        return { stdout: command === "/usr/sbin/lsof" ? "p123\ncnode\nf19\ntREG\nnheld-file\n" : "root metadata", stderr: "" };
      } finally { active = false; }
    },
    now: () => { const current = elapsed; elapsed += scenario.clockTick ?? 0; return current; },
    delay: async (milliseconds) => { expect(active).toBe(false); delays.push(milliseconds); elapsed += milliseconds; },
    report: (record) => { records.push(record); },
    remove: async (file) => { removed.push(file); },
  };
  return { dependencies, calls, records, removed, delays, elapsed: () => elapsed, detachCalls: () => calls.filter(({ command, args }) => command === "/usr/bin/hdiutil" && args[0] === "detach") };
};
const unverifiedFixture = () => {
  const { ownership: _ownership, ...unverified } = fixture;
  return unverified;
};

describe("APFS fixture cleanup", () => {
  it("sends property list input through a closed stdin pipe", async () => {
    await expect(executeApfsCommand(process.execPath, ["--input-type=module", "--eval", "process.stdin.pipe(process.stdout);"], {
      timeout: 2_000, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024, input: attachmentPlist,
    })).resolves.toEqual({ stdout: attachmentPlist, stderr: "" });
  });

  it("preserves a command failure when its process exits before accepting input", async () => {
    await expect(executeApfsCommand(process.execPath, ["--input-type=module", "--eval", "process.stderr.write('invalid property list'); process.exit(7);"], {
      timeout: 2_000, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024, input: "x".repeat(512 * 1024),
    })).rejects.toMatchObject({ code: 7, stderr: "invalid property list" });
  });

  it("positively verifies exact image and actual GPT identity before granting ownership", async () => {
    const script = simulated({ inventory: () => inventory(image("/dev/disk99", true, "/other/image"), image()) });
    await expect(verifyApfsImageOwnership(imageFile, attachmentPlist, script.dependencies)).resolves.toEqual(ownership);
    expect(script.calls.filter(({ command }) => command === "/usr/bin/plutil").map(({ args }) => args[1])).toEqual([
      "system-entities", "images", "images.0.image-path", "images.1.image-path", "images.1.system-entities",
    ]);
    expect(script.detachCalls()).toEqual([]);
  });

  it.each([
    ["absent", inventory(), "not visible"],
    ["changed root", inventory(image("/dev/disk90")), "device changed"],
    ["duplicate image", inventory(image(), image()), "more than once"],
    ["missing images", "{}", "Expected array"],
  ])("refuses an ownership lease for %s", async (_label, data, message) => {
    const script = simulated({ inventory: () => data });
    await expect(verifyApfsImageOwnership(imageFile, attachmentPlist, script.dependencies)).rejects.toThrow(message);
    expect(script.removed).toEqual([]);
  });

  it("detaches the retained actual GUID root and removes only after exact image absence", async () => {
    const script = simulated();
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls().map(({ args, options }) => ({ args, timeout: options.timeout }))).toEqual([{ args: ["detach", device], timeout: 30_000 }]);
    expect(script.records).toMatchObject([{ kind: "image", state: "mounted", rootDevice: device }, { kind: "image", state: "absent", rootDevice: device }]);
    expect(script.removed).toEqual([directory]);
  });

  it("removes an unattached setup directory without inventory or detach", async () => {
    const script = simulated();
    await cleanupApfsFixture({ ...fixture, attachmentAttempted: false }, script.dependencies);
    await cleanupApfsFixture({ ...fixture, directory: undefined, attachmentAttempted: false }, script.dependencies);
    expect(script.calls).toEqual([]);
    expect(script.removed).toEqual([directory]);
  });

  it("recovers an uncertain attach only from a unique positive exact-image observation", async () => {
    const script = simulated();
    await cleanupApfsFixture({ ...unverifiedFixture(), attachmentPlist: undefined }, script.dependencies);
    expect(script.detachCalls()[0]?.args).toEqual(["detach", device]);
    expect(script.removed).toEqual([directory]);
  });

  it("retains uncertain setup on inventory absence even when unrelated images exist", async () => {
    const script = simulated({ inventory: () => inventory(image(device, true, "/unrelated/image")) });
    await expect(cleanupApfsFixture({ ...unverifiedFixture(), attachmentPlist: undefined }, script.dependencies)).rejects.toThrow("unverified APFS attachment");
    expect(script.detachCalls()).toEqual([]);
    expect(script.removed).toEqual([]);
  });

  it("recovers the recorded partial-unmount phase after a release beyond the former four-second window", async () => {
    const initial = busy();
    const vanishedMount = failure("lsof: not a file system");
    const script = simulated({
      inventory: (_elapsed, _count, attempts) => attempts >= 2 ? inventory() : inventory(image(device, attempts === 0)),
      detach: (_attempt, elapsed) => elapsed < 6_000 ? initial : undefined,
      diagnostic: ({ args }) => args.includes(mountDirectory) ? vanishedMount : undefined,
    });
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls().map(({ at }) => at)).toEqual([0, 10_000]);
    expect(script.records.filter(({ kind }) => kind === "image")).toMatchObject([
      { state: "mounted" }, { state: "unmounted_attached" }, { state: "absent" },
    ]);
    expect(script.records).toContainEqual(expect.objectContaining({ kind: "diagnostic", failure: expect.objectContaining({ stderr: "lsof: not a file system" }) }));
    expect(script.removed).toEqual([directory]);
    expect(Math.max(...script.delays)).toBeLessThanOrEqual(1_000);
  });

  it("captures the owned holder before a legal inventory refresh outlasts its six-second hold", async () => {
    let firstBusyAt: number | undefined;
    const script = simulated({
      inventory: (_elapsed, _count, attempts) => attempts >= 2 ? inventory() : inventory(image()),
      detach: (attempt, elapsed) => {
        if (attempt === 1) { firstBusyAt = elapsed; return busy(); }
        expect(elapsed).toBeGreaterThan(firstBusyAt! + 6_001);
        return undefined;
      },
      cost: ({ command, args }) => command === "/usr/bin/plutil" || (command === "/usr/bin/hdiutil" && args[0] === "info") ? 1_600 : 0,
      diagnostic: ({ args, at }) => args.includes(mountDirectory) && at >= firstBusyAt! + 6_001 ? failure("Owned holder already released") : undefined,
    });
    await cleanupApfsFixture(fixture, script.dependencies);
    const volumeQuery = script.calls.find(({ command, args }) => command === "/usr/sbin/lsof" && args.includes(mountDirectory))!;
    const refresh = script.calls.find(({ command, args, at }) => command === "/usr/bin/hdiutil" && args[0] === "info" && at >= firstBusyAt!)!;
    expect(volumeQuery.at).toBe(firstBusyAt);
    expect(script.calls.indexOf(volumeQuery)).toBeLessThan(script.calls.indexOf(refresh));
    expect(script.records).toContainEqual(expect.objectContaining({
      kind: "diagnostic", args: expect.arrayContaining([mountDirectory]), result: expect.objectContaining({ stdout: expect.stringContaining("p123\n") }),
    }));
    expect(script.detachCalls()).toHaveLength(2);
    expect(script.elapsed()).toBe(22_400);
    expect(script.removed).toEqual([directory]);
  });

  it("observes exact disappearance between opportunities without issuing another detach", async () => {
    const script = simulated({ inventory: (elapsed) => elapsed >= 6_000 ? inventory() : inventory(image()), detach: () => busy() });
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls()).toHaveLength(1);
    expect(script.elapsed()).toBe(6_000);
    expect(script.removed).toEqual([directory]);
  });

  it("uses all three ordinary opportunities and the final observation window within thirty seconds", async () => {
    const errors = [busy(), busy(), busy()];
    const script = simulated({ detach: (attempt) => errors[attempt - 1] });
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: errors[0], errors });
    expect(script.detachCalls().map(({ at }) => at)).toEqual([0, 10_000, 20_000]);
    expect(script.elapsed()).toBe(30_000);
    expect(script.calls.filter(({ command }) => command === "/usr/sbin/lsof")).toHaveLength(2);
    expect(script.calls.filter(({ command }) => command === "/usr/sbin/diskutil")).toHaveLength(1);
    expect(script.removed).toEqual([]);
  });

  it("can confirm final-window disappearance after the third Busy without a fourth detach", async () => {
    const script = simulated({ inventory: (elapsed) => elapsed >= 26_000 ? inventory() : inventory(image()), detach: () => busy() });
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls()).toHaveLength(3);
    expect(script.elapsed()).toBe(26_000);
    expect(script.removed).toEqual([directory]);
  });

  it("charges diagnostic and query execution to the original deadline", async () => {
    const initial = busy();
    const script = simulated({
      detach: () => initial,
      cost: ({ command, args }) => command === "/usr/bin/hdiutil" && args[0] === "detach" ? 24_000 : command === "/usr/bin/plutil" ? 100 : command === "/usr/sbin/lsof" ? 1_000 : command === "/usr/sbin/diskutil" ? 2_000 : 0,
    });
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: initial });
    expect(script.detachCalls()).toHaveLength(2);
    expect(script.detachCalls()[0]!.options.timeout).toBe(29_700);
    expect(script.detachCalls()[1]!.options.timeout).toBe(1_100);
    expect(script.elapsed()).toBe(30_000);
    expect(script.removed).toEqual([]);
  });

  it("queries only current exact-image entities and their raw aliases after the first Busy", async () => {
    const current = { "image-path": imageFile, "system-entities": [
      { "dev-entry": device, "content-hint": "GUID_partition_scheme" },
      { "dev-entry": "/dev/disk12s2", "content-hint": "Apple_APFS" },
    ] };
    const script = simulated({
      inventory: (_elapsed, _count, attempts) => attempts >= 2 ? inventory() : inventory(image("/dev/disk99", true, "/other/image"), attempts === 0 ? image() : current),
      detach: (attempt) => attempt === 1 ? busy() : undefined,
    });
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.calls.filter(({ command }) => command === "/usr/sbin/lsof").map(({ args }) => args)).toEqual([
      ["-nP", "-Fpcfnt", "+f", "--", mountDirectory],
      ["-nP", "-Fpcfnt", "--", device, "/dev/rdisk5", "/dev/disk12s2", "/dev/rdisk12s2"],
    ]);
    expect(script.calls.find(({ command }) => command === "/usr/sbin/diskutil")?.args).toEqual(["info", "-plist", device]);
  });

  it("does not treat empty-holder diagnostics or status one as proof of detach", async () => {
    const noHolders = failure("");
    const initial = busy();
    const script = simulated({ detach: () => initial, diagnostic: () => noHolders });
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: initial, errors: [initial, noHolders, noHolders, noHolders, initial, initial] });
    expect(script.removed).toEqual([]);
    expect(script.elapsed()).toBe(30_000);
  });

  it.each([
    ["duplicate", inventory(image(), image()), "more than once"],
    ["changed", inventory(image("/dev/disk90")), "device changed"],
    ["missing inventory", "{}", "Expected array"],
    ["missing GUID", inventory({ "image-path": imageFile, "system-entities": entities().filter((entity) => entity["content-hint"] !== "GUID_partition_scheme") }), "exactly one GPT"],
    ["invalid child", inventory({ "image-path": imageFile, "system-entities": [...entities(), { "dev-entry": "/other/disk", "content-hint": "Apple_APFS" }] }), "Invalid disk image dev-entry"],
  ])("retains the fixture when %s identity cannot be verified", async (_label, data, message) => {
    const script = simulated({ inventory: () => data });
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toThrow(message);
    expect(script.detachCalls()).toEqual([]);
    expect(script.removed).toEqual([]);
  });

  it("rejects malformed attach metadata without inferring a parent from partition names", async () => {
    const script = simulated();
    await expect(cleanupApfsFixture({ ...unverifiedFixture(), attachmentPlist: JSON.stringify({ "system-entities": [{ "dev-entry": "/dev/disk8s1", "content-hint": "Apple_APFS" }] }) }, script.dependencies)).rejects.toThrow("exactly one GPT");
    expect(script.calls.some(({ args }) => args[0] === "info")).toBe(false);
    expect(script.removed).toEqual([]);
  });

  it("rejects changed ownership paths before querying or mutating disks", async () => {
    const script = simulated();
    await expect(cleanupApfsFixture({ ...fixture, ownership: { ...ownership, imageFile: "/other/image" } }, script.dependencies)).rejects.toThrow("ownership image path changed");
    expect(script.calls).toEqual([]);
  });

  it("does not accept detach success while the exact image remains attached", async () => {
    const script = simulated({ keepAfterSuccess: true });
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toThrow("still attached");
    expect(script.detachCalls()).toHaveLength(1);
    expect(script.removed).toEqual([]);
  });

  it("preserves the Busy chain when later inventory inspection fails", async () => {
    const initial = busy();
    const inspection = failure("cannot inspect inventory");
    const script = simulated({ inventory: (_elapsed, _count, attempts) => { if (attempts > 0) throw inspection; return inventory(image()); }, detach: () => initial });
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toMatchObject({ cause: initial, errors: [initial, inspection] });
    expect(script.removed).toEqual([]);
  });

  it("propagates unrelated detach errors without retry", async () => {
    const denied = failure("permission denied");
    const script = simulated({ detach: () => denied });
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toBe(denied);
    expect(script.detachCalls()).toHaveLength(1);
  });

  it("preserves subsequent unrelated detach errors in the original Busy chain", async () => {
    const initial = busy();
    const denied = failure("permission denied");
    const script = simulated({ detach: (attempt) => attempt === 1 ? initial : denied });
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toMatchObject({ cause: initial, errors: [initial, denied] });
    expect(script.detachCalls()).toHaveLength(2);
  });

  it("uses positive integer timeouts with a fractional monotonic clock", async () => {
    const script = simulated({ clockTick: 0.125 });
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.calls.every(({ options }) => Number.isInteger(options.timeout) && options.timeout > 0)).toBe(true);
    expect(script.detachCalls()[0]!.options.timeout).toBeLessThan(30_000);
  });

  it.each([false, true])("shares the same one-shot finalization promise, including rejection=%s", async (rejects) => {
    const denied = failure("permission denied");
    const script = simulated({ ...(rejects ? { detach: () => denied } : {}) });
    const finalize = createApfsFinalizer(() => fixture);
    const first = finalize(script.dependencies);
    const second = finalize(script.dependencies);
    expect(second).toBe(first);
    if (rejects) {
      await expect(first).rejects.toBe(denied);
      await expect(finalize(script.dependencies)).rejects.toBe(denied);
    } else {
      await first;
      await finalize(script.dependencies);
    }
    expect(script.detachCalls()).toHaveLength(1);
  });
});
