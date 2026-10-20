import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, createOperation, DEFAULT_OPERATION_LIMITS, OperationError, parseApiJson, parseVersionArgument, stringifyApiJson } from "../../src/api/index.js";
import type { Operation, TaskGraph } from "../../src/api/index.js";

const projectId = "11111111-1111-1111-1111-111111111111";
const taskId = "22222222-2222-2222-2222-222222222222";
const otherId = "33333333-3333-3333-3333-333333333333";
const time = "2026-10-20T01:02:03.123456789Z";
const project = { id: projectId, name: "Project", repoUrl: "git@github.com:Org/Repo.git", createdAt: time, updatedAt: time };
const task = { id: taskId, projectId, title: "Task", description: "", status: "todo", version: 1n, createdAt: time, updatedAt: time, dependsOn: [], blockedBy: [], ready: true };
const refusal = (code = "not_found", details?: unknown) => ({ error: { code, message: "Actual server explanation.", requestId: "req-1", ...(details === undefined ? {} : { details }) } });
const jsonResponse = (value: unknown, status = 200) => new Response(stringifyApiJson(value), { status, headers: { "Content-Type": "application/json" } });
const cleanups: (() => void | Promise<void>)[] = [];
const operation = (limits: Parameters<typeof createOperation>[0] = {}): Operation => {
  const created = createOperation(limits);
  cleanups.push(() => created.dispose());
  return created;
};
const client = (fetch: typeof globalThis.fetch, op = operation()) => createApiClient({ serverUrl: "http://localhost:8787/", operation: op, fetch });
const server = async (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
  const created = createServer(handler);
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    created.close((error) => error === undefined ? resolve() : reject(error));
    created.closeAllConnections();
  }));
  const address = created.address();
  if (typeof address !== "object" || address === null) throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
};
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("operation-scoped API access", () => {
  it("uses the approved production budgets and checks synchronous work against the shared deadline", () => {
    expect(DEFAULT_OPERATION_LIMITS).toEqual({ totalMs: 300_000, requestMs: 30_000, responseBytes: 128 * 1_048_576, totalBytes: 256 * 1_048_576 });
    const op = operation({ limits: { totalMs: 5 } });
    const until = performance.now() + 10;
    while (performance.now() < until) { /* Advance without yielding to the deadline timer. */ }
    expect(() => op.check()).toThrow("Operation deadline exceeded");
  });

  it("shares cumulative bytes, retains caller cancellation, and disposes idempotently", async () => {
    const source = new AbortController();
    const op = operation({ signal: source.signal, limits: { totalBytes: 5 } });
    op.consume(3);
    expect(() => op.consume(3)).toThrow("response byte budget");
    expect(op.signal.aborted).toBe(true);
    const cancelled = operation({ signal: source.signal });
    source.abort(new Error("caller details"));
    expect(() => cancelled.check()).toThrow("Operation cancelled");
    const disposed = operation();
    disposed.dispose();
    disposed.dispose();
    expect(() => disposed.check()).toThrow("disposed");
  });

  it("reads nanosecond timestamps and full Go int64 versions without changing numeric JSON wire shape", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ ...task, version: 9_223_372_036_854_775_807n }));
    const api = client(fetch);
    const result = await api.getTask(projectId.toUpperCase(), taskId);
    expect(result.version).toBe(9_223_372_036_854_775_807n);
    expect(result.createdAt).toBe(time);
    expect(stringifyApiJson(result)).toContain('"version":9223372036854775807');
    expect(parseVersionArgument("0009007199254740993")).toBe(9_007_199_254_740_993n);
    for (const value of ["0", "-1", "1.5", "1e3", "9223372036854775808"]) expect(() => parseVersionArgument(value)).toThrow();
    expect(parseApiJson('{"version":9223372036854775807}')).toEqual({ version: 9_223_372_036_854_775_807n });
  });

  it("uses exact mutation methods and preserves optional fields, empty values and duplicate dependency input", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(project, 201))
      .mockResolvedValueOnce(jsonResponse(task, 201))
      .mockResolvedValueOnce(jsonResponse(task, 201))
      .mockResolvedValueOnce(jsonResponse({ ...task, version: 9_007_199_254_740_994n }));
    const api = client(fetch);
    await api.createProject({ name: "Project", repoUrl: project.repoUrl });
    await api.createTask(projectId, { title: "Task" });
    await api.createTask(projectId, { title: "Task", description: "", dependsOn: [otherId, otherId] });
    await api.updateTask(projectId, taskId, { version: 9_007_199_254_740_993n, description: "", dependsOn: [] });
    expect(fetch.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "POST", "POST", "PATCH"]);
    expect(fetch.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ name: "Project", repoUrl: project.repoUrl }),
      '{"title":"Task"}',
      JSON.stringify({ title: "Task", description: "", dependsOn: [otherId, otherId] }),
      '{"version":9007199254740993,"description":"","dependsOn":[]}',
    ]);
    expect(fetch.mock.calls.every((call) => call[1]?.redirect === "manual")).toBe(true);
  });

  it("lists complete pages with stable filters and encoded opaque cursors", async () => {
    const cursor = "next page+/=?";
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [task], nextCursor: cursor }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ ...task, id: otherId }], nextCursor: null }));
    const result = await client(fetch).listTasks(projectId, { status: "todo", ready: true });
    expect(result.map((item) => item.id)).toEqual([taskId, otherId]);
    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).searchParams.toString())).toEqual([
      "status=todo&ready=true&limit=100", `status=todo&ready=true&limit=100&cursor=${encodeURIComponent(cursor).replaceAll("%20", "+")}`,
    ]);
  });

  it.each(["cursor", "duplicate", "later failure"])("rejects %s without returning a partial list", async (failure) => {
    const cursor = Buffer.from("cursor").toString("base64url");
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [project], nextCursor: cursor }))
      .mockResolvedValueOnce(failure === "later failure" ? jsonResponse(refusal("internal_error"), 500) : jsonResponse({ items: [{ ...project, id: failure === "duplicate" ? projectId : otherId }], nextCursor: failure === "cursor" ? cursor : null }));
    await expect(client(fetch).listProjects()).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves confirmed API refusals, dependency IDs and graph size details", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(refusal("dependency_unsatisfied", { taskIds: [otherId] }), 409))
      .mockResolvedValueOnce(jsonResponse(refusal("graph_limit_exceeded", { nodeCount: 1001, edgeCount: 0, maxNodes: 1000, maxEdges: 5000 }), 409));
    const api = client(fetch);
    await expect(api.updateTask(projectId, taskId, { version: 1n, status: "done" })).rejects.toMatchObject({
      operation: "task.update", phase: "response", projectId, taskId, status: 409, code: "dependency_unsatisfied", requestId: "req-1", details: { taskIds: [otherId] }, confirmedRefusal: true, outcomeUnconfirmed: false, cause: expect.any(Error),
    });
    await expect(api.getTaskGraph(projectId)).rejects.toMatchObject({ code: "graph_limit_exceeded", details: { nodeCount: 1001, edgeCount: 0, maxNodes: 1000, maxEdges: 5000 } });
  });

  it("never forwards a POST redirect to a second destination", async () => {
    const methods: string[] = [];
    const url = await server((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      response.writeHead(307, { Location: "/elsewhere", "Content-Type": "application/json" });
      response.end("{}");
    });
    const api = createApiClient({ serverUrl: url, operation: operation() });
    await expect(api.createProject({ name: "Project", repoUrl: project.repoUrl })).rejects.toMatchObject({ status: 307, outcomeUnconfirmed: true });
    expect(methods).toEqual(["POST /api/v1/projects"]);
  });

  it("reports an unconfirmed mutation when its response exceeds a byte limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(task, 201));
    await expect(client(fetch, operation({ limits: { responseBytes: 10 } })).createTask(projectId, { title: "Task" })).rejects.toMatchObject({ outcomeUnconfirmed: true, confirmedRefusal: false, cause: { kind: "response_limit" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("marks disconnected mutation results unconfirmed and does not retry", async () => {
    let mutations = 0;
    const url = await server((request) => { mutations++; request.socket.destroy(); });
    await expect(createApiClient({ serverUrl: url, operation: operation() }).createTask(projectId, { title: "Task" })).rejects.toMatchObject({ operation: "task.create", outcomeUnconfirmed: true, confirmedRefusal: false, cause: expect.any(Error) });
    expect(mutations).toBe(1);
  });

  it("includes body reading in the real HTTP request timeout", async () => {
    const url = await server((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"items":');
    });
    const api = createApiClient({ serverUrl: url, operation: operation({ limits: { requestMs: 30 } }) });
    await expect(api.listProjects()).rejects.toMatchObject({ phase: "response", cause: { kind: "request_timeout" } });
  });

  it("cancels a custom response stream even when fetch ignores its signal", async () => {
    const source = new AbortController();
    const cancel = vi.fn();
    let notifyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      return new Response(new ReadableStream<Uint8Array>({ pull: notifyStarted, cancel }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/json" } });
    });
    const pending = client(fetch, operation({ signal: source.signal })).listProjects();
    await started;
    source.abort();
    await expect(pending).rejects.toMatchObject({ cause: { kind: "cancelled" } });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["rejects", "stalls"])("preserves bounded cleanup failure when stream cancellation %s", async (behavior) => {
    const source = new AbortController();
    const cleanupError = new Error("Underlying stream cancellation failed");
    let startedReading: () => void = () => {};
    const started = new Promise<void>((resolve) => { startedReading = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull: startedReading,
      cancel: () => behavior === "rejects" ? Promise.reject(cleanupError) : new Promise<void>(() => {}),
    }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/json" } }));
    const pending = client(fetch, operation({ signal: source.signal })).listProjects();
    await started;
    source.abort();
    const error = await pending.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    const cause = (error as ApiError).cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors[0]).toMatchObject({ kind: "cancelled" });
    if (behavior === "rejects") expect((cause as AggregateError).errors[1]).toBe(cleanupError);
    else expect((cause as AggregateError).errors[1]).toMatchObject({ message: expect.stringContaining("cleanup deadline") });
  });

  it("retains synchronous injected fetch failures without unhandled cancellation rejections", async () => {
    const cause = new Error("Synchronous network boundary failure");
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => { throw cause; });
    await expect(client(fetch).createTask(projectId, { title: "Task" })).rejects.toMatchObject({ cause, outcomeUnconfirmed: true });
  });

  it("rejects unsupported timer ranges before starting an operation", () => {
    expect(() => createOperation({ limits: { totalMs: 2_147_483_648 } })).toThrow("timer range");
    expect(() => createOperation({ limits: { requestMs: 2_147_483_648 } })).toThrow("timer range");
  });

  it("checks the single request deadline after synchronous parsing stalls the timer", async () => {
    const original = JSON.parse;
    const spy = vi.spyOn(JSON, "parse").mockImplementation((...args: Parameters<typeof JSON.parse>) => {
      const until = performance.now() + 15;
      while (performance.now() < until) { /* Keep the deadline timer from running during parsing. */ }
      return original(...args);
    });
    await expect(client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(project)), operation({ limits: { requestMs: 10 } })).getProject(projectId)).rejects.toMatchObject({ cause: { kind: "request_timeout" } });
    expect(spy).toHaveBeenCalled();
  });

  it("counts decoded gzip bytes rather than Content-Length", async () => {
    const body = gzipSync(stringifyApiJson(project));
    const url = await server((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": body.length });
      response.end(body);
    });
    const api = createApiClient({ serverUrl: url, operation: operation({ limits: { responseBytes: body.length + 1 } }) });
    await expect(api.getProject(projectId)).rejects.toMatchObject({ cause: { kind: "response_limit" } });
  });

  it("accumulates success and error bodies within a shared operation", async () => {
    const first = stringifyApiJson(project);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(project))
      .mockResolvedValueOnce(jsonResponse(refusal(), 404));
    const api = client(fetch, operation({ limits: { totalBytes: Buffer.byteLength(first) + 1 } }));
    await api.getProject(projectId);
    await expect(api.getProject(projectId)).rejects.toMatchObject({ cause: { kind: "total_limit" } });
  });

  it("exhausts one total deadline across continuously advancing cursors", async () => {
    let page = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      page++;
      const suffix = page.toString(16).padStart(12, "0");
      return jsonResponse({ items: [{ ...project, id: `11111111-1111-1111-1111-${suffix}` }], nextCursor: Buffer.from(`cursor-${page}`).toString("base64url") });
    });
    await expect(client(fetch, operation({ limits: { totalMs: 35, requestMs: 100 } })).listProjects()).rejects.toMatchObject({ cause: { kind: "deadline" } });
    expect(page).toBeGreaterThan(1);
  });

  it.each([
    ["wrong content type", new Response("{}", { headers: { "Content-Type": "text/plain" } })],
    ["non-UTF8 charset", new Response("{}", { headers: { "Content-Type": "application/json; charset=latin1" } })],
    ["malformed JSON", new Response("{", { headers: { "Content-Type": "application/json" } })],
    ["invalid UTF8", new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } })],
    ["incomplete error", jsonResponse({ error: { code: "not_found", requestId: "req-1" } }, 404)],
    ["wrong success status", jsonResponse(project, 201)],
  ])("rejects %s as protocol failure while retaining its cause", async (_name, response) => {
    await expect(client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)).getProject(projectId)).rejects.toMatchObject({ phase: "protocol", cause: expect.any(Error) });
  });

  it("rejects an already cancelled operation without calling fetch", async () => {
    const source = new AbortController(); source.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(client(fetch, operation({ signal: source.signal })).createProject({ name: "P", repoUrl: project.repoUrl })).rejects.toMatchObject({ phase: "prepare", outcomeUnconfirmed: false, cause: { kind: "cancelled" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

const graph = (): TaskGraph => ({
  project,
  summary: { total: 2, todo: 1, inProgress: 0, done: 1, ready: 1, blocked: 0 },
  tasks: [
    { id: taskId, titlePreview: "Task", titleTruncated: false, status: "todo", dependsOn: [otherId], blockedBy: [], ready: true, createdAt: time, updatedAt: time },
    { id: otherId, titlePreview: "Done", titleTruncated: false, status: "done", dependsOn: [], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
  ],
});

describe("response DTO contract", () => {
  it("ignores unknown numeric version fields while validating known Task versions losslessly", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ ...project, version: 0, metadata: { version: 1.5 } }));
    expect(await client(fetch).getProject(projectId)).toEqual(project);
    for (const version of ["1.0", "1e3", "9223372036854775808"]) {
      const serialized = stringifyApiJson(task).replace('"version":1', `"version":${version}`);
      await expect(client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(serialized, { headers: { "Content-Type": "application/json" } }))).getTask(projectId, taskId)).rejects.toBeInstanceOf(ApiError);
    }
  });
  it("returns a complete graph and ignores future additional fields", async () => {
    const value = graph();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ ...value, futureField: 42 }));
    expect(await client(fetch).getTaskGraph(projectId)).toEqual(value);
  });
  it.each([
    { ...task, version: "1" }, { ...task, version: 0 }, { ...task, version: 1.5 }, { ...task, status: "invalid" },
    { ...task, description: "bad\0text" }, { ...task, ready: false },
    { ...task, dependsOn: [otherId, otherId] }, { ...task, blockedBy: [otherId] },
    { ...task, createdAt: "2026-02-30T01:02:03Z" }, { ...task, updatedAt: "2026-10-20T01:02:03+00:00" },
    { ...task, id: otherId }, { ...task, projectId: otherId }, { ...task, title: " " },
  ])("rejects malformed or mismatched task DTO %#", async (value) => {
    // Use ordinary stringify so deliberately invalid zero versions reach the response parser.
    const serialized = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? Number(item) : item);
    await expect(client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(serialized, { headers: { "Content-Type": "application/json" } }))).getTask(projectId, taskId)).rejects.toBeInstanceOf(ApiError);
  });
  it.each(["summary", "dangling", "cycle", "blocked", "preview", "duplicate"])("rejects inconsistent graph %s", async (failure) => {
    const value = graph();
    const tasks = value.tasks.map((item) => ({ ...item }));
    let summary = value.summary;
    if (failure === "summary") summary = { ...summary, total: 3 };
    if (failure === "dangling") tasks[0] = { ...tasks[0]!, dependsOn: [projectId] };
    if (failure === "cycle") tasks[1] = { ...tasks[1]!, dependsOn: [taskId], blockedBy: [taskId] };
    if (failure === "blocked") tasks[0] = { ...tasks[0]!, blockedBy: [otherId], ready: false };
    if (failure === "preview") tasks[0] = { ...tasks[0]!, titleTruncated: true };
    if (failure === "duplicate") tasks[1] = { ...tasks[1]!, id: taskId };
    await expect(client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ ...value, tasks, summary }))).getTaskGraph(projectId)).rejects.toBeInstanceOf(ApiError);
  });
  it("accepts a whitespace preview cut from a nonempty long title", async () => {
    const value = graph();
    const tasks = [{ ...value.tasks[0]!, titlePreview: " ".repeat(160), titleTruncated: true }, value.tasks[1]!];
    await expect(client(vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ ...value, tasks }))).getTaskGraph(projectId)).resolves.toMatchObject({ tasks });
  });
});
