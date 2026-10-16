import path from "node:path";

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

const comparablePath = (value: string, pathApi: PathApi): string =>
  pathApi.sep === "\\" ? value.toLowerCase() : value;

export const pathsEqual = (
  first: string,
  second: string,
  pathApi: PathApi = path,
): boolean =>
  comparablePath(pathApi.resolve(first), pathApi) ===
  comparablePath(pathApi.resolve(second), pathApi);

const containsPath = (
  parent: string,
  child: string,
  pathApi: PathApi,
): boolean => {
  const relative = pathApi.relative(
    comparablePath(pathApi.resolve(parent), pathApi),
    comparablePath(pathApi.resolve(child), pathApi),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
};

export const pathsOverlap = (
  first: string,
  second: string,
  pathApi: PathApi = path,
): boolean =>
  containsPath(first, second, pathApi) || containsPath(second, first, pathApi);
