import { describe, expect, it } from 'vitest';
import { parseTaskGraph } from '../src/api/parse';
import { buildGraphIndex, projectRoot } from '../src/features/task-graph/model';
import { browsingProjects, installBrowsingFixture } from './mockups/browsing-fixture';

describe('production task browsing fixture', () => {
  it.each(Object.entries(browsingProjects))('provides a valid four-state snapshot for %s', (_scenario, graph) => {
    const parsed = parseTaskGraph(graph, graph.project.id);
    const index = buildGraphIndex(parsed);
    expect(index.nodes.size).toBe(graph.summary.total);
    expect(graph.tasks.filter((task) => task.status === 'proposed').every((task) => !task.ready)).toBe(true);
  });

  it('matches the mixed prototype counts and all four chain aggregates', () => {
    const graph = browsingProjects.mixed;
    expect(graph.summary).toEqual({ total: 16, proposed: 6, todo: 4, inProgress: 2, done: 4, ready: 3, blocked: 1 });
    const index = buildGraphIndex(graph);
    const chains = index.roots.filter((id) => index.successors.get(id)!.length > 0);
    expect(chains.map((id) => index.rootProgress.get(id)!.status)).toEqual(['proposed', 'todo', 'todo', 'in_progress', 'done']);
    const first = projectRoot(index, chains[0]!);
    expect(first.mainIds.size).toBe(2);
    expect(first.externalIds.size).toBe(1);
    expect(first.completed).toBe(0);
  });

  it('keeps a complete progressive fixture with main and external work beyond the initial overview', () => {
    const graph = browsingProjects.progressive;
    const index = buildGraphIndex(graph);
    const root = graph.tasks.find((task) => task.titlePreview === '渐进展开 · 主链交付起点')!;
    const projection = projectRoot(index, root.id);
    expect(graph.summary).toEqual({ total: 101, proposed: 0, todo: 61, inProgress: 0, done: 40, ready: 1, blocked: 60 });
    expect(projection.mainIds.size).toBe(61);
    expect(projection.externalIds.size).toBe(40);
    expect(projection.edges).toHaveLength(100);
    expect(index.rootProgress.get(root.id)).toEqual({ total: 61, done: 0, status: 'todo' });
  });

  it('serves initial and refresh failures once so production retry can restore the snapshot', async () => {
    const dispose = installBrowsingFixture();
    try {
      const load = async (scenario: 'error' | 'refresh-error') => {
        const graph = browsingProjects[scenario];
        return fetch(`/api/v1/projects/${graph.project.id}/task-graph`);
      };
      expect((await load('error')).status).toBe(500);
      expect(await (await load('error')).json()).toEqual(browsingProjects.error);
      expect((await load('refresh-error')).status).toBe(200);
      expect((await load('refresh-error')).status).toBe(500);
      expect(await (await load('refresh-error')).json()).toEqual(browsingProjects['refresh-error']);
    } finally {
      dispose();
    }
  });

  it('cancels the loading scene when production navigation aborts its request', async () => {
    const dispose = installBrowsingFixture();
    try {
      const controller = new AbortController();
      const pending = fetch(`/api/v1/projects/${browsingProjects.loading.project.id}/task-graph`, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toBe(controller.signal.reason);
    } finally {
      dispose();
    }
  });

  it('keeps the full long title in details while graph nodes receive the bounded preview', async () => {
    const dispose = installBrowsingFixture();
    try {
      const graph = browsingProjects['long-titles'];
      const task = graph.tasks.find((item) => item.titleTruncated)!;
      expect(Array.from(task.titlePreview)).toHaveLength(160);
      const response = await fetch(`/api/v1/projects/${graph.project.id}/tasks/${task.id}`);
      const detail = await response.json() as { title: string };
      expect(detail.title.startsWith(task.titlePreview)).toBe(true);
      expect(Array.from(detail.title).length).toBeGreaterThan(160);
    } finally {
      dispose();
    }
  });
});
