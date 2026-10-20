import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskGraph as TaskGraphData } from '../src/api/types';
import { RootList } from '../src/features/task-graph/RootList';
import { getInitialTaskViewport, TaskGraph } from '../src/features/task-graph/TaskGraph';
import { TASK_HANDLE_SIZE } from '../src/features/task-graph/TaskNode';
import { buildGraphIndex } from '../src/features/task-graph/model';
import * as layoutModule from '../src/features/task-graph/layout';
import { installGraphMeasurements } from './graph-measurements';

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
  it('renders complete edges before resize measurements while keeping real handles observed', () => {
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
    expect(TASK_HANDLE_SIZE).toBe(6);
    const handles = [...container.querySelectorAll<HTMLElement>('.task-node-handle')];
    expect(handles).toHaveLength(10);
    handles.forEach((handle) => {
      expect(handle.style.width).toBe(`${TASK_HANDLE_SIZE}px`);
      expect(handle.style.height).toBe(`${TASK_HANDLE_SIZE}px`);
      expect(handle.classList.contains('connectable')).toBe(false);
    });
  });

  it('renders complete projected nodes and arrows, preserving status, shared nodes, and external predecessors', async () => {
    const { container } = render(<TaskGraph index={index} rootId="A" selectedTaskId="C" onSelectTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(4); });
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(5);
    expect(screen.getByText('5 个节点 · 4 条依赖')).toBeTruthy();
    expect(nodeButton('基础 API').classList.contains('task-node-done')).toBe(true);
    expect(nodeButton('合流实现…').classList.contains('task-node-in_progress')).toBe(true);
    expect(nodeButton('合流实现…').classList.contains('task-node-selected')).toBe(true);
    expect(nodeButton('最终验收').classList.contains('task-node-todo')).toBe(true);
    expect(within(nodeButton('最终验收')).getByText('被阻塞')).toBeTruthy();
    expect(within(nodeButton('合流实现…')).getByText('共享')).toBeTruthy();
    expect(within(nodeButton('设计方案')).getByText('外部前置，上游已省略')).toBeTruthy();
    expect(nodeButton('设计方案').classList.contains('task-node-done')).toBe(true);
    expect(nodeButton('发布检查').classList.contains('task-node-boundary')).toBe(true);
    const paths = [...container.querySelectorAll<SVGPathElement>('.react-flow__edge-path')];
    expect(paths.every((path) => path.getAttribute('marker-end')?.startsWith('url('))).toBe(true);
    expect(paths.filter((path) => path.style.strokeDasharray === '5 4')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^独立任务，/ })).toBeNull();
  });

  it('uses the exact Dagre point geometry instead of assuming horizontal midpoint handles', async () => {
    const expected = layoutModule.layoutGraph({ rootId: 'A', mainIds: new Set(['A', 'C', 'D']), boundaryIds: new Set(['B', 'F']), edges: [
      { source: 'A', target: 'C', external: false }, { source: 'B', target: 'C', external: true },
      { source: 'C', target: 'D', external: false }, { source: 'F', target: 'D', external: true },
    ], completed: 1 });
    const { container } = render(<TaskGraph index={index} rootId="A" selectedTaskId={null} onSelectTask={noop} />);
    await waitFor(() => { expect(container.querySelectorAll('.react-flow__edge-path')).toHaveLength(expected.edges.length); });
    const actualPaths = [...container.querySelectorAll('.react-flow__edge-path')].map((path) => path.getAttribute('d'));
    expect(actualPaths).toEqual(expected.edges.map((edge) => edge.points.map((point, position) => `${position === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')));
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
    const geometry = layoutModule.layoutGraph({ rootId: 'root', mainIds: new Set(['root']), boundaryIds: new Set(), edges: [], completed: 0 });
    const actual = getInitialTaskViewport(geometry, 'root', 800, 445);
    const root = geometry.nodes[0]!;
    expect(actual.zoom).toBeGreaterThanOrEqual(0.8);
    expect(actual.zoom).toBeLessThanOrEqual(1);
    expect(root.position.x * actual.zoom + actual.x).toBeGreaterThan(32);
    expect((root.position.x + layoutModule.TASK_NODE_WIDTH / 2) * actual.zoom + actual.x).toBeCloseTo(400);
    expect((root.position.y + layoutModule.TASK_NODE_HEIGHT / 2) * actual.zoom + actual.y).toBeCloseTo(222.5);
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
  it('retains collapsed root renders during selection and still applies their new snapshot progress', async () => {
    const progressReads = vi.spyOn(index.rootProgress, 'get');
    const view = render(<RootList index={index} expandedRootId="A" onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
    await ready(view.container);
    const originalRoots = [...view.container.querySelectorAll('.root-toggle')];
    const originalCanvas = view.container.querySelector('.task-graph-canvas');

    for (const selectedTaskId of ['C', 'D', null]) {
      progressReads.mockClear();
      view.rerender(<RootList index={index} expandedRootId="A" onExpand={noop} selectedTaskId={selectedTaskId} onSelectTask={noop} />);
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
      tasks: graph.tasks.map((task) => task.id === 'E' ? { ...task, status: 'done', ready: false } : task),
      summary: { ...graph.summary, todo: 2, done: 3, ready: 1 },
    });
    view.rerender(<RootList index={refreshed} expandedRootId="A" onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
    expect(originalRoots[2]!.querySelector('.root-progress-label')).toHaveTextContent('1/1 已完成');
    expect(originalRoots[2]!.querySelector('.root-status')).toHaveTextContent('已完成');
    expect(view.container.querySelectorAll('.root-toggle')[2]).toBe(originalRoots[2]);
  });

  it('keeps root status separate from chain progress and unmounts all but the expanded graph', async () => {
    const Wrapper = () => {
      const [expandedRootId, onExpand] = useState<string | null>('A');
      return <RootList index={index} expandedRootId={expandedRootId} onExpand={onExpand} selectedTaskId={null} onSelectTask={noop} />;
    };
    const { container } = render(<Wrapper />);
    const roots = container.querySelectorAll<HTMLButtonElement>('.root-toggle');
    expect(roots).toHaveLength(4);
    expect(roots[0]!.id).toBe('task-root-A');
    expect(roots[0]!.textContent).toContain('1/3 已完成');
    expect(roots[0]!.textContent).toContain('已完成');
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
    const { container } = render(<RootList index={buildGraphIndex(snapshot)} expandedRootId="A" onExpand={noop} selectedTaskId={null} onSelectTask={noop} />);
    expect(screen.getAllByText(`${untrusted}…`)).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
