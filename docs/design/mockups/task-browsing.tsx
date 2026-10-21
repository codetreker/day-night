import { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GraphTask, TaskGraph, TaskGraphSummary, TaskStatus } from '../../../packages/daynight-web/src/api/types';
import { RootList } from '../../../packages/daynight-web/src/features/task-graph/RootList';
import { buildGraphIndex } from '../../../packages/daynight-web/src/features/task-graph/model';
import { TaskDrawer } from '../../../packages/daynight-web/src/features/task-detail/TaskDrawer';
import '../../../packages/daynight-web/src/styles/app.css';
import '../../../packages/daynight-web/src/styles/project.css';
import './task-browsing.css';

type Scenario = 'mixed' | 'complete' | 'empty';
type Seed = readonly [number, string, TaskStatus, readonly number[]];
const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const mixed: readonly Seed[] = [
  [1, '统一任务属性与依赖关系的展示', 'done', []],
  [2, '完善任务详情与 Pull Request 关联', 'done', [1]],
  [3, '归档旧项目的验证材料', 'done', []],
  [4, '整理命令行帮助文档', 'done', []],
  [5, '修复跨平台发布验证', 'in_progress', []],
  [6, 'Linux / macOS 原生环境验收', 'todo', [5]],
  [7, '完善项目可观测性', 'todo', []],
  [8, '协调共享任务与最终交付', 'todo', [2, 7]],
  [9, '任务完成后验证状态刷新与依赖链进度', 'todo', [8]],
  [10, '确认新的数据库迁移', 'done', []],
  [11, '迁移后验证存量数据与服务启动', 'in_progress', [10]],
  [12, '优化 CLI 首次使用体验', 'todo', []],
  [13, '补全项目配置指导', 'todo', []],
  [14, '前端任务浏览体验：保留展开状态、按时间倒序排列、隐藏已完成任务链与紧凑列表布局', 'in_progress', []],
  [15, '在真实浏览器中验证 Keyboard navigation and shared dependency rendering', 'todo', [14]],
  [16, '检查 GitHub 发布包的可见性', 'done', []],
  [17, '保持任务展开状态', 'todo', []],
  [18, '改进任务浏览体验', 'in_progress', []],
  [19, '保留展开状态并按创建时间倒序展示', 'todo', [18]],
  [20, '默认隐藏已完成任务链并压缩列表留白', 'todo', [18]],
  [21, '验证交互状态、任务图与完整交付结果', 'todo', [19, 20]],
];
const scenarioLabels: Record<Scenario, string> = { mixed: 'Daynight', complete: '已交付项目', empty: '新项目' };
const seedGraph = (scenario: Scenario): TaskGraph => {
  const seeds = scenario === 'empty' ? [] : scenario === 'complete' ? mixed.slice(0, 4) : mixed;
  const statuses = new Map(seeds.map(([id, , status]) => [id, status]));
  const tasks: GraphTask[] = seeds.map(([id, title, status, dependencies]) => {
    const blockedBy = dependencies.filter((dependency) => statuses.get(dependency) !== 'done').map(uuid);
    const createdAt = new Date(Date.UTC(2026, 9, 19, 9, id * 10)).toISOString();
    return { id: uuid(id), titlePreview: title, titleTruncated: false, status,
      dependsOn: dependencies.map(uuid), blockedBy, ready: status === 'todo' && blockedBy.length === 0, createdAt, updatedAt: createdAt };
  });
  const summary: TaskGraphSummary = { total: tasks.length, todo: tasks.filter((task) => task.status === 'todo').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length, done: tasks.filter((task) => task.status === 'done').length,
    ready: tasks.filter((task) => task.ready).length, blocked: tasks.filter((task) => task.status === 'todo' && !task.ready).length };
  return { project: { id: uuid(scenario === 'mixed' ? 101 : scenario === 'complete' ? 102 : 103), name: scenarioLabels[scenario],
    repoUrl: 'https://github.com/codetreker/day-night', createdAt: '2026-10-19T09:00:00Z', updatedAt: '2026-10-21T10:30:00Z' }, summary, tasks };
};
const graphs = { mixed: seedGraph('mixed'), complete: seedGraph('complete'), empty: seedGraph('empty') };

