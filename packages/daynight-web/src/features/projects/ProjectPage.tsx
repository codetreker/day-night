import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Project } from "../../api/types";
import { ApiError } from "../../api/client";
import { navigate } from "../../app/router";
import { useI18n } from "../../i18n/LocaleProvider";
import type { WorkspaceMessages } from "../../i18n/messages/workspace";
import { TaskDetailSessionBoundary, useTaskDetailSessions } from "../task-detail/TaskDetailSession";
import { TaskDetailDialog } from "../task-detail/TaskDetailDialog";
import { ChainList } from "../task-graph/ChainList";
import { GraphDataError } from "../task-graph/model";
import { ProjectTaskTabs } from "./ProjectTaskTabs";
import { StandaloneList } from "./StandaloneList";
import { useCompletedChainVisibility, useProjectViewPreferences, useStandaloneVisibility, useTaskView, useTaskViewScroll, type TaskView } from "./useProjectViewPreferences";
import { useTaskGraph } from "./useTaskGraph";
import { TaskExecutionClockProvider } from "../task-execution/TaskExecutionClock";
import "../../styles/project.css";

const backToProjects = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate("/");
};

const errorTitle = (error: unknown, m: WorkspaceMessages["project"]): string => {
  if (error instanceof ApiError && error.code === "not_found") return m.notFound;
  if (error instanceof ApiError && error.code === "graph_limit_exceeded") return m.graphLimit;
  if (error instanceof GraphDataError || error instanceof ApiError && error.kind === "protocol") return m.incomplete;
  return m.loadingFailed;
};

const ErrorDetail = ({ error }: { readonly error: unknown }) => {
  const { messages: { workspace: { project: m }, common } } = useI18n();
  return <>
    <p>{error instanceof ApiError && error.kind === "network"
      ? m.networkError
      : error instanceof GraphDataError || error instanceof ApiError && error.kind === "protocol"
        ? m.protocolError
        : error instanceof ApiError && error.code === "not_found"
          ? m.notFoundDetail
          : error instanceof ApiError && error.code === "graph_limit_exceeded"
            ? m.graphLimitDetail
            : m.readError}</p>
    {error instanceof ApiError && error.graphLimit !== undefined && (
      <p>{m.graphLimitCounts({ nodes: error.graphLimit.nodeCount, edges: error.graphLimit.edgeCount,
        maxNodes: error.graphLimit.maxNodes, maxEdges: error.graphLimit.maxEdges })}</p>
    )}
    {error instanceof ApiError && error.requestId !== null && (
      <p className="request-id">{common.requestId}<code>{error.requestId}</code></p>
    )}
  </>;
};

type ProjectNotice = { readonly kind: "selected-task-removed" };

