import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

type CommandResult = { stdout: string; stderr: string };
type CommandOptions = { timeout: number; env: NodeJS.ProcessEnv; encoding: "utf8"; maxBuffer: number; input?: string };
type CommandFailure = Error & { code?: unknown; stdout?: unknown; stderr?: unknown };
type Dictionary = Record<string, unknown>;
export type ImageEntity = { device: string; mountPoint?: string };
export type VerifiedApfsImage = { imageFile: string; rootDevice: string; inventoryVisibilityVerified: true };
export type ImageObservation =
  | { state: "mounted" | "unmounted_attached"; entities: ImageEntity[] }
  | { state: "absent" };
export type ApfsFixture = {
  directory: string | undefined;
  mountDirectory: string;
  imageFile: string;
  attachmentAttempted: boolean;
  attachmentPlist: string | undefined;
  ownership?: VerifiedApfsImage;
  volumeHolderPid?: number;
};
export type CleanupRecord = {
  kind: "busy" | "diagnostic";
  command: string;
  args: readonly string[];
  result?: CommandResult;
  failure?: { message: string; code: unknown; stdout: unknown; stderr: unknown };
} | { kind: "image"; imageFile: string; state: ImageObservation["state"]; rootDevice: string; entities?: ImageEntity[] };
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
export const realApfsCleanupDependencies: ApfsCleanupDependencies = {
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
const deviceName = (value: unknown): string => {
  if (typeof value !== "string" || !/^\/dev\/disk\d+(?:s\d+)*$/.test(value)) throw new Error("Invalid disk image dev-entry");
  return value;
};
const topology = (value: unknown): { rootDevice: string; entities: ImageEntity[] } => {
  if (!Array.isArray(value)) throw new Error("Disk image has no system-entities array");
  const entries = value.map((entity) => dictionary(entity, "disk image entity"));
  const roots = entries.filter((entity) => entity["content-hint"] === "GUID_partition_scheme");
  if (roots.length !== 1) throw new Error("Expected exactly one GPT image device");
  const rootDevice = deviceName(roots[0]!["dev-entry"]);
  const entities = entries.map((entity): ImageEntity => {
    const device = deviceName(entity["dev-entry"]);
    const mountPoint = entity["mount-point"];
    if (mountPoint !== undefined && (typeof mountPoint !== "string" || !mountPoint.startsWith("/"))) throw new Error("Invalid disk image mount-point");
    return { device, ...(mountPoint === undefined ? {} : { mountPoint }) };
  });
  if (new Set(entities.map(({ device }) => device)).size !== entities.length) throw new Error("Duplicate disk image device");
  return { rootDevice, entities };
};
const failureRecord = (error: unknown): NonNullable<Extract<CleanupRecord, { kind: "busy" | "diagnostic" }>["failure"]> => {
  const failure = error as CommandFailure;
  return { message: error instanceof Error ? error.message : String(error), code: failure?.code, stdout: failure?.stdout, stderr: failure?.stderr };
};
const context = (dependencies: ApfsCleanupDependencies, deadline: number) => {
  const remaining = (): number => Math.max(0, deadline - dependencies.now());
  const options = (limit: number, input?: string): CommandOptions => {
    const timeout = Math.floor(Math.min(limit, remaining()));
    if (timeout < 1) throw new Error("APFS cleanup deadline reached before command execution");
    return { timeout, env: { ...process.env, LC_ALL: "C" }, encoding: "utf8", maxBuffer: 64 * 1024, ...(input === undefined ? {} : { input }) };
  };
  const execute = (command: string, args: readonly string[], limit: number, input?: string): Promise<CommandResult> =>
    dependencies.execute(command, args, options(limit, input));
  const extract = async (input: string, key: string, format: "raw" | "json", type: "array" | "string"): Promise<string> =>
    (await execute("/usr/bin/plutil", ["-extract", key, format, "-expect", type, ...(format === "raw" ? ["-n"] : []), "-o", "-", "-"], 2_000, input)).stdout;
  const readTopology = async (input: string, key: string) => topology(JSON.parse(await extract(input, key, "json", "array")) as unknown);
  const inventory = async (imageFile: string): Promise<ReturnType<typeof topology> | undefined> => {
    const { stdout } = await execute("/usr/bin/hdiutil", ["info", "-plist"], 2_000);
    // Select identity fields only: unrelated inventory entries can contain binary aliases.
    const count = await extract(stdout, "images", "raw", "array");
    if (!/^(0|[1-9]\d*)$/.test(count) || !Number.isSafeInteger(Number(count))) throw new Error("Invalid disk image inventory count");
    let found: ReturnType<typeof topology> | undefined;
    for (let index = 0; index < Number(count); index += 1) {
      if (await extract(stdout, `images.${index}.image-path`, "raw", "string") !== imageFile) continue;
      if (found !== undefined) throw new Error("Fixture image appears more than once in the disk image inventory");
      found = await readTopology(stdout, `images.${index}.system-entities`);
    }
    return found;
  };
  const observe = async (ownership: VerifiedApfsImage): Promise<ImageObservation> => {
    if (ownership.inventoryVisibilityVerified !== true) throw new Error("APFS image inventory visibility is unverified");
    const current = await inventory(ownership.imageFile);
    if (current === undefined) return { state: "absent" };
    if (current.rootDevice !== ownership.rootDevice) throw new Error(`Fixture image device changed from ${ownership.rootDevice} to ${current.rootDevice}`);
    return { state: current.entities.some(({ mountPoint }) => mountPoint !== undefined) ? "mounted" : "unmounted_attached", entities: current.entities };
  };
  return { execute, readTopology, inventory, observe, remaining };
};

export const verifyApfsImageOwnership = async (
  imageFile: string, attachmentPlist: string, dependencies: ApfsCleanupDependencies = realApfsCleanupDependencies,
): Promise<VerifiedApfsImage> => {
  const commands = context(dependencies, dependencies.now() + 30_000);
  const { rootDevice } = await commands.readTopology(attachmentPlist, "system-entities");
  const ownership: VerifiedApfsImage = { imageFile, rootDevice, inventoryVisibilityVerified: true };
  if ((await commands.observe(ownership)).state === "absent") throw new Error("Attached APFS image is not visible in the exact image inventory");
  return ownership;
};

export const cleanupApfsFixture = async (fixture: ApfsFixture, dependencies: ApfsCleanupDependencies = realApfsCleanupDependencies): Promise<void> => {
  if (fixture.attachmentAttempted) {
    const deadline = dependencies.now() + 30_000;
    const commands = context(dependencies, deadline);
    const failures: unknown[] = [];
    const records: CleanupRecord[] = [];
    const report = (record: CleanupRecord): void => { records.push(record); dependencies.report(record); };
    let ownership = fixture.ownership;
    if (ownership !== undefined && ownership.imageFile !== fixture.imageFile) throw new Error("APFS fixture ownership image path changed");
    if (ownership === undefined) {
      const attachedRoot = fixture.attachmentPlist === undefined ? undefined : (await commands.readTopology(fixture.attachmentPlist, "system-entities")).rootDevice;
      const recovered = await commands.inventory(fixture.imageFile);
      if (recovered === undefined) throw new Error("Cannot recover ownership of an unverified APFS attachment from inventory absence");
      if (attachedRoot !== undefined && recovered.rootDevice !== attachedRoot) throw new Error(`Fixture image device changed from ${attachedRoot} to ${recovered.rootDevice}`);
      ownership = { imageFile: fixture.imageFile, rootDevice: recovered.rootDevice, inventoryVisibilityVerified: true };
    }
    const owned = ownership;
    let lastObservation: string | undefined;
    const observe = async (): Promise<ImageObservation> => {
      const observation = await commands.observe(owned);
      const signature = JSON.stringify(observation);
      if (signature !== lastObservation) {
        report({ kind: "image", imageFile: owned.imageFile, rootDevice: owned.rootDevice, state: observation.state, ...(observation.state === "absent" ? {} : { entities: observation.entities }) });
        lastObservation = signature;
      }
      return observation;
    };
    const diagnose = async (diagnostic: { command: string; args: string[] }): Promise<void> => {
      if (commands.remaining() < 1) return;
      try { report({ kind: "diagnostic", ...diagnostic, result: await commands.execute(diagnostic.command, diagnostic.args, 2_000) }); }
      catch (error) { failures.push(error); report({ kind: "diagnostic", ...diagnostic, failure: failureRecord(error) }); }
    };
    const diagnoseDevices = async (observation: ImageObservation): Promise<void> => {
      if (observation.state === "absent") return;
      const devices = [...new Set(observation.entities.flatMap(({ device }) => [device, device.replace("/dev/disk", "/dev/rdisk")]))];
      await diagnose({ command: "/usr/sbin/lsof", args: ["-nP", "-Fpcfnt", "--", ...devices] });
      await diagnose({ command: "/usr/sbin/diskutil", args: ["info", "-plist", owned.rootDevice] });
    };
    const observeUntil = async (target: number): Promise<ImageObservation> => {
      let observation = await observe();
      while (observation.state !== "absent") {
        const wait = Math.min(1_000, target - dependencies.now(), commands.remaining());
        if (wait <= 0) return observation;
        await dependencies.delay(wait);
        if (commands.remaining() < 1) return observation;
        observation = await observe();
      }
      return observation;
    };
    let observation = await observe();
    try {
      for (let attempt = 0; observation.state !== "absent" && attempt < 3; attempt += 1) {
        try {
          await commands.execute("/usr/bin/hdiutil", ["detach", owned.rootDevice], 30_000);
        } catch (error) {
          if (typeof (error as CommandFailure)?.stderr !== "string" || !(error as CommandFailure).stderr!.toString().includes("Resource busy")) throw error;
          failures.push(error);
          report({ kind: "busy", command: "/usr/bin/hdiutil", args: ["detach", owned.rootDevice], failure: failureRecord(error) });
          const observedAt = dependencies.now();
          const nextAttemptAt = attempt === 2 ? deadline : observedAt + Math.floor(Math.max(0, deadline - observedAt) / (3 - attempt));
          if (attempt === 0) {
            // Intersect a known owned process with the volume selection; lsof otherwise ORs selections.
            // https://github.com/apple-oss-distributions/lsof/blob/7a8a1b2a3c0f35c30a5fcd0927f31d441c3e5255/lsof/lsof.8#L169-L186
            const processSelection = fixture.volumeHolderPid === undefined ? [] : ["-a", "-p", String(fixture.volumeHolderPid)];
            await diagnose({ command: "/usr/sbin/lsof", args: ["-nP", "-Fpcfnt", ...processSelection, "+f", "--", fixture.mountDirectory] });
          }
          observation = await observe();
          if (attempt === 0) await diagnoseDevices(observation);
          if (observation.state !== "absent") observation = await observeUntil(nextAttemptAt);
          if (commands.remaining() < 1) break;
          continue;
        }
        observation = await observe();
        if (observation.state !== "absent") throw new Error("Fixture image is still attached after hdiutil reported successful detach");
      }
    } catch (error) {
      if (failures.length === 0) throw error;
      failures.push(error);
      throw new AggregateError(failures, `APFS fixture image cleanup was not confirmed: ${JSON.stringify(records)}`, { cause: failures[0] });
    }
    if (observation.state !== "absent") throw new AggregateError(failures, `APFS fixture image cleanup was not confirmed before its deadline: ${JSON.stringify(records)}`, { cause: failures[0] });
  }
  if (fixture.directory !== undefined) await dependencies.remove(fixture.directory);
};

export const createApfsFinalizer = (fixture: () => ApfsFixture): ((dependencies?: ApfsCleanupDependencies) => Promise<void>) => {
  let finalization: Promise<void> | undefined;
  return (dependencies = realApfsCleanupDependencies) => {
    if (finalization === undefined) finalization = cleanupApfsFixture(fixture(), dependencies);
    return finalization;
  };
};
