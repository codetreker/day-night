import type { GraphTask, TaskDetail, TaskGraph, TaskGraphSummary, TaskStatus } from '../../src/api/types';

export const browsingScenarioLabels = {
  mixed: '四种状态与共享后续',
  'all-proposed': '全部待审批 · 含未完成前置',
  'approved-mixed': '待审批与待处理混合链',
  active: '进行中 · 含待审批后续',
  complete: '全部完成',
  external: '外部前置不改变整链状态',
  'chains-only': '只有任务链',
  'standalone-only': '只有独立任务',
  'long-titles': '长标题与完整详情',
  narrow: '320px 窄屏 · 调整浏览器宽度查看',
  loading: '正在加载',
  error: '初始加载失败 · 可重试',
  'refresh-error': '刷新失败 · 保留快照',
  empty: '空项目',
} as const;
export type BrowsingScenario = keyof typeof browsingScenarioLabels;
export const readBrowsingScenario = (): BrowsingScenario => {
  const hash = location.hash.slice(1);
  return Object.hasOwn(browsingScenarioLabels, hash) ? hash as BrowsingScenario : 'mixed';
};
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
const titles = new Map<string, string>();
const mixed: readonly TaskSeed[] = [
  { number: 1, title: '讨论任务状态管理方案', status: 'proposed', dependencies: [] },
  { number: 2, title: '明确待审批任务的最终交付范围', status: 'proposed', dependencies: [1, 3] },
  { number: 3, title: '确认共享服务接口', status: 'todo', dependencies: [] },
  { number: 4, title: '验证外部接口的独立使用场景', status: 'todo', dependencies: [3] },
  { number: 5, title: '整理已批准任务的执行计划', status: 'todo', dependencies: [] },
  { number: 6, title: '补齐计划中的验收材料', status: 'proposed', dependencies: [5] },
  { number: 7, title: '完成数据模型设计', status: 'done', dependencies: [] },
  { number: 8, title: '实现任务生命周期约束', status: 'in_progress', dependencies: [7] },
  { number: 9, title: '提交客户端完整验收方案', status: 'proposed', dependencies: [8] },
  { number: 10, title: '完成配置引导', status: 'done', dependencies: [] },
  { number: 11, title: '完成配置引导验收', status: 'done', dependencies: [10] },
  { number: 12, title: '评估任务审查提醒', status: 'proposed', dependencies: [] },
  { number: 13, title: '整理发布说明', status: 'todo', dependencies: [] },
  { number: 14, title: '核对 CLI 的使用说明', status: 'in_progress', dependencies: [] },
  { number: 15, title: '归档已交付材料', status: 'done', dependencies: [] },
  { number: 16, title: '讨论跨团队审批流程与任务描述：覆盖中文、English identifiers、长标题自然换行和窄屏下的完整访问能力', status: 'proposed', dependencies: [] },
];

const scenarioSeeds = (scenario: BrowsingScenario): readonly TaskSeed[] => {
  const selected = (numbers: readonly number[]) => mixed.filter((task) => numbers.includes(task.number));
  switch (scenario) {
    case 'empty': return [];
    case 'all-proposed': return selected([1, 2]).map((task) => ({ ...task, dependencies: task.dependencies.filter((number) => number !== 3) }));
    case 'approved-mixed': return selected([5, 6]);
    case 'active': return selected([7, 8, 9]);
    case 'complete': return selected([7, 8, 9, 10, 11, 15]).map((task) => ({ ...task, status: 'done' }));
    case 'external': return selected([1, 2, 3, 4]);
    case 'chains-only': return selected([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    case 'standalone-only': return selected([12, 13, 14, 15, 16]);
    case 'long-titles': return mixed.map((task) => ({ ...task, title: `${task.title}：确认任务范围、Keyboard navigation 和共享依赖的完整展示与自然换行`.repeat(3) }));
    default: return mixed;
  }
};

const createGraph = (scenario: BrowsingScenario, number: number): TaskGraph => {
  const seeds = scenarioSeeds(scenario);
  const statuses = new Map(seeds.map((task) => [task.number, task.status]));
  const tasks: GraphTask[] = seeds.map((task) => {
    const blockedBy = task.dependencies.filter((dependency) => statuses.get(dependency) !== 'done').map(id);
    const createdAt = new Date(Date.UTC(2026, 9, 21, 9, task.number * 10)).toISOString();
    const title = Array.from(task.title);
    titles.set(`${id(number)}:${id(task.number)}`, task.title);
    return {
      id: id(task.number), titlePreview: title.slice(0, 160).join(''), titleTruncated: title.length > 160, status: task.status,
      dependsOn: task.dependencies.map(id), blockedBy,
      ready: task.status === 'todo' && blockedBy.length === 0, createdAt, updatedAt: createdAt,
    };
  });
  const summary: TaskGraphSummary = {
    total: tasks.length,
    proposed: tasks.filter((task) => task.status === 'proposed').length,
    todo: tasks.filter((task) => task.status === 'todo').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
    ready: tasks.filter((task) => task.ready).length,
    blocked: tasks.filter((task) => task.status === 'todo' && !task.ready).length,
  };
  return {
    project: {
      id: id(number), name: `Daynight · ${browsingScenarioLabels[scenario]}`, repoUrl: 'https://github.com/example/task-browser',
      createdAt: '2026-10-21T09:00:00Z', updatedAt: '2026-10-22T09:00:00Z',
    },
    summary, tasks,
  };
};

export const browsingProjects = Object.fromEntries(
  (Object.keys(browsingScenarioLabels) as BrowsingScenario[]).map((scenario, index) => [scenario, createGraph(scenario, 101 + index)]),
) as Readonly<Record<BrowsingScenario, TaskGraph>>;

const detail = (graph: TaskGraph, task: GraphTask, scenario: BrowsingDetailScenario): TaskDetail => ({
  ...task, projectId: graph.project.id, title: titles.get(`${graph.project.id}:${task.id}`)!,
  description: scenario === 'empty' ? '' : scenario === 'long'
    ? Array.from({ length: 24 }, (_, index) => `验收记录 ${index + 1}：完成任务范围内的实现与验证，确认依赖关系、任务状态与实际交付结果一致。共享任务可出现在多条任务链中；已完成的前置任务保留在依赖图中。完整内容在详情窗口内滚动，标题栏、关闭按钮和底部说明持续可见。`).join('\n\n')
    : '完成任务范围内的实现与验证，确认依赖关系、任务状态与实际交付结果一致。\n\n共享任务可出现在多条任务链中；已完成的前置任务保留在依赖图中。',
  properties: { pullRequests: [] },
});

export const installBrowsingFixture = (): (() => void) => {
  const originalFetch = window.fetch;
  const requests = new Map<string, number>();
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
    if (graph !== undefined && graphMatch !== null) {
      const scenario = (Object.keys(browsingProjects) as BrowsingScenario[]).find((key) => browsingProjects[key] === graph)!;
      const count = requests.get(projectId!) ?? 0;
      requests.set(projectId!, count + 1);
      if (scenario === 'loading') return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      if (scenario === 'error' && count === 0 || scenario === 'refresh-error' && count === 1) {
        return Response.json({ error: { code: 'internal_error', message: 'Mockup graph request failed.', requestId: 'mockup-graph-error' } }, { status: 500 });
      }
      return Response.json(graph);
    }
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
