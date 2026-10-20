import path from "node:path";
import { lstat, mkdir, mkdtemp, realpath, rmdir, stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";

export type PathApi = Pick<
  typeof path,
  "resolve" | "join" | "dirname" | "relative" | "isAbsolute" | "normalize" | "sep"
>;


export type PhysicalDirectory = {
  ancestorPath: string;
  ancestorIdentity: string;
  missingComponents: string[];
};

const directoryIdentity = (entry: Pick<BigIntStats, "dev" | "ino">): string =>
  `${entry.dev}:${entry.ino}`;

export const resolvePhysicalDirectory = async (
  target: string,
  missingDescendantError?: Error,
): Promise<PhysicalDirectory> => {
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch (cause) {
    if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") {
      throw new Error(`Cannot resolve filesystem path ${target}.`, { cause });
    }
    try {
      const entry = await lstat(target);
      if (entry.isSymbolicLink()) {
        throw new Error(`Cannot resolve symbolic link ${target}.`, { cause });
      }
      throw new Error(`Filesystem path changed while resolving ${target}.`, { cause });
    } catch (inspectionError) {
      if (!(inspectionError instanceof Error) || !("code" in inspectionError) || inspectionError.code !== "ENOENT") {
        throw inspectionError;
      }
    }
    const parent = path.dirname(target);
    if (parent === target) {
      throw new Error(`Cannot find an existing ancestor of ${target}.`, { cause });
    }
    const canonicalParent = await resolvePhysicalDirectory(
      parent,
      missingDescendantError === undefined ? cause : missingDescendantError,
    );
    return {
      ...canonicalParent,
      missingComponents: [...canonicalParent.missingComponents, path.basename(target)],
    };
  }
  let entry;
  try {
    entry = await stat(resolved, { bigint: true });
  } catch (cause) {
    throw new Error(`Cannot inspect filesystem directory ${target}.`, { cause });
  }
  if (!entry.isDirectory()) {
    throw new Error(`Filesystem path ${target} is not a directory.`, {
      cause: missingDescendantError,
    });
  }
  return {
    ancestorPath: resolved,
    ancestorIdentity: directoryIdentity(entry),
    missingComponents: [],
  };
};

export const ancestorIdentities = async (directory: string): Promise<Set<string>> => {
  const identities = new Set<string>();
  let cursor = directory;
  while (true) {
    let entry;
    try {
      entry = await stat(cursor, { bigint: true });
    } catch (cause) {
      throw new Error(`Cannot inspect filesystem ancestor ${cursor}.`, { cause });
    }
    if (!entry.isDirectory()) {
      throw new Error(`Filesystem ancestor ${cursor} is not a directory.`);
    }
    identities.add(directoryIdentity(entry));
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return identities;
    }
    cursor = parent;
  }
};


export const pathsEqual = (
  first: string,
  second: string,
  pathApi: PathApi = path,
): boolean =>
  pathApi.resolve(first) === pathApi.resolve(second);

const containsPath = (
  parent: string,
  child: string,
  pathApi: PathApi,
): boolean => {
  const resolvedParent = pathApi.resolve(parent);
  const resolvedChild = pathApi.resolve(child);
  const prefix = resolvedParent.endsWith(pathApi.sep)
    ? resolvedParent
    : `${resolvedParent}${pathApi.sep}`;
  return (
    resolvedParent === resolvedChild || resolvedChild.startsWith(prefix)
  );
};

export const pathsOverlap = (
  first: string,
  second: string,
  pathApi: PathApi = path,
): boolean =>
  containsPath(first, second, pathApi) || containsPath(second, first, pathApi);

type PathProbeOperations = {
  mkdtemp: (prefix: string) => Promise<string>;
  mkdir: (target: string) => Promise<void>;
  lstat: (target: string) => Promise<{ dev: bigint; ino: bigint }>;
  rmdir: (target: string) => Promise<void>;
};

const pathProbeOperations: PathProbeOperations = {
  mkdtemp,
  mkdir,
  lstat: (target) => lstat(target, { bigint: true }),
  rmdir,
};

export const missingPathsReferToSameDirectory = async (
  directory: string,
  first: readonly string[],
  second: readonly string[],
  operations: PathProbeOperations = pathProbeOperations,
): Promise<boolean> => {
  let probe: string;
  try {
    probe = await operations.mkdtemp(path.join(directory, ".daynight-path-"));
  } catch (cause) {
    throw new Error(`Cannot create a temporary filesystem path probe in ${directory}.`, { cause });
  }
  const created = [probe];
  let sameDirectory = false;
  const failures: Error[] = [];
  try {
    let firstPath = probe;
    for (const component of first) {
      firstPath = path.join(firstPath, component);
      await operations.mkdir(firstPath);
      created.push(firstPath);
    }
    const original = await operations.lstat(firstPath);
    try {
      const alternate = await operations.lstat(path.join(probe, ...second));
      sameDirectory = original.dev === alternate.dev && original.ino === alternate.ino;
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") {
        throw cause;
      }
    }
  } catch (cause) {
    failures.push(new Error(`Cannot compare filesystem destinations in ${directory}.`, { cause }));
  }
  for (const target of created.reverse()) {
    try {
      await operations.rmdir(target);
    } catch (cause) {
      failures.push(new Error(`Cannot remove temporary filesystem path probe directory ${target}.`, { cause }));
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "Filesystem path comparison or probe cleanup failed.");
  }
  return sameDirectory;
};
