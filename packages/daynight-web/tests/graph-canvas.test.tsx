import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createLocaleRender } from './helpers/renderWithLocale';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskGraph as TaskGraphData } from '../src/api/types';
import { RootList } from '../src/features/task-graph/RootList';
import { getInitialTaskViewport, TaskGraph } from '../src/features/task-graph/TaskGraph';
import { buildGraphIndex, projectRoot } from '../src/features/task-graph/model';
import * as layoutModule from '../src/features/task-graph/layout';
import { browsingProjects } from './mockups/browsing-fixture';
import { installGraphMeasurements } from './graph-measurements';

const render = createLocaleRender('zh-CN');

const taskRenders = vi.hoisted(() => vi.fn<(id: string) => void>());
const flowNodes = vi.hoisted(() => vi.fn<(nodes: readonly unknown[] | undefined) => void>());
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  const { createElement } = await import('react');
  return { ...actual, ReactFlow: (props: Parameters<typeof actual.ReactFlow>[0]) => {
    flowNodes(props.nodes);
    return createElement(actual.ReactFlow, props);
  } };
});
vi.mock('../src/features/task-graph/TaskNode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/task-graph/TaskNode')>();
  const { createElement, memo } = await import('react');
  return {
    ...actual,
    TaskNode: memo((props: Parameters<typeof actual.TaskNode>[0]) => {
      taskRenders(props.id);
      return createElement(actual.TaskNode, props);
    }),
  };
});

