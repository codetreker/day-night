import type { ApprovalAction, GraphTask } from "../../api/types";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { canApprove, canUnapprove, useTaskDetailSessions, type TaskDetailSessions } from "./TaskDetailSession";

export const useTaskDetail = (projectId: string, taskId: string, revision: number, observedTask: GraphTask | undefined) => {
  const sessions = useTaskDetailSessions();
  const opened = useRef<{ readonly sessions: TaskDetailSessions; readonly projectId: string; readonly taskId: string; readonly revision: number } | null>(null);
  const sameIdentity = opened.current?.sessions === sessions && opened.current.projectId === projectId && opened.current.taskId === taskId;
  const subscribe = useCallback((listener: () => void) => sessions.subscribe(projectId, taskId, listener), [sessions, projectId, taskId]);
  const snapshot = useCallback(() => sessions.snapshot(projectId, taskId), [sessions, projectId, taskId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const blockedRead = state.approval.phase === "pending" || state.approval.phase === "unknown" || state.approval.reconciling;
  useEffect(() => {
    sessions.observe(projectId, taskId, observedTask);
    const refresh = opened.current?.sessions === sessions && opened.current.projectId === projectId && opened.current.taskId === taskId;
    const requested = opened.current?.revision;
    opened.current = { sessions, projectId, taskId, revision };
    if (!blockedRead && (!refresh || requested !== revision || sessions.snapshot(projectId, taskId).revision !== revision)) {
      sessions.load(projectId, taskId, revision, refresh ? "automatic" : "open");
    }
  }, [sessions, projectId, taskId, revision, observedTask, blockedRead]);
  useEffect(() => () => { sessions.releaseRead(projectId, taskId); }, [sessions, projectId, taskId]);
  const retry = useCallback(() => {
    const approval = sessions.snapshot(projectId, taskId).approval;
    if (approval.phase === "unknown" || approval.reconciliationError !== null) sessions.reconcile(projectId, taskId);
    else sessions.load(projectId, taskId, revision, "refresh");
  }, [sessions, projectId, taskId, revision]);
  const approve = useCallback(() => { sessions.approve(projectId, taskId); }, [sessions, projectId, taskId]);
  const performApproval = useCallback((action: ApprovalAction, version: bigint) => { sessions.performApproval(projectId, taskId, action, version); }, [sessions, projectId, taskId]);
  const reconcile = useCallback(() => { sessions.reconcile(projectId, taskId); }, [sessions, projectId, taskId]);
  const visible = sameIdentity || state.approval.phase !== "idle" ? state
    : { ...state, detail: null, loadedRevision: null, status: "loading" as const, refreshing: false, error: null };
  const requiresFreshRead = sessions.requiresFreshRead(projectId, taskId, observedTask);
  return { ...visible, requiresFreshRead, retry, approve, performApproval, reconcile, canApprove: canApprove({ ...visible, requiresFreshRead }), canUnapprove: canUnapprove({ ...visible, requiresFreshRead }) };
};
