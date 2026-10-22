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
import { installGraphMeasurements } from './graph-measurements';

const render = createLocaleRender('zh-CN');

const taskRenders = vi.hoisted(() => vi.fn<(id: string) => void>());
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
  summary: { total: 6, todo: 3, inProgress: 1, done: 2, ready: 2, blocked: 1 },
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
const nodeButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}，`) });
const viewport = (container: HTMLElement) => container.querySelector<HTMLElement>('.react-flow__viewport')!;
const zoom = (container: HTMLElement) => Number(/scale\(([^)]+)\)/.exec(viewport(container).style.transform)![1]);
const ready = async (container: HTMLElement) => {
  await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
  await waitFor(() => { expect(viewport(container).style.transform).not.toBe('translate(0px,0px) scale(1)'); });
};

beforeEach(installGraphMeasurements);

describe('task dependency canvas', () => {
  it('expands the existing canvas and restores its toolbar focus without changing the user viewport or layout', async () => {
    const layout = vi.spyOn(layoutModule, 'layoutGraph');
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
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
    const view = render(<><button type="button">图外按钮</button><TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} /></>);
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
    const view = render(<><button type="button" data-testid="outer-background">项目导航</button><section><div data-testid="preexisting-inert" inert={true} /><TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} /><button type="button" data-testid="inner-background">任务链</button></section></>);
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
    const { container } = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
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
    const { container } = render(<TaskGraph index={index} rootId="A" selectedTaskId="C" onSelectTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(5);
    expect(screen.getByText('3 个链内任务 · 2 个外部前置 · 4 条依赖')).toBeTruthy();
    expect(nodeButton('基础 API').classList.contains('task-node-done')).toBe(true);
    expect(nodeButton('合流实现…').classList.contains('task-node-in_progress')).toBe(true);
    expect(nodeButton('合流实现…').classList.contains('task-node-selected')).toBe(true);
    expect(nodeButton('最终验收').classList.contains('task-node-todo')).toBe(true);
    expect(within(nodeButton('最终验收')).getByText('被阻塞')).toBeTruthy();
    expect(within(nodeButton('合流实现…')).getByText('共享')).toBeTruthy();
    expect(within(nodeButton('设计方案')).getByText('外部前置')).toBeTruthy();
    expect(nodeButton('设计方案').classList.contains('task-node-done')).toBe(true);
    expect(nodeButton('发布检查').classList.contains('task-node-external')).toBe(true);
    const paths = [...container.querySelectorAll<SVGPathElement>('.react-flow__edge-path')];
    expect(paths.every((path) => path.getAttribute('marker-end')?.startsWith('url('))).toBe(true);
    expect(paths.filter((path) => path.style.strokeDasharray === '5 4')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^独立任务，/ })).toBeNull();
  });

  it('renders the entire external ancestor closure with its own count and keeps card details behavior', async () => {
    const completed = graph.tasks[1]!;
    const externalGraph: TaskGraphData = {
      ...graph, summary: { total: 6, todo: 3, inProgress: 0, done: 3, ready: 2, blocked: 1 },
      tasks: [
        graph.tasks[0]!,
        { ...completed, id: 'P', titlePreview: '已完成外部祖先', dependsOn: [] },
        { ...completed, id: 'B', titlePreview: '已完成外部前置', dependsOn: ['P'] },
        { ...graph.tasks[3]!, dependsOn: ['A', 'B'], blockedBy: [], ready: true },
        { ...graph.tasks[4]!, id: 'X', titlePreview: '外部前置的无关后续', dependsOn: ['B'], blockedBy: [], ready: true },
        { ...graph.tasks[5]!, id: 'Y', dependsOn: ['D'], blockedBy: ['D'], ready: false },
      ],
    };
    const onSelectTask = vi.fn();
    const { container } = render(<TaskGraph index={buildGraphIndex(externalGraph)} rootId="A" selectedTaskId={null} onSelectTask={onSelectTask} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__node')).toHaveLength(5); });
    expect(screen.getByText('3 个链内任务 · 2 个外部前置 · 4 条依赖')).toBeTruthy();
    expect(nodeButton('已完成外部祖先')).toHaveClass('task-node-external', 'task-node-done');
    expect(nodeButton('已完成外部前置')).toHaveAccessibleName('已完成外部前置，已完成，外部前置');
    expect(screen.queryByRole('button', { name: /外部前置的无关后续/ })).toBeNull();
    const externalRoute = container.querySelector('[data-id="P->B"] .react-flow__edge-path');
    expect(externalRoute).toHaveStyle({ strokeDasharray: '5 4' });
    fireEvent.click(nodeButton('已完成外部祖先'));
    expect(onSelectTask).toHaveBeenCalledWith('P', nodeButton('已完成外部祖先'));
    expect(screen.getByText('虚线节点及连线：外部前置（已补齐全部上游）')).toBeTruthy();
  });

  it('uses every exact Dagre point in an accessible noninteractive dependency layer', async () => {
    const expected = layoutModule.layoutGraph({ rootId: 'A', mainIds: new Set(['A', 'C', 'D']), externalIds: new Set(['B', 'F']), edges: [
      { source: 'A', target: 'C', external: false }, { source: 'B', target: 'C', external: true },
      { source: 'C', target: 'D', external: false }, { source: 'F', target: 'D', external: true },
    ], completed: 1 });
    const { container } = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(expected.edges.length); });
    const actualPaths = [...container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'));
    expect(actualPaths).toEqual(expected.edges.map((edge) => edge.points.map((point, position) => `${position === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')));
    const svg = container.querySelector('svg.task-dependency-edges')!;
    expect(svg.parentElement).toHaveClass('react-flow__viewport-portal');
    expect(svg.closest('.react-flow__viewport')).toBe(viewport(container));
    expect(svg).toHaveAttribute('width', '100%');
    expect(svg).toHaveAttribute('height', '100%');
    expect(svg).not.toHaveAttribute('viewBox');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('role', 'group');
    expect(svg).toHaveAttribute('aria-label', '任务依赖关系');
    const marker = svg.querySelector('marker')!;
    expect(marker).toHaveAttribute('markerWidth', '16');
    expect(marker).toHaveAttribute('markerHeight', '16');
    expect(marker).toHaveAttribute('viewBox', '-10 -10 20 20');
    expect(marker).toHaveAttribute('orient', 'auto-start-reverse');
    expect(marker).toHaveAttribute('markerUnits', 'strokeWidth');
    const relations = [...svg.querySelectorAll('g.task-dependency-edge')];
    expect(relations).toHaveLength(expected.edges.length);
    relations.forEach((relation, position) => {
      const edge = expected.edges[position]!;
      expect(relation).toHaveAttribute('data-id', edge.id);
      expect(relation).toHaveAttribute('role', 'img');
      expect(relation).toHaveAttribute('aria-label', `前置任务 ${edge.source} → 后续任务 ${edge.target}`);
      expect(relation).toHaveAttribute('focusable', 'false');
      expect(relation).not.toHaveAttribute('tabindex');
      expect(relation.querySelectorAll('a,button,[tabindex]')).toHaveLength(0);
      const path = relation.querySelector('path.react-flow__edge-path')!;
      expect(path).toHaveAttribute('data-source', edge.source);
      expect(path).toHaveAttribute('data-target', edge.target);
      expect(path).toHaveAttribute('aria-hidden', 'true');
      expect(path).toHaveAttribute('marker-end', `url(#${marker.id})`);
    });
  });

  it('paints complete dashed bodies before their canonical native arrow paths without changing solid edges', () => {
    const geometry = layoutModule.layoutGraph(projectRoot(index, 'A'));
    const original = geometry.edges.map((edge) => ({
      ...edge, points: [{ x: 10, y: 20 }, { x: 1010, y: 20 }, { x: 1010, y: 1020 }, { x: 2010, y: 1020 }],
    }));
    vi.spyOn(layoutModule, 'layoutGraph').mockReturnValue({ ...geometry, edges: original });
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    const svg = view.container.querySelector('svg.task-dependency-edges')!;
    const allPieces = [...svg.querySelectorAll<SVGElement>('.task-dependency-paint-piece')];
    expect(Number(svg.getAttribute('data-paint-piece-count'))).toBe(allPieces.length);
    expect(allPieces.length).toBeGreaterThan(0);
    for (const edge of original) {
      const relation = svg.querySelector(`[data-id="${edge.id}"]`)!;
      const canonical = relation.querySelector<SVGPathElement>('.react-flow__edge-path')!;
      const pieces = [...relation.querySelectorAll<SVGElement>('.task-dependency-paint-piece')];
      expect(relation.lastElementChild).toBe(canonical);
      expect(canonical.getAttribute('d')).toBe('M10,20 L1010,20 L1010,1020 L2010,1020');
      expect(canonical.style.strokeWidth).toBe('1.5');
      expect(canonical.style.stroke).toBe(edge.external ? 'none' : 'rgb(171, 178, 199)');
      expect(canonical.getAttribute('marker-end')).toBe(`url(#${svg.querySelector('marker')!.id})`);
      if (!edge.external) {
        expect(pieces).toHaveLength(0);
        expect(canonical.style.strokeDasharray).toBe('');
        continue;
      }
      expect(canonical.style.strokeDasharray).toBe('5 4');
      expect(pieces.some((piece) => piece.tagName === 'line')).toBe(true);
      expect(pieces.some((piece) => piece.tagName === 'path')).toBe(true);
      for (const piece of pieces) {
        expect(piece).toHaveAttribute('data-piece-kind', piece.tagName);
        expect(piece).toHaveAttribute('aria-hidden', 'true');
        expect(piece).toHaveAttribute('focusable', 'false');
        expect(piece.style.pointerEvents).toBe('none');
        expect(piece.style.stroke).toBe('rgb(171, 178, 199)');
        expect(piece.style.strokeWidth).toBe('1.5');
        expect(piece.style.strokeDasharray).toBe('5 4');
        expect(piece.style.strokeLinecap).toBe('butt');
        expect(piece.style.strokeLinejoin).toBe('miter');
        expect(piece.style.fill).toBe('none');
        expect(piece).not.toHaveAttribute('marker-end');
        expect(piece).not.toHaveAttribute('tabindex');
        if (piece.tagName === 'line') {
          expect(piece).toHaveAttribute('x1', '0');
          expect(piece).toHaveAttribute('y1', '0');
          expect(piece).toHaveAttribute('y2', '0');
          expect(Number(piece.getAttribute('x2'))).toBeGreaterThan(0);
          expect(piece.getAttribute('transform')).toMatch(/^matrix\([^)]*\)$/);
        } else expect(piece.getAttribute('d')).toMatch(/^M[-\d.,]+(?: L[-\d.,]+)+$/);
      }
    }
    const children = [...svg.querySelectorAll('g.task-dependency-edge > *')];
    view.rerender(<TaskGraph index={index} rootId="A" selectedTaskId="C" onSelectTask={noop} />);
    expect(view.container.querySelector('svg.task-dependency-edges')).toBe(svg);
    expect([...svg.querySelectorAll('g.task-dependency-edge > *')]).toEqual(children);
    children.forEach((child, position) => { expect(svg.querySelectorAll('g.task-dependency-edge > *')[position]).toBe(child); });
  });

  it('keeps dependency paths in the node viewport during zoom and updates them from new snapshots', async () => {
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
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
    view.rerender(<TaskGraph index={updated} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await waitFor(() => { expect(svg.querySelectorAll('.react-flow__edge-path')).toHaveLength(3); });
    expect(view.container.querySelector('svg.task-dependency-edges')).toBe(svg);
    expect(svg.querySelector('[data-id="A->C"] path')).toBe(retainedPath);
    expect([...svg.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'))).toEqual(
      expected.edges.map((edge) => edge.points.map((point, position) => `${position === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')),
    );
    expected.nodes.forEach((node) => {
      expect(view.container.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`)!.style.transform).toBe(`translate(${node.position.x}px,${node.position.y}px)`);
    });
  });

  it('opens each node once using mouse, Enter, or Space and returns the actual native trigger', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={onSelectTask} />);
    const button = nodeButton('合流实现…');
    await user.click(button);
    expect(onSelectTask).toHaveBeenCalledExactlyOnceWith('C', button);
    onSelectTask.mockClear();
    button.focus();
    await user.keyboard('{Enter}');
    expect(onSelectTask).toHaveBeenCalledExactlyOnceWith('C', button);
    onSelectTask.mockClear();
    await user.keyboard(' ');
    expect(onSelectTask).toHaveBeenCalledExactlyOnceWith('C', button);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('keeps wrapper nodes and edges out of the tab order and exposes only read-only viewport controls', async () => {
    const { container } = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
    for (const node of container.querySelectorAll('.react-flow__node')) {
      expect(node.getAttribute('tabindex')).toBeNull();
      expect(node.classList.contains('draggable')).toBe(false);
      expect(node.classList.contains('selectable')).toBe(false);
      expect(node.querySelectorAll('button')).toHaveLength(1);
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
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
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
    view.rerender(<TaskGraph index={index} rootId="A" selectedTaskId="D" onSelectTask={noop} />);
    expect(nodeButton('最终验收').classList.contains('task-node-selected')).toBe(true);
    expect([...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => node.style.transform)).toEqual(positions);
    expect(viewport(view.container).style.transform).toBe(userViewport);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(performance.getEntriesByName('daynight:task-layout')).toEqual(timings);
  });

  it('renders only the tasks whose selected appearance changes while retaining the full graph', async () => {
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await ready(view.container);
    const originalButtons = [...view.container.querySelectorAll('.task-node')];
    const originalPaths = [...view.container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'));
    const expectChangedTasks = (ids: readonly string[]) => {
      expect(taskRenders.mock.calls.map(([id]) => id).sort()).toEqual([...ids].sort());
      const buttons = [...view.container.querySelectorAll('.task-node')];
      const paths = [...view.container.querySelectorAll('.react-flow__edge-path')];
      expect(buttons).toHaveLength(originalButtons.length);
      expect(paths).toHaveLength(originalPaths.length);
      buttons.forEach((button, position) => { expect(button).toBe(originalButtons[position]); });
      expect(paths.map((path) => path.getAttribute('d'))).toEqual(originalPaths);
    };

    taskRenders.mockClear();
    view.rerender(<TaskGraph index={index} rootId="A" selectedTaskId="C" onSelectTask={noop} />);
    await waitFor(() => { expect(nodeButton('合流实现…')).toHaveClass('task-node-selected'); });
    expectChangedTasks(['C']);

    taskRenders.mockClear();
    view.rerender(<TaskGraph index={index} rootId="A" selectedTaskId="D" onSelectTask={noop} />);
    await waitFor(() => { expect(nodeButton('最终验收')).toHaveClass('task-node-selected'); });
    expect(nodeButton('合流实现…')).not.toHaveClass('task-node-selected');
    expectChangedTasks(['C', 'D']);

    taskRenders.mockClear();
    view.rerender(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await waitFor(() => { expect(nodeButton('最终验收')).not.toHaveClass('task-node-selected'); });
    expectChangedTasks(['D']);
  });

  it('starts a long chain at readable zoom and lets the fit control reveal more of it', async () => {
    const tasks = Array.from({ length: 10 }, (_, position) => ({
      ...graph.tasks[0]!, id: `N${position}`, titlePreview: `任务 ${position}`, status: 'todo' as const,
      dependsOn: position === 0 ? [] : [`N${position - 1}`],
      blockedBy: position === 0 ? [] : [`N${position - 1}`], ready: position === 0,
    }));
    const longChain = buildGraphIndex({ ...graph, tasks, summary: { total: 10, todo: 10, inProgress: 0, done: 0, ready: 1, blocked: 9 } });
    const { container } = render(<TaskGraph index={longChain} rootId="N0" selectedTaskId={null} onSelectTask={noop} />);
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

  it('pans an offscreen keyboard-focused node into view while preserving zoom', async () => {
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await ready(view.container);
    const button = nodeButton('最终验收');
    const originalMatches = button.matches.bind(button);
    const focused = vi.spyOn(button, 'matches').mockImplementation((selector) => selector === ':focus-visible' || originalMatches(selector));
    const bounds = vi.fn(() => new DOMRect(2000, 10, 220, 96));
    Object.defineProperty(button, 'getBoundingClientRect', { value: bounds, configurable: true });
    const before = viewport(view.container).style.transform;
    const beforeZoom = zoom(view.container);
    fireEvent.focus(button);
    expect(focused).toHaveBeenCalledWith(':focus-visible');
    expect(bounds).toHaveBeenCalled();
    await waitFor(() => { expect(viewport(view.container).style.transform).not.toBe(before); });
    expect(zoom(view.container)).toBe(beforeZoom);
  });

  it('leaves visible keyboard focus and pointer focus stable', async () => {
    const view = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await ready(view.container);
    const button = nodeButton('基础 API');
    const originalMatches = button.matches.bind(button);
    const focused = vi.spyOn(button, 'matches').mockImplementation((selector) => selector === ':focus-visible' || originalMatches(selector));
    const bounds = vi.fn(() => new DOMRect(20, 20, 220, 96));
    Object.defineProperty(button, 'getBoundingClientRect', { value: bounds, configurable: true });
    const before = viewport(view.container).style.transform;
    fireEvent.focus(button);
    expect(viewport(view.container).style.transform).toBe(before);
    focused.mockImplementation((selector) => selector !== ':focus-visible' && originalMatches(selector));
    bounds.mockReturnValue(new DOMRect(2000, 0, 220, 96));
    fireEvent.focus(button);
    expect(viewport(view.container).style.transform).toBe(before);
  });

  it('shows layout failures explicitly without pretending there are zero tasks', () => {
    render(<TaskGraph index={index} rootId="missing-root" selectedTaskId={null} onSelectTask={noop} />);
    expect(screen.getByRole('alert').textContent).toContain('任务图布局失败');
    expect(screen.queryByRole('application')).toBeNull();
    expect(screen.queryByText(/0 个节点/)).toBeNull();
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
});

describe('root task accordion', () => {
  it('renders the presented root order without changing the complete graph index', () => {
    const rootIds = index.roots.toReversed();
    const view = render(<RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={rootIds} expandedRootId={null} onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
    expect([...view.container.querySelectorAll('.root-toggle')].map((root) => root.id)).toEqual(['task-root-F', 'task-root-E', 'task-root-B', 'task-root-A']);
    expect(index.roots).toEqual(['A', 'B', 'E', 'F']);
    expect(index.successors.get('A')).toEqual(['C']);
    expect(index.rootProgress.get('A')).toEqual({ total: 3, done: 1, status: 'in_progress' });
    expect(screen.getByLabelText('显示 4 条，共 4 条任务链')).toHaveTextContent('4 / 4');
  });

  it('retains collapsed root renders during selection and still applies their new snapshot progress', async () => {
    const progressReads = vi.spyOn(index.rootProgress, 'get');
    const view = render(<RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={index.roots} expandedRootId="A" onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
    await ready(view.container);
    const originalRoots = [...view.container.querySelectorAll('.root-toggle')];
    const originalCanvas = view.container.querySelector('.task-graph-canvas');
    expect(originalRoots[0]!.querySelector('.root-status')).toHaveTextContent('进行中');
    expect(originalRoots[0]!.querySelector('.root-status')).toHaveClass('graph-status-in_progress');
    expect(originalRoots[2]!.querySelector('.root-status')).toHaveClass('graph-status-todo');
    expect(originalRoots[3]!.querySelector('.root-status')).toHaveTextContent('待处理');

    for (const selectedTaskId of ['C', 'D', null]) {
      progressReads.mockClear();
      view.rerender(<RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={index.roots} expandedRootId="A" onExpand={noop} selectedTaskId={selectedTaskId} onSelectTask={noop} />);
      await waitFor(() => {
        const selectedNodes = view.container.querySelectorAll('.task-node-selected');
        expect(selectedNodes).toHaveLength(selectedTaskId === null ? 0 : 1);
        if (selectedTaskId !== null) expect(selectedNodes[0]!.closest('.react-flow__node')).toHaveAttribute('data-id', selectedTaskId);
      });
      expect(progressReads).toHaveBeenCalledExactlyOnceWith('A');
      const roots = [...view.container.querySelectorAll('.root-toggle')];
      expect(roots).toHaveLength(originalRoots.length);
      roots.forEach((root, position) => { expect(root).toBe(originalRoots[position]); });
      expect(view.container.querySelector('.task-graph-canvas')).toBe(originalCanvas);
    }

    const refreshed = buildGraphIndex({
      ...graph,
      tasks: graph.tasks.map((task) => ({ ...task, status: 'done', blockedBy: [], ready: false })),
      summary: { total: 6, todo: 0, inProgress: 0, done: 6, ready: 0, blocked: 0 },
    });
    view.rerender(<RootList showCompleted={true} onShowCompletedChange={noop} index={refreshed} allRootIds={refreshed.roots} rootIds={refreshed.roots} expandedRootId="A" onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
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
      return <RootList showCompleted={true} onShowCompletedChange={noop} index={index} allRootIds={index.roots} rootIds={index.roots} expandedRootId={expandedRootId} onExpand={onExpand} selectedTaskId={null} onSelectTask={noop} />;
    };
    const { container } = render(<Wrapper />);
    const roots = container.querySelectorAll<HTMLButtonElement>('.root-toggle');
    expect(roots).toHaveLength(4);
    expect(roots[0]!.id).toBe('task-root-A');
    expect(roots[0]!.textContent).toContain('1/3 已完成');
    expect(roots[0]!.querySelector('.root-status')).toHaveTextContent('进行中');
    expect(nodeButton('基础 API')).toHaveClass('task-node-done');
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
    const { container } = render(<RootList showCompleted={true} onShowCompletedChange={noop} index={buildGraphIndex(snapshot)} allRootIds={index.roots} rootIds={index.roots} expandedRootId="A" onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
    expect(screen.getAllByText(`${untrusted}…`)).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
