import { useCallback, useEffect, useSyncExternalStore } from "react";
import { canApprove, useTaskDetailSessions } from "./TaskDetailSession";

export const useTaskDetail = (projectId: string, taskId: string, revision: number) => {
  const sessions = useTaskDetailSessions();
  const subscribe = useCallback((listener: () => void) => sessions.subscribe(projectId, taskId, listener), [sessions, projectId, taskId]);
  const snapshot = useCallback(() => sessions.snapshot(projectId, taskId), [sessions, projectId, taskId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    sessions.load(projectId, taskId, revision);
    return () => { sessions.releaseRead(projectId, taskId); };
  }, [sessions, projectId, taskId, revision]);
  const retry = useCallback(() => { sessions.load(projectId, taskId, revision); }, [sessions, projectId, taskId, revision]);
  const approve = useCallback(() => { sessions.approve(projectId, taskId); }, [sessions, projectId, taskId]);
  const reconcile = useCallback(() => { sessions.reconcile(projectId, taskId); }, [sessions, projectId, taskId]);
  const visible = state.revision === revision || state.approval.phase !== "idle" ? state : { ...state, detail: null, status: "loading" as const, error: null };
  return { ...visible, retry, approve, reconcile, canApprove: canApprove(visible) };
};
