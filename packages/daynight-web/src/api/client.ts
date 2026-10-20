import { canonicalId, parseProjectPage, parseServerError, parseTaskDetail, parseTaskGraph } from "./parse";
import type { GraphLimitDetails, ProjectPage, TaskDetail, TaskGraph } from "./types";

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

const read = async <T>(url: string, signal: AbortSignal, parse: (data: unknown) => T): Promise<T> => {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/json" }, cache: "no-store" });
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    throw new ApiError("network");
  }
  signal.throwIfAborted();
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
