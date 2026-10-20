import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getTask, getTaskGraph } from "../src/api/client";
import type { GraphTask, TaskDetail, TaskGraph, TaskStatus } from "../src/api/types";
import { ProjectPage } from "../src/features/projects/ProjectPage";
import type { GraphSnapshot } from "../src/features/projects/useTaskGraph";
import { useTaskDetail } from "../src/features/task-detail/useTaskDetail";
import { projectRoot, type GraphIndex } from "../src/features/task-graph/model";

vi.mock("../src/api/client", async (original) => ({ ...await original<typeof import("../src/api/client")>(), getTask: vi.fn(), getTaskGraph: vi.fn() }));
vi.mock("../src/features/task-graph/RootList", () => ({ RootList: ({ index, expandedRootId, onExpand, onSelectTask }: {
  index: GraphIndex; expandedRootId: string | null; onExpand: (id: string | null) => void; onSelectTask: (id: string, trigger: HTMLElement) => void;
}) => <div data-testid="root-list">{index.roots.map((root) => <div key={root}>
  <button id={`task-root-${root}`} onClick={() => onExpand(expandedRootId === root ? null : root)}>{index.nodes.get(root)!.titlePreview}</button>
  {expandedRootId === root && <div data-testid={`chain-${root}`}>{[...projectRoot(index, root).mainIds].map((id) => <button key={id} onClick={(event) => onSelectTask(id, event.currentTarget)}>节点 {index.nodes.get(id)!.titlePreview}</button>)}</div>}
</div>)}</div> }));
vi.mock("../src/features/task-detail/TaskDrawer", () => ({ TaskDrawer: ({ projectId, taskId, snapshot, onSelectTask, onClose, onRestoreFocus, onRefreshGraph }: {
  projectId: string; taskId: string; snapshot: GraphSnapshot; onSelectTask: (id: string) => void; onClose: () => void; onRestoreFocus: () => void; onRefreshGraph: () => void;
}) => {
  const state = useTaskDetail(projectId, taskId, snapshot.revision);
  useEffect(() => () => onRestoreFocus(), [onRestoreFocus]);
  return <aside aria-label="详情测试外壳"><p data-testid="selected-task">{taskId}</p><p data-testid="detail-state">{state.status}</p><p>{state.detail?.title}</p><p data-testid="detail-business-status">{state.detail?.status}</p>
    <button onClick={() => onSelectTask(C)}>关系跳转</button><button onClick={() => onSelectTask(X)}>未知关系</button>
    <button onClick={onRefreshGraph}>刷新全图</button><button onClick={onClose}>关闭详情</button></aside>;
} }));

