import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getTaskGraph, isAbortError } from "../../api/client";
import type { TaskGraph } from "../../api/types";
import { buildGraphIndex, type GraphIndex } from "../task-graph/model";

export type GraphSnapshot = {
  readonly graph: TaskGraph;
  readonly index: GraphIndex;
  readonly observedAt: string;
  readonly receivedMonotonic: number;
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
  const cached = useRef<{ projectId: string; serializedProject: string; serializedTasks: string; snapshot: GraphSnapshot } | null>(null);
  const request = useCallback(async (automatic = false) => {
    if (automatic && active.current !== null) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const revision = ++generation.current;
    setState((previous) => {
      const snapshot = previous.projectId === projectId ? previous.snapshot : null;
      const error = previous.projectId === projectId && (automatic || snapshot !== null) ? previous.error : null;
      return { projectId, snapshot, status: snapshot !== null ? "ready" : error === null ? "loading" : "error", refreshing: snapshot !== null && !automatic, error };
    });
    try {
      const graph = await getTaskGraph(projectId, controller.signal);
      const receivedMonotonic = performance.now();
      if (controller.signal.aborted || revision !== generation.current) return;
      const serializedProject = JSON.stringify({ ...graph.project, settings: {
        ...graph.project.settings, version: graph.project.settings.version.toString(),
      } });
      // Project settings and clock samples do not change task projections or geometry.
      const serializedTasks = JSON.stringify({ summary: graph.summary, tasks: graph.tasks });
      const previous = cached.current;
      const sameProject = previous?.projectId === projectId;
      const sameTasks = sameProject && previous.serializedTasks === serializedTasks;
      const sameContent = sameTasks && previous.serializedProject === serializedProject;
      const stableGraph = sameContent ? previous.snapshot.graph : sameTasks ? {
        ...graph, tasks: previous.snapshot.graph.tasks, summary: previous.snapshot.graph.summary,
      } : graph;
      const snapshot = {
        graph: stableGraph,
        index: sameTasks ? previous.snapshot.index : buildGraphIndex(graph),
        observedAt: graph.observedAt,
        receivedMonotonic,
        receivedAt: Date.now(), revision,
      };
      cached.current = { projectId, serializedProject, serializedTasks, snapshot };
      setState({ projectId, snapshot, status: "ready", refreshing: false, error: null });
    } catch (error) {
      if (controller.signal.aborted || revision !== generation.current || isAbortError(error)) return;
      const missing = error instanceof ApiError && error.status === 404;
      if (missing) cached.current = null;
      setState((previous) => {
        const snapshot = missing ? null : previous.projectId === projectId ? previous.snapshot : null;
        return { projectId, snapshot, status: snapshot === null ? "error" : "ready", refreshing: false, error };
      });
    } finally {
      if (revision === generation.current) active.current = null;
    }
  }, [projectId]);

  useEffect(() => {
    void request();
    let timer: ReturnType<typeof setInterval> | null = null;
    const pause = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const resume = () => {
      pause();
      if (document.visibilityState === "hidden") return;
      timer = setInterval(() => { void request(true); }, 5_000);
    };
    const onVisibilityChange = () => {
      resume();
      if (document.visibilityState !== "hidden") void request(true);
    };
    resume();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ++generation.current;
      active.current?.abort();
      active.current = null;
      cached.current = null;
    };
  }, [request]);

  const refresh = useCallback(() => { void request(); }, [request]);
  const visible = state.projectId === projectId ? state : initialState(projectId);
  return { snapshot: visible.snapshot, status: visible.status, refreshing: visible.refreshing, error: visible.error, refresh };
};
