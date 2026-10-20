import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import { ApiError, canonicalId } from "../api/index.js";
import type { ApiClient, Operation, Project } from "../api/index.js";
import { normalizeServerUrl } from "../config/server.js";
import { replaceFileAtomically } from "../platform/files.js";
import { repositoryIdentity } from "./identity.js";
import { runRepositoryGit } from "./git.js";

export type ProjectApi = Pick<ApiClient, "getProject" | "listProjects">;
export type ProjectBinding = { readonly serverUrl: string; readonly repoIdentity: string; readonly projectId: string };
export type ProjectRepositoryContext = { readonly serverUrl: string; readonly repoIdentity: string };

const hasCode = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
const metadataDirectory = (root: string): string => path.join(root, ".daynight");
const bindingFile = (root: string): string => path.join(metadataDirectory(root), "project.yml");

const inspectMetadataDirectory = async (root: string, operation: Operation): Promise<boolean> => {
  operation.check();
  try {
    const entry = await lstat(metadataDirectory(root));
    operation.check();
    if (!entry.isDirectory()) throw new Error(`Repository metadata path ${metadataDirectory(root)} must be a directory; symbolic links are not supported.`);
    return true;
  } catch (cause) {
    if (hasCode(cause, "ENOENT")) return false;
    throw cause;
  }
};

const parseBinding = (source: string, filename: string): ProjectBinding => {
  try {
    const document = parseDocument(source, { strict: true, uniqueKeys: true, stringKeys: true, prettyErrors: false });
    const problems = [...document.errors, ...document.warnings];
    if (problems.length !== 0) throw new AggregateError(problems, "Repository binding YAML was rejected.");
    const mapping: unknown = document.toJS();
    if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) throw new Error("Repository binding must be a mapping.");
    const value = mapping as Record<string, unknown>;
    const fields = ["serverUrl", "repoIdentity", "projectId"];
    if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(value, key))) throw new Error("Repository binding must contain exactly serverUrl, repoIdentity, and projectId.");
    const serverUrl = normalizeServerUrl(value.serverUrl);
    if (serverUrl !== value.serverUrl) throw new Error("Repository binding serverUrl must be a normalized HTTP(S) origin.");
    if (typeof value.repoIdentity !== "string" || value.repoIdentity === "" || !value.repoIdentity.isWellFormed() || /[\p{White_Space}\p{Cc}]/u.test(value.repoIdentity)) throw new Error("Repository binding repoIdentity must be a nonempty repository identity without whitespace or control characters.");
    if (typeof value.projectId !== "string" || canonicalId(value.projectId) === null) throw new Error("Repository binding projectId must be a UUID.");
    return { serverUrl, repoIdentity: value.repoIdentity, projectId: canonicalId(value.projectId)! };
  } catch (cause) {
    throw new Error(`Invalid repository binding ${filename}.`, { cause });
  }
};

export const readProjectBinding = async (root: string, operation: Operation): Promise<ProjectBinding | undefined> => {
  if (!await inspectMetadataDirectory(root, operation)) return undefined;
  const filename = bindingFile(root);
  let entry;
  try {
    entry = await lstat(filename);
  } catch (cause) {
    if (hasCode(cause, "ENOENT")) return undefined;
    throw new Error(`Cannot inspect repository binding ${filename}.`, { cause });
  }
  operation.check();
  if (!entry.isFile()) throw new Error(`Repository binding ${filename} must be a regular file; symbolic links are not supported.`);
  let source: string;
  try {
    source = await readFile(filename, "utf8");
  } catch (cause) {
    throw new Error(`Cannot read repository binding ${filename}.`, { cause });
  }
  operation.check();
  return parseBinding(source, filename);
};

export const projectRepositoryIdentity = (project: Project): string => {
  try {
    return repositoryIdentity(project.repoUrl);
  } catch (cause) {
    throw new ApiError({ operation: "project.resolve", projectId: project.id }, "protocol", { cause });
  }
};

export const verifyProjectBinding = async (
  binding: ProjectBinding | undefined,
  context: ProjectRepositoryContext,
  api: ProjectApi,
  operation: Operation,
): Promise<Project | undefined> => {
  operation.check();
  if (binding === undefined || binding.serverUrl !== context.serverUrl || binding.repoIdentity !== context.repoIdentity) return undefined;
  let project: Project;
  try {
    project = await api.getProject(binding.projectId);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404 && cause.code === "not_found" && cause.phase === "response") {
      operation.check();
      return undefined;
    }
    throw cause;
  }
  operation.check();
  return projectRepositoryIdentity(project) === context.repoIdentity ? project : undefined;
};

