import path from "node:path";
import { lstat, mkdir, mkdtemp, rmdir } from "node:fs/promises";

export type PathApi = Pick<
  typeof path,
  "resolve" | "join" | "dirname" | "relative" | "isAbsolute" | "normalize" | "sep"
>;

export type RuntimePaths = {
  stateDirectory: string;
  configFile: string;
  databaseFile: string;
  lockFile: string;
  copilotDirectory: string;
  cacheDirectory: string;
  temporaryDirectory: string;
  logsDirectory: string;
};

export const resolveRuntimePaths = (
  homeDirectory: string,
  pathApi: PathApi = path,
): RuntimePaths => {
  if (!pathApi.isAbsolute(homeDirectory)) {
    throw new Error("The current user's home directory must be an absolute path.");
  }
  const stateDirectory = pathApi.resolve(homeDirectory, ".daynight");
  return {
    stateDirectory,
    configFile: pathApi.join(stateDirectory, "config.yml"),
    databaseFile: pathApi.join(stateDirectory, "state.sqlite"),
    lockFile: pathApi.join(stateDirectory, "instance.lock"),
    copilotDirectory: pathApi.join(stateDirectory, "copilot"),
    cacheDirectory: pathApi.join(stateDirectory, "cache"),
    temporaryDirectory: pathApi.join(stateDirectory, "tmp"),
    logsDirectory: pathApi.join(stateDirectory, "logs"),
  };
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