// The production drawer receives only fixture GET responses in this preview.
window.fetch = async (input, init) => {
  if (init?.method !== undefined && init.method !== 'GET') throw new Error('The preview supports GET requests only.');
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  const match = /^\/api\/v1\/projects\/([^/]+)\/tasks\/([^/]+)$/.exec(url.pathname);
  const graph = Object.values(graphs).find((candidate) => candidate.project.id === match?.[1]);
  const task = graph?.tasks.find((candidate) => candidate.id === match?.[2]);
  if (graph === undefined || task === undefined) throw new Error(`Unknown preview request: ${url.pathname}`);
  return Response.json({ ...task, projectId: graph.project.id, title: task.titlePreview,
    description: '完成范围内的实现与验证，确认任务进度、依赖关系和实际交付结果一致。\n\n这份交互预览使用真实任务链、画布和详情组件。可以展开任务链、查看任务详情、缩放画布，并切换项目场景。',
    properties: { pullRequests: [] } });
};

const ProjectPreview = ({ scenario }: { scenario: Scenario }) => {
  const graph = graphs[scenario];
  const index = useMemo(() => buildGraphIndex(graph), [graph]);
  const orderedRoots = useMemo(() => [...index.roots].reverse(), [index]);
  const completedCount = orderedRoots.filter((id) => { const progress = index.rootProgress.get(id)!; return progress.done === progress.total; }).length;
  const [showCompleted, setShowCompleted] = useState(false);
  const visibleRoots = showCompleted ? orderedRoots : orderedRoots.filter((id) => { const progress = index.rootProgress.get(id)!; return progress.done !== progress.total; });
  const storageKey = `daynight:task-browsing-preview:expanded:${graph.project.id}`;
  const [expanded, setExpanded] = useState<string | null>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return visibleRoots[0] ?? null;
    const value: unknown = JSON.parse(stored);
    return value === null ? null : typeof value === 'string' && index.roots.includes(value) ? value : visibleRoots[0] ?? null;
  });
  const onExpand = (id: string | null) => { setExpanded(id); localStorage.setItem(storageKey, JSON.stringify(id)); };
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const selectTask = useCallback((id: string, element: HTMLElement) => { trigger.current = element; setSelected(id); }, []);
  const snapshot = useMemo(() => ({ graph, index, revision: 1, receivedAt: Date.parse('2026-10-21T10:30:00Z') }), [graph, index]);
  const summary = graph.summary;
  const completion = summary.total === 0 ? 0 : Math.round(summary.done * 100 / summary.total);
  const stats = [ ['任务总数', summary.total, '按任务 ID 去重', ''], ['已完成', summary.done, `完成比例 ${completion}%`, 'done'],
    ['待处理', summary.todo, '等待开始', ''], ['进行中', summary.inProgress, '正在推进', 'active'],
    ['可开始', summary.ready, '待处理的子集', 'ready'], ['被阻塞', summary.blocked, '待处理的子集', 'blocked'] ] as const;
  return <>
    <div className="project-navigation"><a className="back-link" href="#preview-projects">← 项目</a><p className="snapshot-time">最近成功刷新 <time dateTime="2026-10-21T10:30:00Z">10:30:00</time></p></div>
    <div className="page-heading project-heading"><div><p className="eyebrow">项目任务</p><h1>{graph.project.name}</h1><p className="project-repository">{graph.project.repoUrl}</p></div><button className="button" type="button" onClick={() => location.reload()}>↻ 刷新</button></div>
    <section className="stats" aria-label="项目任务统计">{stats.map(([label, number, foot, style]) => <div className={`stat ${style}`} key={label}><p className="stat-label">{label}</p><p className="stat-number">{number}</p><p className="stat-foot">{foot}</p></div>)}</section>
    {summary.total === 0 ? <section className="state-box"><h2>还没有任务</h2><p>项目中的任务会显示在这里。创建任务后，点击刷新查看。</p></section> : <section aria-label="任务依赖链">
      <div className="task-chain-header"><div className="graph-section-heading"><h2 id="preview-task-roots-heading">任务链 <span className="graph-count-pill" title="当前显示 / 全部任务链" aria-label={`当前显示 ${visibleRoots.length} 条，共 ${orderedRoots.length} 条任务链`}>{visibleRoots.length} / {orderedRoots.length}</span></h2><div className="graph-legend" aria-label="任务状态图例"><span className="graph-status graph-status-todo"><i />待处理</span><span className="graph-status graph-status-in_progress"><i />进行中</span><span className="graph-status graph-status-done"><i />已完成</span></div></div>
        <div className="task-chain-controls"><span className="task-chain-order">按创建时间倒序</span><label className="task-chain-filter"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />显示已完成任务链（{completedCount}）</label></div>
      </div>
      {visibleRoots.length === 0 ? <section className="state-box completed-chains-empty"><span className="completed-chains-icon" aria-hidden="true">✓</span><h2>所有任务链均已完成</h2><p>已隐藏 {completedCount} 条已完成任务链，项目统计仍包含全部任务。</p><button className="button" type="button" onClick={() => setShowCompleted(true)}>显示已完成任务链</button></section> : <div className="preview-root-list"><RootList index={{ ...index, roots: visibleRoots }} expandedRootId={visibleRoots.includes(expanded ?? '') ? expanded : null} onExpand={onExpand} selectedTaskId={selected} onSelectTask={selectTask} /></div>}
    </section>}
    {selected !== null && <TaskDrawer projectId={graph.project.id} taskId={selected} snapshot={snapshot} onSelectTask={setSelected} onClose={() => setSelected(null)} onRestoreFocus={() => trigger.current?.focus()} onRefreshGraph={() => location.reload()} />}
  </>;
};

