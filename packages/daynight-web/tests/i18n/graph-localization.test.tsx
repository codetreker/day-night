import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskGraph as GraphData } from '../../src/api/types';
import { RootList } from '../../src/features/task-graph/RootList';
import { TaskGraph } from '../../src/features/task-graph/TaskGraph';
import { buildGraphIndex } from '../../src/features/task-graph/model';
import * as layoutModule from '../../src/features/task-graph/layout';
import { LanguageSelector } from '../../src/i18n/LanguageSelector';
import { messagesByLocale } from '../../src/i18n/messages';
import { renderWithLocale } from '../helpers/renderWithLocale';
import { browsingProjects } from '../mockups/browsing-fixture';
import { installGraphMeasurements } from '../graph-measurements';

const time = '2026-10-20T00:00:00Z';
const graph: GraphData = {
  project: { id: 'project', name: '项目', repoUrl: 'https://github.com/example/repo', createdAt: time, updatedAt: time },
  summary: { total: 5, proposed: 0, todo: 2, inProgress: 1, done: 2, ready: 1, blocked: 1 },
  tasks: [
    { id: 'A', titlePreview: '基础 API', titleTruncated: false, status: 'done', dependsOn: [], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
    { id: 'B', titlePreview: '设计方案', titleTruncated: false, status: 'done', dependsOn: [], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
    { id: 'C', titlePreview: '合流实现', titleTruncated: true, status: 'in_progress', dependsOn: ['A', 'B'], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
    { id: 'D', titlePreview: '最终验收', titleTruncated: false, status: 'todo', dependsOn: ['C', 'F'], blockedBy: ['C', 'F'], ready: false, createdAt: time, updatedAt: time },
    { id: 'F', titlePreview: '发布检查', titleTruncated: false, status: 'todo', dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time },
  ],
};
const index = buildGraphIndex(graph);
const rootIds = ['A', 'B', 'F'];
const noop = () => {};
const viewport = (container: HTMLElement) => container.querySelector<HTMLElement>('.react-flow__viewport')!;
const ready = async (container: HTMLElement) => {
  await waitFor(() => expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(4));
  await waitFor(() => expect(viewport(container).style.transform).not.toBe('translate(0px,0px) scale(1)'));
};

beforeEach(installGraphMeasurements);

describe('localized task graph presentation', () => {
  it('retranslates proposed chain roots and nodes while preserving external context, node identity and layout', async () => {
    const user = userEvent.setup();
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const proposedGraph: GraphData = {
      ...graph,
      summary: { total: 3, proposed: 2, todo: 1, inProgress: 0, done: 0, ready: 1, blocked: 0 },
      tasks: [
        { ...graph.tasks[0]!, status: 'proposed' },
        { ...graph.tasks[3]!, status: 'proposed', dependsOn: ['A', 'F'], blockedBy: ['A', 'F'] },
        graph.tasks[4]!,
      ],
    };
    const proposedIndex = buildGraphIndex(proposedGraph);
    const view = renderWithLocale(<><LanguageSelector /><RootList index={proposedIndex} rootIds={['A', 'F']} allRootIds={['A', 'F']}
      expandedRootId="A" onExpand={noop} selectedTaskId="D" onSelectTask={noop} showCompleted={false} onShowCompletedChange={noop} /></>, { locale: 'en' });
    const selected = await screen.findByRole('button', { name: '最终验收, Proposed, blocked, shared task' });
    expect(view.container.querySelector('#task-root-A .root-status')).toHaveTextContent('Proposed');
    expect(view.container.querySelector('#task-root-A .root-progress-label')).toHaveTextContent('0/2 completed');
    expect(screen.getByRole('button', { name: '发布检查, To do, external prerequisite' })).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN');
    expect(view.container.querySelector('#task-root-A .root-status')).toHaveTextContent('待审批');
    expect(screen.getByRole('button', { name: '最终验收，待审批，被阻塞，共享任务' })).toBe(selected);
    expect(screen.getByRole('button', { name: '发布检查，待处理，外部前置' })).toBeVisible();
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it('retranslates mounted memoized rows, nodes, dependencies and controls while retaining layout, selection and viewport', async () => {
    const user = userEvent.setup();
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const select = vi.fn();
    const view = renderWithLocale(<><LanguageSelector /><RootList index={index} rootIds={rootIds} allRootIds={rootIds}
      expandedRootId="A" onExpand={noop} selectedTaskId="C" onSelectTask={select} showCompleted={false} onShowCompletedChange={noop} /></>, { locale: 'en' });
    await ready(view.container);
    expect(screen.getByRole('region', { name: 'Task dependency graph for 基础 API' })).toBeTruthy();
    expect(screen.getAllByText('3 tasks · 2 unfinished')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Show completed task chains (0)' })).not.toBeChecked();
    expect(screen.getByText('3 chain tasks · 2 external prerequisites · 4 dependencies')).toBeTruthy();
    const selected = screen.getByRole('button', { name: '合流实现…, In progress, shared task' });
    expect(selected.closest('.task-node')).toHaveClass('task-node-selected');
    expect(screen.getByRole('button', { name: '最终验收, To do, blocked, shared task' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '设计方案, Done, external prerequisite' })).toBeTruthy();
    const initialTransform = viewport(view.container).style.transform;
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(viewport(view.container).style.transform).not.toBe(initialTransform));
    const transform = viewport(view.container).style.transform;
    const nodes = [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')];
    const positions = nodes.map((node) => node.style.transform);
    const paths = [...view.container.querySelectorAll('.react-flow__edge-path')];
    const routes = paths.map((path) => path.getAttribute('d'));
    const rootToggle = view.container.querySelector('#task-root-A');
    const relation = screen.getByRole('img', { name: 'Prerequisite task A → subsequent task C' });
    const canvas = view.container.querySelector('.task-graph-canvas');
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN');
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.getByRole('region', { name: '基础 API 的任务依赖图' })).toBeTruthy();
    expect(screen.getAllByText('3 个任务 · 2 个未完成')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: '显示已完成任务链（0）' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '合流实现…，进行中，共享任务' })).toBe(selected);
    expect(selected.closest('.task-node')).toHaveClass('task-node-selected');
    expect(screen.getByRole('button', { name: '最终验收，待处理，被阻塞，共享任务' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '前置任务 A → 后续任务 C' })).toBe(relation);
    expect(screen.getByRole('group', { name: '任务依赖关系' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: '放大' })).toHaveAttribute('title', '放大'));
    expect(screen.getByRole('button', { name: '缩小' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '适应画布' })).toBeTruthy();
    expect(view.container.querySelector('#task-root-A')).toBe(rootToggle);
    expect(view.container.querySelector('.task-graph-canvas')).toBe(canvas);
    [...view.container.querySelectorAll('.react-flow__node')].forEach((node, position) => expect(node).toBe(nodes[position]));
    [...view.container.querySelectorAll('.react-flow__edge-path')].forEach((path, position) => expect(path).toBe(paths[position]));
    expect(nodes.map((node) => node.style.transform)).toEqual(positions);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(routes);
    expect(viewport(view.container).style.transform).toBe(transform);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(selected);
    expect(select).toHaveBeenCalledExactlyOnceWith('C', selected);
  });

  it('retranslates expanded visibility controls without changing the actual visible graph, detail selection or viewport', async () => {
    const user = userEvent.setup();
    const fixture = browsingProjects.progressive;
    const index = buildGraphIndex(fixture);
    const rootId = fixture.tasks.find((task) => task.titlePreview === '渐进展开 · 主链交付起点')!.id;
    const joinId = fixture.tasks.find((task) => task.titlePreview === '合流任务 · 40 个外部前置')!.id;
    const open = vi.fn();
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const view = renderWithLocale(<><LanguageSelector /><TaskGraph index={index} rootId={rootId} selectedTaskId={joinId} onSelectTask={open} /></>, { locale: 'en' });
    await waitFor(() => { expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(50); });
    const body = screen.getByRole('button', { name: '合流任务 · 40 个外部前置, To do, blocked, shared task' });
    const expand = screen.getByRole('button', { name: 'Expand 20 prerequisite tasks and 20 dependencies, 20 prerequisites still hidden' });
    await user.click(expand);
    await waitFor(() => { expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(70); });
    await waitFor(() => { expect(body).toHaveFocus(); });
    expect(open).not.toHaveBeenCalled();
    const nodes = [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')];
    const positions = nodes.map((node) => node.style.transform);
    const paths = [...view.container.querySelectorAll('.react-flow__edge-path')];
    const routes = paths.map((path) => path.getAttribute('d'));
    const transform = viewport(view.container).style.transform;
    expect(screen.getByRole('button', { name: 'Reset overview' })).toBeTruthy();
    expect(screen.getByText('Showing 70/101 tasks · 69/100 dependencies. Use the card controls to expand prerequisites or successors.')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN');
    expect(screen.getByRole('button', { name: '合流任务 · 40 个外部前置，待处理，被阻塞，共享任务' })).toBe(body);
    expect(body.closest('.task-node')).toHaveClass('task-node-selected');
    expect(screen.getByRole('button', { name: '展开前置 20 个任务、20 条依赖' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起到概览' })).toBeTruthy();
    expect(screen.getByText('当前显示 70/101 个任务 · 69/100 条依赖。通过卡片下方按钮展开更多前置或后续。')).toBeTruthy();
    expect([...view.container.querySelectorAll('.react-flow__node')]).toEqual(nodes);
    expect(nodes.map((node) => node.style.transform)).toEqual(positions);
    expect([...view.container.querySelectorAll('.react-flow__edge-path')]).toEqual(paths);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(routes);
    expect(viewport(view.container).style.transform).toBe(transform);
    expect(layout).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('announces exact singular expansion counts in both languages', () => {
    expect(messagesByLocale.en.graph.expandLabel({ direction: 'prerequisites', tasks: 1, edges: 1, remaining: 1 }))
      .toBe('Expand 1 prerequisite task and 1 dependency, 1 prerequisite still hidden');
    expect(messagesByLocale['zh-CN'].graph.expandLabel({ direction: 'successors', tasks: 1, edges: 1, remaining: 1 }))
      .toBe('展开后续 1 个任务、1 条依赖，剩余 1 个后续未展开');
  });

  it('switches within fullscreen and preserves keyboard trapping, background inertness, canvas identity and restored focus', async () => {
    const user = userEvent.setup();
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const view = renderWithLocale(<><button type="button">Background</button><TaskGraph index={index} rootId="A" selectedTaskId="C" onSelectTask={noop} /></>, { locale: 'en' });
    await ready(view.container);
    expect(screen.queryByRole('combobox')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'View fullscreen' });
    const canvas = view.container.querySelector('.task-graph-canvas');
    const transform = viewport(view.container).style.transform;
    fireEvent.click(toggle);
    expect(toggle).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Background', hidden: true })).toHaveAttribute('inert');
    const dialog = screen.getByRole('dialog', { name: 'Task dependency graph fullscreen view' });
    await user.tab();
    const selector = within(dialog).getByRole('combobox', { name: '语言 / Language' });
    expect(selector).toHaveFocus();
    await user.selectOptions(selector, 'zh-CN');
    expect(selector).toHaveFocus();
    expect(screen.getByRole('dialog', { name: '任务依赖图全屏查看' })).toBe(dialog);
    expect(screen.getByRole('button', { name: '退出全屏' })).toBe(toggle);
    expect(view.container.querySelector('.task-graph-canvas')).toBe(canvas);
    expect(viewport(view.container).style.transform).toBe(transform);
    await user.tab({ shift: true });
    expect(toggle).toHaveFocus();
    await user.tab({ shift: true });
    const last = document.activeElement as HTMLElement;
    expect(last).not.toBe(toggle);
    expect(dialog).toContainElement(last);
    await user.tab();
    expect(toggle).toHaveFocus();
    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(toggle).toHaveAccessibleName('全屏查看');
    expect(toggle).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Background' })).not.toHaveAttribute('inert');
    expect(viewport(view.container).style.transform).toBe(transform);
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it('retranslates an existing layout failure without repeating the failed layout', async () => {
    const user = userEvent.setup();
    const layout = vi.spyOn(layoutModule, 'layoutGraph').mockImplementation(() => { throw new Error('layout failed'); });
    renderWithLocale(<><LanguageSelector /><TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} /></>, { locale: 'en' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Task graph layout failed');
    await user.selectOptions(screen.getByRole('combobox'), 'zh-CN');
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent('任务图布局失败');
    expect(alert).toHaveTextContent('无法绘制此任务链，请刷新项目后重试。');
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it('renders empty and hidden-completed chain states in the chosen language', () => {
    const props = { index, allRootIds: [], rootIds: [], expandedRootId: null, selectedTaskId: null,
      onExpand: noop, onSelectTask: noop, showCompleted: false, onShowCompletedChange: noop };
    const view = renderWithLocale(<RootList {...props} />, { locale: 'en' });
    expect(screen.getByRole('heading', { name: 'No task chains' })).toBeTruthy();
    expect(screen.getByLabelText('Showing 0 of 0 task chains')).toHaveTextContent('Newest first · 0 / 0 task chains');
    const completeIndex = buildGraphIndex({ ...graph, summary: { total: 5, proposed: 0, todo: 0, inProgress: 0, done: 5, ready: 0, blocked: 0 }, tasks: graph.tasks.map((task) => ({ ...task, status: 'done', blockedBy: [], ready: false })) });
    view.rerender(<RootList {...props} index={completeIndex} allRootIds={rootIds} />);
    expect(screen.getByRole('heading', { name: 'All task chains are complete' })).toBeTruthy();
    expect(screen.getByText('3 completed task chains are hidden. Project statistics still include all tasks.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show completed task chains' })).toBeTruthy();
  });

  it.each([0, 1, 2, 1000])('formats complete English and Chinese graph counts for %i', (value) => {
    const en = messagesByLocale.en.graph;
    const zh = messagesByLocale['zh-CN'].graph;
    const formatted = new Intl.NumberFormat('en').format(value);
    expect(en.counts({ main: value, external: value, dependencies: value })).toBe(`${formatted} chain ${value === 1 ? 'task' : 'tasks'} · ${formatted} external ${value === 1 ? 'prerequisite' : 'prerequisites'} · ${formatted} ${value === 1 ? 'dependency' : 'dependencies'}`);
    expect(en.completedDescription({ count: value })).toBe(`${formatted} completed task ${value === 1 ? 'chain is' : 'chains are'} hidden. Project statistics still include all tasks.`);
    expect(zh.counts({ main: value, external: value, dependencies: value })).toBe(`${formatted} 个链内任务 · ${formatted} 个外部前置 · ${formatted} 条依赖`);
    expect(en.progress({ done: value, total: 1000 })).toBe(`${formatted}/1,000 completed`);
  });
});
