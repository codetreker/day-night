import { StrictMode, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DependencyEdges } from '../src/features/task-graph/DependencyEdges';
import type { TaskInspection } from '../src/features/task-graph/inspection';
import type { CanvasLayout } from '../src/features/task-graph/layout';

const portal = vi.hoisted(() => ({ mounted: true }));
vi.mock('@xyflow/react', () => ({ ViewportPortal: ({ children }: { children: ReactNode }) => portal.mounted ? children : null }));
const normal: TaskInspection = { selectedTaskId: null, highlighted: null };
const selected: TaskInspection = { selectedTaskId: 'B', highlighted: new Set(['A', 'B']) };
const geometry = (): CanvasLayout => ({
  nodes: [], width: 800, height: 800,
  edges: [
    { id: 'A->B', source: 'A', target: 'B', external: true, points: [{ x: 220, y: 48 }, { x: 252, y: 48 }, { x: 252, y: 348 }, { x: 284, y: 348 }] },
    { id: 'B->C', source: 'B', target: 'C', external: false, points: [{ x: 504, y: 348 }, { x: 536, y: 348 }, { x: 536, y: 548 }, { x: 568, y: 548 }] },
  ],
});
const geometryAttributes = (container: HTMLElement) => [...container.querySelectorAll('path,line')].map((element) => ({
  element, d: element.getAttribute('d'), transform: element.getAttribute('transform'), phase: (element as SVGElement).style.strokeDashoffset,
}));
const expectPaint = (container: HTMLElement, expected: readonly string[]) => {
  const groups = [...container.querySelectorAll<SVGGElement>('.task-dependency-edge')];
  expect(groups).toHaveLength(expected.length);
  groups.forEach((group, position) => {
    expect(group.querySelector('.task-dependency-body')!.getAttribute('stroke')).toBe(expected[position]);
    const reference = group.querySelector('.react-flow__edge-path')!.getAttribute('marker-end')!;
    const marker = [...container.querySelectorAll('marker')].find((candidate) => reference === `url(#${candidate.id})`)!;
    expect(marker.querySelector('polyline')!.getAttribute('fill')).toBe(expected[position]);
    expect(marker.querySelector('polyline')!.getAttribute('stroke')).toBe(expected[position]);
  });
};

describe('dependency presentation', () => {
  it('paints solid bodies and local dashed primitives with native arrows on the complete routes', () => {
    const { container } = render(<DependencyEdges geometry={geometry()} inspection={normal} />);
    const groups = [...container.querySelectorAll<SVGGElement>('.task-dependency-edge')];
    const pieces = [...container.querySelectorAll<SVGElement>('.task-dependency-paint-piece')];
    expect(groups).toHaveLength(2); expect(pieces.length).toBeGreaterThan(1);
    expect(container.querySelector('svg')!.dataset.paintPieceCount).toBe(String(pieces.length));
    expect(pieces.some((piece) => piece.tagName === 'line')).toBe(true);
    for (const group of groups) {
      expect(group.getAttribute('role')).toBe('img'); expect(group.getAttribute('focusable')).toBe('false');
      expect(group.dataset.inspection).toBe('normal');
      expect(group.querySelector('path')!.getAttribute('aria-hidden')).toBe('true');
    }
    const external = groups[0]!.querySelector<SVGPathElement>('.react-flow__edge-path')!;
    expect(external.style.fill).toBe('none'); expect(external.style.stroke).toBe('none');
    expect(groups[1]!.querySelector<SVGPathElement>('.react-flow__edge-path')!.style.stroke).toBe('inherit');
    for (const piece of pieces) {
      expect(piece.style.stroke).toBe('inherit'); expect(piece.style.strokeDasharray).toBe('5 4');
      expect(piece.style.pointerEvents).toBe('none'); expect(piece.getAttribute('aria-hidden')).toBe('true');
    }
    expectPaint(container, ['#abb2c7', '#abb2c7']);
    for (const marker of container.querySelectorAll('marker')) {
      expect(marker.getAttribute('markerUnits')).toBe('strokeWidth'); expect(marker.getAttribute('orient')).toBe('auto-start-reverse');
      expect(marker.getAttribute('viewBox')).toBe('-10 -10 20 20');
      const shape = marker.querySelector('polyline')!;
      expect(shape.getAttribute('points')).toBe('-5,-4 0,0 -5,4 -5,-4');
      expect(shape.getAttribute('stroke-linecap')).toBe('round'); expect(shape.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it('changes body and arrow paint together while retaining path geometry, primitives and marker definitions', () => {
    const layout = geometry(); const { container, rerender } = render(<DependencyEdges geometry={layout} inspection={normal} />);
    const attributes = geometryAttributes(container);
    const markers = [...container.querySelectorAll('marker')].map((marker) => marker.outerHTML);
    rerender(<DependencyEdges geometry={layout} inspection={selected} />);
    expect(geometryAttributes(container)).toEqual(attributes);
    expect([...container.querySelectorAll('marker')].map((marker) => marker.outerHTML)).toEqual(markers);
    expect([...container.querySelectorAll<SVGGElement>('.task-dependency-edge')].map((group) => group.dataset.inspection)).toEqual(['highlighted', 'unrelated']);
    expectPaint(container, ['#6762ce', '#c7cddb']);
    rerender(<DependencyEdges geometry={layout} inspection={normal} />);
    expectPaint(container, ['#abb2c7', '#abb2c7']);
  });

  it('replaces changed geometry while preserving the current inspection paint', () => {
    const layout = geometry(); const { container, rerender } = render(<StrictMode><DependencyEdges geometry={layout} inspection={selected} /></StrictMode>);
    const before = container.querySelector('.react-flow__edge-path')!.getAttribute('d');
    const updated = { ...layout, edges: [{ ...layout.edges[0]!, points: [{ x: 220, y: 48 }, { x: 252, y: 48 }, { x: 252, y: 448 }, { x: 284, y: 448 }] }, layout.edges[1]!] };
    rerender(<StrictMode><DependencyEdges geometry={updated} inspection={selected} /></StrictMode>);
    expect(container.querySelector('.react-flow__edge-path')!.getAttribute('d')).not.toBe(before);
    expectPaint(container, ['#6762ce', '#c7cddb']);
  });

  it('renders correctly after the viewport portal becomes available', () => {
    portal.mounted = false;
    const layout = geometry(); const { container, rerender } = render(<DependencyEdges geometry={layout} inspection={selected} />);
    expect(container.querySelector('svg')).toBeNull();
    portal.mounted = true;
    rerender(<DependencyEdges geometry={layout} inspection={{ ...selected }} />);
    expectPaint(container, ['#6762ce', '#c7cddb']);
  });
});
