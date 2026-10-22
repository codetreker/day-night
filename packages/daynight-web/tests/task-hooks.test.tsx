import { act, renderHook as renderHookWithoutSession, waitFor, type RenderHookOptions } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphTask, TaskDetail, TaskGraph } from "../src/api/types";
import { ApiError, approveTask, getTask, getTaskGraph } from "../src/api/client";
import { useTaskGraph } from "../src/features/projects/useTaskGraph";
import { useTaskDetail } from "../src/features/task-detail/useTaskDetail";
import { TaskDetailSessionBoundary } from "../src/features/task-detail/TaskDetailSession";
import { isTaskStale } from "../src/features/task-detail/freshness";
import { GraphDataError } from "../src/features/task-graph/model";

const renderHook = <Result, Props,>(render: (props: Props) => Result, options?: RenderHookOptions<Props>) =>
  renderHookWithoutSession(render, { ...options, wrapper: TaskDetailSessionBoundary });

vi.mock("../src/api/client", async (original) => ({ ...await original<typeof import("../src/api/client")>(), approveTask: vi.fn(), getTask: vi.fn(), getTaskGraph: vi.fn() }));
const graphRequest = vi.mocked(getTaskGraph);
const detailRequest = vi.mocked(getTask);
const projectId = "10000000-0000-0000-0000-000000000001";
const otherProject = "10000000-0000-0000-0000-000000000002";
const taskId = "20000000-0000-0000-0000-000000000001";
const otherTask = "20000000-0000-0000-0000-000000000002";
const time = "2026-10-20T12:00:00.123456Z";
const node: GraphTask = { id: taskId, titlePreview: "任务一", titleTruncated: false, status: "todo", dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time };
const detail: TaskDetail = { id: taskId, projectId, title: "任务一", description: "完整描述", properties: { pullRequests: [] }, status: "todo", version: 1n, dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time };
const graph = (id = projectId): TaskGraph => ({
  project: { id, name: `项目 ${id}`, repoUrl: "https://github.com/example/repo", createdAt: time, updatedAt: time },
  tasks: [node], summary: { total: 1, proposed: 0, todo: 1, inProgress: 0, done: 0, ready: 1, blocked: 0 },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
beforeEach(() => { graphRequest.mockReset(); detailRequest.mockReset(); vi.mocked(approveTask).mockReset(); });

describe("task graph snapshots", () => {
  it("publishes graph, validated index, local receipt time and revision atomically", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123456);
    graphRequest.mockResolvedValue(graph());
    const { result } = renderHook(() => useTaskGraph(projectId));
    expect(result.current).toMatchObject({ snapshot: null, status: "loading", refreshing: false, error: null });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.snapshot?.graph).toEqual(graph());
    expect(result.current.snapshot?.index.nodes.get(taskId)).toEqual(node);
    expect(result.current.snapshot?.receivedAt).toBe(123456);
    expect(result.current.snapshot?.revision).toBeGreaterThan(0);
    expect(graphRequest.mock.calls[0]?.[0]).toBe(projectId);
    expect(graphRequest.mock.calls[0]?.[1].aborted).toBe(false);
  });

  it("retains a same-project snapshot through refresh and failure, then replaces it whole on success", async () => {
    const update = deferred<TaskGraph>();
    graphRequest.mockResolvedValueOnce(graph()).mockReturnValueOnce(update.promise).mockResolvedValueOnce({ ...graph(), tasks: [],
      summary: { total: 0, proposed: 0, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 } });
    const { result } = renderHook(() => useTaskGraph(projectId));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current.snapshot;
    act(() => result.current.refresh());
    expect(result.current).toMatchObject({ snapshot: first, status: "ready", refreshing: true, error: null });
    const failure = new Error("private diagnostic");
    await act(async () => { update.reject(failure); });
    expect(result.current).toMatchObject({ snapshot: first, status: "ready", refreshing: false, error: failure });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.snapshot?.graph.tasks).toEqual([]));
    expect(result.current.snapshot?.index.nodes.size).toBe(0);
    expect(result.current.snapshot?.revision).toBeGreaterThan(first!.revision);
    expect(result.current.error).toBeNull();
  });

  it("discards the entire retained graph after an authoritative not-found response", async () => {
    const failure = new ApiError("server", 404, "not_found");
    graphRequest.mockResolvedValueOnce(graph()).mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useTaskGraph(projectId));
    await waitFor(() => expect(result.current.snapshot?.graph).toEqual(graph()));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ snapshot: null, refreshing: false, error: failure });
  });

  it("hides prior project data on the very first render after identity changes", async () => {
    const next = deferred<TaskGraph>();
    graphRequest.mockResolvedValueOnce(graph()).mockReturnValueOnce(next.promise);
    const renders: Array<{ project: string; displayed: string | null; error: unknown }> = [];
    const { result, rerender } = renderHook(({ project }) => {
      const state = useTaskGraph(project);
      renders.push({ project, displayed: state.snapshot?.graph.project.id ?? null, error: state.error });
      return state;
    }, { initialProps: { project: projectId } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ project: otherProject });
    expect(renders.filter((render) => render.project === otherProject).every((render) => render.displayed === null)).toBe(true);
    expect(result.current).toMatchObject({ snapshot: null, status: "loading", error: null });
    await act(async () => { next.resolve(graph(otherProject)); });
    expect(result.current.snapshot?.graph.project.id).toBe(otherProject);
  });

  it("cancels navigation and ignores late success/failure even when the transport ignores abort", async () => {
    const old = deferred<TaskGraph>();
    graphRequest.mockReturnValueOnce(old.promise).mockResolvedValueOnce(graph(otherProject));
    const { result, rerender } = renderHook(({ project }) => useTaskGraph(project), { initialProps: { project: projectId } });
    const oldSignal = graphRequest.mock.calls[0]![1];
    rerender({ project: otherProject });
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.snapshot?.graph.project.id).toBe(otherProject));
    await act(async () => { old.resolve(graph()); });
    expect(result.current.snapshot?.graph.project.id).toBe(otherProject);
    const lateFailure = deferred<TaskGraph>();
    graphRequest.mockReturnValueOnce(lateFailure.promise).mockResolvedValueOnce(graph(otherProject));
    act(() => result.current.refresh());
    const superseded = graphRequest.mock.calls[2]![1];
    act(() => result.current.refresh());
    expect(superseded.aborted).toBe(true);
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    await act(async () => { lateFailure.reject(new Error("late failure")); });
    expect(result.current.error).toBeNull();
  });

  it("rejects invalid graph semantics as a whole and can retry successfully", async () => {
    graphRequest.mockResolvedValueOnce({ ...graph(), summary: { ...graph().summary, total: 9 } }).mockResolvedValueOnce(graph());
    const { result } = renderHook(() => useTaskGraph(projectId));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeInstanceOf(GraphDataError);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeNull();
  });

  it("does not show aborts as errors and cancels outstanding work on unmount", async () => {
    graphRequest.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    const aborted = renderHook(() => useTaskGraph(projectId));
    await act(async () => { await Promise.resolve(); });
    expect(aborted.result.current.error).toBeNull();
    aborted.unmount();
    const late = deferred<TaskGraph>();
    graphRequest.mockReturnValueOnce(late.promise);
    const mounted = renderHook(() => useTaskGraph(projectId));
    const pendingSignal = graphRequest.mock.calls.at(-1)![1];
    mounted.unmount();
    expect(pendingSignal.aborted).toBe(true);
    await act(async () => { late.resolve(graph()); });
  });
});

