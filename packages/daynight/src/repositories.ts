import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Document } from "yaml";
import { defaultRepositoryRoot, parseConfigurationDocument, remoteIdentity, resolveRepositoryRoot, validateConfigurationSource } from "./config.js";
import type { RepositoryConfiguration } from "./config.js";
import { missingPathsReferToSameDirectory, resolvePhysicalDirectory } from "./paths.js";
import type { RuntimePaths } from "./paths.js";

export type AddRepositoryInput = { remote: string; path?: string };
export type AddRepositoryOptions = { workingDirectory: string; homeDirectory: string };
export type AddRepositoryResult = { repository: RepositoryConfiguration; added: boolean };

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const repositoryPathComponent = (component: string): string => {
  let escaped = component.replace(/[<>:"/\\|?*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\.+$/, (dots) => "%2E".repeat(dots.length));
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(escaped)) {
    escaped = `%${escaped.charCodeAt(0).toString(16).toUpperCase()}${escaped.slice(1)}`;
  }
  return escaped;
};

const sameDirectory = async (first: string, second: string): Promise<boolean> => {
  const [left, right] = await Promise.all([resolvePhysicalDirectory(first), resolvePhysicalDirectory(second)]);
  if (left.ancestorIdentity !== right.ancestorIdentity || left.missingComponents.length !== right.missingComponents.length) {
    return false;
  }
  return left.missingComponents.every((component, index) => component === right.missingComponents[index]) ||
    missingPathsReferToSameDirectory(left.ancestorPath, left.missingComponents, right.missingComponents);
};

const updateConfiguration = async (
  input: AddRepositoryInput,
  runtimePaths: RuntimePaths,
  options: AddRepositoryOptions,
): Promise<AddRepositoryResult> => {
  let existingEntry;
  try {
    existingEntry = await lstat(runtimePaths.configFile);
  } catch (cause) {
    if (!hasCode(cause, "ENOENT")) {
      throw new Error(`Cannot inspect configuration file ${runtimePaths.configFile}.`, { cause });
    }
  }
  if (existingEntry !== undefined && !existingEntry.isFile()) {
    throw new Error(`Configuration file ${runtimePaths.configFile} must be a regular file; symbolic-link writes are not supported.`);
  }
  const source = existingEntry === undefined ? undefined : await readFile(runtimePaths.configFile, "utf8");
  const existing = source === undefined ? undefined : await validateConfigurationSource(source, runtimePaths);
  const document = source === undefined ? new Document({ repositoryRoot: defaultRepositoryRoot, repositories: [] }) : parseConfigurationDocument(source, runtimePaths);
  const decoded = document.toJS() as Record<string, unknown>;
  const root = document.has("repositoryRoot") ? decoded.repositoryRoot : defaultRepositoryRoot;
  const identity = remoteIdentity(input.remote, "remote");
  const previous = existing?.repositories.find((repository) => repository.coordinate === identity.coordinate);
  if (previous !== undefined && input.path === undefined) {
    return { repository: previous, added: false };
  }
  let repositoryPath: string;
  if (input.path === undefined) {
    repositoryPath = path.join(resolveRepositoryRoot(root, runtimePaths, options.homeDirectory), ...[identity.host, identity.owner, identity.name].map(repositoryPathComponent));
  } else {
    if (input.path.trim() === "" || input.path.includes("\0") || input.path.startsWith("~")) {
      throw new Error("path must be a nonempty absolute path or working-directory-relative path without NUL characters; expand ~ before passing --path.");
    }
    if (path.sep === "\\" && /^[a-z]:(?![\\/])/i.test(input.path)) {
      throw new Error("path must not use a drive-relative Windows path.");
    }
    repositoryPath = path.resolve(options.workingDirectory, input.path);
  }
  if (previous !== undefined) {
    if (await sameDirectory(previous.path, repositoryPath)) {
      return { repository: previous, added: false };
    }
    throw new Error(`Repository ${identity.coordinate} is already configured at ${previous.path}; the requested path ${repositoryPath} differs.`);
  }
  if (!document.has("repositoryRoot")) {
    document.set("repositoryRoot", defaultRepositoryRoot);
  }
  document.addIn(["repositories"], { remote: input.remote, path: repositoryPath });
  const updatedSource = document.toString();
  const configuration = await validateConfigurationSource(updatedSource, runtimePaths);
  const repository = configuration.repositories.at(-1)!;
  const temporaryFile = path.join(path.dirname(runtimePaths.configFile), `.config-${randomUUID()}.tmp`);
  const handle = await open(temporaryFile, "wx", 0o600);
  let failure: unknown;
  let renamed = false;
  let closed = false;
  try {
    await handle.writeFile(updatedSource, "utf8");
    if (existingEntry !== undefined) {
      await handle.chmod(existingEntry.mode & 0o777);
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryFile, runtimePaths.configFile);
    renamed = true;
    return { repository, added: true };
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

export const addRepository = async (
  input: AddRepositoryInput,
  runtimePaths: RuntimePaths,
  options: AddRepositoryOptions,
): Promise<AddRepositoryResult> => {
  if (!path.isAbsolute(options.workingDirectory) || !path.isAbsolute(options.homeDirectory)) {
    throw new Error("The working directory and home directory must be absolute paths.");
  }
  await mkdir(path.dirname(runtimePaths.configFile), { recursive: true });
  const lockFile = `${runtimePaths.configFile}.lock`;
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
    return await updateConfiguration(input, runtimePaths, options);
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
