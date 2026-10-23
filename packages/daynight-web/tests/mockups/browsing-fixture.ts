import { stringifyWireJson } from "../helpers/wireJson";
import type { GraphTask, TaskDetail, TaskGraph, TaskGraphSummary, TaskStatus } from '../../src/api/types';
import { isTaskVersion, parseApiJson } from '../../src/api/json';

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
  'approval-ready': '批准可开始的任务 · 精确大版本号',
  'approval-blocked': '批准仍有未完成前置的任务',
  'unapproval-ready': '撤回可开始任务的审批 · 含重新批准',
  'unapproval-blocked': '撤回仍有未完成前置的任务审批',
  pending: '批准处理中 · 可关闭重开详情',
  failure: '服务拒绝批准 · 显示错误后显式重试',
  conflict: '版本冲突 · 重读修改后的任务',
  'approved-by-other': '其他调用方已批准',
  'unknown-applied': '响应丢失 · 核查后确认已批准',
  'unknown-unapplied': '响应丢失 · 核查后仍待审批',
  'unknown-reconcile-error': '结果未知 · 核查失败后显式恢复',
  'graph-refresh-error': '批准成功 · 任务图刷新失败',
  'task-switch': '批准处理中切换任务 · 响应身份隔离',
  long320: '批准长标题任务 · 320px 键盘交互',
  progressive: '渐进展开 · 主链与外部前置',
  'complete-context': '完整上游与无关分支排除',
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

const approvalScenarios = new Set<BrowsingScenario>([
  'approval-ready', 'approval-blocked', 'unapproval-ready', 'unapproval-blocked', 'pending', 'failure', 'conflict', 'approved-by-other',
  'unknown-applied', 'unknown-unapplied', 'unknown-reconcile-error', 'graph-refresh-error', 'task-switch', 'long320',
]);
export const isApprovalScenario = (scenario: BrowsingScenario): boolean => approvalScenarios.has(scenario);

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

