import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getTaskGraph, isAbortError } from "../../api/client";
import type { TaskGraph } from "../../api/types";
import { buildGraphIndex, type GraphIndex } from "../task-graph/model";

export type GraphSnapshot = {
  readonly graph: TaskGraph;
  readonly index: GraphIndex;
  readonly receivedAt: number;
  readonly revision: number;
};

type GraphState = {
  readonly projectId: string;
  readonly snapshot: GraphSnapshot | null;
  readonly status: "loading" | "ready" | "error";
  readonly refreshing: boolean;
  readonly error: unknown;
};

const initialState = (projectId: string): GraphState => ({
  projectId, snapshot: null, status: "loading", refreshing: false, error: null,
});

export const useTaskGraph = (projectId: string) => {
  const [state, setState] = useState<GraphState>(() => initialState(projectId));
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const request = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const revision = ++generation.current;
    setState((previous) => {
      const snapshot = previous.projectId === projectId ? previous.snapshot : null;
      return { projectId, snapshot, status: snapshot === null ? "loading" : "ready", refreshing: snapshot !== null, error: null };
    });
    try {
      const graph = await getTaskGraph(projectId, controller.signal);
      if (controller.signal.aborted || revision !== generation.current) return;
      const index = buildGraphIndex(graph);
      setState({ projectId, snapshot: { graph, index, receivedAt: Date.now(), revision }, status: "ready", refreshing: false, error: null });
    } catch (error) {
      if (controller.signal.aborted || revision !== generation.current || isAbortError(error)) return;
      setState((previous) => {
        const snapshot = error instanceof ApiError && error.status === 404 ? null : previous.projectId === projectId ? previous.snapshot : null;
        return { projectId, snapshot, status: snapshot === null ? "error" : "ready", refreshing: false, error };
      });
    } finally {
      if (revision === generation.current) active.current = null;
    }
  }, [projectId]);

  useEffect(() => {
    void request();
    return () => {
      ++generation.current;
      active.current?.abort();
      active.current = null;
    };
  }, [request]);

  const refresh = useCallback(() => { void request(); }, [request]);
  const visible = state.projectId === projectId ? state : initialState(projectId);
  return { snapshot: visible.snapshot, status: visible.status, refreshing: visible.refreshing, error: visible.error, refresh };
};
