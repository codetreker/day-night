import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { ConfigurationPaths } from "./paths.js";

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

export const readConfigurationSource = async (paths: ConfigurationPaths): Promise<string> => {
  try {
    return await readFile(paths.configFile, "utf8");
  } catch (cause) {
    throw new Error(`Cannot read configuration file ${paths.configFile}.`, { cause });
  }
};

const replaceConfiguration = async (
  paths: ConfigurationPaths,
  source: string,
  mode: number | undefined,
): Promise<void> => {
  const temporaryFile = path.join(path.dirname(paths.configFile), `.config-${randomUUID()}.tmp`);
  const handle = await open(temporaryFile, "wx", 0o600);
  let failure: unknown;
  let renamed = false;
  let closed = false;
  try {
    await handle.writeFile(source, "utf8");
    if (mode !== undefined) {
      await handle.chmod(mode & 0o777);
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryFile, paths.configFile);
    renamed = true;
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    const cleanup: unknown[] = [];
    if (!closed) {
      try { await handle.close(); } catch (cause) { cleanup.push(cause); }
    }
    if (!renamed) {
      try { await unlink(temporaryFile); } catch (cause) { cleanup.push(cause); }
    }
    if (cleanup.length !== 0) {
      throw new AggregateError(failure === undefined ? cleanup : [failure, ...cleanup], "Configuration write or temporary-file cleanup failed.");
    }
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
      await replaceConfiguration(paths, updated.source, existingEntry?.mode);
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
