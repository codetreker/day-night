import { performance } from "node:perf_hooks";
import { parseApiJson, stringifyApiJson } from "./json.js";
import { OperationError } from "./operation.js";
import type { Operation } from "./operation.js";
import { canonicalId, parsePage, parseProject, parseServerError, parseTask, parseTaskGraph, ProtocolError } from "./parse.js";
import type { CreateProjectInput, CreateTaskInput, ErrorDetails, Project, ServerError, Task, TaskFilters, TaskGraph, UpdateTaskInput } from "./types.js";

type Context = { readonly operation: string; readonly projectId?: string; readonly taskId?: string };
export type ApiPhase = "prepare" | "request" | "response" | "protocol" | "pagination";

export class ApiError extends Error {
  readonly operation: string;
  readonly phase: ApiPhase;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: ErrorDetails;
  readonly outcomeUnconfirmed: boolean;
  readonly confirmedRefusal: boolean;

  constructor(context: Context, phase: ApiPhase, options: {
    readonly cause: unknown;
    readonly status?: number;
    readonly serverError?: ServerError;
    readonly outcomeUnconfirmed?: boolean;
    readonly confirmedRefusal?: boolean;
  }) {
    const target = [context.projectId === undefined ? "" : ` project=${context.projectId}`, context.taskId === undefined ? "" : ` task=${context.taskId}`].join("");
    const server = options.serverError;
    const reason = server === undefined
      ? options.cause instanceof OperationError ? options.cause.message : phase === "protocol" || phase === "pagination" ? "Invalid server response." : "Local HTTP request failed."
      : `${server.code}: ${server.message} (requestId=${server.requestId})`;
    const details = server?.details;
    const detailText = details === undefined ? "" : ` details=${JSON.stringify(details)}`;
    super(`${context.operation}${target} [${phase}]: ${reason}${detailText}${options.outcomeUnconfirmed === true ? " Remote mutation outcome is unconfirmed; query the target before retrying." : ""}`, { cause: options.cause });
    this.name = "ApiError";
    this.operation = context.operation;
    this.phase = phase;
    if (context.projectId !== undefined) this.projectId = context.projectId;
    if (context.taskId !== undefined) this.taskId = context.taskId;
    if (options.status !== undefined) this.status = options.status;
    if (server !== undefined) { this.code = server.code; this.requestId = server.requestId; }
    if (details !== undefined) this.details = details;
    this.outcomeUnconfirmed = options.outcomeUnconfirmed === true;
    this.confirmedRefusal = options.confirmedRefusal === true;
  }
}

export type ApiClient = {
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  listProjects(): Promise<readonly Project[]>;
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  getTask(projectId: string, taskId: string): Promise<Task>;
  listTasks(projectId: string, filters?: TaskFilters): Promise<readonly Task[]>;
  listReadyTasks(projectId: string, limit: number): Promise<readonly Task[]>;
  updateTask(projectId: string, taskId: string, input: UpdateTaskInput): Promise<Task>;
  getTaskGraph(projectId: string): Promise<TaskGraph>;
};

const resourceId = (value: string): string => {
  const parsed = canonicalId(value);
  if (parsed === null) throw new Error("Resource ID must be a hyphenated UUID.");
  return parsed;
};

