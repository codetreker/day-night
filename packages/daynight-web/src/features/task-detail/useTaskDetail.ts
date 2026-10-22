import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getTask, isAbortError } from "../../api/client";
import type { TaskDetail } from "../../api/types";

type DetailState = {
  readonly projectId: string;
  readonly taskId: string;
  readonly detail: TaskDetail | null;
  readonly status: "loading" | "ready" | "error";
  readonly error: unknown;
};

const initialState = (projectId: string, taskId: string): DetailState => ({
  projectId, taskId, detail: null, status: "loading", error: null,
});

const preserveCollection = (previous: TaskDetail | null, detail: TaskDetail): TaskDetail => {
  if (previous === null) return detail;
  const old = previous.properties.pullRequests;
  const fresh = detail.properties.pullRequests;
  const unchanged = old.length === fresh.length && old.every((item, index) => item.url === fresh[index]!.url && item.title === fresh[index]!.title);
  return unchanged ? { ...detail, properties: { ...detail.properties, pullRequests: old } } : detail;
};

export const useTaskDetail = (projectId: string, taskId: string, revision: number) => {
  const [state, setState] = useState<DetailState>(() => initialState(projectId, taskId));
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const queued = useRef(false);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const observedRevision = useRef(revision);
  const request = useCallback(async (automatic = false): Promise<void> => {
    if (automatic && document.visibilityState === "hidden") return;
    if (automatic && active.current !== null) {
      queued.current = true;
      return;
    }
    queued.current = false;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const sequence = ++generation.current;
    setState((previous) => {
      const detail = previous.projectId === projectId && previous.taskId === taskId ? previous.detail : null;
      const error = previous.projectId === projectId && previous.taskId === taskId && (automatic || detail !== null) ? previous.error : null;
      return { projectId, taskId, detail, status: detail !== null ? "ready" : error === null ? "loading" : "error", error };
    });
    try {
      const detail = await getTask(projectId, taskId, controller.signal);
      if (controller.signal.aborted || sequence !== generation.current) return;
      setState((previous) => ({ projectId, taskId, detail: preserveCollection(previous.detail, detail), status: "ready", error: null }));
    } catch (error) {
      if (controller.signal.aborted || sequence !== generation.current || isAbortError(error)) return;
      setState((previous) => {
        const detail = error instanceof ApiError && error.status === 404 ? null : previous.detail;
        return { projectId, taskId, detail, status: detail === null ? "error" : "ready", error };
      });
    } finally {
      if (sequence === generation.current) {
        active.current = null;
        if (queued.current && document.visibilityState !== "hidden") void request(true);
      }
    }
  }, [projectId, taskId]);

  useEffect(() => {
    observedRevision.current = latestRevision.current;
    void request();
    return () => {
      ++generation.current;
      queued.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, [projectId, taskId, request]);

  useEffect(() => {
    if (observedRevision.current === revision) return;
    observedRevision.current = revision;
    void request(true);
  }, [projectId, taskId, revision, request]);

  const retry = useCallback(() => { void request(); }, [request]);
  const visible = state.projectId === projectId && state.taskId === taskId
    ? state : initialState(projectId, taskId);
  return { detail: visible.detail, status: visible.status, error: visible.error, retry };
};
