import os from "node:os";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import crossSpawn from "cross-spawn";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
const spawnRequire = createRequire(require.resolve("cross-spawn"));
type CommandOptions = SpawnSyncOptionsWithStringEncoding & { cwd: string; env: NodeJS.ProcessEnv };
// Reuse the pinned launcher's PATH/PATHEXT and shim rules so the recorded tool matches its launch.
const resolveCommand = spawnRequire("./lib/util/resolveCommand.js") as (command: { command: string; options: CommandOptions }) => string | undefined;
const parseCommand = spawnRequire("./lib/parse.js") as (file: string, args: string[], options: CommandOptions) => { command: string };
const timeoutMs = 10_000;
const maxBuffer = 1_048_576;
const diagnosticOutputLimit = 16_384;
type ProbeError = { name: string; message: string; code?: string | number; syscall?: string };
type Probe = {
  file: string; args: string[]; startedAt: string; state: "resolving" | "running" | "completed" | "failed";
  resolvedExecutable: string | null; launcher: string | null; elapsedMs: number | null;
  timeoutMs: number; maxBuffer: number; exitCode: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean; error: ProbeError | null;
};
const serializeError = (error: unknown): ProbeError => {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  return { name: error.name, message: error.message,
    ...("code" in error && (typeof error.code === "string" || typeof error.code === "number") ? { code: error.code } : {}),
    ...("syscall" in error && typeof error.syscall === "string" ? { syscall: error.syscall } : {}),
  };
};

export const createValidationProbeRecorder = (options: {
  directory: string;
  environment: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  execute?: (file: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;
}) => {
  const directory = path.resolve(options.directory);
  const log = options.log === undefined ? (message: string): void => { process.stdout.write(message); } : options.log;
  const execute = options.execute === undefined ? crossSpawn.sync : options.execute;
  const probes: Probe[] = [];
  const diagnostics: { capturedAt: string; platform: string; architecture: string; probes: Probe[]; error: ProbeError | null } = {
    capturedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, probes, error: null,
  };
  mkdirSync(directory, { recursive: true });
  const persist = (): void => { writeFileSync(path.join(directory, "validation-probes.json"), `${JSON.stringify(diagnostics, null, 2)}\n`); };
  persist();
  const command = (file: string, args: readonly string[], version: boolean): string => {
    const started = performance.now();
    const probe: Probe = { file, args: [...args], startedAt: new Date().toISOString(), state: "resolving",
      resolvedExecutable: null, launcher: null, elapsedMs: null, timeoutMs, maxBuffer,
      exitCode: null, signal: null, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, error: null };
    probes.push(probe);
    const record = (): void => { persist(); log(`Validation probe: ${JSON.stringify(probe)}\n`); };
    record();
    try {
      const environment = file === "gh" ? {
        ...options.environment,
        GH_CONFIG_DIR: path.join(directory, "gh", "config"),
        XDG_STATE_HOME: path.join(directory, "gh", "state"),
        XDG_DATA_HOME: path.join(directory, "gh", "data"),
        GH_TELEMETRY: "0",
      } : { ...options.environment };
      const executionOptions: CommandOptions = {
        cwd: process.cwd(), env: environment, encoding: "utf8", shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer,
      };
      probe.resolvedExecutable = resolveCommand({ command: file, options: executionOptions }) ?? null;
      const parsed = parseCommand(file, [...args], executionOptions);
      probe.launcher = resolveCommand({ command: parsed.command, options: executionOptions }) ?? null;
      probe.state = "running";
      record();
      const result = execute(file, [...args], executionOptions);
      const stdout = typeof result.stdout === "string" ? result.stdout : "";
      const stderr = typeof result.stderr === "string" ? result.stderr : "";
      probe.exitCode = result.status;
      probe.signal = result.signal;
      probe.stdout = stdout.slice(0, diagnosticOutputLimit);
      probe.stderr = stderr.slice(0, diagnosticOutputLimit);
      probe.stdoutTruncated = stdout.length > diagnosticOutputLimit;
      probe.stderrTruncated = stderr.length > diagnosticOutputLimit;
      if (result.error !== undefined && result.error !== null) throw result.error;
      if (result.status !== 0 || result.signal !== null) {
        throw new Error(`Cannot record ${file} ${args.join(" ")}: exit=${result.status}, signal=${result.signal}.`);
      }
      const output = stdout.trim();
      if (version && output === "") throw new Error(`The ${file} version command returned no output.`);
      probe.state = "completed";
      probe.elapsedMs = performance.now() - started;
      record();
      return version ? output.split(/\r?\n/)[0]! : output;
    } catch (error) {
      probe.state = "failed";
      probe.elapsedMs = performance.now() - started;
      probe.error = serializeError(error);
      diagnostics.error = probe.error;
      record();
      throw error;
    }
  };
  return {
    command: (file: string, args: readonly string[]): string => command(file, args, false),
    version: (file: string): string => command(file, ["--version"], true),
    fail: (error: unknown): void => { diagnostics.error = serializeError(error); persist(); },
  };
};

export const recordValidationEnvironment = async (directory: string, environment: NodeJS.ProcessEnv): Promise<void> => {
  const probes = createValidationProbeRecorder({ directory, environment });
  try {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string; dependencies: Record<string, string>;
    };
    const database = new Database(":memory:");
    let sqliteVersion: string;
    try { sqliteVersion = (database.prepare("SELECT sqlite_version() AS version").get() as { version: string }).version; }
    finally { database.close(); }
    const { header } = process.report.getReport() as { header: { glibcVersionRuntime?: string } };
    const evidence = {
      capturedAt: new Date().toISOString(),
      sourceRevision: probes.command("git", ["rev-parse", "HEAD"]),
      sourceDirty: probes.command("git", ["status", "--porcelain"]) !== "",
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      osVersion: os.version(),
      glibcVersionRuntime: header.glibcVersionRuntime,
      versions: { node: process.version, nodeAbi: process.versions.modules, nodeApi: process.versions.napi,
        pnpm: probes.version("pnpm"), git: probes.version("git"), gh: probes.version("gh") },
      packageVersion: manifest.version,
      sqlite: { packageVersion: manifest.dependencies["better-sqlite3"], engineVersion: sqliteVersion },
      liveCopilotExercised: false,
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(path.join(directory, "validation-environment.json"), serialized);
    process.stdout.write(serialized);
  } catch (error) { probes.fail(error); throw error; }
};

if (import.meta.main) await recordValidationEnvironment(path.resolve(".tmp"), process.env);
