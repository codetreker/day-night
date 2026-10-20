import { describe, expect, it } from "vitest";
import { cleanupApfsFixture, executeApfsCommand, type ApfsCleanupDependencies, type CleanupRecord } from "../../fixtures/apfs-cleanup.js";

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
const fixture = { directory, mountDirectory, imageFile, attachmentAttempted: true, attachmentPlist };
const image = (root = device, mounted = true, file = imageFile): Record<string, unknown> => ({
  "image-path": file, "system-entities": entities(root, mounted), "image-alias": { data: "binary alias" },
});
const inventory = (...images: Record<string, unknown>[]): string => JSON.stringify({ images });
const busy = (): Error => Object.assign(new Error("hdiutil detach failed"), {
  code: 16, stdout: "", stderr: 'hdiutil: couldn\'t eject "disk5" - Resource busy\n',
});
const failure = (message: string): Error => Object.assign(new Error(message), { code: 1, stdout: "", stderr: message });
type Step = { action: "info" | "detach" | "lsof" | "diskutil"; duration?: number; stdout?: string; error?: Error };

const scripted = (steps: Step[], clockTick = 0) => {
  let elapsed = 0;
  let index = 0;
  const calls: { command: string; args: readonly string[]; options: Parameters<ApfsCleanupDependencies["execute"]>[2] }[] = [];
  const records: CleanupRecord[] = [];
  const removed: string[] = [];
  const delays: number[] = [];
  const dependencies: ApfsCleanupDependencies = {
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
      expect(options.timeout).toBeGreaterThan(0);
      expect(Number.isInteger(options.timeout)).toBe(true);
      expect(options.env.LC_ALL).toBe("C");
      expect(options.maxBuffer).toBe(64 * 1024);
      expect(options.encoding).toBe("utf8");
      if (command === "/usr/bin/plutil") {
        expect(args[0]).toBe("-extract");
        expect(args.slice(3)).toEqual(["-expect", args[4], ...(args[2] === "raw" ? ["-n"] : []), "-o", "-", "-"]);
        expect(options.input).toBeTypeOf("string");
        let value: unknown = JSON.parse(options.input!);
        for (const key of args[1]!.split(".")) value = (value as Record<string, unknown>)[key];
        if (args[4] === "array" && !Array.isArray(value)) throw failure(`Expected array at ${args[1]}`);
        if (args[4] === "string" && typeof value !== "string") throw failure(`Expected string at ${args[1]}`);
        if (args[2] === "json") return { stdout: JSON.stringify(value), stderr: "" };
        return { stdout: Array.isArray(value) ? String(value.length) : value as string, stderr: "" };
      }
      const step = steps[index++];
      const action = command === "/usr/bin/hdiutil" ? args[0] : command.split("/").at(-1);
      expect(step?.action).toBe(action);
      elapsed += step?.duration ?? 0;
      if (step?.error !== undefined) throw step.error;
      return { stdout: step?.stdout ?? "", stderr: "" };
    },
    now: () => { const current = elapsed; elapsed += clockTick; return current; },
    delay: async (milliseconds) => { delays.push(milliseconds); elapsed += milliseconds; },
    report: (record) => { records.push(record); },
    remove: async (file) => { removed.push(file); },
  };
  return {
    dependencies, calls, records, removed, delays, elapsed: () => elapsed,
    detachCalls: () => calls.filter(({ command, args }) => command === "/usr/bin/hdiutil" && args[0] === "detach"),
  };
};

const attached = (): Step => ({ action: "info", stdout: inventory(image()) });
const absent = (): Step => ({ action: "info", stdout: inventory() });
const diagnostics = (): Step[] => [{ action: "lsof" }, { action: "diskutil" }];

