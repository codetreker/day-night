import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { pathsEqual, pathsOverlap } from "./paths.js";
import type { PathApi, RuntimePaths } from "./paths.js";

export type RepositoryConfiguration = {
  coordinate: string;
  host: string;
  owner: string;
  name: string;
  remote: string;
  path: string;
};

export type Configuration = {
  pollIntervalMs: number;
  maxConcurrentWorker: number;
  agentTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  repositories: RepositoryConfiguration[];
};

export const configurationDefaults = {
  pollIntervalMs: 60_000,
  maxConcurrentWorker: 1,
  agentTimeoutMs: 1_800_000,
  maxAttempts: 3,
  retryDelayMs: 30_000,
} as const;

const asMapping = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a mapping.`);
  }
  return value as Record<string, unknown>;
};

const validateKeys = (
  value: Record<string, unknown>,
  accepted: readonly string[],
  field: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!accepted.includes(key)) {
      throw new Error(`${field} contains unsupported field ${JSON.stringify(key)}.`);
    }
  }
};

const nonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new Error(`${field} must be a nonempty string without NUL characters.`);
  }
  return value;
};

const positiveInteger = (
  mapping: Record<string, unknown>,
  field: keyof typeof configurationDefaults,
): number => {
  if (!Object.hasOwn(mapping, field)) {
    return configurationDefaults[field];
  }
  const value = mapping[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  if (field.endsWith("Ms") && value > 2_147_483_647) {
    throw new Error(`${field} must not exceed the supported timer limit of 2147483647 milliseconds.`);
  }
  return value;
};

const remoteIdentity = (
  remote: string,
  field: string,
): Pick<RepositoryConfiguration, "coordinate" | "host" | "owner" | "name"> => {
  const invalidRemote = (): Error =>
    new Error(
      `${field} must be an HTTPS or SSH GitHub repository address with an owner and repository name; HTTPS credentials, query strings, and fragments are not allowed.`,
    );
  let host: string;
  let coordinate: string;
  const scp = /^git@([^\s/:]+):([^\s]+)$/.exec(remote);
  if (scp !== null) {
    host = scp[1]!;
    coordinate = scp[2]!;
    try {
      const parsedHost = new URL(`ssh://git@${host}`);
      if (parsedHost.hostname.toLowerCase() !== host.toLowerCase() || parsedHost.port !== "") {
        throw invalidRemote();
      }
    } catch (cause) {
      throw new Error(`${field} has an invalid SSH host.`, { cause });
    }
  } else {
    if (!/^(?:https|ssh):\/\//i.test(remote)) {
      throw invalidRemote();
    }
    let url: URL;
    try {
      url = new URL(remote);
    } catch (cause) {
      throw new Error(`${field} is not a supported GitHub repository address.`, { cause });
    }
    if (
      !["https:", "ssh:"].includes(url.protocol) ||
      url.search !== "" ||
      url.hash !== "" ||
      url.password !== "" ||
      (url.protocol === "https:" && url.username !== "") ||
      (url.protocol === "ssh:" && url.username !== "git") ||
      /\s/.test(remote)
    ) {
      throw invalidRemote();
    }
    host = url.protocol === "https:" ? url.host : url.hostname;
    coordinate = url.pathname.slice(1);
    if (!remote.endsWith(url.pathname)) {
      throw invalidRemote();
    }
  }
  try {
    const normalizedHost = new URL(`https://${host}`);
    if (normalizedHost.hostname === "" || normalizedHost.pathname !== "/" || normalizedHost.search !== "" || normalizedHost.hash !== "" || normalizedHost.username !== "" || normalizedHost.password !== "") {
      throw invalidRemote();
    }
    host = normalizedHost.hostname.replace(/\.$/, "") +
      (normalizedHost.port === "" ? "" : `:${normalizedHost.port}`);
  } catch (cause) {
    throw new Error(`${field} has an invalid repository host.`, { cause });
  }
  coordinate = coordinate.replace(/\/$/, "").replace(/\.git$/, "");
  const match = /^([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/([a-z\d_.-]+)$/i.exec(coordinate);
  if (match === null || host === "" || match[2] === "." || match[2] === "..") {
    throw invalidRemote();
  }
  const owner = match[1]!.toLowerCase();
  const name = match[2]!.toLowerCase();
  host = host.toLowerCase();
  return { coordinate: `${host}/${owner}/${name}`, host, owner, name };
};

const validateRepositoryPaths = (
  repositories: readonly RepositoryConfiguration[],
  repositoryPaths: readonly string[],
  stateDirectory: string,
  pathApi: PathApi,
): void => {
  for (const [index, repositoryPath] of repositoryPaths.entries()) {
    if (pathsOverlap(repositoryPath, stateDirectory, pathApi)) {
      throw new Error(
        `repositories[${index}].path must not overlap the state directory ${stateDirectory}.`,
      );
    }
    const duplicate = repositoryPaths
      .slice(0, index)
      .findIndex((previous) => pathsEqual(previous, repositoryPath, pathApi));
    if (duplicate !== -1) {
      throw new Error(
        `repositories[${index}].path resolves to the same location as repositories[${duplicate}].path (${repositories[duplicate]!.coordinate}).`,
      );
    }
  }
};

export const parseConfiguration = (
  source: string,
  runtimePaths: RuntimePaths,
  pathApi: PathApi = path,
): Configuration => {
  const document = parseDocument(source, {
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    prettyErrors: false,
  });
  const problems = [...document.errors, ...document.warnings];
  if (problems.length !== 0) {
    throw new Error(`Invalid YAML in ${runtimePaths.configFile}.`, {
      cause: new AggregateError(problems, "YAML configuration was rejected."),
    });
  }
  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch (cause) {
    throw new Error(`Cannot decode YAML in ${runtimePaths.configFile}.`, { cause });
  }
  const mapping = asMapping(parsed, "Configuration");
  validateKeys(mapping, [...Object.keys(configurationDefaults), "repositories"], "Configuration");
  if (!Array.isArray(mapping.repositories) || mapping.repositories.length === 0) {
    throw new Error("repositories must be a nonempty sequence.");
  }
  const identities = new Set<string>();
  const repositories = mapping.repositories.map((value: unknown, index: number) => {
    const field = `repositories[${index}]`;
    const repository = asMapping(value, field);
    validateKeys(repository, ["remote", "path"], field);
    const remote = nonEmptyString(repository.remote, `${field}.remote`);
    const identity = remoteIdentity(remote, `${field}.remote`);
    if (identities.has(identity.coordinate)) {
      throw new Error(`${field}.remote duplicates repository ${identity.coordinate}.`);
    }
    identities.add(identity.coordinate);
    const configuredPath = nonEmptyString(repository.path, `${field}.path`);
    if (configuredPath.startsWith("~")) {
      throw new Error(`${field}.path must use an absolute path or a config-directory-relative path; tilde expansion is not supported.`);
    }
    if (pathApi.sep === "\\" && /^[a-z]:(?![\\/])/i.test(configuredPath)) {
      throw new Error(`${field}.path must not use a drive-relative Windows path.`);
    }
    return {
      ...identity,
      remote,
      path: pathApi.resolve(pathApi.dirname(runtimePaths.configFile), configuredPath),
    };
  });
  validateRepositoryPaths(repositories, repositories.map((repository) => repository.path), runtimePaths.stateDirectory, pathApi);
  return {
    pollIntervalMs: positiveInteger(mapping, "pollIntervalMs"),
    maxConcurrentWorker: positiveInteger(mapping, "maxConcurrentWorker"),
    agentTimeoutMs: positiveInteger(mapping, "agentTimeoutMs"),
    maxAttempts: positiveInteger(mapping, "maxAttempts"),
    retryDelayMs: positiveInteger(mapping, "retryDelayMs"),
    repositories,
  };
};

const canonicalPath = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
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
    return path.join(await canonicalPath(parent), path.basename(target));
  }
};

export const loadConfiguration = async (
  runtimePaths: RuntimePaths,
): Promise<Configuration> => {
  let source: string;
  try {
    source = await readFile(runtimePaths.configFile, "utf8");
  } catch (cause) {
    throw new Error(`Cannot read configuration file ${runtimePaths.configFile}.`, { cause });
  }
  const configuration = parseConfiguration(source, runtimePaths);
  const [stateDirectory, ...repositoryPaths] = await Promise.all([
    canonicalPath(runtimePaths.stateDirectory),
    ...configuration.repositories.map((repository) => canonicalPath(repository.path)),
  ]);
  validateRepositoryPaths(configuration.repositories, repositoryPaths, stateDirectory!, path);
  return configuration;
};