const completeContext: readonly TaskSeed[] = [
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

const scenarioSeeds = (scenario: BrowsingScenario): readonly TaskSeed[] => {
  const selected = (numbers: readonly number[]) => mixed.filter((task) => numbers.includes(task.number));
  if (isApprovalScenario(scenario)) {
    const withdrawing = scenario === 'unapproval-ready' || scenario === 'unapproval-blocked';
    const seeds: readonly TaskSeed[] = [
      { number: 1, title: '审阅任务范围并明确审批决定', status: scenario === 'unapproval-ready' ? 'todo' : 'proposed', dependencies: [] },
      { number: 2, title: '有未完成前置的后续任务', status: withdrawing ? 'todo' : 'proposed', dependencies: [1] },
      { number: 12, title: '切换查看的独立任务', status: withdrawing ? 'todo' : 'proposed', dependencies: [] },
    ];
    return scenario === 'long320'
      ? seeds.map((task) => ({ ...task, title: `${task.title}：中文、English identifiers、Keyboard navigation 与完整审批内容的自然换行。`.repeat(4) }))
      : seeds;
  }
  switch (scenario) {
    case 'empty': return [];
    case 'progressive': return progressive;
    case 'complete-context': return completeContext;
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
    return { startedAt: null, completedAt: null,
      id: id(task.number), titlePreview: title.slice(0, 160).join(''), titleTruncated: title.length > 160, status: task.status,
      dependsOn: task.dependencies.map(id), externalDependsOn: [], blockedBy,
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
  return { observedAt: "2026-10-20T12:00:00Z",
    project: { settings: { version: 1n, executionWarningMinutes: 60 },
      id: id(number), name: `Daynight · ${browsingScenarioLabels[scenario]}`, repoUrl: 'https://github.com/example/task-browser',
      createdAt: '2026-10-21T09:00:00Z', updatedAt: '2026-10-22T09:00:00Z',
    },
    summary, tasks,
  };
};

export const browsingProjects = Object.fromEntries(
  (Object.keys(browsingScenarioLabels) as BrowsingScenario[]).map((scenario, index) => [scenario, createGraph(scenario, 101 + index)]),
) as Readonly<Record<BrowsingScenario, TaskGraph>>;

const detail = (graph: TaskGraph, task: GraphTask | TaskDetail, scenario: BrowsingDetailScenario, version = 1n): TaskDetail => ({ startedAt: task.startedAt, completedAt: task.completedAt,
  id: task.id, projectId: graph.project.id, title: titles.get(`${graph.project.id}:${task.id}`)!, version,
  status: task.status, dependsOn: task.dependsOn, externalDependsOn: task.externalDependsOn, blockedBy: task.blockedBy, ready: task.ready,
  createdAt: task.createdAt, updatedAt: task.updatedAt,
  description: scenario === 'empty' ? '' : scenario === 'long'
    ? Array.from({ length: 24 }, (_, index) => `验收记录 ${index + 1}：完成任务范围内的实现与验证，确认依赖关系、任务状态与实际交付结果一致。共享任务可出现在多条任务链中；已完成的前置任务保留在依赖图中。完整内容在详情窗口内滚动，标题栏、关闭按钮和底部说明持续可见。`).join('\n\n')
    : '完成任务范围内的实现与验证，确认依赖关系、任务状态与实际交付结果一致。\n\n共享任务可出现在多条任务链中；已完成的前置任务保留在依赖图中。',
  properties: { pullRequests: [] },
});

type SceneState = {
  readonly scenario: BrowsingScenario;
  readonly initial: TaskGraph;
  readonly tasks: Map<string, TaskDetail>;
  readonly attempts: Map<string, number>;
  readonly failedTaskReads: Set<string>;
  readonly pending: Map<number, { readonly settle: () => void; readonly reject: (error: unknown) => void }>;
  graphReads: number;
  failedGraphReads: boolean;
};
export type BrowsingFixtureControls = {
  readonly pending: number;
  readonly taskReadFailure: boolean;
  readonly graphReadFailure: boolean;
};
export type BrowsingFixture = (() => void) & {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getRevision: () => number;
  readonly controls: (scenario: BrowsingScenario) => BrowsingFixtureControls;
  readonly settlePending: (scenario: BrowsingScenario) => void;
  readonly recoverReads: (scenario: BrowsingScenario) => void;
};

const jsonResponse = (value: unknown, status = 200): Response => new Response(stringifyWireJson(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const fault = (code: string, status: number): Response => jsonResponse({
  error: { code, message: `Preview request failed: ${code}.`, requestId: `mockup-${code}` },
}, status);

const graphSnapshot = (state: SceneState): TaskGraph => {
  const tasks: GraphTask[] = [...state.tasks.values()].map((task) => ({ startedAt: task.startedAt, completedAt: task.completedAt,
    id: task.id, titlePreview: Array.from(task.title).slice(0, 160).join(''), titleTruncated: Array.from(task.title).length > 160,
    status: task.status, dependsOn: task.dependsOn, externalDependsOn: task.externalDependsOn, blockedBy: task.blockedBy, ready: task.ready,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
  }));
  return { observedAt: "2026-10-20T12:00:00Z", project: state.initial.project, tasks, summary: {
    total: tasks.length, proposed: tasks.filter((task) => task.status === 'proposed').length,
    todo: tasks.filter((task) => task.status === 'todo').length, inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    done: tasks.filter((task) => task.status === 'done').length, ready: tasks.filter((task) => task.ready).length,
    blocked: tasks.filter((task) => task.status === 'todo' && !task.ready).length,
  } };
};

export const installBrowsingFixture = (): BrowsingFixture => {
  const originalFetch = window.fetch;
  const listeners = new Set<() => void>();
  let revision = 0;
  let pendingId = 0;
  const emit = () => { revision++; for (const listener of listeners) listener(); };
  const states = new Map((Object.keys(browsingProjects) as BrowsingScenario[]).map((scenario) => {
    const initial = browsingProjects[scenario];
    const state: SceneState = { scenario, initial, tasks: new Map(initial.tasks.map((task) => [
      task.id, detail(initial, task, scenario === 'long320' ? 'long' : 'normal', isApprovalScenario(scenario) ? 9_007_199_254_740_993n : 1n),
    ])), attempts: new Map(), failedTaskReads: new Set(), pending: new Map(), graphReads: 0, failedGraphReads: false };
    return [initial.project.id, state];
  }));
  const stateForScenario = (scenario: BrowsingScenario) => states.get(browsingProjects[scenario].project.id)!;
  const applyApproval = (state: SceneState, taskId: string, version: bigint, action: 'approve' | 'unapprove'): Response => {
    const current = state.tasks.get(taskId)!;
    if (current.version !== version) return fault('version_conflict', 409);
    if (current.status !== (action === 'approve' ? 'proposed' : 'todo')) return fault('invalid_transition', 409);
    const updated: TaskDetail = { ...current, status: action === 'approve' ? 'todo' : 'proposed', version: current.version + 1n,
      ready: action === 'approve' && current.blockedBy.length === 0, updatedAt: new Date(Date.parse(current.updatedAt) + 1_000).toISOString() };
    state.tasks.set(taskId, updated);
    if (state.scenario === 'graph-refresh-error') state.failedGraphReads = true;
    emit();
    return jsonResponse(updated);
  };
  const fixtureFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? 'GET';
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (url.origin !== location.origin) throw new Error(`Unknown browsing preview origin: ${url.origin}`);
    const graphMatch = /^\/api\/v1\/projects\/([^/]+)\/task-graph$/.exec(url.pathname);
    const taskMatch = /^\/api\/v1\/projects\/([^/]+)\/tasks\/([^/]+)(\/(?:attachments|approve|unapprove))?$/.exec(url.pathname);
    const projectId = graphMatch?.[1] ?? taskMatch?.[1];
    const state = projectId === undefined ? undefined : states.get(projectId);
    if (state !== undefined && graphMatch !== null) {
      if (method !== 'GET') return fault('method_not_allowed', 405);
      const count = state.graphReads++;
      if (state.scenario === 'loading') return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      if (state.scenario === 'error' && count === 0 || state.scenario === 'refresh-error' && count === 1 || state.failedGraphReads) return fault('internal_error', 500);
      return jsonResponse(graphSnapshot(state));
    }
    const task = state?.tasks.get(taskMatch?.[2] ?? '');
    if (state !== undefined && task !== undefined && taskMatch !== null) {
      if (taskMatch[3] === '/approve' || taskMatch[3] === '/unapprove') {
        const action = taskMatch[3] === '/approve' ? 'approve' : 'unapprove';
        if (method !== 'POST') return fault('method_not_allowed', 405);
        const body = typeof init?.body === 'string' ? init.body : request === null ? '' : await request.text();
        let data: unknown;
        try { data = parseApiJson(body); } catch { return fault('validation_failed', 400); }
        if (typeof data !== 'object' || data === null || Array.isArray(data) || Object.keys(data).length !== 1 || !('version' in data) || !isTaskVersion(data.version)) return fault('validation_failed', 400);
        const version = data.version;
        if (version !== task.version) return fault('version_conflict', 409);
        if (task.status !== (action === 'approve' ? 'proposed' : 'todo')) return fault('invalid_transition', 409);
        const attemptKey = `${task.id}:${action}`;
        const attempt = state.attempts.get(attemptKey) ?? 0;
        state.attempts.set(attemptKey, attempt + 1);
        if (state.scenario === 'pending' || state.scenario === 'task-switch') {
          const key = ++pendingId;
          return new Promise<Response>((resolve, reject) => {
            state.pending.set(key, { settle: () => resolve(applyApproval(state, task.id, version, action)), reject });
            emit();
          });
        }
        if (attempt === 0) {
          if (state.scenario === 'failure') return fault('internal_error', 503);
          if (state.scenario === 'conflict') {
            state.tasks.set(task.id, { ...task, version: version + 1n, title: `${task.title}（范围已更新，请重新审阅）`, updatedAt: '2026-10-22T09:30:00Z' });
            return fault('version_conflict', 409);
          }
          if (state.scenario === 'approved-by-other') {
            applyApproval(state, task.id, version, action);
            return fault('version_conflict', 409);
          }
          if (state.scenario === 'unknown-applied' || state.scenario === 'unknown-reconcile-error') applyApproval(state, task.id, version, action);
          if (state.scenario === 'unknown-reconcile-error') { state.failedTaskReads.add(task.id); emit(); }
          if (state.scenario === 'unknown-applied' || state.scenario === 'unknown-unapplied' || state.scenario === 'unknown-reconcile-error') throw new TypeError('The preview approval operation response was lost.');
        }
        return applyApproval(state, task.id, version, action);
      }
      if (method !== 'GET') return fault('method_not_allowed', 405);
      if (taskMatch[3] === '/attachments') return jsonResponse({ items: [], nextCursor: null });
      const scenario = readBrowsingDetailScenario();
      if (scenario === 'loading') return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      if (scenario === 'error' || state.failedTaskReads.has(task.id)) return fault('internal_error', 500);
      return jsonResponse({ ...task, description: scenario === 'normal' ? task.description : detail(state.initial, task, scenario).description });
    }
    throw new Error(`Unknown browsing preview request: ${url.pathname}`);
  };
  window.fetch = fixtureFetch;
  const dispose = () => {
    if (window.fetch === fixtureFetch) window.fetch = originalFetch;
    for (const state of states.values()) for (const pending of state.pending.values()) pending.reject(new DOMException('Preview closed', 'AbortError'));
    listeners.clear();
  };
  return Object.assign(dispose, {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRevision: () => revision,
    controls: (scenario: BrowsingScenario): BrowsingFixtureControls => {
      const state = stateForScenario(scenario);
      return { pending: state.pending.size, taskReadFailure: state.failedTaskReads.size > 0, graphReadFailure: state.failedGraphReads };
    },
    settlePending: (scenario: BrowsingScenario) => {
      const state = stateForScenario(scenario);
      const pending = [...state.pending.values()];
      state.pending.clear();
      for (const entry of pending) entry.settle();
      emit();
    },
    recoverReads: (scenario: BrowsingScenario) => {
      const state = stateForScenario(scenario);
      state.failedTaskReads.clear();
      state.failedGraphReads = false;
      emit();
    },
  });
};