const Preview = () => {
  const [scenario, setScenario] = useState<Scenario>(() => { const value = new URLSearchParams(location.search).get('scenario'); return value === 'complete' || value === 'empty' ? value : 'mixed'; });
  return <div className="shell"><a className="skip-link" href="#main-content">跳到主要内容</a><aside className="sidebar" aria-label="工作空间导航"><a className="brand" href="#preview-projects"><span className="brand-mark" aria-hidden="true" />daynight</a><nav aria-label="主导航"><p className="nav-label">工作空间</p><a className="nav-button" href="#preview-projects" aria-current="page"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>项目</a></nav><div className="sidebar-bottom">本地工作空间<small>任务与依赖，一处看清</small></div></aside><div className="workspace"><header className="topbar"><nav className="crumb" aria-label="面包屑"><a href="#preview-projects">工作空间</a><span aria-hidden="true">/</span><span className="crumb-current" aria-current="page">项目任务</span></nav><span className="local-label">工作空间 · 本地</span></header><main className="content" id="main-content" tabIndex={-1}><div className="preview-scenario" id="preview-projects"><span>交互预览</span><label>项目场景 <select value={scenario} onChange={(event) => { const next = event.target.value as Scenario; setScenario(next); history.replaceState(null, '', `?scenario=${next}`); }}>{Object.entries(scenarioLabels).map(([value, label]) => <option value={value} key={value}>{label}{value === 'mixed' ? ' · 混合任务与共享依赖' : value === 'complete' ? ' · 全部完成' : ' · 尚无任务'}</option>)}</select></label><span className="preview-hint">展开选择按项目保留，刷新可验证</span></div><ProjectPreview key={scenario} scenario={scenario} /></main></div></div>;
};

const root = document.getElementById('root');
if (root === null) throw new Error('The preview root element is missing.');
createRoot(root).render(<Preview />);