const withBindingLock = async <Result>(root: string, operation: Operation, action: () => Promise<Result>): Promise<Result> => {
  operation.check();
  if (!await inspectMetadataDirectory(root, operation)) {
    try { await mkdir(metadataDirectory(root)); }
    catch (cause) { if (!hasCode(cause, "EEXIST")) throw cause; }
    await inspectMetadataDirectory(root, operation);
  }
  operation.check();
  const filename = `${bindingFile(root)}.lock`;
  let handle;
  try {
    handle = await open(filename, "wx", 0o600);
  } catch (cause) {
    throw new Error(hasCode(cause, "EEXIST")
      ? `Repository metadata is locked at ${filename}; confirm the writer has stopped before removing this lock. The lock contains its process ID and ownership token.`
      : `Cannot acquire repository metadata lock ${filename}.`, { cause });
  }
  const content = `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`;
  let identity: Awaited<ReturnType<typeof handle.stat>> | undefined;
  let failure: unknown;
  let failed = false;
  try {
    identity = await handle.stat();
    await handle.writeFile(content, "utf8");
    await handle.sync();
    operation.check();
    return await action();
  } catch (cause) {
    failed = true;
    failure = cause;
    throw cause;
  } finally {
    const cleanup: unknown[] = [];
    let owned = false;
    try {
      const current = await lstat(filename);
      if (!current.isFile() || identity === undefined || current.dev !== identity.dev || current.ino !== identity.ino || await readFile(filename, "utf8") !== content) throw new Error(`Repository metadata lock ownership changed at ${filename}; the replacement lock was retained.`);
      owned = true;
    } catch (cause) { cleanup.push(cause); }
    try { await handle.close(); } catch (cause) { cleanup.push(cause); }
    if (owned) {
      try { await unlink(filename); } catch (cause) { cleanup.push(cause); }
    }
    if (cleanup.length !== 0) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, "Repository metadata operation or lock cleanup failed.");
  }
};

const ensureIgnored = async (root: string, operation: Operation): Promise<void> => {
  operation.check();
  const tracked = await runRepositoryGit(root, ["ls-files", "-z", "--", ".daynight"], operation);
  if (tracked.stdout !== "") throw new Error("Repository .daynight contents are tracked by Git; remove them from the index before using automatic project discovery.");
  const filename = path.join(root, ".gitignore");
  let entry;
  try { entry = await lstat(filename); }
  catch (cause) { if (!hasCode(cause, "ENOENT")) throw new Error(`Cannot inspect ${filename}.`, { cause }); }
  operation.check();
  if (entry !== undefined && !entry.isFile()) throw new Error(`Repository ignore file ${filename} must be a regular file; symbolic links are not supported.`);
  if (entry !== undefined) {
    if ((entry.mode & 0o222) === 0) throw new Error(`Repository ignore file ${filename} is not writable.`);
    await access(filename, constants.W_OK);
  }
  const source = entry === undefined ? Buffer.alloc(0) : await readFile(filename);
  operation.check();
  const containsRule = source.toString("latin1").split(/\r?\n/).includes("/.daynight/");
  const ignored = await runRepositoryGit(root, ["check-ignore", "--quiet", "--", ".daynight/"], operation, { allowExitOne: true });
  if (!containsRule || ignored.exitCode !== 0) {
    const firstLineFeed = source.indexOf(0x0a);
    const newline = firstLineFeed > 0 && source[firstLineFeed - 1] === 0x0d ? "\r\n" : "\n";
    const separator = source.length === 0 || source.at(-1) === 0x0a ? "" : newline;
    const updated = Buffer.concat([source, Buffer.from(`${separator}/.daynight/${newline}`)]);
    operation.check();
    await replaceFileAtomically(filename, updated, entry?.mode);
    operation.check();
  }
  for (const target of [".daynight/", ".daynight/project.yml"]) {
    const verified = await runRepositoryGit(root, ["check-ignore", "--quiet", "--", target], operation, { allowExitOne: true });
    if (verified.exitCode !== 0) throw new Error(`Repository ignore rule for ${target} is ineffective in ${filename}.`);
  }
};

export const persistProjectBinding = async (options: {
  readonly root: string;
  readonly binding: ProjectBinding;
  readonly project: Project;
  readonly operation: Operation;
  readonly api: ProjectApi;
}): Promise<Project> => withBindingLock(options.root, options.operation, async () => {
  const { root, binding, operation, api, project } = options;
  const current = await readProjectBinding(root, operation);
  const selected = await verifyProjectBinding(current, binding, api, operation);
  if (selected !== undefined) return selected;
  if (current?.serverUrl === binding.serverUrl && current.repoIdentity === binding.repoIdentity && current.projectId === binding.projectId) throw new Error(`Project ${binding.projectId} changed during repository discovery; retry the command to discover its current association.`);
  await ensureIgnored(root, operation);
  const filename = bindingFile(root);
  let entry;
  try { entry = await lstat(filename); }
  catch (cause) { if (!hasCode(cause, "ENOENT")) throw cause; }
  operation.check();
  if (entry !== undefined && !entry.isFile()) throw new Error(`Repository binding ${filename} must be a regular file; symbolic links are not supported.`);
  await replaceFileAtomically(filename, stringify(binding), entry?.mode);
  operation.check();
  return project;
});
