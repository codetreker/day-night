import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ApiError } from "../../api/client";
import { navigate } from "../../app/router";
import { TaskDetailDialog } from "../task-detail/TaskDetailDialog";
import { RootList } from "../task-graph/RootList";
import { GraphDataError } from "../task-graph/model";
import { ProjectTaskTabs } from "./ProjectTaskTabs";
import { StandaloneList } from "./StandaloneList";
import { completedChainPreferenceNotice, projectViewPreferenceNotice, standaloneVisibilityNotice, taskViewPreferenceNotice, taskViewScrollNotice,
  useCompletedChainVisibility, useProjectViewPreferences, useStandaloneVisibility, useTaskView, useTaskViewScroll, type TaskView } from "./useProjectViewPreferences";
import { useTaskGraph } from "./useTaskGraph";
import "../../styles/project.css";

const backToProjects = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate("/");
};

const errorTitle = (error: unknown): string => {
  if (error instanceof ApiError && error.code === "not_found") return "项目不存在";
  if (error instanceof ApiError && error.code === "graph_limit_exceeded") return "任务图超过展示上限";
  if (error instanceof GraphDataError || error instanceof ApiError && error.kind === "protocol") return "任务图数据不完整";
  return "项目加载失败";
};

const ErrorDetail = ({ error }: { readonly error: unknown }) => (
  <>
    <p>{error instanceof ApiError && error.kind === "network"
      ? "无法连接服务，请检查本地服务后重试。"
      : error instanceof GraphDataError || error instanceof ApiError && error.kind === "protocol"
        ? "任务图数据不完整或不一致，请重试。"
        : error instanceof ApiError && error.code === "not_found"
          ? "这个项目不存在，请返回项目列表。"
          : error instanceof ApiError && error.code === "graph_limit_exceeded"
            ? "完整任务图超过当前支持的展示规模。"
            : "暂时无法读取任务图，请重试。"}</p>
    {error instanceof ApiError && error.graphLimit !== undefined && (
      <p>当前 {error.graphLimit.nodeCount} 个任务、{error.graphLimit.edgeCount} 条依赖；支持最多 {error.graphLimit.maxNodes} 个任务、{error.graphLimit.maxEdges} 条依赖。</p>
    )}
    {error instanceof ApiError && error.requestId !== null && (
      <p className="request-id">请求 ID：<code>{error.requestId}</code></p>
    )}
  </>
);

