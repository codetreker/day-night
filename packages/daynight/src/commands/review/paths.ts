import path from "node:path";
import type { PathApi } from "../../platform/filesystem.js";

export type ReviewPaths = {
  stateDirectory: string;
  configFile: string;
  databaseFile: string;
  lockFile: string;
  copilotDirectory: string;
  cacheDirectory: string;
  temporaryDirectory: string;
  logsDirectory: string;
};

export const resolveReviewPaths = (
  homeDirectory: string,
  pathApi: PathApi = path,
): ReviewPaths => {
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
