import type { GraphTask, TaskDetail, TaskGraph, TaskGraphSummary, TaskStatus } from '../../src/api/types';

export type BrowsingScenario = 'mixed' | 'external' | 'progressive' | 'complete' | 'empty';
export type BrowsingDetailScenario = 'normal' | 'long' | 'empty' | 'loading' | 'error';
export const readBrowsingDetailScenario = (): BrowsingDetailScenario => {
  const value = new URLSearchParams(location.search).get('detail');
  return value === 'long' || value === 'empty' || value === 'loading' || value === 'error' ? value : 'normal';
};
type TaskSeed = {
  readonly number: number;
  readonly title: string;
  readonly status: TaskStatus;
  readonly dependencies: readonly number[];
};

const id = (number: number): string => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const mixed: readonly TaskSeed[] = [
  { number: 1, title: '统一项目任务属性', status: 'done', dependencies: [] },
  { number: 2, title: '完善任务详情与 Pull Request 关联', status: 'done', dependencies: [1] },
  { number: 3, title: '归档旧项目验证材料', status: 'done', dependencies: [] },
  { number: 4, title: '修复跨平台发布验证', status: 'in_progress', dependencies: [] },
  { number: 5, title: 'Linux / macOS 原生环境验收', status: 'todo', dependencies: [4] },
  { number: 6, title: '完善项目可观测性', status: 'todo', dependencies: [] },
  { number: 7, title: '协调共享任务与最终交付', status: 'todo', dependencies: [2, 6] },
  { number: 8, title: '验证状态刷新与任务链进度', status: 'todo', dependencies: [7] },
  { number: 9, title: '确认数据库迁移', status: 'done', dependencies: [] },
  { number: 10, title: '验证迁移后的服务启动', status: 'in_progress', dependencies: [9] },
  { number: 11, title: '完善首次使用体验：项目配置、交互提示与 Keyboard navigation 的完整验收', status: 'todo', dependencies: [] },
  { number: 12, title: '改进任务链浏览顺序', status: 'in_progress', dependencies: [] },
  { number: 13, title: '验证最新任务链与浏览器保存的展开状态', status: 'todo', dependencies: [12] },
];

const external: readonly TaskSeed[] = [
  { number: 30, title: '外部上下文 · 链内交付起点', status: 'todo', dependencies: [] },
  { number: 14, title: '外部祖先 · 已完成基础协议', status: 'done', dependencies: [] },
  { number: 15, title: '外部前置 · 实现共享接口', status: 'done', dependencies: [14] },
  { number: 16, title: '外部前置 · 验证共享接口', status: 'done', dependencies: [14] },
  { number: 17, title: '外部前置 · 菱形合流', status: 'done', dependencies: [15, 16] },
  { number: 31, title: '链内最终交付', status: 'todo', dependencies: [30, 17] },
  { number: 32, title: '外部前置的无关后续 · 当前链不显示', status: 'todo', dependencies: [17] },
];

const progressive: readonly TaskSeed[] = [
  ...Array.from({ length: 40 }, (_, position) => ({ number: 2000 + position, title: `外部前置 ${position + 1} · 已完成共享协议`, status: 'done' as const, dependencies: [] })),
  { number: 3000, title: '渐进展开 · 主链交付起点', status: 'todo', dependencies: [] },
  ...Array.from({ length: 60 }, (_, position) => ({
    number: 3001 + position, title: position === 0 ? '合流任务 · 40 个外部前置' : `主链后续 ${position + 1}`,
    status: 'todo' as const, dependencies: position === 0 ? [3000, ...Array.from({ length: 40 }, (_, index) => 2000 + index)] : [3000],
  })),
];