describe("APFS fixture cleanup", () => {
  it("sends property list input through a closed stdin pipe", async () => {
    const output = await executeApfsCommand(process.execPath, ["--input-type=module", "--eval", "process.stdin.pipe(process.stdout);"], {
      timeout: 2_000, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024, input: attachmentPlist,
    });
    expect(output).toEqual({ stdout: attachmentPlist, stderr: "" });
  });

  it("preserves the child command failure if it exits before accepting its input", async () => {
    const command = executeApfsCommand(process.execPath, ["--input-type=module", "--eval", "process.stderr.write('invalid property list'); process.exit(7);"], {
      timeout: 2_000, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024, input: "x".repeat(512 * 1024),
    });
    await expect(command).rejects.toMatchObject({ code: 7, stderr: "invalid property list" });
  });

  it("detaches the actual GPT device and verifies image absence before removing its directory", async () => {
    const script = scripted([attached(), { action: "detach" }, absent()]);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls().map(({ args, options }) => ({ args, timeout: options.timeout }))).toEqual([
      { args: ["detach", device], timeout: 30_000 },
    ]);
    expect(script.records).toEqual([
      { kind: "image", imageFile, attached: true, device }, { kind: "image", imageFile, attached: false, device: undefined },
    ]);
    expect(script.removed).toEqual([directory]);
    expect(script.delays).toEqual([]);
    expect(script.calls.filter(({ command }) => command === "/usr/bin/plutil").map(({ args }) => args[1])).toEqual([
      "system-entities", "images", "images.0.image-path", "images.0.system-entities", "images",
    ]);
  });

  it("removes directories without mount commands when attachment was never attempted", async () => {
    const script = scripted([]);
    await cleanupApfsFixture({ ...fixture, attachmentAttempted: false }, script.dependencies);
    await cleanupApfsFixture({ ...fixture, directory: undefined, attachmentAttempted: false }, script.dependencies);
    expect(script.calls).toEqual([]);
    expect(script.removed).toEqual([directory]);
  });

  it("recovers an uncertain attachment from only the exact image inventory entry", async () => {
    const script = scripted([
      { action: "info", stdout: inventory(image("/dev/disk99", true, "/unrelated/image"), image()) },
      { action: "detach" }, absent(),
    ]);
    await cleanupApfsFixture({ ...fixture, attachmentPlist: undefined }, script.dependencies);
    expect(script.detachCalls()[0]?.args).toEqual(["detach", device]);
    expect(script.removed).toEqual([directory]);
  });

  it("accepts proven exact image absence after an uncertain attach without detaching an unrelated image", async () => {
    const script = scripted([{ action: "info", stdout: inventory(image(device, true, "/unrelated/image")) }]);
    await cleanupApfsFixture({ ...fixture, attachmentPlist: undefined }, script.dependencies);
    expect(script.detachCalls()).toEqual([]);
    expect(script.removed).toEqual([directory]);
  });

  it("recovers busy cleanup after the mountpoint disappears while the image remains attached", async () => {
    const initial = busy();
    const vanishedMount = failure(`lsof: not a file system: ${mountDirectory}`);
    const script = scripted([
      attached(), { action: "detach", error: initial },
      { action: "lsof", error: vanishedMount },
      { action: "diskutil", stdout: "device metadata" },
      { action: "info", stdout: inventory(image(device, false)) },
      { action: "detach" }, absent(),
    ]);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls().map(({ args }) => args)).toEqual([["detach", device], ["detach", device]]);
    expect(script.calls.find(({ command }) => command === "/usr/sbin/lsof")?.args).toEqual([
      "-nP", "-Fpcfnt", "+f", "--", mountDirectory,
    ]);
    expect(script.calls.find(({ command }) => command === "/usr/sbin/diskutil")?.args).toEqual(["info", "-plist", device]);
    expect(script.records).toMatchObject([
      { kind: "image", device },
      { kind: "busy", args: ["detach", device], failure: { code: 16, stderr: expect.stringContaining("Resource busy") } },
      { kind: "diagnostic", failure: { stderr: expect.stringContaining("not a file system") } },
      { kind: "diagnostic", result: { stdout: "device metadata" } },
      { kind: "image", device }, { kind: "image", device: undefined },
    ]);
    expect(script.delays).toEqual([1_000]);
    expect(script.removed).toEqual([directory]);
  });

  it("retains busy and failed diagnostics when inventory proves the image has already detached", async () => {
    const script = scripted([
      attached(), { action: "detach", error: busy() },
      { action: "lsof", error: failure("not a file system") },
      { action: "diskutil", error: failure("Could not find disk") }, absent(),
    ]);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.detachCalls()).toHaveLength(1);
    expect(script.records.filter(({ kind }) => kind === "busy")).toHaveLength(1);
    expect(script.records.filter(({ kind }) => kind === "diagnostic")).toHaveLength(2);
    expect(script.removed).toEqual([directory]);
  });

  it("bounds persistent busy cleanup by three ordinary detach attempts and retains the fixture", async () => {
    const errors = [busy(), busy(), busy()] as const;
    const script = scripted([
      attached(), { action: "detach", error: errors[0] }, ...diagnostics(),
      attached(), { action: "detach", error: errors[1] },
      attached(), { action: "detach", error: errors[2] }, attached(),
    ]);
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: errors[0], errors });
    expect(script.detachCalls().map(({ args }) => args)).toEqual(Array.from({ length: 3 }, () => ["detach", device]));
    expect(script.delays).toEqual([1_000, 1_000]);
    expect(script.elapsed()).toBe(2_000);
    expect(script.removed).toEqual([]);
  });

  it("charges inventory, diagnostics and delays to the original thirty-second deadline", async () => {
    const initial = busy();
    const script = scripted([
      { action: "info", duration: 1_000, stdout: inventory(image()) },
      { action: "detach", duration: 25_000, error: initial },
      { action: "lsof", duration: 1_000 }, { action: "diskutil", duration: 2_000 },
    ]);
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: initial });
    expect((error as AggregateError).errors[1]).toMatchObject({ message: expect.stringContaining("deadline reached") });
    expect(script.detachCalls()[0]?.options.timeout).toBe(29_000);
    expect(script.elapsed()).toBe(30_000);
    expect(script.removed).toEqual([]);
  });

  it.each([
    ["ambiguous image", inventory(image(), image()), "more than once"],
    ["changed device", inventory(image("/dev/disk90")), "device changed"],
    ["missing inventory", "{}", "Expected array at images"],
    ["missing GPT device", inventory({ "image-path": imageFile, "system-entities": entities().filter((entity) => entity["content-hint"] !== "GUID_partition_scheme") }), "exactly one GPT"],
  ])("preserves ownership uncertainty for %s without attempting detach", async (_label, stdout, message) => {
    const script = scripted([{ action: "info", stdout }]);
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toThrow(message);
    expect(script.detachCalls()).toEqual([]);
    expect(script.removed).toEqual([]);
  });

  it("does not accept detach success while the exact image remains attached", async () => {
    const script = scripted([attached(), { action: "detach" }, attached()]);
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect((error as AggregateError).errors[0]).toMatchObject({ message: expect.stringContaining("still attached") });
    expect(script.detachCalls()).toHaveLength(1);
    expect(script.removed).toEqual([]);
  });

  it("preserves the busy cause when subsequent exact image inspection fails", async () => {
    const initial = busy();
    const inspection = failure("cannot inspect image inventory");
    const script = scripted([attached(), { action: "detach", error: initial }, ...diagnostics(), { action: "info", error: inspection }]);
    const error = await cleanupApfsFixture(fixture, script.dependencies).catch((error: unknown) => error);
    expect(error).toMatchObject({ cause: initial, errors: [initial, inspection] });
    expect(script.removed).toEqual([]);
  });

  it("preserves unrelated detach errors without retry or removal", async () => {
    const denied = failure("permission denied");
    const script = scripted([attached(), { action: "detach", error: denied }]);
    await expect(cleanupApfsFixture(fixture, script.dependencies)).rejects.toBe(denied);
    expect(script.detachCalls()).toHaveLength(1);
    expect(script.removed).toEqual([]);
  });

  it("rejects malformed attach metadata instead of inferring a parent from APFS disk names", async () => {
    const script = scripted([]);
    const attachmentPlist = JSON.stringify({ "system-entities": [{ "dev-entry": "/dev/disk8s1", "content-hint": "Apple_APFS" }] });
    await expect(cleanupApfsFixture({ ...fixture, attachmentPlist }, script.dependencies)).rejects.toThrow("exactly one GPT");
    expect(script.detachCalls()).toEqual([]);
    expect(script.removed).toEqual([]);
  });

  it("passes integer command timeouts when the monotonic clock has fractional milliseconds", async () => {
    const script = scripted([attached(), { action: "detach" }, absent()], 0.125);
    await cleanupApfsFixture(fixture, script.dependencies);
    expect(script.calls.every(({ options }) => Number.isInteger(options.timeout) && options.timeout > 0)).toBe(true);
    expect(script.detachCalls()[0]!.options.timeout).toBeLessThan(30_000);
  });
});