const projectId = "10000000-0000-0000-0000-000000000001";
const otherProject = "10000000-0000-0000-0000-000000000002";
const A = "20000000-0000-0000-0000-000000000001";
const B = "20000000-0000-0000-0000-000000000002";
const C = "20000000-0000-0000-0000-000000000003";
const D = "20000000-0000-0000-0000-000000000004";
const X = "20000000-0000-0000-0000-000000000009";
const time = "2026-10-20T12:00:00.123456Z";
type Seed = { id: string; title: string; status: TaskStatus; dependsOn: readonly string[] };
const seeds: readonly Seed[] = [
  { id: A, title: "已完成根", status: "done", dependsOn: [] }, { id: B, title: "后续任务", status: "todo", dependsOn: [A] },
  { id: C, title: "独立根", status: "todo", dependsOn: [] }, { id: D, title: "阻塞任务", status: "todo", dependsOn: [B] },
];
const graph = (items = seeds, id = projectId): TaskGraph => {
  const tasks: GraphTask[] = items.map((seed) => {
    const blockedBy = seed.dependsOn.filter((id) => items.find((item) => item.id === id)?.status !== "done");
    return { id: seed.id, titlePreview: seed.title, titleTruncated: false, status: seed.status, dependsOn: seed.dependsOn, blockedBy,
      ready: seed.status === "todo" && blockedBy.length === 0, createdAt: time, updatedAt: time };
  });
  return {
    project: { id, name: id === projectId ? "核心项目" : "另一个项目", repoUrl: "git@github.com:example/project.git", createdAt: time, updatedAt: time }, tasks,
    summary: { total: tasks.length, todo: tasks.filter((task) => task.status === "todo").length,
      done: tasks.filter((task) => task.status === "done").length, inProgress: tasks.filter((task) => task.status === "in_progress").length,
      ready: tasks.filter((task) => task.ready).length, blocked: tasks.filter((task) => task.status === "todo" && !task.ready).length },
  };
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const graphRequest = vi.mocked(getTaskGraph);
const detailRequest = vi.mocked(getTask);
const number = (label: string) => screen.getByText(label, { selector: ".stat-label" }).parentElement?.querySelector(".stat-number")?.textContent;

beforeEach(() => {
  graphRequest.mockReset(); detailRequest.mockReset();
  detailRequest.mockImplementation(async (project, id): Promise<TaskDetail> => ({
    id, projectId: project, title: `详情 ${id}`, description: "文本", status: "todo", dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time,
  }));
});

describe("project dashboard", () => {
  it("loads a complete graph into six accurate unique-task statistics and expands the first root", async () => {
    const pending = deferred<TaskGraph>();
    graphRequest.mockReturnValueOnce(pending.promise);
    render(<ProjectPage projectId={projectId} />);
    expect(screen.getByRole("status", { name: "正在加载任务图" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "项目任务统计" })).toBeNull();
    await act(async () => { pending.resolve(graph()); });
    expect(screen.getByRole("heading", { name: "核心项目" })).toBeTruthy();
    expect(["任务总数", "已完成", "待处理", "进行中", "可开始", "被阻塞"].map(number)).toEqual(["4", "1", "3", "0", "2", "1"]);
    expect(screen.getByText("完成比例 25%")).toBeTruthy();
    expect(screen.getAllByText("待处理的子集")).toHaveLength(2);
    expect(screen.getByTestId(`chain-${A}`)).toBeTruthy();
    expect(screen.queryByTestId(`chain-${C}`)).toBeNull();
    expect(screen.getByText("git@github.com:example/project.git")).toBeTruthy();
    expect(screen.getByText(/最近成功刷新/).querySelector("time")?.getAttribute("datetime")).not.toBe(time);
    fireEvent.click(screen.getByRole("button", { name: "独立根" }));
    expect(screen.getByTestId(`chain-${C}`)).toBeTruthy();
    expect(screen.queryByTestId(`chain-${A}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "独立根" }));
    expect(screen.queryByTestId(`chain-${C}`)).toBeNull();
  });

  it("retains the snapshot and receipt time on refresh failure and keeps a valid expanded root", async () => {
    const pending = deferred<TaskGraph>();
    graphRequest.mockResolvedValueOnce(graph()).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(graph());
    render(<ProjectPage projectId={projectId} />);
    await screen.findByRole("heading", { name: "核心项目" });
    fireEvent.click(screen.getByRole("button", { name: "独立根" }));
    const receipt = screen.getByText(/最近成功刷新/).querySelector("time")?.getAttribute("datetime");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(screen.getByRole("button", { name: "正在刷新…" })).toBeDisabled();
    expect(screen.getByText("正在刷新，当前显示上次成功读取的数据。")).toBeTruthy();
    expect(number("任务总数")).toBe("4");
    await act(async () => { pending.reject(new ApiError("server", 500, "internal_error", "refresh-request")); });
    expect((await screen.findByRole("alert")).textContent).toContain("仍显示上次成功读取的数据");
    expect(screen.getByText("refresh-request")).toBeTruthy();
    expect(screen.getByText(/最近成功刷新/).querySelector("time")?.getAttribute("datetime")).toBe(receipt);
    expect(screen.getByTestId(`chain-${C}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByTestId(`chain-${C}`)).toBeTruthy();
  });

  it("selects the new first root after refresh removes the expanded root and closes a vanished detail with focus fallback", async () => {
    graphRequest.mockResolvedValueOnce(graph()).mockResolvedValueOnce(graph([seeds[2]!]));
    render(<ProjectPage projectId={projectId} />);
    const trigger = await screen.findByRole("button", { name: "节点 后续任务" });
    trigger.focus(); fireEvent.click(trigger);
    await screen.findByText(`详情 ${B}`);
    fireEvent.click(screen.getByRole("button", { name: "刷新全图" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(await screen.findByText("所选任务已不在新的任务图中，详情已关闭。")).toBeTruthy();
    expect(screen.getByTestId(`chain-${C}`)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "独立根" }));
    expect(number("任务总数")).toBe("1");
  });

  it("re-reads a retained detail after a new graph revision without using detail responses to patch graph statistics", async () => {
    graphRequest.mockResolvedValueOnce(graph()).mockResolvedValueOnce(graph());
    detailRequest.mockResolvedValue({ id: B, projectId, title: `详情 ${B}`, description: "更新后的详情", status: "done", dependsOn: [A], blockedBy: [], ready: false, createdAt: time, updatedAt: time });
    render(<ProjectPage projectId={projectId} />);
    fireEvent.click(await screen.findByRole("button", { name: "节点 后续任务" }));
    await screen.findByText(`详情 ${B}`);
    expect(detailRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("detail-business-status").textContent).toBe("done");
    expect(number("已完成")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "刷新全图" }));
    await waitFor(() => expect(detailRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("selected-task").textContent).toBe(B);
    expect(number("已完成")).toBe("1");
  });

  it("preserves the original node focus across relation navigation and allows unknown snapshot references", async () => {
    graphRequest.mockResolvedValue(graph());
    render(<ProjectPage projectId={projectId} />);
    const trigger = await screen.findByRole("button", { name: "节点 后续任务" });
    trigger.focus(); fireEvent.click(trigger);
    await screen.findByText(`详情 ${B}`);
    fireEvent.click(screen.getByRole("button", { name: "关系跳转" }));
    await screen.findByText(`详情 ${C}`);
    expect(screen.getByTestId("selected-task").textContent).toBe(C);
    fireEvent.click(screen.getByRole("button", { name: "未知关系" }));
    await screen.findByText(`详情 ${X}`);
    expect(detailRequest.mock.calls.at(-1)?.[1]).toBe(X);
    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("falls back to the page heading when the selected chain disappears into an empty snapshot", async () => {
    graphRequest.mockResolvedValueOnce(graph()).mockResolvedValueOnce(graph([]));
    render(<ProjectPage projectId={projectId} />);
    fireEvent.click(await screen.findByRole("button", { name: "节点 后续任务" }));
    await screen.findByText(`详情 ${B}`);
    fireEvent.click(screen.getByRole("button", { name: "刷新全图" }));
    await screen.findByRole("heading", { name: "还没有任务" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "核心项目" })));
    expect(number("任务总数")).toBe("0");
    expect(screen.queryByTestId("root-list")).toBeNull();
  });

  it("clears project-specific display immediately when the project prop changes", async () => {
    const pending = deferred<TaskGraph>();
    graphRequest.mockResolvedValueOnce(graph()).mockReturnValueOnce(pending.promise);
    const view = render(<ProjectPage projectId={projectId} />);
    await screen.findByRole("heading", { name: "核心项目" });
    view.rerender(<ProjectPage projectId={otherProject} />);
    expect(screen.queryByRole("heading", { name: "核心项目" })).toBeNull();
    expect(screen.queryByRole("region", { name: "项目任务统计" })).toBeNull();
    await act(async () => { pending.resolve(graph(seeds, otherProject)); });
    expect(screen.getByRole("heading", { name: "另一个项目" })).toBeTruthy();
  });

  it("renders an empty project as zero statistics and an explicit empty state", async () => {
    graphRequest.mockResolvedValue(graph([]));
    render(<ProjectPage projectId={projectId} />);
    await screen.findByRole("heading", { name: "还没有任务" });
    expect(["任务总数", "已完成", "待处理", "进行中", "可开始", "被阻塞"].map(number)).toEqual(["0", "0", "0", "0", "0", "0"]);
    expect(screen.getByText("完成比例 0%")).toBeTruthy();
  });

  it.each([
    [new ApiError("server", 404, "not_found", "missing-project"), "项目不存在", "这个项目不存在，请返回项目列表。"],
    [new ApiError("network"), "项目加载失败", "无法连接服务，请检查本地服务后重试。"],
    [new ApiError("protocol", 200), "任务图数据不完整", "任务图数据不完整或不一致，请重试。"],
  ] as const)("shows safe first-load errors without zero-stat fallbacks %#", async (failure, heading, message) => {
    graphRequest.mockRejectedValueOnce(failure).mockResolvedValueOnce(graph());
    render(<ProjectPage projectId={projectId} />);
    expect((await screen.findByRole("alert")).textContent).toContain(heading);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText("任务总数")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "核心项目" });
  });

  it("explains graph limits using actual counts and rejects malformed graph snapshots", async () => {
    graphRequest.mockRejectedValueOnce(new ApiError("server", 409, "graph_limit_exceeded", "large-graph", { nodeCount: 1001, edgeCount: 5100, maxNodes: 1000, maxEdges: 5000 }))
      .mockResolvedValueOnce({ ...graph(), summary: { ...graph().summary, total: 999 } });
    render(<ProjectPage projectId={projectId} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "任务图超过展示上限" })).toBeTruthy();
    expect(alert.textContent).toContain("当前 1001 个任务、5100 条依赖；支持最多 1000 个任务、5000 条依赖。");
    expect(alert.textContent).toContain("large-graph");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "任务图数据不完整" });
    expect(screen.queryByText("任务总数")).toBeNull();
  });

  it("renders untrusted project values as plain text and preserves modified return clicks", async () => {
    graphRequest.mockResolvedValue({ ...graph([]), project: { ...graph().project, name: "<img src=x onerror=alert(1)>", repoUrl: "javascript:alert(1)" } });
    const view = render(<ProjectPage projectId={projectId} />);
    await screen.findByRole("heading", { name: "<img src=x onerror=alert(1)>" });
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: "← 项目" });
    const observe = (event: Event) => { expect(event.defaultPrevented).toBe(false); event.preventDefault(); };
    document.addEventListener("click", observe, { once: true });
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/");
  });
});
