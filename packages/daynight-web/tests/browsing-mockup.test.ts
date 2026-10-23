import { describe, expect, it } from 'vitest';
import { approveTask, getTask, getTaskGraph } from '../src/api/client';
import { parseApiJson } from '../src/api/json';
import { parseTaskGraph } from '../src/api/parse';
import { decodeTaskGraphJson } from '../src/api/project-json';
import { buildGraphIndex, projectChain } from '../src/features/task-graph/model';
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

  it('matches mixed prototype counts with unique ordinary components and explicit external context', () => {
    const graph = browsingProjects.mixed;
    expect(graph.summary).toEqual({ total: 16, proposed: 6, todo: 4, inProgress: 2, done: 4, ready: 3, blocked: 1 });
    const index = buildGraphIndex(graph);
    const chains = index.representativeIds.filter((id) => index.components.get(id)!.memberIds.size > 1);
    expect(chains).toEqual([1, 3, 5, 7, 10].map(taskId));
    expect(chains.map((id) => index.components.get(id)!.progress.status)).toEqual(['proposed', 'todo', 'todo', 'in_progress', 'done']);
    const members = chains.flatMap((id) => [...index.components.get(id)!.memberIds]);
    expect(members).toHaveLength(11);
    expect(new Set(members).size).toBe(members.length);
    const first = projectChain(index, chains[0]!);
    expect(first.mainIds.size).toBe(2);
    expect(first.externalIds.size).toBe(1);
    expect(first.completed).toBe(0);
    expect(first.mainIds).toEqual(new Set([taskId(1), taskId(2)]));
    expect(first.externalIds).toEqual(new Set([taskId(3)]));
    expect(first.edges).toEqual([
      { source: taskId(1), target: taskId(2), external: false },
      { source: taskId(3), target: taskId(2), external: true },
    ]);
    expect(index.componentByTask.get(taskId(3))).toBe(taskId(3));
  });

  it('combines two ordinary roots into one component without duplicate member progress', () => {
    const graph = browsingProjects['ordinary-merge'];
    const index = buildGraphIndex(graph);
    expect(graph.summary).toEqual({ total: 3, proposed: 0, todo: 2, inProgress: 0, done: 1, ready: 1, blocked: 1 });
    expect(index.representativeIds).toEqual([taskId(50)]);
    expect(index.componentByTask.get(taskId(51))).toBe(taskId(50));
    expect(index.components.get(taskId(50))).toEqual({
      memberIds: new Set([taskId(50), taskId(51), taskId(52)]),
      progress: { total: 3, done: 1, status: 'in_progress' },
    });
    const projection = projectChain(index, taskId(50));
    expect(projection.mainIds).toEqual(new Set([taskId(50), taskId(51), taskId(52)]));
    expect(projection.externalIds.size).toBe(0);
    expect(projection.edges).toEqual([
      { source: taskId(50), target: taskId(52), external: false },
      { source: taskId(51), target: taskId(52), external: false },
    ]);
  });

  it('keeps external-only tasks as singleton components without removing their execution blockers', () => {
    const graph = browsingProjects['external-only'];
    const index = buildGraphIndex(graph);
    expect(graph.summary).toEqual({ total: 2, proposed: 0, todo: 2, inProgress: 0, done: 0, ready: 1, blocked: 1 });
    expect(index.representativeIds).toEqual([taskId(70), taskId(71)]);
    expect([...index.components.values()].map((component) => component.memberIds.size)).toEqual([1, 1]);
    expect(graph.tasks.find((task) => task.id === taskId(71))).toMatchObject({
      dependsOn: [taskId(70)], externalDependsOn: [taskId(70)], blockedBy: [taskId(70)], ready: false,
    });
    const projection = projectChain(index, taskId(71));
    expect(projection.mainIds).toEqual(new Set([taskId(71)]));
    expect(projection.externalIds).toEqual(new Set([taskId(70)]));
    expect(projection.edges).toEqual([{ source: taskId(70), target: taskId(71), external: true }]);
  });

  it('keeps complete external ancestry ordinary except the explicitly classified boundary', () => {
    const graph = browsingProjects['complete-context'];
    const index = buildGraphIndex(graph);
    const projection = projectChain(index, taskId(30));
    expect(index.representativeIds).toEqual([taskId(14), taskId(30)]);
    expect(projection.mainIds).toEqual(new Set([taskId(30), taskId(31)]));
    expect(projection.externalIds).toEqual(new Set([14, 15, 16, 17].map(taskId)));
    expect(projection.mainIds.has(taskId(32))).toBe(false);
    expect(projection.externalIds.has(taskId(32))).toBe(false);
    expect(projection.edges.filter((edge) => edge.external)).toEqual([{ source: taskId(17), target: taskId(31), external: true }]);
    expect(projection.edges).toContainEqual({ source: taskId(14), target: taskId(15), external: false });
    expect(index.components.get(taskId(30))!.progress).toEqual({ total: 2, done: 0, status: 'todo' });
  });

  it('keeps a complete progressive fixture with main and external work beyond the initial overview', () => {
    const graph = browsingProjects.progressive;
    const index = buildGraphIndex(graph);
    const root = graph.tasks.find((task) => task.titlePreview === '渐进展开 · 主链交付起点')!;
    const projection = projectChain(index, root.id);
    expect(graph.summary).toEqual({ total: 101, proposed: 0, todo: 61, inProgress: 0, done: 40, ready: 1, blocked: 60 });
    expect(projection.mainIds.size).toBe(61);
    expect(projection.externalIds.size).toBe(40);
    expect(projection.edges).toHaveLength(100);
    expect(projection.edges.filter((edge) => edge.external)).toHaveLength(40);
    expect(projection.edges.filter((edge) => !edge.external)).toHaveLength(60);
    expect(index.components.get(root.id)!.progress).toEqual({ total: 61, done: 0, status: 'todo' });
  });

  it('preserves the same explicit external classification in graph and full task responses', async () => {
    const dispose = installBrowsingFixture();
    try {
      const projectId = browsingProjects.external.project.id;
      const graph = await getTaskGraph(projectId, signal());
      const task = await getTask(projectId, taskId(2), signal());
      expect(task).toMatchObject({
        dependsOn: [taskId(1), taskId(3)], externalDependsOn: [taskId(3)],
        blockedBy: [taskId(1), taskId(3)], ready: false, version: 1n,
      });
      expect(graph.tasks.find((node) => node.id === task.id)).toMatchObject({
        dependsOn: task.dependsOn, externalDependsOn: task.externalDependsOn, blockedBy: task.blockedBy, ready: task.ready,
      });
    } finally { dispose(); }
  });

  it.each(['progressive', 'complete-context', 'ordinary-merge'] as const)('serves the complete %s graph and exact detail versions through production APIs', async (scenario) => {
    const dispose = installBrowsingFixture();
    try {
      const source = browsingProjects[scenario];
      const graph = await getTaskGraph(source.project.id, signal());
      expect(graph).toEqual(source);
      expect(graph.tasks.every((task) => !('version' in task))).toBe(true);
      const task = await getTask(source.project.id, source.tasks[0]!.id, signal());
      expect(task).toMatchObject({ id: source.tasks[0]!.id, status: source.tasks[0]!.status, version: 1n });
    } finally { dispose(); }
  });

  it('serves initial and refresh failures once so production retry can restore the snapshot', async () => {
    const dispose = installBrowsingFixture();
    try {
      const load = async (scenario: 'error' | 'refresh-error') => {
        const graph = browsingProjects[scenario];
        return fetch(`/api/v1/projects/${graph.project.id}/task-graph`);
      };
      expect((await load('error')).status).toBe(500);
      expect(await decodeTaskGraphJson(await load('error'))).toEqual(browsingProjects.error);
      expect((await load('refresh-error')).status).toBe(200);
      expect((await load('refresh-error')).status).toBe(500);
      expect(await decodeTaskGraphJson(await load('refresh-error'))).toEqual(browsingProjects['refresh-error']);
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
      const expected = scenario === 'unapproval-ready' ? { proposed: 0, todo: 3, ready: 2, blocked: 1 }
        : scenario === 'unapproval-blocked' ? { proposed: 1, todo: 2, ready: 1, blocked: 1 }
          : { proposed: 3, todo: 0, ready: 0, blocked: 0 };
      expect(graph.summary).toEqual({ total: 3, inProgress: 0, done: 0, ...expected });
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
