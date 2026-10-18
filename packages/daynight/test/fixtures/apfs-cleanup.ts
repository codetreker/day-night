import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

type CommandResult = { stdout: string; stderr: string };
type CommandOptions = { timeout: number; env: NodeJS.ProcessEnv; encoding: "utf8"; maxBuffer: number };
type CommandFailure = Error & { code?: unknown; stdout?: unknown; stderr?: unknown };

export type CleanupRecord = {
  kind: "busy" | "diagnostic";
  command: string;
  args: readonly string[];
  result?: CommandResult;
  failure?: { message: string; code: unknown; stdout: unknown; stderr: unknown };
};

export type ApfsCleanupDependencies = {
  execute: (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
  report: (record: CleanupRecord) => void;
  remove: (directory: string) => Promise<void>;
};

const executeFile = promisify(execFile);
const defaults: ApfsCleanupDependencies = {
  execute: (command, args, options) => executeFile(command, [...args], options),
  now: () => performance.now(),
  delay: async (milliseconds) => { await setTimeout(milliseconds); },
  report: (record) => { process.stderr.write(`APFS fixture cleanup: ${JSON.stringify(record)}\n`); },
  remove: (directory) => rm(directory, { recursive: true, force: true }),
};

const failureRecord = (error: unknown): NonNullable<CleanupRecord["failure"]> => {
  const failure = error as CommandFailure;
  return {
    message: error instanceof Error ? error.message : String(error),
    code: failure?.code,
    stdout: failure?.stdout,
    stderr: failure?.stderr,
  };
};

export const cleanupApfsFixture = async (
  fixture: { directory: string | undefined; mountDirectory: string; attachmentAttempted: boolean },
  dependencies: ApfsCleanupDependencies = defaults,
): Promise<void> => {
  if (fixture.attachmentAttempted) {
    const deadline = dependencies.now() + 30_000;
    const failures: unknown[] = [];
    const records: CleanupRecord[] = [];
    const remaining = (): number => Math.max(0, Math.floor(deadline - dependencies.now()));
    const options = (limit: number): CommandOptions => {
      const timeout = Math.min(limit, remaining());
      if (timeout === 0) throw new Error("APFS cleanup deadline reached before command execution");
      return { timeout, env: { ...process.env, LC_ALL: "C" }, encoding: "utf8", maxBuffer: 64 * 1024 };
    };
    const report = (record: CleanupRecord): void => {
      records.push(record);
      dependencies.report(record);
    };
    const detach = ["detach", fixture.mountDirectory];
    let detached = false;
    for (let attempt = 0; attempt < 3 && remaining() > 0; attempt += 1) {
      try {
        await dependencies.execute("/usr/bin/hdiutil", detach, options(30_000));
        detached = true;
        break;
      } catch (error) {
        const failure = failureRecord(error);
        const busy = typeof failure.stderr === "string" && failure.stderr.includes("Resource busy");
        if (!busy && failures.length === 0) throw error;
        failures.push(error);
        if (!busy) break;
        report({ kind: "busy", command: "/usr/bin/hdiutil", args: detach, failure });
        if (attempt === 0) {
          // +f selects the exact mounted filesystem, rather than recursively opening its files.
          // https://github.com/apple-oss-distributions/lsof/blob/7a8a1b2a3c0f35c30a5fcd0927f31d441c3e5255/lsof/lsof.8#L722-L760
          const diagnostics = [
            { command: "/usr/sbin/lsof", args: ["-nP", "-Fpcfnt", "+f", "--", fixture.mountDirectory] },
            { command: "/usr/sbin/diskutil", args: ["info", "-plist", fixture.mountDirectory] },
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
        if (attempt < 2 && remaining() > 0) {
          await dependencies.delay(Math.min(1_000, remaining()));
        }
      }
    }
    if (!detached) {
      throw new AggregateError(failures, `APFS fixture remains mounted: ${JSON.stringify(records)}`, { cause: failures[0] });
    }
  }
  if (fixture.directory !== undefined) await dependencies.remove(fixture.directory);
};
