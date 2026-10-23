import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getTaskGraph, listProjects } from "../../src/api/client";
import type { GraphTask, ProjectPage, TaskGraph } from "../../src/api/types";
import { App } from "../../src/app/App";
import { getFormats } from "../../src/i18n/formats";
import { en } from "../../src/i18n/messages/en";
import { zhCN } from "../../src/i18n/messages/zh-CN";
import { renderWithLocale } from "../helpers/renderWithLocale";

vi.mock("../../src/api/client", async (original) => ({
  ...await original<typeof import("../../src/api/client")>(), getTaskGraph: vi.fn(), listProjects: vi.fn(),
}));
vi.mock("../../src/features/task-graph/RootList", () => ({ RootList: () => null }));
vi.mock("../../src/features/task-detail/TaskDetailDialog", () => ({ TaskDetailDialog: ({ taskId, onRefreshGraph }: {
  taskId: string; onRefreshGraph: () => void;
}) => <aside aria-label="Task test shell"><p>{taskId}</p><button onClick={onRefreshGraph}>Refresh test graph</button></aside> }));

const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const date = "2026-10-20T12:34:56Z";
const project = { settings: { version: 1n, executionWarningMinutes: 60 }, id: projectId, name: "Project 用户数据", repoUrl: "https://example.com/repo", createdAt: date, updatedAt: date };
const tasks: readonly GraphTask[] = [{ allowAgents: false, startedAt: null, completedAt: null, id: taskId, titlePreview: "Task 用户数据", titleTruncated: false, status: "todo", dependsOn: [], blockedBy: [], ready: true, createdAt: date, updatedAt: date }];
const graph = (items = tasks): TaskGraph => ({ observedAt: "2026-10-20T12:00:00Z",
  project, tasks: items,
  summary: { total: items.length, proposed: items.filter((task) => task.status === "proposed").length,
    todo: items.filter((task) => task.status === "todo").length, done: items.filter((task) => task.status === "done").length,
    inProgress: items.filter((task) => task.status === "in_progress").length, ready: items.filter((task) => task.ready).length,
    blocked: items.filter((task) => task.status === "todo" && !task.ready).length },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const graphRequest = vi.mocked(getTaskGraph);
const projectRequest = vi.mocked(listProjects);

beforeEach(() => {
  graphRequest.mockReset();
  projectRequest.mockReset();
  graphRequest.mockResolvedValue(graph());
  projectRequest.mockResolvedValue({ items: [project], nextCursor: null });
});

describe("workspace localization", () => {
  it("retranslates proposed statistics and standalone rows without changing their identity or refetching", async () => {
    window.history.replaceState(null, "", `/projects/${projectId}`);
    graphRequest.mockResolvedValueOnce(graph([{ ...tasks[0]!, status: "proposed", ready: false }]));
    const user = userEvent.setup();
    renderWithLocale(<App />, { locale: "en" });
    await screen.findByRole("heading", { name: project.name });
    const statistics = screen.getByRole("region", { name: "Project task statistics" });
    expect(statistics.querySelectorAll(".stat")).toHaveLength(7);
    const proposed = statistics.querySelector(".stat.proposed")!;
    expect(proposed).toHaveTextContent("Proposed1Awaiting approval");
    await user.click(screen.getByRole("tab", { name: "Standalone tasks" }));
    const row = screen.getByRole("button", { name: /Task 用户数据/ });
    expect(row).toHaveTextContent("Proposed");
    expect(row).not.toHaveTextContent("Ready");
    await user.selectOptions(screen.getByRole("combobox"), "zh-CN");
    expect(screen.getByRole("region", { name: "项目任务统计" })).toBe(statistics);
    expect(proposed).toHaveTextContent("待审批1等待批准");
    expect(screen.getByRole("button", { name: /Task 用户数据/ })).toBe(row);
    expect(row).toHaveTextContent("待审批");
    expect(row).not.toHaveTextContent("可开始");
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it("translates a pending project request without restarting it and updates route titles without moving selector focus", async () => {
    const pending = deferred<ProjectPage>();
    projectRequest.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderWithLocale(<App />, { locale: "en" });
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Projects · Daynight");
    expect(screen.getByRole("status", { name: "Loading projects" })).toBeVisible();
    const signal = projectRequest.mock.calls[0]![1];
    const selector = screen.getByRole("combobox", { name: "语言 / Language" });
    await user.selectOptions(selector, "zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe("项目 · Daynight");
    expect(selector).toHaveFocus();
    expect(screen.getByRole("status", { name: "正在加载项目" })).toBeVisible();
    expect(projectRequest).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve({ items: [project], nextCursor: null }));
    expect(screen.getByText(`创建于 ${getFormats("zh-CN").date(date)}`)).toBeVisible();
    const card = screen.getByRole("heading", { name: project.name }).closest("a")!;
    await user.click(card);
    await screen.findByRole("heading", { name: project.name });
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
    expect(document.title).toBe("项目任务 · Daynight");
    expect(screen.getByRole("main")).toHaveFocus();
    await user.selectOptions(selector, "en");
    expect(selector).toHaveFocus();
    expect(document.title).toBe("Project tasks · Daynight");
    expect(document.documentElement.lang).toBe("en");
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
    expect(graphRequest).toHaveBeenCalledTimes(1);
    expect(projectRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: project.name })).toBeVisible();
  });

  it.each([
    [new ApiError("network", null, "network", "network-id"), "Project could not be loaded", "无法连接服务，请检查本地服务后重试。"],
    [new ApiError("protocol", 200, "protocol", "protocol-id"), "Task graph data is incomplete", "任务图数据不完整或不一致，请重试。"],
    [new ApiError("server", 404, "not_found", "missing-id"), "Project not found", "这个项目不存在，请返回项目列表。"],
    [new ApiError("server", 409, "graph_limit_exceeded", "limit-id", { nodeCount: 1001, edgeCount: 5100, maxNodes: 1000, maxEdges: 5000 }), "Task graph exceeds the display limit", "完整任务图超过当前支持的展示规模。"],
  ] as const)("retranslates an existing %s error and retains its request ID without retrying", async (error, title, detail) => {
    graphRequest.mockRejectedValueOnce(error);
    window.history.replaceState(null, "", `/projects/${projectId}`);
    const user = userEvent.setup();
    renderWithLocale(<App />, { locale: "en" });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: title })).toBeVisible();
    const requestId = screen.getByText(error.requestId!);
    await user.selectOptions(screen.getByRole("combobox"), "zh-CN");
    expect(screen.getByRole("alert")).toBe(alert);
    expect(within(alert).getByText(detail)).toBeVisible();
    expect(screen.getByText(error.requestId!)).toBe(requestId);
    expect(graphRequest).toHaveBeenCalledTimes(1);
    if (error.graphLimit !== undefined) expect(alert).toHaveTextContent("当前 1,001 个任务、5,100 条依赖；支持最多 1,000 个任务、5,000 条依赖。");
  });

  it("retains task tabs, filters, rows and scroll state, and retranslates a semantic removed-task notice", async () => {
    window.history.replaceState(null, "", `/projects/${projectId}`);
    graphRequest.mockResolvedValueOnce(graph()).mockResolvedValueOnce(graph([]));
    const user = userEvent.setup();
    renderWithLocale(<App />, { locale: "en" });
    await screen.findByRole("heading", { name: project.name });
    await user.click(screen.getByRole("tab", { name: "Standalone tasks" }));
    const standaloneTab = screen.getByRole("tab", { name: "Standalone tasks" });
    const filter = screen.getByRole("checkbox", { name: "Show completed standalone tasks (0)" });
    await user.click(filter);
    const row = screen.getByRole("button", { name: /Task 用户数据/ });
    const scroll = vi.spyOn(window, "scrollTo");
    scroll.mockClear();
    const selector = screen.getByRole("combobox");
    await user.selectOptions(selector, "zh-CN");
    expect(screen.getByRole("tab", { name: "独立任务" })).toBe(standaloneTab);
    expect(standaloneTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: "显示已完成独立任务（0）" })).toBe(filter);
    expect(filter).toBeChecked();
    expect(screen.getByRole("button", { name: /Task 用户数据/ })).toBe(row);
    expect(graphRequest).toHaveBeenCalledTimes(1);
    expect(scroll).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(`daynight:task-view:${projectId}`)).toBe('"standalone"');
    expect(window.localStorage.getItem(`daynight:completed-standalone-tasks:${projectId}`)).toBe("true");
    await user.click(row);
    expect(screen.getByRole("complementary", { name: "Task test shell" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh test graph" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Task test shell" })).toBeNull());
    const notice = screen.getByText(zhCN.workspace.project.selectedTaskRemoved);
    expect(notice).toHaveAttribute("role", "status");
    await user.selectOptions(selector, "en");
    expect(screen.getByText(en.workspace.project.selectedTaskRemoved)).toBe(notice);
    expect(graphRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "No tasks yet" })).toBeVisible();
  });

  it("translates a saved project preference problem at display time and leaves its stored value untouched", async () => {
    window.history.replaceState(null, "", `/projects/${projectId}`);
    const key = `daynight:task-view:${projectId}`;
    window.localStorage.setItem(key, '"unknown"');
    const user = userEvent.setup();
    renderWithLocale(<App />, { locale: "en" });
    await screen.findByRole("heading", { name: project.name });
    const notice = screen.getByText(en.workspace.preferences.tab.invalid);
    await user.selectOptions(screen.getByRole("combobox"), "zh-CN");
    expect(screen.getByText(zhCN.workspace.preferences.tab.invalid)).toBe(notice);
    expect(window.localStorage.getItem(key)).toBe('"unknown"');
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it("updates 404 navigation and title in place with no resource request", async () => {
    window.history.replaceState(null, "", "/missing");
    renderWithLocale(<App />, { locale: "en" });
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    const selector = screen.getByRole("combobox");
    selector.focus();
    fireEvent.change(selector, { target: { value: "zh-CN" } });
    expect(selector).toHaveFocus();
    expect(document.title).toBe("页面不存在 · Daynight");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByRole("link", { name: "返回项目列表" })).toHaveAttribute("href", "/");
    expect(projectRequest).not.toHaveBeenCalled();
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("uses complete standalone count sentences for %i tasks in both languages", (count) => {
    expect(en.workspace.standalone.summary({ visible: count, total: count })).toBe(`Newest first · ${count} / ${count} standalone ${count === 1 ? "task" : "tasks"}`);
    expect(en.workspace.standalone.hiddenCompleted({ count })).toBe(`${count} completed standalone ${count === 1 ? "task is" : "tasks are"} hidden. Project statistics still include all tasks.`);
    expect(zhCN.workspace.standalone.summary({ visible: count, total: count })).toBe(`最新创建在前 · ${count} / ${count} 个独立任务`);
  });
});