describe("task details", () => {
  it("loads independently, retries failures locally and never exposes an old detail while retrying", async () => {
    const retry = deferred<TaskDetail>();
    detailRequest.mockRejectedValueOnce(new Error("detail unavailable")).mockReturnValueOnce(retry.promise);
    const { result } = renderHook(() => useTaskDetail(projectId, taskId, 1));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.detail).toBeNull();
    act(() => result.current.retry());
    expect(result.current).toMatchObject({ status: "loading", detail: null, error: null });
    await act(async () => { retry.resolve(detail); });
    expect(result.current).toMatchObject({ status: "ready", detail, error: null });
  });

  it("clears immediately for identity changes and retains loaded details through a same-identity graph refresh", async () => {
    detailRequest.mockImplementation(async (project, task) => ({ ...detail, projectId: project, id: task }));
    const renders: Array<{ key: string; displayed: string | null }> = [];
    const { result, rerender } = renderHook(({ project, task, revision }) => {
      const state = useTaskDetail(project, task, revision);
      renders.push({ key: `${project}/${task}/${revision}`, displayed: state.detail?.id ?? null });
      return state;
    }, { initialProps: { project: projectId, task: taskId, revision: 1 } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    for (const props of [
      { project: projectId, task: otherTask, revision: 1 },
      { project: otherProject, task: otherTask, revision: 1 },
      { project: otherProject, task: otherTask, revision: 2 },
    ]) {
      const first = renders.length;
      rerender(props);
      if (props.revision === 2) {
        expect(renders[first]?.displayed).toBe(props.task);
        expect(result.current.refreshing).toBe(true);
        expect(result.current.loadedRevision).toBe(1);
      } else expect(renders[first]?.displayed).toBeNull();
      await waitFor(() => expect(result.current.loadedRevision).toBe(props.revision));
      expect(result.current.status).toBe("ready");
      expect(result.current.detail?.projectId).toBe(props.project);
      expect(result.current.detail?.id).toBe(props.task);
    }
    expect(detailRequest).toHaveBeenCalledTimes(4);
  });

  it.each([new Error("Background detail read failed"), new DOMException("Background read cancelled", "AbortError")])("retains loaded details and the actual background error until a fresh retry succeeds %#", async (error) => {
    const pending = deferred<TaskDetail>();
    const recovery = deferred<TaskDetail>();
    const proposed = { ...detail, status: "proposed" as const, ready: false };
    const fresh = { ...proposed, version: proposed.version + 1n, title: "Updated task" };
    detailRequest.mockResolvedValueOnce(proposed).mockReturnValueOnce(pending.promise).mockReturnValueOnce(recovery.promise);
    const { result, rerender } = renderHook(({ revision }) => useTaskDetail(projectId, taskId, revision), { initialProps: { revision: 1 } });
    await waitFor(() => expect(result.current.loadedRevision).toBe(1));
    rerender({ revision: 2 });
    expect(result.current.detail).toBe(proposed);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.canApprove).toBe(false);
    await act(async () => { pending.reject(error); });
    expect(result.current).toMatchObject({ detail: proposed, status: "ready", loadedRevision: 1, revision: 2, refreshing: false, error });
    expect(result.current.error).toBe(error);
    expect(result.current.canApprove).toBe(false);
    act(() => result.current.retry());
    expect(result.current.detail).toBe(proposed);
    await act(async () => { recovery.resolve(fresh); });
    expect(result.current).toMatchObject({ detail: fresh, loadedRevision: 2, refreshing: false, error: null, canApprove: true });
  });

  it("performs the deferred background read when approval finishes after the graph revision changes", async () => {
    const mutation = deferred<TaskDetail>();
    const refresh = deferred<TaskDetail>();
    const proposed = { ...detail, status: "proposed" as const, ready: false };
    const approved = { ...detail, version: proposed.version + 1n };
    detailRequest.mockResolvedValueOnce(proposed).mockReturnValueOnce(refresh.promise);
    vi.mocked(approveTask).mockReturnValueOnce(mutation.promise);
    const { result, rerender } = renderHook(({ revision }) => useTaskDetail(projectId, taskId, revision), { initialProps: { revision: 1 } });
    await waitFor(() => expect(result.current.loadedRevision).toBe(1));
    act(() => result.current.approve());
    rerender({ revision: 2 });
    expect(detailRequest).toHaveBeenCalledTimes(1);
    expect(result.current.approval.phase).toBe("pending");
    await act(async () => { mutation.resolve(approved); });
    await waitFor(() => expect(detailRequest).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ detail: approved, refreshing: true, loadedRevision: 1 });
    await act(async () => { refresh.resolve(approved); });
    expect(result.current).toMatchObject({ detail: approved, refreshing: false, loadedRevision: 2, error: null });
  });

  it("aborts superseded details and ignores late values without patching the graph", async () => {
    const late = deferred<TaskDetail>();
    detailRequest.mockReturnValueOnce(late.promise).mockResolvedValueOnce({ ...detail, id: otherTask });
    const { result, rerender } = renderHook(({ task }) => useTaskDetail(projectId, task, 1), { initialProps: { task: taskId } });
    const oldSignal = detailRequest.mock.calls[0]![2];
    rerender({ task: otherTask });
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.detail?.id).toBe(otherTask));
    await act(async () => { late.resolve(detail); });
    expect(result.current.detail?.id).toBe(otherTask);
  });

  it("ignores a cancelled failure and cleans up requests on unmount", async () => {
    const late = deferred<TaskDetail>();
    detailRequest.mockReturnValueOnce(late.promise).mockResolvedValueOnce(detail);
    const { result, rerender, unmount } = renderHook(({ revision }) => useTaskDetail(projectId, taskId, revision), { initialProps: { revision: 1 } });
    rerender({ revision: 2 });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { late.reject(new Error("stale failure")); });
    expect(result.current.error).toBeNull();
    const pending = deferred<TaskDetail>();
    detailRequest.mockReturnValueOnce(pending.promise);
    act(() => result.current.retry());
    const pendingSignal = detailRequest.mock.calls.at(-1)![2];
    unmount();
    expect(pendingSignal.aborted).toBe(true);
    await act(async () => { pending.resolve(detail); });
  });

  it("does not turn an AbortError into a displayed failure", async () => {
    detailRequest.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    const { result } = renderHook(() => useTaskDetail(projectId, taskId, 1));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toBeNull();
    expect(result.current.detail).toBeNull();
  });
});

