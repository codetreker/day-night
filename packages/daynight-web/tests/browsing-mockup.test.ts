import { describe, expect, it } from 'vitest';
import { approveTask, getTask, getTaskGraph } from '../src/api/client';
import { parseApiJson } from '../src/api/json';
import { parseTaskGraph } from '../src/api/parse';
import { buildGraphIndex, projectRoot } from '../src/features/task-graph/model';
import { browsingProjects, installBrowsingFixture, isApprovalScenario, type BrowsingScenario } from './mockups/browsing-fixture';

const signal = () => new AbortController().signal;
const version = 9_007_199_254_740_993n;
const taskId = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const approvalProject = (scenario: BrowsingScenario) => browsingProjects[scenario].project.id;

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
      const detail = parseApiJson(await response.text()) as { title: string; version: bigint };
      expect(detail.title.startsWith(task.titlePreview)).toBe(true);
      expect(Array.from(detail.title).length).toBeGreaterThan(160);
      expect(detail.version).toBe(1n);
    } finally {
      dispose();
    }
  });
});

describe('production approval fixture', () => {
  it.each((Object.keys(browsingProjects) as BrowsingScenario[]).filter(isApprovalScenario))('seeds exact int64 versions and versionless graphs for %s', async (scenario) => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject(scenario);
      const graph = await getTaskGraph(project, signal());
      expect(graph.summary).toEqual({ total: 3, proposed: 3, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 });
      expect(graph.tasks.every((task) => !('version' in task))).toBe(true);
      expect((await getTask(project, taskId(1), signal())).version).toBe(version);
    } finally { dispose(); }
  });

  it.each([
    ['approval-ready', 1, true, 1, 0],
    ['approval-blocked', 2, false, 0, 1],
  ] as const)('approves %s with accurate todo/ready/blocked projection', async (scenario, number, ready, readyCount, blocked) => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject(scenario);
      const approved = await approveTask(project, taskId(number), version, signal());
      expect(approved).toMatchObject({ status: 'todo', version: version + 1n, ready });
      expect(approved.blockedBy).toEqual(ready ? [] : [taskId(1)]);
      const graph = await getTaskGraph(project, signal());
      expect(graph.summary).toMatchObject({ proposed: 2, todo: 1, ready: readyCount, blocked });
      expect(graph.tasks.find((task) => task.id === approved.id)?.status).toBe('todo');
      const other = await getTask(approvalProject('pending'), approved.id, signal());
      expect(other).toMatchObject({ status: 'proposed', version });
    } finally { dispose(); }
  });

  it('rejects malformed, stale and repeated approval writes without changing state', async () => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject('approval-ready');
      const url = `/api/v1/projects/${project}/tasks/${taskId(1)}/approve`;
      for (const body of ['{}', '{"version":null}', '{"version":0}', '{"version":1.5}', '{"version":9223372036854775808}', '{"version":"9007199254740993"}', '{"version":9007199254740993,"extra":true}']) {
        expect((await fetch(url, { method: 'POST', body })).status).toBe(400);
      }
      expect((await fetch(url)).status).toBe(405);
      await expect(approveTask(project, taskId(1), version - 1n, signal())).rejects.toMatchObject({ code: 'version_conflict' });
      expect((await getTask(project, taskId(1), signal())).version).toBe(version);
      await approveTask(project, taskId(1), version, signal());
      await expect(approveTask(project, taskId(1), version + 1n, signal())).rejects.toMatchObject({ code: 'invalid_transition' });
      expect((await getTask(project, taskId(1), signal())).version).toBe(version + 1n);
    } finally { dispose(); }
  });

  it('refuses the first failure-scene write and accepts an explicit retry', async () => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject('failure');
      await expect(approveTask(project, taskId(1), version, signal())).rejects.toMatchObject({ kind: 'server', status: 503 });
      expect(await getTask(project, taskId(1), signal())).toMatchObject({ status: 'proposed', version });
      expect(await approveTask(project, taskId(1), version, signal())).toMatchObject({ status: 'todo', version: version + 1n });
    } finally { dispose(); }
  });

  it('exposes changed content after conflict and requires the newly reviewed version', async () => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject('conflict');
      await expect(approveTask(project, taskId(1), version, signal())).rejects.toMatchObject({ code: 'version_conflict' });
      const current = await getTask(project, taskId(1), signal());
      expect(current).toMatchObject({ status: 'proposed', version: version + 1n });
      expect(current.title).toContain('范围已更新');
      await expect(approveTask(project, taskId(1), version, signal())).rejects.toMatchObject({ code: 'version_conflict' });
      expect(await approveTask(project, taskId(1), current.version, signal())).toMatchObject({ status: 'todo', version: version + 2n });
    } finally { dispose(); }
  });

  it('models approval by another caller as a conflict followed by current todo content', async () => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject('approved-by-other');
      await expect(approveTask(project, taskId(1), version, signal())).rejects.toMatchObject({ code: 'version_conflict' });
      expect(await getTask(project, taskId(1), signal())).toMatchObject({ status: 'todo', version: version + 1n });
    } finally { dispose(); }
  });

  it.each(['unknown-applied', 'unknown-unapplied'] as const)('makes %s outcomes observable through a fresh state read', async (scenario) => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject(scenario);
      await expect(approveTask(project, taskId(1), version, signal())).rejects.toMatchObject({ kind: 'network' });
      const current = await getTask(project, taskId(1), signal());
      expect(current).toMatchObject(scenario === 'unknown-applied' ? { status: 'todo', version: version + 1n } : { status: 'proposed', version });
      if (scenario === 'unknown-unapplied') expect(await approveTask(project, taskId(1), current.version, signal())).toMatchObject({ status: 'todo', version: version + 1n });
    } finally { dispose(); }
  });

  it('keeps reconciliation reads failed until the preview control restores them', async () => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject('unknown-reconcile-error');
      await expect(approveTask(project, taskId(1), version, signal())).rejects.toMatchObject({ kind: 'network' });
      await expect(getTask(project, taskId(1), signal())).rejects.toMatchObject({ kind: 'server' });
      expect(dispose.controls('unknown-reconcile-error').taskReadFailure).toBe(true);
      dispose.recoverReads('unknown-reconcile-error');
      expect(await getTask(project, taskId(1), signal())).toMatchObject({ status: 'todo', version: version + 1n });
      expect(dispose.controls('unknown-reconcile-error').taskReadFailure).toBe(false);
    } finally { dispose(); }
  });

  it('retains the confirmed todo detail when graph reads fail until explicit recovery', async () => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject('graph-refresh-error');
      await getTaskGraph(project, signal());
      await approveTask(project, taskId(1), version, signal());
      await expect(getTaskGraph(project, signal())).rejects.toMatchObject({ kind: 'server' });
      expect(await getTask(project, taskId(1), signal())).toMatchObject({ status: 'todo', version: version + 1n });
      expect(dispose.controls('graph-refresh-error').graphReadFailure).toBe(true);
      dispose.recoverReads('graph-refresh-error');
      expect((await getTaskGraph(project, signal())).summary).toMatchObject({ proposed: 2, todo: 1, ready: 1 });
    } finally { dispose(); }
  });

  it.each(['pending', 'task-switch'] as const)('holds independent task writes in %s until the preview control settles them', async (scenario) => {
    const dispose = installBrowsingFixture();
    try {
      const project = approvalProject(scenario);
      const first = approveTask(project, taskId(1), version, signal());
      const second = approveTask(project, taskId(12), version, signal());
      expect(dispose.controls(scenario).pending).toBe(2);
      expect(await getTask(project, taskId(1), signal())).toMatchObject({ status: 'proposed', version });
      expect(await getTask(project, taskId(12), signal())).toMatchObject({ status: 'proposed', version });
      const revision = dispose.getRevision();
      dispose.settlePending(scenario);
      expect(dispose.getRevision()).toBeGreaterThan(revision);
      expect((await Promise.all([first, second])).map((task) => [task.id, task.status, task.version])).toEqual([
        [taskId(1), 'todo', version + 1n], [taskId(12), 'todo', version + 1n],
      ]);
      expect(dispose.controls(scenario).pending).toBe(0);
    } finally { dispose(); }
  });

  it('isolates mutable fixture state between installations', async () => {
    const project = approvalProject('approval-ready');
    const first = installBrowsingFixture();
    await approveTask(project, taskId(1), version, signal());
    first();
    const second = installBrowsingFixture();
    try { expect(await getTask(project, taskId(1), signal())).toMatchObject({ status: 'proposed', version }); }
    finally { second(); }
  });
});
