import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getTask, getTaskGraph, isAbortError, listProjects } from "../src/api/client";
import { canonicalId, parseProjectPage, parseServerError, parseTaskDetail, parseTaskGraph } from "../src/api/parse";

const projectId = "10000000-0000-0000-0000-00000000000a";
const taskId = "20000000-0000-0000-0000-00000000000b";
const otherId = "30000000-0000-0000-0000-00000000000c";
const time = "2026-10-20T12:34:56.123456Z";
const project = { id: projectId, name: "Core project", repoUrl: "git@github.com:org/repo.git", createdAt: time, updatedAt: time };
const task = {
  id: taskId, projectId, title: "A task", description: "", properties: { pullRequests: [] }, status: "todo", version: 9007199254740992,
  dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time,
};
const graphTask = {
  id: taskId, titlePreview: "A task", titleTruncated: false, status: "todo",
  dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time,
};
const summary = { total: 1, todo: 1, inProgress: 0, done: 0, ready: 1, blocked: 0 };
const graph = { project, summary, tasks: [graphTask] };
const signal = (): AbortSignal => new AbortController().signal;
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json; charset=utf-8" },
});
const mockResponse = (value: unknown, status = 200) => {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(value, status)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => vi.unstubAllGlobals());

describe("response parsing", () => {
  it("accepts page data, canonicalizes identities, and keeps opaque cursors", () => {
    expect(parseProjectPage({ items: [{ ...project, id: projectId.toUpperCase() }], nextCursor: "opaque+/= token" }))
      .toEqual({ items: [project], nextCursor: "opaque+/= token" });
    expect(parseProjectPage({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
    expect(canonicalId(`{${projectId}}`)).toBeNull();
  });

  it.each([
    undefined, null, [], {}, { items: null, nextCursor: null }, { items: [] }, { items: [], nextCursor: "" },
    { items: [project, { ...project, id: projectId.toUpperCase() }], nextCursor: null },
    ...["id", "name", "repoUrl", "createdAt", "updatedAt"].map((field) => ({ items: [{ ...project, [field]: null }], nextCursor: null })),
    ...["2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00+01:00", "invalid"].map((createdAt) =>
      ({ items: [{ ...project, createdAt }], nextCursor: null })),
    { items: [{ ...project, name: "   " }], nextCursor: null },
    { items: [{ ...project, repoUrl: "bad\0text" }], nextCursor: null },
  ])("rejects malformed pages %# without invented defaults", (value) => {
    expect(() => parseProjectPage(value)).toThrow("invalid response");
  });

  it("accepts UTC timestamps with seconds and nanoseconds", () => {
    for (const createdAt of ["2026-10-20T12:34:56Z", "0001-01-01T00:00:00Z", "2026-10-20T12:34:56.123456789Z"]) {
      expect(parseProjectPage({ items: [{ ...project, createdAt }], nextCursor: null }).items[0]?.createdAt).toBe(createdAt);
    }
  });

  it("parses complete graph and task fields without using int64 version", () => {
    expect(parseTaskGraph(graph, projectId)).toEqual(graph);
    expect(parseTaskGraph({ ...graph, tasks: [{ ...graphTask, titlePreview: " ".repeat(160), titleTruncated: true }] }, projectId).tasks[0]?.titlePreview)
      .toBe(" ".repeat(160));
    const { version: _version, ...detail } = task;
    expect(parseTaskDetail(task, projectId, taskId)).toEqual(detail);
    expect(parseTaskDetail({ ...task, status: "done", ready: false, dependsOn: [otherId], blockedBy: [] }, projectId, taskId).status).toBe("done");
    expect(parseTaskDetail({ ...task, status: "in_progress" }, projectId, taskId).status).toBe("in_progress");
  });

  it("preserves complete ordered PR strings and duplicates without interpreting their content", () => {
    const pullRequests = [
      { url: '', title: '' },
      { url: '  arbitrary\0URL\n\t', title: '<script>文本</script>\n\0' },
      { url: 'javascript:alert(1)', title: '  ' },
      { url: '  arbitrary\0URL\n\t', title: '<script>文本</script>\n\0' },
    ];
    expect(parseTaskDetail({ ...task, properties: { pullRequests } }, projectId, taskId).properties)
      .toEqual({ pullRequests });
    expect(parseTaskDetail({ ...task, properties: { pullRequests, futureField: true } }, projectId, taskId).properties)
      .toEqual({ pullRequests });
    expect(parseTaskGraph({ ...graph, tasks: [{ ...graphTask, properties: { pullRequests } }] }, projectId)).toEqual(graph);
  });

  it.each([
    undefined, null, [], {}, { pullRequests: null }, { pullRequests: {} }, { pullRequests: [null] },
    { pullRequests: [[]] }, { pullRequests: [{}] }, { pullRequests: [{ url: '' }] },
    { pullRequests: [{ title: '' }] }, { pullRequests: [{ url: null, title: '' }] },
    { pullRequests: [{ url: '', title: 1 }] },
  ])("rejects missing or malformed task properties without a legacy fallback %#", (properties) => {
    expect(() => parseTaskDetail({ ...task, properties }, projectId, taskId)).toThrow('invalid response');
  });

  it.each([
    { ...graph, project: { ...project, id: otherId } },
    { ...graph, tasks: null },
    { ...graph, tasks: [graphTask, graphTask] },
    { ...graph, summary: null },
    ...["total", "todo", "inProgress", "done", "ready", "blocked"].flatMap((field) => [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null].map((value) =>
      ({ ...graph, summary: { ...summary, [field]: value } }))),
    ...["titlePreview", "titleTruncated", "ready", "status", "dependsOn", "blockedBy", "id", "createdAt", "updatedAt"].map((field) =>
      ({ ...graph, tasks: [{ ...graphTask, [field]: null }] })),
    { ...graph, tasks: [{ ...graphTask, status: "pending" }] },
    { ...graph, tasks: [{ ...graphTask, dependsOn: [otherId, otherId.toUpperCase()] }] },
    { ...graph, tasks: [{ ...graphTask, blockedBy: [42] }] },
    { ...graph, tasks: [{ ...graphTask, id: "bad" }] },
  ])("rejects malformed graphs %#", (value) => {
    expect(() => parseTaskGraph(value, projectId)).toThrow("invalid response");
  });

  it.each([
    { ...task, projectId: otherId }, { ...task, id: otherId }, { ...task, title: "" },
    { ...task, description: undefined }, { ...task, status: "pending" }, { ...task, ready: 1 },
    { ...task, dependsOn: undefined }, { ...task, blockedBy: [null] },
  ])("rejects malformed or mismatched task details %#", (value) => {
    expect(() => parseTaskDetail(value, projectId, taskId)).toThrow("invalid response");
  });

  it("validates error metadata while discarding raw messages and unneeded details", () => {
    expect(parseServerError({ error: { code: "not_found", message: "secret SQL", requestId: "Request_1.2-3", details: { taskIds: [taskId] } } }))
      .toEqual({ code: "not_found", requestId: "Request_1.2-3" });
    expect(parseServerError({ error: { code: "graph_limit_exceeded", message: "secret", requestId: "r1", details: {
      nodeCount: 1001, edgeCount: 3, maxNodes: 1000, maxEdges: 5000,
    } } })).toEqual({ code: "graph_limit_exceeded", requestId: "r1", graphLimit: {
      nodeCount: 1001, edgeCount: 3, maxNodes: 1000, maxEdges: 5000,
    } });
  });

  it.each([
    {}, { error: null }, { error: { code: "Bad Code", message: "x", requestId: "r1" } },
    { error: { code: "not_found", message: "x", requestId: "\nsecret" } },
    { error: { code: "not_found", requestId: "r1" } },
    { error: { code: "graph_limit_exceeded", message: "x", requestId: "r1" } },
    { error: { code: "graph_limit_exceeded", message: "x", requestId: "r1", details: { nodeCount: 1, edgeCount: 2, maxNodes: 1000, maxEdges: null } } },
  ])("rejects malformed error envelopes %#", (value) => {
    expect(() => parseServerError(value)).toThrow("invalid response");
  });
});

describe("API requests", () => {
  it("uses relative URLs, explicit signal, no-store, and safely encoded opaque cursor", async () => {
    const fetchMock = mockResponse({ items: [project], nextCursor: "next" });
    const abortSignal = signal();
    await expect(listProjects({ limit: 50, cursor: "opaque+/= &?" }, abortSignal)).resolves.toEqual({ items: [project], nextCursor: "next" });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/v1/projects?limit=50&cursor=opaque%2B%2F%3D+%26%3F", {
      signal: abortSignal, headers: { Accept: "application/json" }, cache: "no-store",
    });
    await listProjects({}, abortSignal);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/projects");
  });

  it("normalizes requested IDs and binds resource responses to requests", async () => {
    const fetchMock = mockResponse(graph);
    await expect(getTaskGraph(projectId.toUpperCase(), signal())).resolves.toEqual(graph);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/projects/${projectId}/task-graph`);
    fetchMock.mockResolvedValue(response(task));
    await expect(getTask(projectId.toUpperCase(), taskId.toUpperCase(), signal())).resolves.toMatchObject({ id: taskId, projectId });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/projects/${projectId}/tasks/${taskId}`);
    fetchMock.mockResolvedValue(response({ ...graph, project: { ...project, id: otherId } }));
    await expect(getTaskGraph(projectId, signal())).rejects.toMatchObject({ kind: "protocol", status: 200 });
    fetchMock.mockResolvedValue(response({ ...task, id: otherId }));
    await expect(getTask(projectId, taskId, signal())).rejects.toMatchObject({ kind: "protocol" });
  });

  it("rejects invalid request arguments before sending a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const limit of [0, 101, 1.5, Number.NaN]) expect(() => listProjects({ limit }, signal())).toThrow(ApiError);
    expect(() => listProjects({ cursor: "" }, signal())).toThrow(ApiError);
    expect(() => getTaskGraph("not-a-uuid", signal())).toThrow(ApiError);
    expect(() => getTask(projectId, "../../secret", signal())).toThrow(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports safe network failures without raw exception text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("credentials secret")));
    await expect(listProjects({}, signal())).rejects.toMatchObject({ kind: "network", status: null, requestId: null });
    await expect(listProjects({}, signal())).rejects.not.toThrow("secret");
  });

  it.each([
    new Response("<html>credentials</html>", { headers: { "Content-Type": "text/html" } }),
    new Response("{}"),
    new Response("not-json", { headers: { "Content-Type": "application/json" } }),
    response({ items: null, nextCursor: null }),
    response({ error: { code: "internal_error", message: "secret", requestId: null } }, 500),
  ])("reports safe protocol failures %#", async (raw) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(raw));
    await expect(listProjects({}, signal())).rejects.toMatchObject({ kind: "protocol" });
  });

  it.each([
    [404, "not_found", "The requested resource was not found."],
    [500, "internal_error", "Unable to load the requested data. Please try again."],
    [503, "unrecognized_code", "Unable to load the requested data. Please try again."],
  ] as const)("exposes sanitized server metadata for %i/%s", async (status, code, message) => {
    mockResponse({ error: { code, message: "SQL password=secret", requestId: "req-1" } }, status);
    await expect(listProjects({}, signal())).rejects.toMatchObject({ kind: "server", status, code, requestId: "req-1", message });
  });

  it("preserves graph-limit details for a useful refusal", async () => {
    const graphLimit = { nodeCount: 1001, edgeCount: 5, maxNodes: 1000, maxEdges: 5000 };
    mockResponse({ error: { code: "graph_limit_exceeded", message: "raw text", requestId: "req2", details: graphLimit } }, 409);
    await expect(getTaskGraph(projectId, signal())).rejects.toMatchObject({ kind: "server", status: 409, graphLimit,
      message: "This project's task graph exceeds the supported size." });
  });

  it("does not fetch for pre-aborted signals, preserving the abort reason", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(listProjects({}, controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves in-flight cancellation including custom reasons", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled by route generation");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      controller.abort(reason);
      return Promise.reject(new TypeError("fetch failed"));
    }));
    await expect(listProjects({}, controller.signal)).rejects.toBe(reason);
  });

  it("preserves abort errors even when the signal is not marked aborted", async () => {
    const reason = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(reason));
    await expect(listProjects({}, signal())).rejects.toBe(reason);
    const json = vi.fn().mockRejectedValue(reason);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ headers: new Headers({ "Content-Type": "application/json" }), status: 200, json }));
    await expect(listProjects({}, signal())).rejects.toBe(reason);
    expect(isAbortError(reason)).toBe(true);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(new Error("other"))).toBe(false);
  });

  it("rejects an otherwise successful fetch after its signal was cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve(response({ items: [], nextCursor: null }));
    }));
    await expect(listProjects({}, controller.signal)).rejects.toBe(controller.signal.reason);
  });

  it("rejects cancellation during body parsing", async () => {
    const controller = new AbortController();
    const json = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ items: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ headers: new Headers({ "Content-Type": "application/json" }), status: 200, json }));
    const error: unknown = await listProjects({}, controller.signal).catch((failure: unknown) => failure);
    expect(error).toBe(controller.signal.reason);
  });
});
