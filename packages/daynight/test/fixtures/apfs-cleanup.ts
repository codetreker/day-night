import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

type CommandResult = { stdout: string; stderr: string };
type CommandOptions = { timeout: number; env: NodeJS.ProcessEnv; encoding: "utf8"; maxBuffer: number; input?: string };
type CommandFailure = Error & { code?: unknown; stdout?: unknown; stderr?: unknown };
type Dictionary = Record<string, unknown>;

export type CleanupRecord = {
  kind: "busy" | "diagnostic";
  command: string;
  args: readonly string[];
  result?: CommandResult;
  failure?: { message: string; code: unknown; stdout: unknown; stderr: unknown };
} | { kind: "image"; imageFile: string; attached: boolean; device: string | undefined };

export type ApfsCleanupDependencies = {
  execute: (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
  report: (record: CleanupRecord) => void;
  remove: (directory: string) => Promise<void>;
};

const executeFile = promisify(execFile);
export const executeApfsCommand: ApfsCleanupDependencies["execute"] = async (command, args, { input, ...options }) => {
  const execution = executeFile(command, [...args], options);
  let inputFailure: Error | undefined;
  execution.child.stdin!.once("error", (error: Error) => { inputFailure = error; });
  execution.child.stdin!.end(input);
  const output = await execution;
  if (inputFailure !== undefined) throw inputFailure;
  return output;
};

const defaults: ApfsCleanupDependencies = {
  execute: executeApfsCommand,
  now: () => performance.now(),
  delay: async (milliseconds) => { await setTimeout(milliseconds); },
  report: (record) => { process.stderr.write(`APFS fixture cleanup: ${JSON.stringify(record)}\n`); },
  remove: (directory) => rm(directory, { recursive: true, force: true }),
};

const dictionary = (value: unknown, label: string): Dictionary => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${label} dictionary`);
  return value as Dictionary;
};

const imageDevice = (value: unknown): string => {
  if (!Array.isArray(value)) throw new Error("Disk image has no system-entities array");
  const roots = value.map((entity) => dictionary(entity, "disk image entity"))
    .filter((entity) => entity["content-hint"] === "GUID_partition_scheme");
  if (roots.length !== 1) throw new Error("Expected exactly one GPT image device");
  const device = roots[0]!["dev-entry"];
  if (typeof device !== "string" || !/^\/dev\/[^/]+$/.test(device)) throw new Error("Invalid disk image dev-entry");
  return device;
};

const failureRecord = (error: unknown): NonNullable<Extract<CleanupRecord, { kind: "busy" | "diagnostic" }>["failure"]> => {
  const failure = error as CommandFailure;
  return {
    message: error instanceof Error ? error.message : String(error),
    code: failure?.code,
    stdout: failure?.stdout,
    stderr: failure?.stderr,
  };
};

export const cleanupApfsFixture = async (
  fixture: {
    directory: string | undefined;
    mountDirectory: string;
    imageFile: string;
    attachmentAttempted: boolean;
    attachmentPlist: string | undefined;
  },
  dependencies: ApfsCleanupDependencies = defaults,
): Promise<void> => {
  if (fixture.attachmentAttempted) {
    const deadline = dependencies.now() + 30_000;
    const failures: unknown[] = [];
    const records: CleanupRecord[] = [];
    const remaining = (): number => Math.max(0, Math.floor(deadline - dependencies.now()));
    const options = (limit: number, input?: string): CommandOptions => {
      const timeout = Math.min(limit, remaining());
      if (timeout === 0) throw new Error("APFS cleanup deadline reached before command execution");
      return {
        timeout, env: { ...process.env, LC_ALL: "C" }, encoding: "utf8", maxBuffer: 64 * 1024,
        ...(input === undefined ? {} : { input }),
      };
    };
    const report = (record: CleanupRecord): void => {
      records.push(record);
      dependencies.report(record);
    };
    const extract = async (input: string, key: string, format: "raw" | "json", type: "array" | "string"): Promise<string> => {
      const { stdout } = await dependencies.execute("/usr/bin/plutil", [
        "-extract", key, format, "-expect", type, ...(format === "raw" ? ["-n"] : []), "-o", "-", "-",
      ], options(2_000, input));
      return stdout;
    };
    // A detach can unmount APFS before ejection fails. Its mountpoint then loses device identity.
    // Apple's disk-image fixture also retains dev-entry from attach metadata for cleanup:
    // https://github.com/apple-oss-distributions/hfs/blob/d1bac2f062e6e9c0dfcce302d9aacb10173d0eea/tests/disk-image.m#L393-L462
    const rootDevice = async (input: string, key: string): Promise<string> =>
      imageDevice(JSON.parse(await extract(input, key, "json", "array")) as unknown);
    let ownedDevice = fixture.attachmentPlist === undefined ? undefined : await rootDevice(fixture.attachmentPlist, "system-entities");
    const inspectImage = async (): Promise<string | undefined> => {
      const { stdout } = await dependencies.execute("/usr/bin/hdiutil", ["info", "-plist"], options(2_000));
      // Extract only identity fields: the inventory also contains binary image aliases.
      const count = await extract(stdout, "images", "raw", "array");
      if (!/^(0|[1-9]\d*)$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error("Invalid disk image inventory count");
      let device: string | undefined;
      for (let index = 0; index < Number(count); index += 1) {
        const imagePath = await extract(stdout, `images.${index}.image-path`, "raw", "string");
        if (imagePath !== fixture.imageFile) continue;
        if (device !== undefined) throw new Error("Fixture image appears more than once in the disk image inventory");
        device = await rootDevice(stdout, `images.${index}.system-entities`);
      }
      if (device !== undefined && ownedDevice !== undefined && device !== ownedDevice) {
        throw new Error(`Fixture image device changed from ${ownedDevice} to ${device}`);
      }
      if (ownedDevice === undefined) ownedDevice = device;
      report({ kind: "image", imageFile: fixture.imageFile, attached: device !== undefined, device });
      return device;
    };

    let device = await inspectImage();
    let detached = device === undefined;
    for (let attempt = 0; !detached && attempt < 3 && remaining() > 0; attempt += 1) {
      let busy = false;
      try {
        await dependencies.execute("/usr/bin/hdiutil", ["detach", device!], options(30_000));
      } catch (error) {
        const failure = failureRecord(error);
        busy = typeof failure.stderr === "string" && failure.stderr.includes("Resource busy");
        if (!busy && failures.length === 0) throw error;
        failures.push(error);
        if (!busy) break;
        report({ kind: "busy", command: "/usr/bin/hdiutil", args: ["detach", device!], failure });
        if (attempt === 0) {
          const diagnostics = [
            { command: "/usr/sbin/lsof", args: ["-nP", "-Fpcfnt", "+f", "--", fixture.mountDirectory] },
            { command: "/usr/sbin/diskutil", args: ["info", "-plist", device!] },
          ];
          for (const diagnostic of diagnostics) {
            try {
              const result = await dependencies.execute(diagnostic.command, diagnostic.args, options(2_000));
              report({ kind: "diagnostic", ...diagnostic, result });
            } catch (diagnosticError) {
              failures.push(diagnosticError);
              report({ kind: "diagnostic", ...diagnostic, failure: failureRecord(diagnosticError) });
            }
          }
        }
      }
      if (busy && attempt < 2 && remaining() > 0) {
        await dependencies.delay(Math.min(1_000, remaining()));
      }
      try {
        device = await inspectImage();
      } catch (inspectionError) {
        failures.push(inspectionError);
        break;
      }
      detached = device === undefined;
      if (!detached && !busy) {
        failures.push(new Error("Fixture image is still attached after hdiutil reported successful detach"));
        break;
      }
    }
    if (!detached) {
      throw new AggregateError(failures, `APFS fixture image cleanup was not confirmed: ${JSON.stringify(records)}`, { cause: failures[0] });
    }
  }
  if (fixture.directory !== undefined) await dependencies.remove(fixture.directory);
};
