import mime from "mime";
import { canonicalId, isAttachmentPath, parseAttachment, parseAttachmentPage, parseProjectPage, parseServerError, parseTaskDetail, parseTaskGraph } from "./parse";
import type { Attachment, AttachmentPage, GraphLimitDetails, ProjectPage, TaskDetail, TaskGraph } from "./types";

export class ApiError extends Error {
  readonly kind: "network" | "protocol" | "server";
  readonly status: number | null;
  readonly code: string;
  readonly requestId: string | null;
  readonly graphLimit: GraphLimitDetails | undefined;

  constructor(
    kind: ApiError["kind"],
    status: number | null = null,
    code: string = kind,
    requestId: string | null = null,
    graphLimit?: GraphLimitDetails,
  ) {
    const message = kind === "network"
      ? "Unable to connect to the server. Please try again."
      : kind === "protocol"
        ? "The server returned an invalid response. Please try again."
        : code === "not_found"
          ? "The requested resource was not found."
          : code === "graph_limit_exceeded"
            ? "This project's task graph exceeds the supported size."
            : "Unable to load the requested data. Please try again.";
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.graphLimit = graphLimit;
  }
}

export const isAbortError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";

const request = async (url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> => {
  signal.throwIfAborted();
  try {
    const response = await fetch(url, { ...init, signal, cache: "no-store" });
    signal.throwIfAborted();
    return response;
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    throw new ApiError("network");
  }
};

const json = async <T>(response: Response, signal: AbortSignal, parse: (data: unknown) => T): Promise<T> => {
  let body: unknown;
  try {
    const contentType = response.headers.get("Content-Type");
    if (contentType === null || !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) throw new Error("Invalid media type");
    body = await response.json();
    signal.throwIfAborted();
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    throw new ApiError("protocol", response.status);
  }
  try {
    if (response.ok) return parse(body);
    const serverError = parseServerError(body);
    throw new ApiError("server", response.status, serverError.code, serverError.requestId, serverError.graphLimit);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("protocol", response.status);
  }
};

const read = async <T>(url: string, signal: AbortSignal, parse: (data: unknown) => T): Promise<T> =>
  json(await request(url, signal, { headers: { Accept: "application/json" } }), signal, parse);

const requestId = (value: string): string => {
  const id = canonicalId(value);
  if (id === null) throw new ApiError("protocol");
  return id;
};

export const listProjects = (query: { readonly limit?: number; readonly cursor?: string }, signal: AbortSignal): Promise<ProjectPage> => {
  const parameters = new URLSearchParams();
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new ApiError("protocol");
    parameters.set("limit", String(query.limit));
  }
  if (query.cursor !== undefined) {
    if (query.cursor === "") throw new ApiError("protocol");
    parameters.set("cursor", query.cursor);
  }
  const suffix = parameters.size === 0 ? "" : `?${parameters.toString()}`;
  return read(`/api/v1/projects${suffix}`, signal, parseProjectPage);
};

export const getTaskGraph = (projectId: string, signal: AbortSignal): Promise<TaskGraph> => {
  const project = requestId(projectId);
  return read(`/api/v1/projects/${project}/task-graph`, signal, (data) => parseTaskGraph(data, project));
};

export const getTask = (projectId: string, taskId: string, signal: AbortSignal): Promise<TaskDetail> => {
  const project = requestId(projectId);
  const task = requestId(taskId);
  return read(`/api/v1/projects/${project}/tasks/${task}`, signal, (data) => parseTaskDetail(data, project, task));
};

const attachmentTaskUrl = (projectId: string, taskId: string): string =>
  `/api/v1/projects/${requestId(projectId)}/tasks/${requestId(taskId)}`;

const encodedAttachmentPath = (path: string): string => {
  if (!isAttachmentPath(path)) throw new ApiError("protocol");
  return path.split("/").map(encodeURIComponent).join("/");
};

export const attachmentDownloadUrl = (projectId: string, taskId: string, path: string): string =>
  `${attachmentTaskUrl(projectId, taskId)}/attachments/files/${encodedAttachmentPath(path)}`;

export const attachmentPreviewRoot = (projectId: string, taskId: string): string =>
  `${attachmentTaskUrl(projectId, taskId)}/preview/`;

export const attachmentPreviewUrl = (projectId: string, taskId: string, path: string): string =>
  `${attachmentPreviewRoot(projectId, taskId)}${encodedAttachmentPath(path)}`;

export const listAttachments = (
  projectId: string, taskId: string, query: { readonly limit?: number; readonly cursor?: string }, signal: AbortSignal,
): Promise<AttachmentPage> => {
  const url = `${attachmentTaskUrl(projectId, taskId)}/attachments`;
  const parameters = new URLSearchParams();
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new ApiError("protocol");
    parameters.set("limit", String(query.limit));
  }
  if (query.cursor !== undefined) {
    if (query.cursor === "") throw new ApiError("protocol");
    parameters.set("cursor", query.cursor);
  }
  return read(parameters.size === 0 ? url : `${url}?${parameters}`, signal, parseAttachmentPage);
};

export const attachmentContentType = (path: string): string =>
  mime.getType(path) ?? "application/octet-stream";

export const putAttachment = async (
  projectId: string, taskId: string, path: string, file: File, signal: AbortSignal,
): Promise<Attachment> => {
  const response = await request(attachmentDownloadUrl(projectId, taskId, path), signal, {
    method: "PUT", body: file, redirect: "error", headers: { Accept: "application/json", "Content-Type": attachmentContentType(path) },
  });
  return json(response, signal, (data) => {
    const attachment = parseAttachment(data);
    if ((response.status !== 200 && response.status !== 201) || attachment.path !== path) throw new ApiError("protocol", response.status);
    return attachment;
  });
};

export const removeAttachment = async (projectId: string, taskId: string, path: string, signal: AbortSignal): Promise<void> => {
  const response = await request(attachmentDownloadUrl(projectId, taskId, path), signal, { method: "DELETE", redirect: "error" });
  if (!response.ok) return json(response, signal, () => { throw new ApiError("protocol", response.status); });
  if (response.status !== 204) throw new ApiError("protocol", response.status);
};

export const readAttachmentText = async (projectId: string, taskId: string, path: string, signal: AbortSignal): Promise<string> => {
  const response = await request(attachmentDownloadUrl(projectId, taskId, path), signal);
  if (!response.ok) return json(response, signal, () => { throw new ApiError("protocol", response.status); });
  if (response.status !== 200) throw new ApiError("protocol", response.status);
  try {
    const text = await response.text();
    signal.throwIfAborted();
    return text;
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    throw new ApiError("network", response.status);
  }
};

export const checkAttachmentPreview = async (projectId: string, taskId: string, path: string, signal: AbortSignal): Promise<void> => {
  const response = await request(attachmentPreviewUrl(projectId, taskId, path), signal, { method: "HEAD" });
  if (!response.ok) {
    const header = response.headers.get("X-Request-ID");
    const requestId = header !== null && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(header) ? header : null;
    throw new ApiError("server", response.status, "server", requestId);
  }
  if (response.status !== 200) throw new ApiError("protocol", response.status);
};