const ProjectView = ({ projectId, renderActions }: { readonly projectId: string; readonly renderActions?: (project: Project) => ReactNode }) => {
  const graph = useTaskGraph(projectId);
  const sessions = useTaskDetailSessions();
  useEffect(() => sessions.subscribeProject(projectId, graph.refresh), [sessions, projectId, graph.refresh]);
  const { messages: { workspace: { project: m, projects, app, preferences }, common }, format } = useI18n();
  const [detailSelection, setDetailSelection] = useState<{ readonly id: string; readonly revision: number } | null>(null);
  const [notice, setNotice] = useState<ProjectNotice | null>(null);
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
    const chains = snapshot.index.representativeIds.toReversed().filter((id) => snapshot.index.components.get(id)!.memberIds.size > 1);
    const standalone = snapshot.index.representativeIds.toReversed().filter((id) => snapshot.index.components.get(id)!.memberIds.size === 1);
    let unfinishedChainTaskCount = 0;
    let unfinishedStandaloneTaskCount = 0;
    for (const task of snapshot.index.nodes.values()) {
      if (task.status === "done") continue;
      if (snapshot.index.components.get(snapshot.index.componentByTask.get(task.id)!)!.memberIds.size === 1) unfinishedStandaloneTaskCount++;
      else unfinishedChainTaskCount++;
    }
    return { chains, standalone, unfinishedChainTaskCount, unfinishedStandaloneTaskCount };
  }, [snapshot]);
  const rootIds = useMemo(() => snapshot === null || categories === null ? null : categories.chains.filter((id) => {
    const progress = snapshot.index.components.get(id)!.progress;
    return showCompleted || progress.status !== "done";
  }), [snapshot, categories, showCompleted]);
  const standaloneIds = useMemo(() => snapshot === null || categories === null ? [] : categories.standalone.filter((id) =>
    showCompletedStandalone || snapshot.index.nodes.get(id)!.status !== "done"), [snapshot, categories, showCompletedStandalone]);
  const { expandedRootId, setExpandedRootId, issue: preferenceIssue } = useProjectViewPreferences(projectId, rootIds, snapshot?.index.componentByTask ?? null);
  expandedRoot.current = expandedRootId;
  const detailTaskId = detailSelection !== null && snapshot !== null &&
    (detailSelection.revision === snapshot.revision || snapshot.index.nodes.has(detailSelection.id)) ? detailSelection.id : null;

  useEffect(() => {
    if (snapshot === null) return;
    if (detailSelection !== null && detailSelection.revision !== snapshot.revision && !snapshot.index.nodes.has(detailSelection.id)) {
      setDetailSelection(null);
      setNotice({ kind: "selected-task-removed" });
    }
  }, [snapshot, detailSelection]);

  const onOpenTask = useCallback((id: string, trigger: HTMLElement) => {
    originalTrigger.current = trigger;
    setNotice(null);
    setDetailSelection({ id, revision: snapshot!.revision });
  }, [snapshot]);
  const onSelectRelation = useCallback((id: string) => {
    setDetailSelection({ id, revision: snapshot!.revision });
  }, [snapshot]);
  const onClose = useCallback(() => { setDetailSelection(null); }, []);
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
        <a className="back-link" href="/" onClick={backToProjects}>{m.back}</a>
        {snapshot !== null && (
          <p className="snapshot-time"><time dateTime={new Date(snapshot.receivedAt).toISOString()}>{m.lastRefreshed({ time: format.time(snapshot.receivedAt) })}</time></p>
        )}
      </div>
      <div className="page-heading project-heading">
        <div>
          <p className="eyebrow">{app.projectTasks}</p>
          <h1 ref={heading} tabIndex={-1}>{snapshot === null ? app.projectTasks : snapshot.graph.project.name}</h1>
          {snapshot !== null && <p className="project-repository">{snapshot.graph.project.repoUrl}</p>}
        </div>
        <div className="project-title-actions">{snapshot !== null && renderActions?.(snapshot.graph.project)}<button className="button" type="button" onClick={graph.refresh} disabled={graph.refreshing}>{graph.refreshing ? m.refreshing : projects.refresh}</button></div>
      </div>
      {preferenceIssue !== null && <p className="snapshot-notice" role="status">{preferences.expanded[preferenceIssue.kind]}</p>}
      {visibilityIssue !== null && <p className="snapshot-notice" role="status">{preferences.completedChains[visibilityIssue.kind]}</p>}
      {tabIssue !== null && <p className="snapshot-notice" role="status">{preferences.tab[tabIssue.kind]}</p>}
      {standaloneIssue !== null && <p className="snapshot-notice" role="status">{preferences.standalone[standaloneIssue.kind]}</p>}
      {scrollIssue !== null && <p className="snapshot-notice" role="status">{preferences.scroll[scrollIssue.kind]}</p>}
      {graph.status === "loading" && (
        <section className="state-box" role="status" aria-label={m.loading}>
          <span className="spinner" aria-hidden="true" /><h2>{m.loading}</h2><p>{m.loadingDetail}</p>
        </section>
      )}
      {graph.status === "error" && (
        <section className="state-box" role="alert">
          <h2>{errorTitle(graph.error, m)}</h2><ErrorDetail error={graph.error} />
          <button className="button primary" type="button" onClick={graph.refresh}>{projects.retry}</button>
          <a className="back-link" href="/" onClick={backToProjects}>{app.returnToProjects}</a>
        </section>
      )}
      {snapshot !== null && summary !== undefined && (
        <>
          {graph.error !== null && (
            <section className="snapshot-error" role="alert"><h2>{m.refreshFailed}</h2><p>{m.showingSnapshot}</p><ErrorDetail error={graph.error} />
              <button className="button" type="button" onClick={graph.refresh}>{m.retryRefresh}</button>
            </section>
          )}
          {notice !== null && <p className="snapshot-notice" role="status">{m.selectedTaskRemoved}</p>}
          <section className="stats" aria-label={m.statistics}>
            <div className="stat"><p className="stat-label">{m.totalTasks}</p><p className="stat-number">{format.number(summary.total)}</p><p className="stat-foot">{m.uniqueTasks}</p></div>
            <div className="stat done"><p className="stat-label">{common.status.done}</p><p className="stat-number">{format.number(summary.done)}</p><p className="stat-foot">{m.completion({ percent: completion })}</p></div>
            <div className="stat proposed"><p className="stat-label">{common.status.proposed}</p><p className="stat-number">{format.number(summary.proposed)}</p><p className="stat-foot">{m.awaitingApproval}</p></div>
            <div className="stat"><p className="stat-label">{common.status.todo}</p><p className="stat-number">{format.number(summary.todo)}</p><p className="stat-foot">{m.waiting}</p></div>
            <div className="stat active"><p className="stat-label">{common.status.in_progress}</p><p className="stat-number">{format.number(summary.inProgress)}</p><p className="stat-foot">{m.advancing}</p></div>
            <div className="stat ready"><p className="stat-label">{m.ready}</p><p className="stat-number">{format.number(summary.ready)}</p><p className="stat-foot">{m.todoSubset}</p></div>
            <div className="stat blocked"><p className="stat-label">{m.blocked}</p><p className="stat-number">{format.number(summary.blocked)}</p><p className="stat-foot">{m.todoSubset}</p></div>
          </section>
          {summary.total === 0 ? (
            <section className="state-box"><h2>{m.empty}</h2><p>{m.emptyDetail}</p></section>
          ) : (
            <TaskExecutionClockProvider projectId={projectId} snapshot={snapshot}>
              <ProjectTaskTabs activeView={activeView} unfinishedStandaloneTaskCount={categories!.unfinishedStandaloneTaskCount}
                unfinishedChainTaskCount={categories!.unfinishedChainTaskCount} onViewChange={selectView} />
              <div role="tabpanel" id="project-task-panel-chains" aria-labelledby="project-task-tab-chains" hidden={activeView !== "chains"}>
                {activeView === "chains" && <section aria-label={m.chains}>
                  <ChainList index={snapshot.index} representativeIds={rootIds!} allRepresentativeIds={categories!.chains} expandedRootId={expandedRootId} onExpand={setExpandedRootId} onOpenTask={onOpenTask}
                    showCompleted={showCompleted} onShowCompletedChange={onShowCompletedChange} />
                </section>}
              </div>
              <div role="tabpanel" id="project-task-panel-standalone" aria-labelledby="project-task-tab-standalone" hidden={activeView !== "standalone"}>
                {activeView === "standalone" && <StandaloneList index={snapshot.index} taskIds={standaloneIds} allTaskIds={categories!.standalone} onSelectTask={onOpenTask}
                  showCompleted={showCompletedStandalone} onShowCompletedChange={onStandaloneVisibilityChange} />}
              </div>
            </TaskExecutionClockProvider>
          )}
          {detailTaskId !== null && <TaskDetailDialog projectId={projectId} taskId={detailTaskId} snapshot={snapshot} onSelectTask={onSelectRelation}
            onClose={onClose} onRestoreFocus={restoreFocus} onRefreshGraph={graph.refresh} />}
        </>
      )}
    </>
  );
};

export const ProjectPage = ({ projectId, renderActions }: { readonly projectId: string; readonly renderActions?: (project: Project) => ReactNode }) => <TaskDetailSessionBoundary><ProjectView key={projectId} projectId={projectId} {...(renderActions === undefined ? {} : { renderActions })} /></TaskDetailSessionBoundary>;