const ProjectView = ({ projectId }: { readonly projectId: string }) => {
  const graph = useTaskGraph(projectId);
  const [selection, setSelection] = useState<{ readonly id: string; readonly revision: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const originalTrigger = useRef<HTMLElement | null>(null);
  const expandedRoot = useRef<string | null>(null);
  const currentView = useRef<TaskView>("chains");
  const snapshot = graph.snapshot;
  const { activeView, onViewChange, issue: tabIssue } = useTaskView(projectId);
  const { savePosition, issue: scrollIssue } = useTaskViewScroll(projectId, activeView, snapshot !== null);
  currentView.current = activeView;
  const { showCompleted, onShowCompletedChange, issue: visibilityIssue } = useCompletedChainVisibility(projectId);
  const { showCompleted: showCompletedStandalone, onShowCompletedChange: onStandaloneVisibilityChange, issue: standaloneIssue } = useStandaloneVisibility(projectId);
  // Database timestamp precision is retained by reversing the server's exact order.
  const categories = useMemo(() => {
    if (snapshot === null) return null;
    const chains = snapshot.index.roots.toReversed().filter((id) => snapshot.index.successors.get(id)!.length > 0);
    const standalone = snapshot.index.roots.toReversed().filter((id) => snapshot.index.successors.get(id)!.length === 0);
    let unfinishedChainTaskCount = 0;
    let unfinishedStandaloneTaskCount = 0;
    for (const task of snapshot.index.nodes.values()) {
      if (task.status === "done") continue;
      if (task.dependsOn.length === 0 && snapshot.index.successors.get(task.id)!.length === 0) unfinishedStandaloneTaskCount++;
      else unfinishedChainTaskCount++;
    }
    return { chains, standalone, unfinishedChainTaskCount, unfinishedStandaloneTaskCount };
  }, [snapshot]);
  const rootIds = useMemo(() => snapshot === null || categories === null ? null : categories.chains.filter((id) => {
    const progress = snapshot.index.rootProgress.get(id)!;
    return showCompleted || progress.status !== "done";
  }), [snapshot, categories, showCompleted]);
  const standaloneIds = useMemo(() => snapshot === null || categories === null ? [] : categories.standalone.filter((id) =>
    showCompletedStandalone || snapshot.index.nodes.get(id)!.status !== "done"), [snapshot, categories, showCompletedStandalone]);
  const { expandedRootId, setExpandedRootId, issue: preferenceIssue } = useProjectViewPreferences(projectId, rootIds);
  expandedRoot.current = expandedRootId;
  const selectedTaskId = selection !== null && snapshot !== null &&
    (selection.revision === snapshot.revision || snapshot.index.nodes.has(selection.id)) ? selection.id : null;

  useEffect(() => {
    if (snapshot === null) return;
    if (selection !== null && selection.revision !== snapshot.revision && !snapshot.index.nodes.has(selection.id)) {
      setSelection(null);
      setNotice("所选任务已不在新的任务图中，详情已关闭。");
    }
  }, [snapshot, selection]);

  const onSelectTask = useCallback((id: string, trigger: HTMLElement) => {
    originalTrigger.current = trigger;
    setNotice(null);
    setSelection({ id, revision: snapshot!.revision });
  }, [snapshot]);
  const onSelectRelation = useCallback((id: string) => {
    setSelection({ id, revision: snapshot!.revision });
  }, [snapshot]);
  const onClose = useCallback(() => { setSelection(null); }, []);
  const restoreFocus = useCallback(() => {
    if (originalTrigger.current?.isConnected) {
      originalTrigger.current.focus();
      return;
    }
    const fullscreenToggle = currentView.current !== "chains" || expandedRoot.current === null ? null : document.getElementById(`task-graph-${expandedRoot.current}`)
      ?.querySelector<HTMLButtonElement>('.task-graph-fullscreen .graph-fullscreen-toggle');
    if (fullscreenToggle != null) {
      fullscreenToggle.focus();
      return;
    }
    const root = currentView.current !== "chains" || expandedRoot.current === null ? null : document.getElementById(`task-root-${expandedRoot.current}`);
    if (root !== null) root.focus();
    else {
      const standalone = currentView.current === "standalone" ? document.querySelector<HTMLButtonElement>(".standalone-row") : null;
      const tab = document.getElementById(`project-task-tab-${currentView.current}`);
      if (standalone !== null) standalone.focus();
      else if (tab !== null) tab.focus();
      else heading.current?.focus();
    }
  }, []);

  const selectView = useCallback((view: TaskView) => {
    if (view === activeView) return;
    savePosition();
    onViewChange(view);
  }, [activeView, savePosition, onViewChange]);

  const summary = snapshot?.graph.summary;
  const completion = summary === undefined || summary.total === 0 ? 0 : Math.round(summary.done * 100 / summary.total);
  return (
    <>
      <div className="project-navigation">
        <a className="back-link" href="/" onClick={backToProjects}>← 项目</a>
        {snapshot !== null && (
          <p className="snapshot-time">最近成功刷新 <time dateTime={new Date(snapshot.receivedAt).toISOString()}>{new Date(snapshot.receivedAt).toLocaleTimeString("zh-CN", { hour12: false })}</time></p>
        )}
      </div>
      <div className="page-heading project-heading">
        <div>
          <p className="eyebrow">项目任务</p>
          <h1 ref={heading} tabIndex={-1}>{snapshot === null ? "项目任务" : snapshot.graph.project.name}</h1>
          {snapshot !== null && <p className="project-repository">{snapshot.graph.project.repoUrl}</p>}
        </div>
        <button className="button" type="button" onClick={graph.refresh} disabled={graph.refreshing}>{graph.refreshing ? "正在刷新…" : "刷新"}</button>
      </div>
      {preferenceIssue !== null && <p className="snapshot-notice" role="status">{projectViewPreferenceNotice(preferenceIssue)}</p>}
      {visibilityIssue !== null && <p className="snapshot-notice" role="status">{completedChainPreferenceNotice(visibilityIssue)}</p>}
      {tabIssue !== null && <p className="snapshot-notice" role="status">{taskViewPreferenceNotice(tabIssue)}</p>}
      {standaloneIssue !== null && <p className="snapshot-notice" role="status">{standaloneVisibilityNotice(standaloneIssue)}</p>}
      {scrollIssue !== null && <p className="snapshot-notice" role="status">{taskViewScrollNotice(scrollIssue)}</p>}
      {graph.status === "loading" && (
        <section className="state-box" role="status" aria-label="正在加载任务图">
          <span className="spinner" aria-hidden="true" /><h2>正在加载任务图</h2><p>正在读取项目任务和依赖关系。</p>
        </section>
      )}
      {graph.status === "error" && (
        <section className="state-box" role="alert">
          <h2>{errorTitle(graph.error)}</h2><ErrorDetail error={graph.error} />
          <button className="button primary" type="button" onClick={graph.refresh}>重试</button>
          <a className="back-link" href="/" onClick={backToProjects}>返回项目列表</a>
        </section>
      )}
      {snapshot !== null && summary !== undefined && (
        <>
          {graph.refreshing && <p className="snapshot-notice" role="status">正在刷新，当前显示上次成功读取的数据。</p>}
          {graph.error !== null && (
            <section className="snapshot-error" role="alert"><h2>刷新失败</h2><p>仍显示上次成功读取的数据。</p><ErrorDetail error={graph.error} />
              <button className="button" type="button" onClick={graph.refresh}>重试刷新</button>
            </section>
          )}
          {notice !== null && <p className="snapshot-notice" role="status">{notice}</p>}
          <section className="stats" aria-label="项目任务统计">
            <div className="stat"><p className="stat-label">任务总数</p><p className="stat-number">{summary.total}</p><p className="stat-foot">按任务 ID 去重</p></div>
            <div className="stat done"><p className="stat-label">已完成</p><p className="stat-number">{summary.done}</p><p className="stat-foot">完成比例 {completion}%</p></div>
            <div className="stat proposed"><p className="stat-label">待审批</p><p className="stat-number">{summary.proposed}</p><p className="stat-foot">等待批准</p></div>
            <div className="stat"><p className="stat-label">待处理</p><p className="stat-number">{summary.todo}</p><p className="stat-foot">等待开始</p></div>
            <div className="stat active"><p className="stat-label">进行中</p><p className="stat-number">{summary.inProgress}</p><p className="stat-foot">正在推进</p></div>
            <div className="stat ready"><p className="stat-label">可开始</p><p className="stat-number">{summary.ready}</p><p className="stat-foot">待处理的子集</p></div>
            <div className="stat blocked"><p className="stat-label">被阻塞</p><p className="stat-number">{summary.blocked}</p><p className="stat-foot">待处理的子集</p></div>
          </section>
          {summary.total === 0 ? (
            <section className="state-box"><h2>还没有任务</h2><p>项目中的任务会显示在这里。创建任务后，点击刷新查看。</p></section>
          ) : (
            <>
              <ProjectTaskTabs activeView={activeView} unfinishedStandaloneTaskCount={categories!.unfinishedStandaloneTaskCount}
                unfinishedChainTaskCount={categories!.unfinishedChainTaskCount} onViewChange={selectView} />
              <div role="tabpanel" id="project-task-panel-chains" aria-labelledby="project-task-tab-chains" hidden={activeView !== "chains"}>
                {activeView === "chains" && <section aria-label="任务依赖链">
                  <RootList index={snapshot.index} rootIds={rootIds!} allRootIds={categories!.chains} expandedRootId={expandedRootId} onExpand={setExpandedRootId} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask}
                    showCompleted={showCompleted} onShowCompletedChange={onShowCompletedChange} />
                </section>}
              </div>
              <div role="tabpanel" id="project-task-panel-standalone" aria-labelledby="project-task-tab-standalone" hidden={activeView !== "standalone"}>
                {activeView === "standalone" && <StandaloneList index={snapshot.index} taskIds={standaloneIds} allTaskIds={categories!.standalone} onSelectTask={onSelectTask}
                  showCompleted={showCompletedStandalone} onShowCompletedChange={onStandaloneVisibilityChange} />}
              </div>
            </>
          )}
          {selectedTaskId !== null && <TaskDetailDialog projectId={projectId} taskId={selectedTaskId} snapshot={snapshot} onSelectTask={onSelectRelation}
            onClose={onClose} onRestoreFocus={restoreFocus} onRefreshGraph={graph.refresh} />}
        </>
      )}
    </>
  );
};

export const ProjectPage = ({ projectId }: { readonly projectId: string }) => <ProjectView key={projectId} projectId={projectId} />;
