import type { TaskStatus, ExecutionPlatform, GraphTask } from "../../api/types";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { canSetStatus, canSetAgentPermission, canSetRequiredPlatform, useTaskDetailSessions, type TaskDetailSessions } from "./TaskDetailSession";

export const useTaskDetail = (projectId: string, taskId: string, revision: number, observedTask: GraphTask | undefined) => {
  const sessions = useTaskDetailSessions();
  const opened = useRef<{ readonly sessions: TaskDetailSessions; readonly projectId: string; readonly taskId: string; readonly revision: number } | null>(null);
  const sameIdentity = opened.current?.sessions === sessions && opened.current.projectId === projectId && opened.current.taskId === taskId;
  const subscribe = useCallback((listener: () => void) => sessions.subscribe(projectId, taskId, listener), [sessions, projectId, taskId]);
  const snapshot = useCallback(() => sessions.snapshot(projectId, taskId), [sessions, projectId, taskId]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const blockedRead = state.mutation.phase === "pending" || state.mutation.phase === "unknown" || state.mutation.reconciling;
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
    const mutation = sessions.snapshot(projectId, taskId).mutation;
    if (mutation.phase === "unknown" || mutation.reconciliationError !== null) sessions.reconcile(projectId, taskId);
    else sessions.load(projectId, taskId, revision, "refresh");
  }, [sessions, projectId, taskId, revision]);
  const setStatus = useCallback((status: TaskStatus, version: bigint) => { sessions.setStatus(projectId, taskId, status, version); }, [sessions, projectId, taskId]);
  const setAgentPermission = useCallback((allowAgents: boolean, version: bigint) => { sessions.setAgentPermission(projectId, taskId, allowAgents, version); }, [sessions, projectId, taskId]);
  const setRequiredPlatform = useCallback((requiredPlatform: ExecutionPlatform | null, version: bigint) => { sessions.setRequiredPlatform(projectId, taskId, requiredPlatform, version); }, [sessions, projectId, taskId]);
  const reconcile = useCallback(() => { sessions.reconcile(projectId, taskId); }, [sessions, projectId, taskId]);
  const visible = sameIdentity || state.mutation.phase !== "idle" ? state
    : { ...state, detail: null, loadedRevision: null, status: "loading" as const, refreshing: false, error: null };
  const requiresFreshRead = sessions.requiresFreshRead(projectId, taskId, observedTask);
  return { ...visible, requiresFreshRead, retry, setStatus, setAgentPermission, setRequiredPlatform, reconcile, canSetRequiredPlatform: canSetRequiredPlatform({ ...visible, requiresFreshRead }), canSetAgentPermission: canSetAgentPermission({ ...visible, requiresFreshRead }), canSetStatus: canSetStatus({ ...visible, requiresFreshRead }) };
};
