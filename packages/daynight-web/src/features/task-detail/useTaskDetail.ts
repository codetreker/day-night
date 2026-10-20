import { useCallback, useEffect, useRef, useState } from "react";
import { getTask, isAbortError } from "../../api/client";
import type { TaskDetail } from "../../api/types";

type DetailState = {
  readonly projectId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly detail: TaskDetail | null;
  readonly status: "loading" | "ready" | "error";
  readonly error: unknown;
};

const initialState = (projectId: string, taskId: string, revision: number): DetailState => ({
  projectId, taskId, revision, detail: null, status: "loading", error: null,
});

export const useTaskDetail = (projectId: string, taskId: string, revision: number) => {
  const [state, setState] = useState<DetailState>(() => initialState(projectId, taskId, revision));
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const request = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const sequence = ++generation.current;
    setState(initialState(projectId, taskId, revision));
    try {
      const detail = await getTask(projectId, taskId, controller.signal);
      if (controller.signal.aborted || sequence !== generation.current) return;
      setState({ projectId, taskId, revision, detail, status: "ready", error: null });
    } catch (error) {
      if (controller.signal.aborted || sequence !== generation.current || isAbortError(error)) return;
      setState({ projectId, taskId, revision, detail: null, status: "error", error });
    } finally {
      if (sequence === generation.current) active.current = null;
    }
  }, [projectId, taskId, revision]);

  useEffect(() => {
    void request();
    return () => {
      ++generation.current;
      active.current?.abort();
      active.current = null;
    };
  }, [request]);

  const retry = useCallback(() => { void request(); }, [request]);
  const visible = state.projectId === projectId && state.taskId === taskId && state.revision === revision
    ? state : initialState(projectId, taskId, revision);
  return { detail: visible.detail, status: visible.status, error: visible.error, retry };
};
