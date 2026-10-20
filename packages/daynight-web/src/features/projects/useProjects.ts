import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, listProjects } from '../../api/client';
import type { Project } from '../../api/types';

type ProjectsState = {
  items: readonly Project[];
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  loadingMore: boolean;
  moreError: unknown;
};

const initialState: ProjectsState = {
  items: [],
  nextCursor: null,
  status: 'loading',
  error: null,
  loadingMore: false,
  moreError: null,
};

export const useProjects = () => {
  const [state, setState] = useState<ProjectsState>(initialState);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);

  const request = useCallback(async (cursor: string | null, append: boolean) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const currentGeneration = ++generation.current;
    setState((previous) => append
      ? { ...previous, loadingMore: true, moreError: null }
      : { ...initialState });

    try {
      const page = await listProjects(
        cursor === null ? { limit: 50 } : { limit: 50, cursor },
        controller.signal,
      );
      if (controller.signal.aborted || currentGeneration !== generation.current) return;
      setState((previous) => {
        const projects = new Map<string, Project>();
        for (const project of [...(append ? previous.items : []), ...page.items]) {
          if (!projects.has(project.id)) projects.set(project.id, project);
        }
        return {
          items: [...projects.values()],
          nextCursor: page.nextCursor,
          status: 'ready',
          error: null,
          loadingMore: false,
          moreError: null,
        };
      });
    } catch (error) {
      if (controller.signal.aborted || currentGeneration !== generation.current || isAbortError(error)) return;
      setState((previous) => append
        ? { ...previous, loadingMore: false, moreError: error }
        : { ...initialState, status: 'error', error });
    } finally {
      if (currentGeneration === generation.current) active.current = null;
    }
  }, []);

  useEffect(() => {
    void request(null, false);
    return () => {
      ++generation.current;
      active.current?.abort();
      active.current = null;
    };
  }, [request]);

  const refresh = useCallback(() => { void request(null, false); }, [request]);
  const loadMore = useCallback(() => {
    if (state.nextCursor !== null && active.current === null) {
      void request(state.nextCursor, true);
    }
  }, [request, state.nextCursor]);

  return { ...state, refresh, loadMore };
};
