import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { canApprove, useTaskDetailSessions, type TaskDetailSessions } from "./TaskDetailSession";

export const useTaskDetail = (projectId: string, taskId: string, revision: number) => {
  const sessions = useTaskDetailSessions();
  const opened = useRef<{ readonly sessions: TaskDetailSessions; readonly projectId: string; readonly taskId: string; readonly revision: number } | null>(null);
  const sameIdentity = opened.current?.sessions === sessions && opened.current.projectId === projectId && opened.current.taskId === taskId;
  const subscribe = useCallback((listener: () => void) => sessions.subscribe(projectId, taskId, listener), [sessions, projectId, taskId]);
  const snapshot = useCallback(() => sessions.snapshot(projectId, taskId), [sessions, projectId, taskId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const blockedRead = state.approval.phase === "pending" || state.approval.phase === "unknown" || state.approval.reconciling;
  useEffect(() => {
    const refresh = opened.current?.sessions === sessions && opened.current.projectId === projectId && opened.current.taskId === taskId;
    const requested = opened.current?.revision;
    opened.current = { sessions, projectId, taskId, revision };
    if (!blockedRead && (!refresh || requested !== revision || sessions.snapshot(projectId, taskId).revision !== revision)) {
      sessions.load(projectId, taskId, revision, refresh ? "refresh" : "open");
    }
    return () => { sessions.releaseRead(projectId, taskId); };
  }, [sessions, projectId, taskId, revision, blockedRead]);
  const retry = useCallback(() => { sessions.load(projectId, taskId, revision, "refresh"); }, [sessions, projectId, taskId, revision]);
  const approve = useCallback(() => { sessions.approve(projectId, taskId); }, [sessions, projectId, taskId]);
  const reconcile = useCallback(() => { sessions.reconcile(projectId, taskId); }, [sessions, projectId, taskId]);
  const visible = sameIdentity || state.approval.phase !== "idle" ? state
    : { ...state, detail: null, loadedRevision: null, status: "loading" as const, refreshing: false, error: null };
  const refreshing = visible.detail !== null && (visible.refreshing || !blockedRead && (!sameIdentity || state.revision !== revision));
  return { ...visible, refreshing, retry, approve, reconcile, canApprove: canApprove({ ...visible, refreshing }) };
};