const createGraph = (scenario: BrowsingScenario, name: string, number: number): TaskGraph => {
  const seeds = scenario === 'empty' ? [] : scenario === 'complete' ? mixed.slice(0, 3) : scenario === 'external' ? external : scenario === 'progressive' ? progressive : mixed;
  const statuses = new Map(seeds.map((task) => [task.number, task.status]));
  const tasks: GraphTask[] = seeds.map((task) => {
    const blockedBy = task.dependencies.filter((dependency) => statuses.get(dependency) !== 'done').map(id);
    const createdAt = new Date(Date.UTC(2026, 9, 21, 9, task.number * 10)).toISOString();
    return {
      id: id(task.number), titlePreview: task.title, titleTruncated: false, status: task.status,
      dependsOn: task.dependencies.map(id), blockedBy,
      ready: task.status === 'todo' && blockedBy.length === 0, createdAt, updatedAt: createdAt,
    };
  });
  const summary: TaskGraphSummary = {
    total: tasks.length,
    todo: tasks.filter((task) => task.status === 'todo').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
    ready: tasks.filter((task) => task.ready).length,
    blocked: tasks.filter((task) => task.status === 'todo' && !task.ready).length,
  };
  return {
    project: {
      id: id(number), name, repoUrl: 'https://github.com/example/task-browser',
      createdAt: '2026-10-21T09:00:00Z', updatedAt: '2026-10-22T09:00:00Z',
    },
    summary, tasks,
  };
};

export const browsingProjects: Readonly<Record<BrowsingScenario, TaskGraph>> = {
  mixed: createGraph('mixed', 'Daynight · 任务链浏览', 101),
  external: createGraph('external', '完整上游上下文', 104),
  progressive: createGraph('progressive', '渐进任务图 · 101 个任务', 105),
  complete: createGraph('complete', '已交付项目', 102),
  empty: createGraph('empty', '新项目', 103),
};

const detail = (graph: TaskGraph, task: GraphTask, scenario: BrowsingDetailScenario): TaskDetail => ({
  ...task, projectId: graph.project.id, title: task.titlePreview,
  description: scenario === 'empty' ? '' : scenario === 'long'
    ? Array.from({ length: 24 }, (_, index) => `验收记录 ${index + 1}：完成任务范围内的实现与验证，确认依赖关系、任务状态与实际交付结果一致。共享任务可出现在多条任务链中；已完成的前置任务保留在依赖图中。完整内容在详情窗口内滚动，标题栏、关闭按钮和底部说明持续可见。`).join('\n\n')
    : '完成任务范围内的实现与验证，确认依赖关系、任务状态与实际交付结果一致。\n\n共享任务可出现在多条任务链中；已完成的前置任务保留在依赖图中。',
  properties: { pullRequests: [] },
});

export const installBrowsingFixture = (): (() => void) => {
  const originalFetch = window.fetch;
  const fixtureFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? 'GET';
    if (method !== 'GET') throw new Error(`Browsing preview does not support ${method} requests.`);
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (url.origin !== location.origin) throw new Error(`Unknown browsing preview origin: ${url.origin}`);
    const graphMatch = /^\/api\/v1\/projects\/([^/]+)\/task-graph$/.exec(url.pathname);
    const taskMatch = /^\/api\/v1\/projects\/([^/]+)\/tasks\/([^/]+)(\/attachments)?$/.exec(url.pathname);
    const projectId = graphMatch?.[1] ?? taskMatch?.[1];
    const graph = Object.values(browsingProjects).find((candidate) => candidate.project.id === projectId);
    if (graph !== undefined && graphMatch !== null) return Response.json(graph);
    const task = graph?.tasks.find((candidate) => candidate.id === taskMatch?.[2]);
    if (graph !== undefined && task !== undefined && taskMatch !== null) {
      if (taskMatch[3] !== undefined) return Response.json({ items: [], nextCursor: null });
      const scenario = readBrowsingDetailScenario();
      if (scenario === 'loading') return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      if (scenario === 'error') return Response.json({ error: { code: 'internal_error', message: 'Mockup detail request failed.', requestId: 'mockup-detail-error' } }, { status: 500 });
      return Response.json(detail(graph, task, scenario));
    }
    throw new Error(`Unknown browsing preview request: ${url.pathname}`);
  };
  window.fetch = fixtureFetch;
  return () => { if (window.fetch === fixtureFetch) window.fetch = originalFetch; };
};
