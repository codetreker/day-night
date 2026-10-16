import path from "node:path";
import { lstat, mkdtemp, rmdir } from "node:fs/promises";

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

type CaseProbeOperations = {
  mkdtemp: (prefix: string) => Promise<string>;
  lstat: (target: string) => Promise<{ dev: bigint; ino: bigint }>;
  rmdir: (target: string) => Promise<void>;
};

const caseProbeOperations: CaseProbeOperations = {
  mkdtemp,
  lstat: (target) => lstat(target, { bigint: true }),
  rmdir,
};

export const isFilesystemCaseSensitive = async (
  directory: string,
  operations: CaseProbeOperations = caseProbeOperations,
): Promise<boolean> => {
  let probe: string;
  try {
    probe = await operations.mkdtemp(path.join(directory, ".daynight-case-"));
  } catch (cause) {
    throw new Error(`Cannot create a temporary filesystem case probe in ${directory}.`, { cause });
  }
  let caseSensitive = false;
  let failure: Error | undefined;
  try {
    const original = await operations.lstat(probe);
    const alternate = path.join(
      path.dirname(probe),
      path.basename(probe).replace(".daynight-case-", ".DAYNIGHT-CASE-"),
    );
    try {
      const alternateEntry = await operations.lstat(alternate);
      caseSensitive = original.dev !== alternateEntry.dev || original.ino !== alternateEntry.ino;
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") {
        throw cause;
      }
      caseSensitive = true;
    }
  } catch (cause) {
    failure = new Error(`Cannot determine filesystem case sensitivity in ${directory}.`, { cause });
  }
  try {
    await operations.rmdir(probe);
  } catch (cause) {
    const cleanupFailure = new Error(`Cannot remove temporary filesystem case probe ${probe}.`, { cause });
    if (failure !== undefined) {
      throw new AggregateError([failure, cleanupFailure], "Filesystem case probing and probe cleanup both failed.");
    }
    throw cleanupFailure;
  }
  if (failure !== undefined) {
    throw failure;
  }
  return caseSensitive;
};