const time = '2026-10-20T00:00:00Z';
const graph: TaskGraphData = {
  project: { id: 'project', name: '项目', repoUrl: 'https://github.com/example/repo', createdAt: time, updatedAt: time },
  summary: { total: 6, proposed: 0, todo: 3, inProgress: 1, done: 2, ready: 2, blocked: 1 },
  tasks: [
    { id: 'A', titlePreview: '基础 API', titleTruncated: false, status: 'done', dependsOn: [], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
    { id: 'B', titlePreview: '设计方案', titleTruncated: false, status: 'done', dependsOn: [], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
    { id: 'C', titlePreview: '合流实现', titleTruncated: true, status: 'in_progress', dependsOn: ['A', 'B'], blockedBy: [], ready: false, createdAt: time, updatedAt: time },
    { id: 'D', titlePreview: '最终验收', titleTruncated: false, status: 'todo', dependsOn: ['C', 'F'], blockedBy: ['C', 'F'], ready: false, createdAt: time, updatedAt: time },
    { id: 'E', titlePreview: '独立任务', titleTruncated: false, status: 'todo', dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time },
    { id: 'F', titlePreview: '发布检查', titleTruncated: false, status: 'todo', dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time },
  ],
};
const index = buildGraphIndex(graph);
const noop = () => {};
const nodeButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}，(?!详情$)`) });
const nodeShell = (name: string) => nodeButton(name).closest<HTMLElement>('.task-node')!;
const detailsButton = (name: string) => screen.getByRole('button', { name: `${name}，详情` });
const viewport = (container: HTMLElement) => container.querySelector<HTMLElement>('.react-flow__viewport')!;
const zoom = (container: HTMLElement) => Number(/scale\(([^)]+)\)/.exec(viewport(container).style.transform)![1]);
const ready = async (container: HTMLElement) => {
  await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
  await waitFor(() => { expect(viewport(container).style.transform).not.toBe('translate(0px,0px) scale(1)'); });
};

beforeEach(installGraphMeasurements);

describe('task dependency canvas', () => {
  it('exposes proposed main and external nodes with their own status and unfinished prerequisites', async () => {
    const proposed = {
      ...graph,
      summary: { total: 6, proposed: 2, todo: 1, inProgress: 1, done: 2, ready: 1, blocked: 0 },
      tasks: graph.tasks.map((task) => task.id === 'D' || task.id === 'F'
        ? { ...task, status: 'proposed' as const, ready: false } : task),
    };
    const view = render(<TaskGraph index={buildGraphIndex(proposed)} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const main = screen.getByRole('button', { name: '最终验收，待审批，被阻塞，共享任务' });
    expect(main.closest('.task-node')).toHaveClass('task-node-proposed');
    expect(within(main).getByText('待审批')).toHaveClass('graph-status-proposed');
    const external = screen.getByRole('button', { name: '发布检查，待审批，外部前置' });
    expect(external.closest('.task-node')).toHaveClass('task-node-proposed', 'task-node-external');
    expect(within(external).queryByText('被阻塞')).toBeNull();
  });

  it('expands the existing canvas and restores its toolbar focus without changing the user viewport or layout', async () => {
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const initialZoom = zoom(view.container);
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    await waitFor(() => { expect(zoom(view.container)).toBeGreaterThan(initialZoom); });
    const canvas = view.container.querySelector('.task-graph-canvas');
    const nodes = [...view.container.querySelectorAll('.react-flow__node')];
    const paths = [...view.container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'));
    const positions = nodes.map((node) => (node as HTMLElement).style.transform);
    const transform = viewport(view.container).style.transform;
    const enter = screen.getByRole('button', { name: '全屏查看' });
    fireEvent.click(enter);
    const dialog = screen.getByRole('dialog', { name: '任务依赖图全屏查看' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('task-graph-fullscreen');
    expect(screen.getByRole('button', { name: '退出全屏' })).toBe(enter);
    expect(enter).toHaveFocus();
    expect(view.container.querySelector('.task-graph-canvas')).toBe(canvas);
    [...view.container.querySelectorAll('.react-flow__node')].forEach((node, position) => { expect(node).toBe(nodes[position]); });
    expect(nodes.map((node) => (node as HTMLElement).style.transform)).toEqual(positions);
    expect([...view.container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'))).toEqual(paths);
    expect(viewport(view.container).style.transform).toBe(transform);
    nodeButton('基础 API').focus();
    fireEvent.keyDown(nodeButton('基础 API'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(enter).toHaveAccessibleName('全屏查看');
    expect(enter).toHaveFocus();
    expect(view.container.querySelector('.task-graph-canvas')).toBe(canvas);
    expect(viewport(view.container).style.transform).toBe(transform);
    expect(layout).toHaveBeenCalledTimes(1);
    fireEvent.click(enter);
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(viewport(view.container).style.transform).toBe(transform);
  });

  it('wraps keyboard focus inside fullscreen and leaves Escape outside the graph alone', async () => {
    const user = userEvent.setup();
    const view = render(<><button type="button">图外按钮</button><TaskGraph index={index} rootId="A" onOpenTask={noop} /></>);
    await ready(view.container);
    fireEvent.click(screen.getByRole('button', { name: '全屏查看' }));
    const exit = screen.getByRole('button', { name: '退出全屏' });
    await user.tab({ shift: true });
    const last = document.activeElement;
    expect(last).not.toBe(exit);
    expect(view.container.querySelector('.task-graph')).toContainElement(last as HTMLElement);
    await user.tab();
    expect(exit).toHaveFocus();
    await user.tab();
    expect(within(screen.getByRole('dialog')).getByRole('combobox', { name: '语言 / Language' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '收起到概览' })).toHaveFocus();
    await user.tab();
    expect(nodeButton('基础 API')).toHaveFocus();
    (last as HTMLElement).focus();
    await user.tab();
    expect(exit).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '任务依赖图全屏查看' })).toBeTruthy();
    fireEvent.keyDown(exit, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('inerts background ancestors and restores their original state on exit and unmount without touching body portals', async () => {
    document.body.style.overflow = 'scroll';
    const portal = document.createElement('div');
    portal.textContent = 'body portal';
    document.body.append(portal);
    const view = render(<><button type="button" data-testid="outer-background">项目导航</button><section><div data-testid="preexisting-inert" inert={true} /><TaskGraph index={index} rootId="A" onOpenTask={noop} /><button type="button" data-testid="inner-background">任务链</button></section></>);
    await ready(view.container);
    const background = [screen.getByTestId('outer-background'), screen.getByTestId('inner-background')];
    const existing = screen.getByTestId('preexisting-inert');
    existing.setAttribute('inert', 'preserve-this-value');
    const enter = screen.getByRole('button', { name: '全屏查看' });
    fireEvent.click(enter);
    background.forEach((element) => { expect(element).toHaveAttribute('inert'); });
    expect(document.body.style.overflow).toBe('hidden');
    expect(portal).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }));
    background.forEach((element) => { expect(element).not.toHaveAttribute('inert'); });
    expect(existing).toHaveAttribute('inert', 'preserve-this-value');
    expect(document.body.style.overflow).toBe('scroll');
    fireEvent.click(enter);
    view.unmount();
    background.forEach((element) => { expect(element).not.toHaveAttribute('inert'); });
    expect(existing).toHaveAttribute('inert', 'preserve-this-value');
    expect(document.body.style.overflow).toBe('scroll');
    portal.remove();
    document.body.style.overflow = '';
  });

  it('renders all dependency paths without endpoint measurements and still observes the task nodes', () => {
    const observed = new Set<Element>();
    vi.stubGlobal('ResizeObserver', class {
      observe(target: Element) { observed.add(target); }
      unobserve(target: Element) { observed.delete(target); }
      disconnect() {}
    });
    const { container } = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    const nodes = [...container.querySelectorAll('.react-flow__node')];
    const edges = [...container.querySelectorAll('.react-flow__edge-path')];
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(4);
    expect(nodes.every((node) => observed.has(node))).toBe(true);
    expect(edges.every((edge) => edge.getAttribute('marker-end')?.startsWith('url('))).toBe(true);
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(0);
    expect(container.querySelectorAll('svg.task-dependency-edges')).toHaveLength(1);
  });

  it('renders complete projected nodes and arrows, preserving status, shared nodes, and external predecessors', async () => {
    const { container } = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(5);
    expect(screen.getByText('3 个链内任务 · 2 个外部前置 · 4 条依赖')).toBeTruthy();
    expect(nodeShell('基础 API').classList.contains('task-node-done')).toBe(true);
    expect(nodeShell('合流实现…').classList.contains('task-node-in_progress')).toBe(true);
    fireEvent.click(nodeButton('合流实现…'));
    expect(nodeShell('合流实现…').classList.contains('task-node-selected')).toBe(true);
    expect(nodeShell('最终验收').classList.contains('task-node-todo')).toBe(true);
    expect(within(nodeButton('最终验收')).getByText('被阻塞')).toBeTruthy();
    expect(within(nodeButton('合流实现…')).getByText('共享')).toBeTruthy();
    expect(within(nodeButton('设计方案')).getByText('外部前置')).toBeTruthy();
    expect(nodeShell('设计方案').classList.contains('task-node-done')).toBe(true);
    expect(nodeShell('发布检查').classList.contains('task-node-external')).toBe(true);
    const paths = [...container.querySelectorAll<SVGPathElement>('.react-flow__edge-path')];
    expect(paths.every((path) => path.getAttribute('marker-end')?.startsWith('url('))).toBe(true);
    expect(paths.filter((path) => path.getAttribute('data-external') === 'true')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^独立任务，/ })).toBeNull();
  });

  it('renders the entire external ancestor closure with its own count and keeps card details behavior', async () => {
    const completed = graph.tasks[1]!;
    const externalGraph: TaskGraphData = {
      ...graph, summary: { total: 6, proposed: 0, todo: 3, inProgress: 0, done: 3, ready: 2, blocked: 1 },
      tasks: [
        graph.tasks[0]!,
        { ...completed, id: 'P', titlePreview: '已完成外部祖先', dependsOn: [] },
        { ...completed, id: 'B', titlePreview: '已完成外部前置', dependsOn: ['P'] },
        { ...graph.tasks[3]!, dependsOn: ['A', 'B'], blockedBy: [], ready: true },
        { ...graph.tasks[4]!, id: 'X', titlePreview: '外部前置的无关后续', dependsOn: ['B'], blockedBy: [], ready: true },
        { ...graph.tasks[5]!, id: 'Y', dependsOn: ['D'], blockedBy: ['D'], ready: false },
      ],
    };
    const onOpenTask = vi.fn();
    const { container } = render(<TaskGraph index={buildGraphIndex(externalGraph)} rootId="A" onOpenTask={onOpenTask} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__node')).toHaveLength(5); });
    expect(screen.getByText('3 个链内任务 · 2 个外部前置 · 4 条依赖')).toBeTruthy();
    expect(nodeShell('已完成外部祖先')).toHaveClass('task-node-external', 'task-node-done');
    expect(nodeButton('已完成外部前置')).toHaveAccessibleName('已完成外部前置，已完成，外部前置');
    expect(screen.queryByRole('button', { name: /外部前置的无关后续/ })).toBeNull();
    const externalRoute = container.querySelector<SVGPathElement>('[data-id="P->B"] .react-flow__edge-path')!;
    expect(externalRoute).toHaveAttribute('data-external', 'true');
    expect(externalRoute.style.stroke).toBe('none');
    expect(container.querySelector('[data-id="P->B"] .task-dependency-paint-piece')).toHaveStyle({ strokeDasharray: '5 4' });
    fireEvent.click(nodeButton('已完成外部祖先'));
    expect(onOpenTask).not.toHaveBeenCalled();
    fireEvent.click(detailsButton('已完成外部祖先'));
    expect(onOpenTask).toHaveBeenCalledWith('P', detailsButton('已完成外部祖先'));
    expect(screen.getByText('虚线节点及连线：外部前置 · 展开仅影响当前画布')).toBeTruthy();
  });

  it('renders canonical rounded routes in an accessible noninteractive dependency layer with bounded native arrow markers', async () => {
    const expected = layoutModule.layoutGraph(projectRoot(index, 'A'));
    const { container } = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(container);
    const svg = container.querySelector('svg.task-dependency-edges')!;
    expect(svg.parentElement).toHaveClass('react-flow__viewport-portal');
    expect(svg.closest('.react-flow__viewport')).toBe(viewport(container));
    expect(svg).not.toHaveAttribute('viewBox');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('role', 'group');
    expect(svg).toHaveAttribute('aria-label', '任务依赖关系');
    expect(svg.querySelectorAll('marker')).toHaveLength(3);
    for (const marker of svg.querySelectorAll('marker')) {
      expect(marker).toHaveAttribute('markerWidth', '16');
      expect(marker).toHaveAttribute('markerHeight', '16');
      expect(marker).toHaveAttribute('viewBox', '-10 -10 20 20');
      expect(marker).toHaveAttribute('orient', 'auto-start-reverse');
      expect(marker).toHaveAttribute('markerUnits', 'strokeWidth');
    }
    for (const edge of expected.edges) {
      const relation = svg.querySelector(`[data-id="${edge.id}"]`)!;
      expect(relation).toHaveAttribute('role', 'img');
      expect(relation).toHaveAttribute('aria-label', `前置任务 ${edge.source} → 后续任务 ${edge.target}`);
      expect(relation).toHaveAttribute('focusable', 'false');
      expect(relation.querySelectorAll('a,button,[tabindex]')).toHaveLength(0);
      const path = relation.querySelector('path.react-flow__edge-path')!;
      expect(path).toHaveAttribute('data-source', edge.source);
      expect(path).toHaveAttribute('data-target', edge.target);
      expect(path).toHaveAttribute('aria-hidden', 'true');
      expect(path.getAttribute('marker-end')).toContain('-normal)');
      const coordinates = path.getAttribute('d')!.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
      expect(coordinates.slice(0, 2)).toEqual([edge.points[0]!.x, edge.points[0]!.y]);
      expect(coordinates.slice(-2)).toEqual([edge.points.at(-1)!.x, edge.points.at(-1)!.y]);
    }
    expect([...svg.querySelectorAll('.react-flow__edge-path')].some((path) => path.getAttribute('d')!.includes('Q'))).toBe(true);
  });

  it('retains canonical curves and all local dash paint elements while selection recolors their groups and arrows', async () => {
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const svg = view.container.querySelector('svg.task-dependency-edges')!;
    const children = [...svg.querySelectorAll('g.task-dependency-edge > *')];
    const geometry = children.map((child) => [child.getAttribute('d'), child.getAttribute('transform'), child.getAttribute('x2')]);
    const pieces = [...svg.querySelectorAll<SVGElement>('.task-dependency-paint-piece')];
    expect(Number(svg.getAttribute('data-paint-piece-count'))).toBe(pieces.length);
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(piece).toHaveAttribute('data-piece-kind', piece.tagName);
      expect(piece).toHaveAttribute('aria-hidden', 'true');
      expect(piece).toHaveAttribute('focusable', 'false');
      expect(piece.style.stroke).toBe('inherit');
      expect(piece.style.strokeDasharray).toBe('5 4');
      expect(piece).not.toHaveAttribute('marker-end');
    }
    fireEvent.click(nodeButton('合流实现…'));
    expect([...svg.querySelectorAll('g.task-dependency-edge > *')]).toEqual(children);
    expect(children.map((child) => [child.getAttribute('d'), child.getAttribute('transform'), child.getAttribute('x2')])).toEqual(geometry);
    for (const relation of svg.querySelectorAll<SVGGElement>('.task-dependency-edge')) {
      const highlighted = relation.getAttribute('data-target') === 'C';
      expect(relation).toHaveAttribute('data-inspection', highlighted ? 'highlighted' : 'unrelated');
      expect(relation.querySelector('.react-flow__edge-path')!.getAttribute('marker-end')).toContain(highlighted ? '-highlighted)' : '-unrelated)');
      expect(relation.querySelector('.task-dependency-body')).toHaveAttribute('stroke', highlighted ? '#6762ce' : '#c7cddb');

    }
    expect(svg.querySelectorAll('marker')).toHaveLength(3);
  });

  it('preserves edge geometry and paint fragments through detail feedback and unchanged inspection roles', async () => {
    const open = vi.fn();
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={open} />);
    await ready(view.container);
    fireEvent.click(nodeButton('合流实现…'));
    const paths = [...view.container.querySelectorAll('.react-flow__edge-path')];
    const references = paths.map((path) => path.getAttribute('marker-end'));
    const fragments = [...view.container.querySelectorAll('.task-dependency-paint-piece')];
    fireEvent.click(detailsButton('合流实现…'));
    view.rerender(<TaskGraph index={index} rootId="A" onOpenTask={open} />);
    expect([...view.container.querySelectorAll('.react-flow__edge-path')]).toEqual(paths);
    expect(paths.map((path) => path.getAttribute('marker-end'))).toEqual(references);
    expect([...view.container.querySelectorAll('.task-dependency-paint-piece')]).toEqual(fragments);
    fireEvent.click(nodeButton('最终验收'));
    for (const edgeId of ['A->C', 'B->C']) expect(view.container.querySelector(`[data-id="${edgeId}"] .react-flow__edge-path`)!.getAttribute('marker-end')).toContain('-highlighted)');
  });

  it('keeps dependency paths in the node viewport during zoom and updates them from new snapshots', async () => {
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const svg = view.container.querySelector('svg.task-dependency-edges')!;
    const paths = [...svg.querySelectorAll('path.react-flow__edge-path')];
    const initialPaths = paths.map((path) => path.getAttribute('d'));
    const beforeZoom = viewport(view.container).style.transform;
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    await waitFor(() => { expect(viewport(view.container).style.transform).not.toBe(beforeZoom); });
    expect(view.container.querySelector('svg.task-dependency-edges')).toBe(svg);
    paths.forEach((path, position) => { expect(svg.querySelectorAll('path.react-flow__edge-path')[position]).toBe(path); });
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(initialPaths);
    expect(svg.closest('.react-flow__viewport')).toBe(viewport(view.container));
    expect(view.container.querySelector('.react-flow__nodes')!.parentElement).toBe(viewport(view.container));

    const updated = buildGraphIndex({
      ...graph,
      tasks: graph.tasks.map((task) => task.id === 'D' ? { ...task, dependsOn: ['C'], blockedBy: ['C'] } : task),
    });
    const expected = layoutModule.layoutGraph(projectRoot(updated, 'A'));
    const retainedPath = svg.querySelector('[data-id="A->C"] path');
    view.rerender(<TaskGraph index={updated} rootId="A" onOpenTask={noop} />);
    await waitFor(() => { expect(svg.querySelectorAll('.react-flow__edge-path')).toHaveLength(3); });
    expect(view.container.querySelector('svg.task-dependency-edges')).toBe(svg);
    expect(svg.querySelector('[data-id="A->C"] path')).toBe(retainedPath);
    expect([...svg.querySelectorAll('.task-dependency-edge')].map((edge) => edge.getAttribute('data-id'))).toEqual(expected.edges.map((edge) => edge.id));
    expect([...svg.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'))).not.toEqual(initialPaths);
    expected.nodes.forEach((node) => {
      expect(view.container.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`)!.style.transform).toBe(`translate(${node.position.x}px,${node.position.y}px)`);
    });
  });

  it('separates two sibling native controls for keyboard inspection and details without bubbling', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    render(<TaskGraph index={index} rootId="A" onOpenTask={onOpenTask} />);
    const body = nodeButton('合流实现…');
    const details = detailsButton('合流实现…');
    expect(body.parentElement).toBe(details.parentElement);
    expect(body.querySelector('button')).toBeNull();
    expect(body).not.toHaveAttribute('aria-haspopup');
    expect(details).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(body);
    expect(body).toHaveAttribute('aria-pressed', 'true');
    expect(onOpenTask).not.toHaveBeenCalled();
    body.focus();
    await user.keyboard('{Enter}');
    expect(body).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard(' ');
    expect(body).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    expect(details).toHaveFocus();
    for (const activate of [() => user.keyboard('{Enter}'), () => user.keyboard(' '), () => user.click(details)]) {
      onOpenTask.mockClear();
      await activate();
      expect(onOpenTask).toHaveBeenCalledExactlyOnceWith('C', details);
      expect(body).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('keeps wrapper nodes and edges out of the tab order and exposes only read-only viewport controls', async () => {
    const { container } = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
    for (const node of container.querySelectorAll('.react-flow__node')) {
      expect(node.getAttribute('tabindex')).toBeNull();
      expect(node.classList.contains('draggable')).toBe(false);
      expect(node.classList.contains('selectable')).toBe(false);
      expect(node.querySelectorAll('button')).toHaveLength(2);
    }
    for (const edge of container.querySelectorAll('.react-flow__edge')) {
      expect(edge.getAttribute('tabindex')).toBeNull();
      expect(edge.classList.contains('selectable')).toBe(false);
    }
    expect(container.querySelector('.react-flow__controls-interactive')).toBeNull();
    expect(container.querySelectorAll('.react-flow__handle.connectable')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '放大' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '缩小' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '适应画布' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'React Flow attribution' }).getAttribute('href')).toContain('reactflow.dev');
  });

  it('zooms and fits without recomputing layout, and applies selected styling without moving nodes', async () => {
    const spy = vi.spyOn(layoutModule, 'layoutGraph');
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const timings = performance.getEntriesByName('daynight:task-layout') as PerformanceMeasure[];
    expect(timings).toHaveLength(1);
    expect(timings[0]!.detail).toEqual({ rootId: 'A' });
    expect(timings[0]!.duration).toBeGreaterThanOrEqual(0);
    const initialZoom = zoom(view.container);
    const positions = [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => node.style.transform);
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    await waitFor(() => { expect(zoom(view.container)).toBeGreaterThan(initialZoom); });
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    await waitFor(() => { expect(zoom(view.container)).toBeLessThan(1.2 * initialZoom); });
    fireEvent.click(screen.getByRole('button', { name: '适应画布' }));
    await waitFor(() => { expect(zoom(view.container)).toBeLessThanOrEqual(1); });
    expect(zoom(view.container)).toBeGreaterThanOrEqual(0.2);
    const userViewport = viewport(view.container).style.transform;
    fireEvent.click(nodeButton('最终验收'));
    expect(nodeShell('最终验收').classList.contains('task-node-selected')).toBe(true);
    expect([...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => node.style.transform)).toEqual(positions);
    expect(viewport(view.container).style.transform).toBe(userViewport);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(performance.getEntriesByName('daynight:task-layout')).toEqual(timings);
  });

  it('updates inspection through context while retaining controlled node data, static content and the graph element', async () => {
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const originalButtons = [...view.container.querySelectorAll('.task-node')];
    const originalPaths = [...view.container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'));
    const expectStableGeometry = () => {
      expect(taskRenders).not.toHaveBeenCalled();
      expect(flowNodes).not.toHaveBeenCalled();
      const buttons = [...view.container.querySelectorAll('.task-node')];
      const paths = [...view.container.querySelectorAll('.react-flow__edge-path')];
      expect(buttons).toHaveLength(originalButtons.length);
      expect(paths).toHaveLength(originalPaths.length);
      buttons.forEach((button, position) => { expect(button).toBe(originalButtons[position]); });
      expect(paths.map((path) => path.getAttribute('d'))).toEqual(originalPaths);
    };

    taskRenders.mockClear();
    flowNodes.mockClear();
    fireEvent.click(nodeButton('合流实现…'));
    await waitFor(() => { expect(nodeShell('合流实现…')).toHaveClass('task-node-selected'); });
    expectStableGeometry();

    taskRenders.mockClear();
    fireEvent.click(nodeButton('最终验收'));
    await waitFor(() => { expect(nodeShell('最终验收')).toHaveClass('task-node-selected'); });
    expect(nodeShell('合流实现…')).not.toHaveClass('task-node-selected');
    expectStableGeometry();

    taskRenders.mockClear();
    fireEvent.click(nodeButton('最终验收'));
    await waitFor(() => { expect(nodeShell('最终验收')).not.toHaveClass('task-node-selected'); });
    expectStableGeometry();
  });

  it('keeps controlled nodes and their data identical during inspection and detail feedback, and rebuilds them only for a new snapshot', async () => {
    const open = vi.fn();
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={open} />);
    await ready(view.container);
    const originalNodes = flowNodes.mock.calls.at(-1)![0]!;
    const title = nodeShell('合流实现…').querySelector('.task-node-title')!;
    const status = nodeShell('合流实现…').querySelector('.task-node-bottom')!;
    flowNodes.mockClear();
    fireEvent.click(nodeButton('合流实现…'));
    fireEvent.click(detailsButton('合流实现…'));
    view.rerender(<TaskGraph index={index} rootId="A" onOpenTask={open} />);
    expect(flowNodes).not.toHaveBeenCalled();
    expect(nodeShell('合流实现…').querySelector('.task-node-title')).toBe(title);
    expect(nodeShell('合流实现…').querySelector('.task-node-bottom')).toBe(status);
    expect(nodeButton('合流实现…')).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveBeenCalledExactlyOnceWith('C', detailsButton('合流实现…'));
    const updated = buildGraphIndex({ ...graph, tasks: graph.tasks.map((task) => task.id === 'C' ? { ...task, titlePreview: '新的合流标题' } : task) });
    view.rerender(<TaskGraph index={updated} rootId="A" onOpenTask={open} />);
    await ready(view.container);
    expect(flowNodes.mock.calls.at(-1)![0]).not.toBe(originalNodes);
    expect(nodeButton('新的合流标题…')).toHaveAttribute('aria-pressed', 'true');
  });

  it('highlights the exact transitive upstream closure, toggles selection, and clears on blank canvas without opening details', async () => {
    const open = vi.fn();
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={open} />);
    await ready(view.container);
    fireEvent.click(nodeButton('合流实现…'));
    expect(nodeShell('合流实现…')).toHaveAttribute('data-inspection', 'selected');
    for (const title of ['基础 API', '设计方案']) expect(nodeShell(title)).toHaveAttribute('data-inspection', 'prerequisite');
    for (const title of ['最终验收', '发布检查']) expect(nodeShell(title)).toHaveAttribute('data-inspection', 'unrelated');
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(nodeButton('合流实现…'));
    expect(view.container.querySelectorAll('.task-node-normal')).toHaveLength(5);
    fireEvent.click(nodeButton('基础 API'));
    expect(view.container.querySelectorAll('.task-node-prerequisite')).toHaveLength(0);
    expect(view.container.querySelectorAll('[data-inspection="highlighted"]')).toHaveLength(0);
    fireEvent.click(view.container.querySelector('.react-flow__pane')!);
    expect(view.container.querySelectorAll('.task-node-normal')).toHaveLength(5);
  });

  it('recomputes retained selection from successful snapshots and clears a removed task with usable focus before it can reappear', async () => {
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    fireEvent.click(nodeButton('合流实现…'));
    const changed = buildGraphIndex({ ...graph, tasks: graph.tasks.map((task) => task.id === 'C' ? { ...task, dependsOn: ['A'] } : task) });
    view.rerender(<TaskGraph index={changed} rootId="A" onOpenTask={noop} />);
    await waitFor(() => { expect(nodeButton('合流实现…')).toHaveAttribute('aria-pressed', 'true'); });
    expect(nodeShell('基础 API')).toHaveAttribute('data-inspection', 'prerequisite');
    expect(screen.queryByRole('button', { name: /^设计方案，/ })).toBeNull();
    nodeButton('合流实现…').focus();
    const removed = buildGraphIndex({ ...graph,
      tasks: graph.tasks.filter((task) => task.id !== 'C').map((task) => task.id === 'D' ? { ...task, dependsOn: ['A', 'F'], blockedBy: ['F'] } : task),
      summary: { total: 5, proposed: 0, todo: 3, inProgress: 0, done: 2, ready: 2, blocked: 1 },
    });
    view.rerender(<TaskGraph index={removed} rootId="A" onOpenTask={noop} />);
    await waitFor(() => { expect(view.container.querySelectorAll('.task-node-selected')).toHaveLength(0); });
    expect(screen.getByRole('button', { name: '全屏查看' })).toHaveFocus();
    view.rerender(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await waitFor(() => { expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(1); });
    expect(screen.queryByRole('button', { name: /^合流实现…，/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收起到概览' }));
    await ready(view.container);
    expect(nodeButton('合流实现…')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(nodeButton('合流实现…'));
    view.rerender(<TaskGraph index={index} rootId="B" onOpenTask={noop} />);
    await ready(view.container);
    expect(nodeButton('合流实现…')).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts a long chain at readable zoom and lets the fit control reveal more of it', async () => {
    const tasks = Array.from({ length: 10 }, (_, position) => ({
      ...graph.tasks[0]!, id: `N${position}`, titlePreview: `任务 ${position}`, status: 'todo' as const,
      dependsOn: position === 0 ? [] : [`N${position - 1}`],
      blockedBy: position === 0 ? [] : [`N${position - 1}`], ready: position === 0,
    }));
    const longChain = buildGraphIndex({ ...graph, tasks, summary: { total: 10, proposed: 0, todo: 10, inProgress: 0, done: 0, ready: 1, blocked: 9 } });
    const { container } = render(<TaskGraph index={longChain} rootId="N0" onOpenTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(9); });
    await waitFor(() => { expect(zoom(container)).toBe(0.8); });
    const transform = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(viewport(container).style.transform)!;
    const source = container.querySelector<HTMLElement>('.react-flow__node[data-id="N0"]')!;
    const sourcePosition = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(source.style.transform)!;
    const sourceLeft = Number(sourcePosition[1]) * zoom(container) + Number(transform[1]);
    const sourceTop = Number(sourcePosition[2]) * zoom(container) + Number(transform[2]);
    expect(sourceLeft).toBeGreaterThanOrEqual(0);
    expect(sourceLeft + layoutModule.TASK_NODE_WIDTH * zoom(container)).toBeLessThanOrEqual(800);
    expect(sourceTop).toBeGreaterThanOrEqual(0);
    expect(sourceTop + layoutModule.TASK_NODE_HEIGHT * zoom(container)).toBeLessThanOrEqual(445);
    fireEvent.click(screen.getByRole('button', { name: '适应画布' }));
    await waitFor(() => { expect(zoom(container)).toBeLessThan(0.8); });
    expect(zoom(container)).toBeGreaterThanOrEqual(0.2);
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(10);
  });

  it.each(['body', 'details'])('reveals an offscreen keyboard-focused %s control despite temporary native focus scrolling', async (control) => {
    const tasks = Array.from({ length: 10 }, (_, position) => ({
      ...graph.tasks[0]!, id: `N${position}`, titlePreview: `任务 ${position}`, status: 'todo' as const,
      dependsOn: position === 0 ? [] : [`N${position - 1}`],
      blockedBy: position === 0 ? [] : [`N${position - 1}`], ready: position === 0,
    }));
    const longChain = buildGraphIndex({ ...graph, tasks, summary: { total: 10, proposed: 0, todo: 10, inProgress: 0, done: 0, ready: 1, blocked: 9 } });
    const view = render(<TaskGraph index={longChain} rootId="N0" onOpenTask={noop} />);
    await waitFor(() => { expect(zoom(view.container)).toBe(0.8); });
    const button = control === 'body' ? nodeButton('任务 9') : detailsButton('任务 9');
    const focused = vi.spyOn(button, 'matches').mockReturnValue(false);
    const before = viewport(view.container).style.transform;
    fireEvent.focus(button);
    expect(viewport(view.container).style.transform).toBe(before);
    const flow = view.container.querySelector<HTMLElement>('.react-flow')!;
    flow.scrollLeft = 2000;
    Object.defineProperty(flow, 'scrollTo', { value: (options: ScrollToOptions) => { flow.scrollLeft = options.left!; flow.scrollTop = options.top!; }, configurable: true });
    Object.defineProperty(button.closest('.task-node')!, 'getBoundingClientRect', { value: () => new DOMRect(20, 20, layoutModule.TASK_NODE_WIDTH, layoutModule.TASK_NODE_HEIGHT), configurable: true });
    const beforeZoom = zoom(view.container);
    focused.mockImplementation((selector) => selector === ':focus-visible');
    fireEvent.focus(button);
    fireEvent.scroll(flow);
    await waitFor(() => { expect(viewport(view.container).style.transform).not.toBe(before); });
    expect(flow.scrollLeft).toBe(0);
    expect(zoom(view.container)).toBe(beforeZoom);
  });

  it.each(['body', 'details'])('keeps the intended viewport stable for an already visible keyboard-focused %s control', async (control) => {
    const view = render(<TaskGraph index={index} rootId="A" onOpenTask={noop} />);
    await ready(view.container);
    const button = control === 'body' ? nodeButton('基础 API') : detailsButton('基础 API');
    vi.spyOn(button, 'matches').mockImplementation((selector) => selector === ':focus-visible');
    const before = viewport(view.container).style.transform;
    fireEvent.focus(button);
    expect(viewport(view.container).style.transform).toBe(before);
  });

  it('shows layout failures explicitly without pretending there are zero tasks', () => {
    render(<TaskGraph index={index} rootId="missing-root" onOpenTask={noop} />);
    expect(screen.getByRole('alert').textContent).toContain('任务图布局失败');
    expect(screen.queryByRole('application')).toBeNull();
    expect(screen.queryByText(/0 个节点/)).toBeNull();
  });
});

describe('progressive task visibility', () => {
  const fixture = browsingProjects.progressive;
  const progressiveIndex = buildGraphIndex(fixture);
  const rootId = fixture.tasks.find((task) => task.titlePreview === '渐进展开 · 主链交付起点')!.id;
  const visibleIds = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => node.dataset.id!);
  const taskIds = new Map(fixture.tasks.map((task) => [task.titlePreview, task.id]));
  const taskShell = (container: HTMLElement, title: string) => container.querySelector<HTMLElement>(`.react-flow__node[data-id="${taskIds.get(title)!}"] .task-node`)!;
  const taskBody = (container: HTMLElement, title: string) => within(taskShell(container, title)).getByRole('button', { name: new RegExp(`^${title}，(?!详情$)`) });
  const taskDetails = (container: HTMLElement, title: string) => within(taskShell(container, title)).getByRole('button', { name: `${title}，详情` });
  const expansion = (container: HTMLElement, title: string, direction: string) => taskShell(container, title).querySelector<HTMLButtonElement>(`.task-node-expand[data-direction="${direction}"]`)!;
  const rendered = async (container: HTMLElement, nodes: number, edges: number) => {
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__node')).toHaveLength(nodes); });
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(edges); });
  };

  it('traces the full hidden upstream closure and opens Details without expanding or changing the overview layout', async () => {
    const open = vi.fn();
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const view = render(<TaskGraph index={progressiveIndex} rootId={rootId} onOpenTask={open} />);
    await rendered(view.container, 50, 49);
    await waitFor(() => { expect(zoom(view.container)).toBe(0.8); });
    const originalIds = visibleIds(view.container);
    const originalViewport = viewport(view.container).style.transform;
    expect(within(view.container.querySelector<HTMLElement>('.graph-toolbar')!).getByText('61 个链内任务 · 40 个外部前置 · 100 条依赖')).toBeTruthy();
    expect(view.container.querySelector('.task-graph')).toHaveAttribute('data-hidden-upstream-count', '0');
    const body = taskBody(view.container, '合流任务 · 40 个外部前置');
    flowNodes.mockClear();
    fireEvent.click(body);
    expect(view.container.querySelector('.graph-hidden-prerequisites')).toHaveTextContent(/^另有40个上游未展开$/);
    expect(visibleIds(view.container)).toEqual(originalIds);
    expect(viewport(view.container).style.transform).toBe(originalViewport);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(flowNodes).not.toHaveBeenCalled();
    const details = taskDetails(view.container, '合流任务 · 40 个外部前置');
    fireEvent.click(details);
    expect(open).toHaveBeenCalledExactlyOnceWith(taskIds.get('合流任务 · 40 个外部前置'), details);
    expect(visibleIds(view.container)).toEqual(originalIds);
    expect(body).toHaveAttribute('aria-pressed', 'true');
    expect(view.container.querySelector('.graph-hidden-prerequisites')).toHaveTextContent(/^另有40个上游未展开$/);
    expect(viewport(view.container).style.transform).toBe(originalViewport);
    expect(layout).toHaveBeenCalledTimes(1);
  });

  it('expands direct prerequisite and successor batches with exact counts and resets the full graph to its original overview', async () => {
    const user = userEvent.setup();
    const view = render(<TaskGraph index={progressiveIndex} rootId={rootId} onOpenTask={noop} />);
    await rendered(view.container, 50, 49);
    await waitFor(() => { expect(zoom(view.container)).toBe(0.8); });
    const originalIds = visibleIds(view.container);
    const originalRoutes = [...view.container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'));
    const originalViewport = viewport(view.container).style.transform;
    const body = taskBody(view.container, '合流任务 · 40 个外部前置');
    const rootBody = taskBody(view.container, '渐进展开 · 主链交付起点');
    const hiddenUpstream = view.container.querySelector('.graph-hidden-prerequisites');
    fireEvent.click(body);
    const upstream = expansion(view.container, '合流任务 · 40 个外部前置', 'prerequisites');
    expect(upstream).toHaveAttribute('data-added-tasks', '20');
    expect(upstream).toHaveAttribute('data-added-edges', '20');
    expect(upstream).toHaveAttribute('data-remaining', '20');
    expect(upstream).toHaveAccessibleName('展开前置 20 个任务、20 条依赖，剩余 20 个前置未展开');
    upstream.focus();
    await user.keyboard('{Enter}');
    await rendered(view.container, 70, 69);
    await waitFor(() => { expect(body).toHaveFocus(); });
    expect(zoom(view.container)).toBe(0.8);
    expect(body).toHaveAttribute('aria-pressed', 'true');
    expect(hiddenUpstream).toHaveTextContent(/^另有20个上游未展开$/);
    const downstream = expansion(view.container, '渐进展开 · 主链交付起点', 'successors');
    expect(downstream).toHaveAttribute('data-added-tasks', '11');
    expect(downstream).toHaveAttribute('data-added-edges', '11');
    expect(downstream).toHaveAttribute('data-remaining', '0');
    fireEvent.click(downstream);
    await rendered(view.container, 81, 80);
    await waitFor(() => { expect(rootBody).toHaveFocus(); });
    expect(body).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(expansion(view.container, '合流任务 · 40 个外部前置', 'prerequisites'));
    await rendered(view.container, 101, 100);
    expect(view.container.querySelector('.task-graph')).toHaveAttribute('data-hidden-upstream-count', '0');
    expect(view.container.querySelectorAll('.task-node-expand')).toHaveLength(0);
    expect(progressiveIndex.rootProgress.get(rootId)).toEqual({ total: 61, done: 0, status: 'todo' });
    const reset = within(view.container.querySelector<HTMLElement>('.graph-toolbar')!).getByRole('button', { name: '收起到概览' });
    await user.click(reset);
    await rendered(view.container, 50, 49);
    expect(reset).toHaveFocus();
    expect(visibleIds(view.container)).toEqual(originalIds);
    expect([...view.container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'))).toEqual(originalRoutes);
    expect(viewport(view.container).style.transform).toBe(originalViewport);
    expect(body).toHaveAttribute('aria-pressed', 'true');
    expect(hiddenUpstream).toHaveTextContent(/^另有40个上游未展开$/);
  });

  it('clears a selection hidden by reset and retains actual visible IDs through refresh until an explicit new overview', async () => {
    const view = render(<><button type="button">详情关闭控件</button><TaskGraph index={progressiveIndex} rootId={rootId} onOpenTask={noop} /></>);
    await rendered(view.container, 50, 49);
    const initialIds = visibleIds(view.container);
    fireEvent.click(expansion(view.container, '渐进展开 · 主链交付起点', 'successors'));
    await rendered(view.container, 61, 60);
    fireEvent.click(taskBody(view.container, '主链后续 60'));
    expect(taskBody(view.container, '主链后续 60')).toHaveAttribute('aria-pressed', 'true');
    const reset = screen.getByRole('button', { name: '收起到概览' });
    fireEvent.click(reset);
    await rendered(view.container, 50, 49);
    expect(reset).toHaveFocus();
    expect(screen.queryByRole('button', { name: /^主链后续 60，/ })).toBeNull();
    expect(view.container.querySelectorAll('.task-node-selected')).toHaveLength(0);
    const sourcePosition = fixture.tasks.findIndex((task) => task.id === rootId);
    const addition = { ...fixture.tasks[sourcePosition + 2]!, id: 'new-main', titlePreview: '新增直接后续' };
    const refreshed = buildGraphIndex({ ...fixture, tasks: [...fixture.tasks.slice(0, sourcePosition + 1), addition, ...fixture.tasks.slice(sourcePosition + 1)], summary: { ...fixture.summary, total: 102, todo: 62, blocked: 61 } });
    const outside = screen.getByRole('button', { name: '详情关闭控件' });
    outside.focus();
    const beforeRefresh = viewport(view.container).style.transform;
    view.rerender(<><button type="button">详情关闭控件</button><TaskGraph index={refreshed} rootId={rootId} onOpenTask={noop} /></>);
    await rendered(view.container, 50, 49);
    expect(visibleIds(view.container)).toEqual(initialIds);
    expect(screen.queryByRole('button', { name: /^新增直接后续，/ })).toBeNull();
    expect(outside).toHaveFocus();
    expect(viewport(view.container).style.transform).toBe(beforeRefresh);
    fireEvent.click(reset);
    await rendered(view.container, 50, 49);
    expect(within(view.container.querySelector<HTMLElement>('.react-flow__node[data-id="new-main"]')!).getByRole('button', { name: '新增直接后续，待处理，被阻塞' })).toBeTruthy();
    expect(visibleIds(view.container)).not.toEqual(initialIds);
    expect(reset).toHaveFocus();
  });
  it('recovers graph focus when refresh removes a focused visible card', async () => {
    const view = render(<TaskGraph index={progressiveIndex} rootId={rootId} onOpenTask={noop} />);
    await rendered(view.container, 50, 49);
    fireEvent.click(expansion(view.container, '合流任务 · 40 个外部前置', 'prerequisites'));
    await rendered(view.container, 70, 69);
    const removedId = fixture.tasks.find((task) => task.titlePreview === '外部前置 1 · 已完成共享协议')!.id;
    taskBody(view.container, '外部前置 1 · 已完成共享协议').focus();
    const tasks = fixture.tasks.filter((task) => task.id !== removedId).map((task) => ({ ...task, dependsOn: task.dependsOn.filter((id) => id !== removedId) }));
    const refreshed = buildGraphIndex({ ...fixture, tasks, summary: { ...fixture.summary, total: 100, done: 39 } });
    view.rerender(<TaskGraph index={refreshed} rootId={rootId} onOpenTask={noop} />);
    await rendered(view.container, 69, 68);
    expect(screen.getByRole('button', { name: '全屏查看' })).toHaveFocus();
  });

  it.each([false, true])('recovers a removed expansion control without taking focus from an open dialog (dialog=%s)', async (dialogFocused) => {
    const ui = (index: ReturnType<typeof buildGraphIndex>) => <><div role="dialog" aria-label="详情测试窗口"><button type="button">详情关闭控件</button></div><TaskGraph index={index} rootId={rootId} onOpenTask={noop} /></>;
    const view = render(ui(progressiveIndex));
    await rendered(view.container, 50, 49);
    const footer = expansion(view.container, '渐进展开 · 主链交付起点', 'successors');
    footer.focus();
    const dialogButton = screen.getByRole('button', { name: '详情关闭控件' });
    if (dialogFocused) dialogButton.focus();
    const transform = viewport(view.container).style.transform;
    const tasks = fixture.tasks.filter((task) => !task.titlePreview.startsWith('主链后续 ') || Number(task.titlePreview.slice('主链后续 '.length)) <= 49);
    const refreshed = buildGraphIndex({ ...fixture, tasks, summary: { ...fixture.summary, total: 90, todo: 50, blocked: 49 } });
    view.rerender(ui(refreshed));
    await rendered(view.container, 50, 49);
    await waitFor(() => { expect(footer.isConnected).toBe(false); });
    await waitFor(() => { expect(dialogFocused ? dialogButton : taskBody(view.container, '渐进展开 · 主链交付起点')).toHaveFocus(); });
    expect(taskBody(view.container, '渐进展开 · 主链交付起点')).toBeTruthy();
    expect(viewport(view.container).style.transform).toBe(transform);
  });

  it('reveals an offscreen expansion control using intended viewport coordinates before native scroll resets', async () => {
    const view = render(<TaskGraph index={progressiveIndex} rootId={rootId} onOpenTask={noop} />);
    await rendered(view.container, 50, 49);
    await waitFor(() => { expect(zoom(view.container)).toBe(0.8); });
    const button = expansion(view.container, '合流任务 · 40 个外部前置', 'prerequisites');
    vi.spyOn(button, 'matches').mockImplementation((selector) => selector === ':focus-visible');
    const flow = view.container.querySelector<HTMLElement>('.react-flow')!;
    flow.scrollLeft = 2000;
    Object.defineProperty(flow, 'scrollTo', { value: (options: ScrollToOptions) => { flow.scrollLeft = options.left!; flow.scrollTop = options.top!; }, configurable: true });
    Object.defineProperty(button, 'getBoundingClientRect', { value: () => new DOMRect(20, 20, layoutModule.TASK_NODE_WIDTH, layoutModule.TASK_NODE_HEIGHT), configurable: true });
    const before = viewport(view.container).style.transform;
    fireEvent.focus(button);
    fireEvent.scroll(flow);
    await waitFor(() => { expect(viewport(view.container).style.transform).not.toBe(before); });
    expect(flow.scrollLeft).toBe(0);
    expect(zoom(view.container)).toBe(0.8);
  });
});

describe('initial task viewport policy', () => {
  it('centers a fitting graph normally rather than anchoring every root to the left', () => {
    const geometry = layoutModule.layoutGraph({ rootId: 'root', mainIds: new Set(['root']), externalIds: new Set(), edges: [], completed: 0 });
    const actual = getInitialTaskViewport(geometry, 'root', 800, 445);
    const root = geometry.nodes[0]!;
    expect(actual.zoom).toBeGreaterThanOrEqual(0.8);
    expect(actual.zoom).toBeLessThanOrEqual(1);
    expect(root.position.x * actual.zoom + actual.x).toBeGreaterThan(32);
    expect((root.position.x + layoutModule.TASK_NODE_WIDTH / 2) * actual.zoom + actual.x).toBeCloseTo(400);
    expect((root.position.y + layoutModule.TASK_NODE_HEIGHT / 2) * actual.zoom + actual.y).toBeCloseTo(222.5);
  });

  it.each([320, 800])('starts with the complete leftmost upstream region when it lies before the root at width %s', (width) => {
    const geometry: layoutModule.CanvasLayout = {
      nodes: [
        { id: 'root', kind: 'main', position: { x: 20000, y: 12000 } },
        { id: 'later-upstream', kind: 'external', position: { x: 32, y: 9000 } },
        { id: 'first-upstream', kind: 'external', position: { x: 32, y: 2000 } },
        { id: 'tail', kind: 'main', position: { x: 20284, y: 12000 } },
      ], edges: [], width: 20536, height: 13000,
    };
    const actual = getInitialTaskViewport(geometry, 'root', width, 445);
    expect(actual.zoom).toBe(0.8);
    expect(32 * actual.zoom + actual.x).toBe(32);
    expect(2000 * actual.zoom + actual.y).toBe(32);
    expect((32 + layoutModule.TASK_NODE_WIDTH) * actual.zoom + actual.x).toBeLessThan(width);
    expect((2000 + layoutModule.TASK_NODE_HEIGHT) * actual.zoom + actual.y).toBeLessThan(445);
  });

  it.each([
    ['wide', 20000, 6000],
    ['tall', 32, 20000],
  ])('keeps the source root visible when readable zoom cannot contain the %s bounds', (_kind, tailX, tailY) => {
    const geometry: layoutModule.CanvasLayout = {
      nodes: [
        { id: 'root', kind: 'main', position: { x: 32, y: 6000 } },
        { id: 'tail', kind: 'main', position: { x: tailX, y: tailY } },
      ], edges: [], width: tailX + 252, height: tailY + 6128,
    };
    const actual = getInitialTaskViewport(geometry, 'root', 800, 445);
    expect(actual.zoom).toBe(0.8);
    expect(32 * actual.zoom + actual.x).toBe(32);
    expect((6000 + layoutModule.TASK_NODE_HEIGHT / 2) * actual.zoom + actual.y).toBeCloseTo(222.5);
  });
  it('anchors a folded overview to its root even when visible prerequisites are far to the left', () => {
    const geometry: layoutModule.CanvasLayout = {
      nodes: [
        { id: 'upstream', kind: 'external', position: { x: 32, y: 32 } },
        { id: 'root', kind: 'main', position: { x: 20000, y: 4000 } },
      ],
      edges: [], width: 20252, height: 4168,
    };
    for (const width of [320, 800]) {
      const actual = getInitialTaskViewport(geometry, 'root', width, 445, true);
      expect(actual.zoom).toBe(0.8);
      expect(actual.x + 20000 * actual.zoom).toBe(32);
      expect(actual.y + (4000 + layoutModule.TASK_NODE_HEIGHT / 2) * actual.zoom).toBe(445 / 2);
      expect(32 + layoutModule.TASK_NODE_WIDTH * actual.zoom).toBeLessThan(width);
    }
  });
});

describe('root task accordion', () => {
  it('renders the presented root order without changing the complete graph index', () => {
    const rootIds = index.roots.toReversed();
    const view = render(<RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={rootIds} expandedRootId={null} onExpand={noop} onOpenTask={noop} />);
    expect([...view.container.querySelectorAll('.root-toggle')].map((root) => root.id)).toEqual(['task-root-F', 'task-root-E', 'task-root-B', 'task-root-A']);
    expect(index.roots).toEqual(['A', 'B', 'E', 'F']);
    expect(index.successors.get('A')).toEqual(['C']);
    expect(index.rootProgress.get('A')).toEqual({ total: 3, done: 1, status: 'in_progress' });
    expect(screen.getByLabelText('显示 4 条，共 4 条任务链')).toHaveTextContent('4 / 4');
  });

  it('retains collapsed root renders during selection and still applies their new snapshot progress', async () => {
    const progressReads = vi.spyOn(index.rootProgress, 'get');
    const view = render(<RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={index.roots} expandedRootId="A" onExpand={noop} onOpenTask={noop} />);
    await ready(view.container);
    const originalRoots = [...view.container.querySelectorAll('.root-toggle')];
    const originalCanvas = view.container.querySelector('.task-graph-canvas');
    expect(originalRoots[0]!.querySelector('.root-status')).toHaveTextContent('进行中');
    expect(originalRoots[0]!.querySelector('.root-status')).toHaveClass('graph-status-in_progress');
    expect(originalRoots[2]!.querySelector('.root-status')).toHaveClass('graph-status-todo');
    expect(originalRoots[3]!.querySelector('.root-status')).toHaveTextContent('待处理');

    for (const selectedTaskId of ['C', 'D', null]) {
      progressReads.mockClear();
      fireEvent.click(nodeButton(selectedTaskId === 'C' ? '合流实现…' : '最终验收'));
      await waitFor(() => {
        const selectedNodes = view.container.querySelectorAll('.task-node-selected');
        expect(selectedNodes).toHaveLength(selectedTaskId === null ? 0 : 1);
        if (selectedTaskId !== null) expect(selectedNodes[0]!.closest('.react-flow__node')).toHaveAttribute('data-id', selectedTaskId);
      });
      expect(progressReads).not.toHaveBeenCalled();
      const roots = [...view.container.querySelectorAll('.root-toggle')];
      expect(roots).toHaveLength(originalRoots.length);
      roots.forEach((root, position) => { expect(root).toBe(originalRoots[position]); });
      expect(view.container.querySelector('.task-graph-canvas')).toBe(originalCanvas);
    }

    const refreshed = buildGraphIndex({
      ...graph,
      tasks: graph.tasks.map((task) => ({ ...task, status: 'done', blockedBy: [], ready: false })),
      summary: { total: 6, proposed: 0, todo: 0, inProgress: 0, done: 6, ready: 0, blocked: 0 },
    });
    view.rerender(<RootList showCompleted={true} onShowCompletedChange={noop} index={refreshed} allRootIds={refreshed.roots} rootIds={refreshed.roots} expandedRootId="A" onExpand={noop} onOpenTask={noop} />);
    expect(originalRoots[2]!.querySelector('.root-progress-label')).toHaveTextContent('1/1 已完成');
    expect(originalRoots[2]!.querySelector('.root-status')).toHaveTextContent('已完成');
    expect(originalRoots[0]!.querySelector('.root-progress-label')).toHaveTextContent('3/3 已完成');
    expect(originalRoots[0]!.querySelector('.root-status')).toHaveTextContent('已完成');
    expect(originalRoots[0]!.querySelector('.root-status')).toHaveClass('graph-status-done');
    expect(screen.getByRole('checkbox', { name: '显示已完成任务链（4）' })).toBeChecked();
    expect(view.container.querySelectorAll('.root-toggle')[2]).toBe(originalRoots[2]);
  });

  it('shows aggregate chain status and unmounts all but the expanded graph', async () => {
    const Wrapper = () => {
      const [expandedRootId, onExpand] = useState<string | null>('A');
      return <RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={index.roots} expandedRootId={expandedRootId} onExpand={onExpand} onOpenTask={noop} />;
    };
    const { container } = render(<Wrapper />);
    const roots = container.querySelectorAll<HTMLButtonElement>('.root-toggle');
    expect(roots).toHaveLength(4);
    expect(roots[0]!.id).toBe('task-root-A');
    expect(roots[0]!.textContent).toContain('1/3 已完成');
    expect(roots[0]!.querySelector('.root-status')).toHaveTextContent('进行中');
    expect(nodeShell('基础 API')).toHaveClass('task-node-done');
    expect(roots[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('.task-graph-canvas')).toHaveLength(1);
    const firstCanvas = container.querySelector('.task-graph-canvas');
    fireEvent.click(roots[1]!);
    expect((performance.getEntriesByName('daynight:task-layout') as PerformanceMeasure[]).map((entry) => entry.detail)).toEqual([{ rootId: 'B' }]);
    expect(roots[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(roots[1]!.getAttribute('aria-expanded')).toBe('true');
    expect(firstCanvas?.isConnected).toBe(false);
    expect(container.querySelectorAll('.task-graph-canvas')).toHaveLength(1);
    fireEvent.click(roots[1]!);
    expect(container.querySelectorAll('.task-graph-canvas')).toHaveLength(0);
    fireEvent.click(roots[2]!);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1); });
    expect(roots[2]!.textContent).toContain('独立任务');
    expect(roots[2]!.textContent).toContain('0/1 已完成');
  });

  it('renders task previews as plain text in both the accordion and nodes', () => {
    const untrusted = '<img src=x onerror=alert(1)>'.repeat(6);
    const snapshot = { ...graph, tasks: graph.tasks.map((task) => task.id === 'A' ? { ...task, titlePreview: untrusted, titleTruncated: true } : task) };
    const { container } = render(<RootList showCompleted={true} onShowCompletedChange={noop} index={buildGraphIndex(snapshot)} allRootIds={index.roots} rootIds={index.roots} expandedRootId="A" onExpand={noop} onOpenTask={noop} />);
    expect(screen.getAllByText(`${untrusted}…`)).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