describe("detail freshness", () => {
  it("accepts the same fields and order-independent dependency sets", () => {
    expect(isTaskStale(node, detail)).toBe(false);
    expect(isTaskStale({ ...node, dependsOn: [taskId, otherTask], blockedBy: [taskId, otherTask] },
      { ...detail, dependsOn: [otherTask, taskId], blockedBy: [otherTask, taskId] })).toBe(false);
  });

  it.each([
    undefined,
    { ...node, id: otherTask }, { ...node, updatedAt: "2026-10-21T12:00:00Z" }, { ...node, status: "done" as const },
    { ...node, ready: false }, { ...node, dependsOn: [otherTask] }, { ...node, blockedBy: [otherTask] },
    { ...node, titlePreview: "另一个标题" }, { ...node, titleTruncated: true },
  ])("detects changed snapshot-derived fields %#", (changed) => {
    expect(isTaskStale(changed, detail)).toBe(true);
  });

  it("detects a dependency completion changing readiness with no task updatedAt change", () => {
    const blocked = { ...node, dependsOn: [otherTask], blockedBy: [otherTask], ready: false };
    const newlyReady = { ...detail, dependsOn: [otherTask], blockedBy: [], ready: true };
    expect(blocked.updatedAt).toBe(newlyReady.updatedAt);
    expect(isTaskStale(blocked, newlyReady)).toBe(true);
  });

  it("compares Unicode code point previews without truncating a surrogate pair", () => {
    const title = "😀".repeat(161);
    expect(isTaskStale({ ...node, titlePreview: "😀".repeat(160), titleTruncated: true }, { ...detail, title })).toBe(false);
  });
});