export const createApiClient = (options: {
  readonly serverUrl: string;
  readonly operation: Operation;
  readonly fetch?: typeof globalThis.fetch;
}): ApiClient => {
  const origin = new URL(options.serverUrl);
  if (!/^https?:$/.test(origin.protocol) || origin.username !== "" || origin.password !== "" || origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") throw new Error("serverUrl must be an HTTP(S) service origin without credentials, path, query or fragment.");
  const operation = options.operation;
  const fetch = options.fetch ?? globalThis.fetch;

  const request = async <T>(context: Context, path: string, method: "GET" | "POST" | "PATCH", parse: (value: unknown) => T, body?: unknown): Promise<T> => {
    let phase: ApiPhase = "prepare";
    let dispatched = false;
    let status: number | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bodyFailure: unknown;
    let removeAbort = (): void => {};
    let removeOperationAbort = (): void => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestDeadline = Infinity;
    let totalBudgetCapped = false;
    let serverError: ServerError | undefined;
    const controller = new AbortController();
    const checkRequest = (): void => {
      operation.check();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (performance.now() >= requestDeadline) {
        controller.abort(new OperationError(totalBudgetCapped ? "deadline" : "request_timeout"));
        throw controller.signal.reason;
      }
    };
    try {
      operation.check();
      const serialized = body === undefined ? undefined : stringifyApiJson(body);
      const url = new URL(`/api/v1${path}`, origin);
      const remaining = operation.remainingMs();
      const timeout = Math.min(operation.limits.requestMs, remaining);
      totalBudgetCapped = remaining <= operation.limits.requestMs;
      requestDeadline = performance.now() + timeout;
      timer = setTimeout(() => controller.abort(new OperationError(totalBudgetCapped ? "deadline" : "request_timeout")), Math.ceil(timeout));
      timer.unref();
      const cancel = (): void => controller.abort(operation.signal.reason);
      operation.signal.addEventListener("abort", cancel, { once: true });
      removeOperationAbort = () => operation.signal.removeEventListener("abort", cancel);
      if (operation.signal.aborted) cancel();
      phase = "request";
      checkRequest();
      const aborted = new Promise<never>((_resolve, reject) => {
        const fail = (): void => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", fail, { once: true });
        removeAbort = () => controller.signal.removeEventListener("abort", fail);
        if (controller.signal.aborted) fail();
      });
      const response = await Promise.race([Promise.resolve().then(() => {
        checkRequest();
        dispatched = true;
        return fetch(url, {
        method,
        headers: { Accept: "application/json", ...(serialized === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(serialized === undefined ? {} : { body: serialized }),
        redirect: "manual",
        signal: controller.signal,
        });
      }), aborted]);
      status = response.status;
      phase = "response";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const chunks: string[] = [];
      let pendingText = "";
      let bytes = 0;
      let decodingError: unknown;
      if (response.body !== null) {
        reader = response.body.getReader();
        // Cancelling an already errored stream repeats its existing failure, rather than introducing a cleanup failure.
        void reader.closed.catch((error: unknown) => { bodyFailure = error; });
        while (true) {
          checkRequest();
          const chunk = await Promise.race([reader.read(), aborted]);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          operation.consume(chunk.value.byteLength);
          if (bytes > operation.limits.responseBytes) throw new OperationError("response_limit");
          // Count the whole bounded body even when UTF-8 decoding fails before its end.
          if (decodingError === undefined) {
            try {
              pendingText += decoder.decode(chunk.value, { stream: true });
              if (pendingText.length >= 65_536) { chunks.push(pendingText); pendingText = ""; }
            }
            catch (error) { decodingError = error; }
          }
        }
      }
      checkRequest();
      phase = "protocol";
      if (decodingError !== undefined) throw decodingError;
      chunks.push(pendingText, decoder.decode());
      const contentType = response.headers.get("content-type");
      if (contentType === null || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) throw new ProtocolError("Expected an application/json UTF-8 response.");
      const value = parseApiJson(chunks.join(""));
      checkRequest();
      const expectedStatus = method === "POST" ? 201 : 200;
      if (status !== expectedStatus) {
        if (status < 400 || status > 599) throw new ProtocolError("Unexpected HTTP status.");
        serverError = parseServerError(value);
        const confirmedRefusal = status >= 400 && status < 500;
        throw new ApiError(context, "response", { cause: new Error(serverError.message), status, serverError, confirmedRefusal, outcomeUnconfirmed: method !== "GET" && !confirmedRefusal });
      }
      const result = parse(value);
      checkRequest();
      return result;
    } catch (cause) {
      controller.abort(cause);
      let failure = cause;
      if (reader !== undefined) {
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const cleanup = reader.cancel(cause);
          await Promise.race([cleanup, new Promise<never>((_resolve, reject) => {
            cleanupTimer = setTimeout(() => reject(new Error("Response stream cancellation exceeded its 100 ms cleanup deadline.")), 100);
          })]);
        } catch (cleanupError) {
          if (cleanupError !== cause && cleanupError !== bodyFailure) failure = new AggregateError([cause, cleanupError], "HTTP request failed and response cleanup failed.", { cause });
        } finally {
          if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
        }
      }
      if (cause instanceof ApiError && failure === cause) throw cause;
      throw new ApiError(context, phase, {
        cause: failure,
        ...(status === undefined ? {} : { status }),
        ...(serverError === undefined ? {} : { serverError }),
        confirmedRefusal: cause instanceof ApiError && cause.confirmedRefusal,
        outcomeUnconfirmed: cause instanceof ApiError ? cause.outcomeUnconfirmed : method !== "GET" && dispatched,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeAbort();
      removeOperationAbort();
      reader?.releaseLock();
    }
  };

  const list = async <T extends { readonly id: string }>(context: Context, path: string, parse: (item: unknown) => T, filters: Record<string, string> = {}): Promise<readonly T[]> => {
    const result: T[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    try {
      do {
        operation.check();
        const query = new URLSearchParams({ ...filters, limit: "100", ...(cursor === null ? {} : { cursor }) });
        const page = await request(context, `${path}?${query}`, "GET", (value) => parsePage(value, parse));
        for (const item of page.items) {
          if (seenIds.has(item.id)) throw new ProtocolError("Duplicate resource ID across list pages.");
          seenIds.add(item.id);
          result.push(item);
        }
        cursor = page.nextCursor;
        if (cursor !== null) {
          if (seenCursors.has(cursor)) throw new ProtocolError("Repeated pagination cursor.");
          seenCursors.add(cursor);
        }
      } while (cursor !== null);
      operation.check();
      return result;
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(context, "pagination", { cause });
    }
  };

  return {
    createProject: (input) => request({ operation: "project.create" }, "/projects", "POST", (value) => parseProject(value), { name: input.name, repoUrl: input.repoUrl }),
    getProject: (projectId) => {
      const project = resourceId(projectId);
      return request({ operation: "project.show", projectId: project }, `/projects/${encodeURIComponent(project)}`, "GET", (value) => parseProject(value, project));
    },
    listProjects: () => list({ operation: "project.list" }, "/projects", (value) => parseProject(value)),
    createTask: (projectId, input) => {
      const project = resourceId(projectId);
      return request({ operation: "task.create", projectId: project }, `/projects/${encodeURIComponent(project)}/tasks`, "POST", (value) => parseTask(value, project), {
        title: input.title,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.dependsOn === undefined ? {} : { dependsOn: input.dependsOn }),
        ...(input.properties === undefined ? {} : { properties: input.properties }),
      });
    },
    getTask: (projectId, taskId) => {
      const project = resourceId(projectId), task = resourceId(taskId);
      return request({ operation: "task.show", projectId: project, taskId: task }, `/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}`, "GET", (value) => parseTask(value, project, task));
    },
    listTasks: (projectId, filters = {}) => {
      const project = resourceId(projectId);
      const query = { ...(filters.status === undefined ? {} : { status: filters.status }), ...(filters.ready === undefined ? {} : { ready: String(filters.ready) }) };
      return list({ operation: "task.list", projectId: project }, `/projects/${encodeURIComponent(project)}/tasks`, (value) => {
        const task = parseTask(value, project);
        if ((filters.status !== undefined && task.status !== filters.status) || (filters.ready !== undefined && task.ready !== filters.ready)) throw new ProtocolError("Task does not match the requested filters.");
        return task;
      }, query);
    },
    listReadyTasks: (projectId, limit) => {
      const project = resourceId(projectId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Ready task limit must be an integer from 1 to 100.");
      const query = new URLSearchParams({ ready: "true", limit: String(limit) });
      return request({ operation: "task.ready", projectId: project }, `/projects/${encodeURIComponent(project)}/tasks?${query}`, "GET", (value) => {
        const page = parsePage(value, (item) => {
          const task = parseTask(item, project);
          if (!task.ready) throw new ProtocolError("Task does not match the requested ready filter.");
          return task;
        });
        if (page.items.length > limit) throw new ProtocolError("Ready task page exceeds the requested limit.");
        return page.items;
      });
    },
    updateTask: (projectId, taskId, input) => {
      const project = resourceId(projectId), task = resourceId(taskId);
      return request({ operation: "task.update", projectId: project, taskId: task }, `/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}`, "PATCH", (value) => parseTask(value, project, task), {
        version: input.version,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.dependsOn === undefined ? {} : { dependsOn: input.dependsOn }),
        ...(input.properties === undefined ? {} : { properties: input.properties }),
      });
    },
    getTaskGraph: (projectId) => {
      const project = resourceId(projectId);
      return request({ operation: "task.graph", projectId: project }, `/projects/${encodeURIComponent(project)}/task-graph`, "GET", (value) => parseTaskGraph(value, project));
    },
  };
};
