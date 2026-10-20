import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { ConfigurationPaths } from "./paths.js";
import { replaceFileAtomically } from "../platform/files.js";

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

export const readConfigurationSource = async (paths: ConfigurationPaths): Promise<string> => {
  try {
    return await readFile(paths.configFile, "utf8");
  } catch (cause) {
    throw new Error(`Cannot read configuration file ${paths.configFile}.`, { cause });
  }
};

export type ConfigurationUpdate<Result> = { result: Result; source?: string };

export const updateConfigurationFile = async <Result>(
  paths: ConfigurationPaths,
  update: (source: string | undefined) => Promise<ConfigurationUpdate<Result>>,
): Promise<Result> => {
  await mkdir(path.dirname(paths.configFile), { recursive: true });
  const lockFile = `${paths.configFile}.lock`;
  let lock;
  try {
    lock = await open(lockFile, "wx", 0o600);
  } catch (cause) {
    throw new Error(hasCode(cause, "EEXIST")
      ? `Configuration is locked by another writer at ${lockFile}; retry when that writer exits. Remove the lock only after confirming no writer is running.`
      : `Cannot acquire configuration lock ${lockFile}.`, { cause });
  }
  let failure: unknown;
  try {
    let existingEntry;
    try {
      existingEntry = await lstat(paths.configFile);
    } catch (cause) {
      if (!hasCode(cause, "ENOENT")) {
        throw new Error(`Cannot inspect configuration file ${paths.configFile}.`, { cause });
      }
    }
    if (existingEntry !== undefined && !existingEntry.isFile()) {
      throw new Error(`Configuration file ${paths.configFile} must be a regular file; symbolic-link writes are not supported.`);
    }
    const source = existingEntry === undefined ? undefined : await readConfigurationSource(paths);
    const updated = await update(source);
    if (updated.source !== undefined) {
      await replaceFileAtomically(paths.configFile, updated.source, existingEntry?.mode);
    }
    return updated.result;
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    const cleanup: unknown[] = [];
    try { await lock.close(); } catch (cause) { cleanup.push(cause); }
    try { await unlink(lockFile); } catch (cause) { cleanup.push(cause); }
    if (cleanup.length !== 0) {
      throw new AggregateError(failure === undefined ? cleanup : [failure, ...cleanup], "Configuration update or lock cleanup failed.");
    }
  }
};
