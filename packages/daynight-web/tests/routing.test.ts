import { Graph, layout } from '@dagrejs/dagre';
import { describe, expect, it } from 'vitest';
import { layoutGraph, TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasEdge, type CanvasLayout, type CanvasPoint } from '../src/features/task-graph/layout';
import type { RootProjection } from '../src/features/task-graph/model';
import { planDependencyRoutes, type RoutingNode } from '../src/features/task-graph/routing';
import { compileDependencyRoute } from '../src/features/task-graph/routes';
import { parseCurve } from './e2e/dependency-geometry';

type Curve = ReturnType<typeof parseCurve>[number];
const rectangle = (id: string, left: number, top: number): RoutingNode => ({ id, left, top, right: left + 220, bottom: top + 96 });
const edge = (source: string, target: string, points: readonly CanvasPoint[]): CanvasEdge => ({ id: `${source}->${target}`, source, target, external: false, points });
const roots = (a: number, b: number, c: number): number[] => {
  if (a === 0) return b === 0 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  return discriminant < 0 ? [] : [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
};
const at = (s: Curve, t: number): CanvasPoint => s.kind === 'L'
  ? { x: s.from.x + (s.to.x - s.from.x) * t, y: s.from.y + (s.to.y - s.from.y) * t }
  : { x: (1 - t) ** 2 * s.from.x + 2 * (1 - t) * t * s.control!.x + t * t * s.to.x, y: (1 - t) ** 2 * s.from.y + 2 * (1 - t) * t * s.control!.y + t * t * s.to.y };

// Partition at exact line/quadratic intersections with the rectangle boundaries.
// Membership is constant on each open interval, so its midpoint proves whether
// the entire interval enters the node; this is independent of planner clearance.
const crosses = (s: Curve, r: RoutingNode): boolean => {
  const breaks = [0, 1];
  for (const [axis, values] of [['x', [r.left, r.right]], ['y', [r.top, r.bottom]]] as const) for (const value of values) {
    const candidates = s.kind === 'L' ? [(value - s.from[axis]) / (s.to[axis] - s.from[axis])]
      : roots(s.from[axis] - 2 * s.control![axis] + s.to[axis], 2 * (s.control![axis] - s.from[axis]), s.from[axis] - value);
    breaks.push(...candidates.filter((t) => t > 0 && t < 1));
  }
  breaks.sort((a, b) => a - b);
  return breaks.slice(1).some((end, index) => {
    const p = at(s, (end + breaks[index]!) / 2);
    return p.x > r.left + 1e-7 && p.x < r.right - 1e-7 && p.y > r.top + 1e-7 && p.y < r.bottom - 1e-7;
  });
};
const layoutRectangles = (actual: CanvasLayout): readonly RoutingNode[] => actual.nodes.map((node) => ({
  id: node.id, left: node.position.x, right: node.position.x + TASK_NODE_WIDTH, top: node.position.y, bottom: node.position.y + TASK_NODE_HEIGHT,
}));
const verify = (rectangles: readonly RoutingNode[], edges: readonly CanvasEdge[]) => {
  const byId = new Map(rectangles.map((node) => [node.id, node]));
  const failures: string[] = [];
  let curves = 0;
  for (const dependency of edges) {
    const source = byId.get(dependency.source)!;
    const target = byId.get(dependency.target)!;
    const route = parseCurve(compileDependencyRoute(dependency.points, dependency.external).d);
    const first = route[0]!;
    const last = route.at(-1)!;
    if (first.from.x !== source.right || first.from.y !== (source.top + source.bottom) / 2 || last.to.x !== target.left || last.to.y !== (target.top + target.bottom) / 2) failures.push(`${dependency.id}: ports`);
    if (first.kind !== 'L' || first.to.x <= first.from.x || first.to.y !== first.from.y || last.kind !== 'L' || last.to.x <= last.from.x || last.to.y !== last.from.y) failures.push(`${dependency.id}: endpoint tangents`);
    for (const segment of route) {
      if (segment.to.x < segment.from.x || (segment.control !== undefined && (segment.control.x < segment.from.x || segment.control.x > segment.to.x))) failures.push(`${dependency.id}: backward`);
      if (segment.control !== undefined) curves++;
      const xs = [segment.from.x, segment.to.x, ...(segment.control === undefined ? [] : [segment.control.x])];
      const ys = [segment.from.y, segment.to.y, ...(segment.control === undefined ? [] : [segment.control.y])];
      const left = Math.min(...xs); const right = Math.max(...xs); const top = Math.min(...ys); const bottom = Math.max(...ys);
      for (const node of rectangles) {
        if (node.right <= left || node.left >= right || node.bottom <= top || node.top >= bottom) continue;
        if (crosses(segment, node)) failures.push(`${dependency.id}: crosses ${node.id}`);
      }
    }
    for (let index = 1; index < dependency.points.length - 1; index++) {
      const a = dependency.points[index - 1]!; const b = dependency.points[index]!; const c = dependency.points[index + 1]!;
      const u = { x: b.x - a.x, y: b.y - a.y }; const v = { x: c.x - b.x, y: c.y - b.y };
      if (u.x * v.y === u.y * v.x && u.x * v.x + u.y * v.y < 0) failures.push(`${dependency.id}: reversal`);
    }
  }
  expect(failures.slice(0, 10)).toEqual([]);
  return { curves };
};
const projection = (size: number, edges: readonly (readonly [number, number])[], external = false): RootProjection => ({
  rootId: 'n0000', mainIds: new Set(Array.from({ length: size }, (_, index) => `n${String(index).padStart(4, '0')}`)), externalIds: new Set(), completed: 0,
  edges: edges.map(([source, target]) => ({ source: `n${String(source).padStart(4, '0')}`, target: `n${String(target).padStart(4, '0')}`, external })),
});
const capacity = (kind: 'chain' | 'merge' | 'shared' | 'external'): RootProjection => {
  const edges: [number, number][] = [];
  if (kind === 'chain') for (let index = 1; index < 1000; index++) edges.push([index - 1, index]);
  if (kind === 'merge') {
    let previous = Array.from({ length: 99 }, (_, index) => index + 1);
    for (const node of previous) edges.push([0, node]);
    let next = 100; let additional = 401;
    for (let layer = 2; layer <= 10; layer++) {
      const current: number[] = [];
      for (let index = 0; index < 100; index++) {
        const node = next++; current.push(node); const count = additional > 0 ? 6 : 5; if (additional > 0) additional--;
        for (let offset = 0; offset < count; offset++) edges.push([previous[(index * 5 + offset) % previous.length]!, node]);
      }
      previous = current;
    }
  }
  if (kind === 'shared') for (let index = 0; index < 499; index++) {
    edges.push([0, 500 + index]);
    for (let offset = 0; offset < (index < 10 ? 9 : 8); offset++) edges.push([1 + (index * 8 + offset) % 499, 500 + index]);
    edges.push([500 + index, 999]);
  }
  if (kind === 'external') {
    let previous = Array.from({ length: 99 }, (_, index) => index + 1); let next = 100; let additional = 397;
    for (let layer = 1; layer <= 9; layer++) {
      const current: number[] = [];
      for (let index = 0; index < 99; index++) {
        const node = next++; current.push(node); const count = additional > 0 ? 6 : 5; if (additional > 0) additional--;
        for (let offset = 0; offset < count; offset++) edges.push([previous[(index * 5 + offset) % previous.length]!, node]);
      }
      previous = current;
    }
    const tails: number[] = [];
    for (let index = 0; index < 8; index++) { tails.push(next); for (let offset = 0; offset < 5; offset++) edges.push([previous[index * 5 + offset]!, next]); next++; }
    for (const source of [0, ...previous, ...tails]) edges.push([source, 999]);
  }
  return projection(1000, edges, kind === 'shared' || kind === 'external');
};

describe('obstacle-free left-to-right dependency planning', () => {
  it('replaces steep ports and gap-only detours with a single stable gap channel', () => {
    const nodes = [rectangle('source', 32, 32), rectangle('other', 32, 160), rectangle('target', 316, 500)];
    const edges = [edge('source', 'target', [{ x: 150, y: 128 }, { x: 284, y: 900 }, { x: 420, y: 500 }])];
    const original = structuredClone({ nodes, edges });
    expect(crosses(parseCurve('M150,128 L284,900')[0]!, nodes[1]!)).toBe(true);
    const result = planDependencyRoutes(nodes, edges);
    expect(result[0]!.points).toEqual([{ x: 252, y: 80 }, { x: 284, y: 80 }, { x: 284, y: 548 }, { x: 316, y: 548 }]);
    verify(nodes, result);
    expect({ nodes, edges }).toEqual(original);
    expect(edges[0]!.points[0]).toEqual({ x: 150, y: 128 });
    expect(nodes[0]).toEqual(rectangle('source', 32, 32));
  });

  it('repairs blocked interior spans and moves an occupied intended passage to a free column row', () => {
    const nodes = [rectangle('s', 32, 32), rectangle('a', 316, 32), rectangle('b', 316, 160), rectangle('c', 600, 32), rectangle('t', 884, 300)];
    const input = edge('s', 't', [{ x: 252, y: 80 }, { x: 284, y: 80 }, { x: 426, y: 80 }, { x: 568, y: 144 }, { x: 710, y: 144 }, { x: 852, y: 348 }, { x: 884, y: 348 }]);
    expect(crosses(parseCurve('M426,16 L710,144')[0]!, nodes[3]!)).toBe(true);
    const result = planDependencyRoutes(nodes, [input])[0]!;
    expect(result.points).toContainEqual({ x: 568, y: 16 });
    verify(nodes, [result]);
  });

  it('retains a clear long interior diagonal instead of adding bends at every crossed rank', () => {
    const nodes = [rectangle('s', 32, 300), rectangle('a', 316, 32), rectangle('b', 600, 32), rectangle('c', 884, 32), rectangle('t', 1168, 500)];
    const input = edge('s', 't', [{ x: 252, y: 348 }, { x: 284, y: 348 }, { x: 426, y: 400 }, { x: 568, y: 426 }, { x: 710, y: 452 }, { x: 852, y: 478 }, { x: 994, y: 504 }, { x: 1136, y: 548 }, { x: 1168, y: 548 }]);
    const result = planDependencyRoutes(nodes, [input])[0]!;
    expect(result.points).toContainEqual({ x: 426, y: 400 });
    expect(result.points).toContainEqual({ x: 994, y: 504 });
    expect(result.points).not.toContainEqual({ x: 710, y: 452 });
    expect(result.points.length).toBeLessThan(input.points.length);
    verify(nodes, [result]);
  });

  it('keeps native Dagre node positions, order and bounds unchanged', () => {
    const input = projection(6, [[0, 1], [0, 2], [1, 3], [2, 3], [0, 5], [3, 4], [5, 4]]);
    const graph = new Graph({ directed: true });
    graph.setGraph({ rankdir: 'LR', ranker: 'longest-path', nodesep: 32, ranksep: 64, marginx: 32, marginy: 32 });
    for (const id of [...input.mainIds].sort()) graph.setNode(id, { width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT });
    for (const edge of [...input.edges].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))) graph.setEdge(edge.source, edge.target, {});
    layout(graph);
    const result = layoutGraph(input);
    expect(result.width).toBe(graph.graph().width); expect(result.height).toBe(graph.graph().height);
    for (const node of result.nodes) expect(node.position).toEqual({ x: graph.node(node.id).x! - TASK_NODE_WIDTH / 2, y: graph.node(node.id).y! - TASK_NODE_HEIGHT / 2 });
    verify(layoutRectangles(result), result.edges);
  });

  it.each(['chain', 'merge', 'shared', 'external'] as const)('proves every rounded route avoids every card in the full %s capacity layout', (kind) => {
    const input = capacity(kind); const actual = layoutGraph(input);
    expect(actual.nodes).toHaveLength(1000); expect(actual.edges).toHaveLength(kind === 'chain' ? 999 : 5000);
    const result = verify(layoutRectangles(actual), actual.edges);
    expect(result.curves).toBeLessThan(kind === 'chain' ? 1 : 30_000);
  }, 60_000);

  it('proves geometry for deterministic randomized DAGs with long edges and shared predecessors', () => {
    let state = 0x7316ab;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    for (let attempt = 0; attempt < 24; attempt++) {
      const edges: [number, number][] = [];
      for (let target = 1; target < 30; target++) for (let source = 0; source < target; source++) if (random() < 0.16) edges.push([source, target]);
      const actual = layoutGraph(projection(30, edges, true));
      verify(layoutRectangles(actual), actual.edges);
    }
  }, 60_000);

  it('rejects invalid rectangles, overlapping columns, missing endpoints and invalid waypoints', () => {
    const source = rectangle('s', 32, 32); const target = rectangle('t', 316, 32); const input = edge('s', 't', [{ x: 252, y: 80 }, { x: 316, y: 80 }]);
    expect(() => planDependencyRoutes([{ ...source, left: NaN }, target], [input])).toThrow(/invalid node bounds/);
    expect(() => planDependencyRoutes([source, { ...source, id: 'other', right: 260 }, target], [input])).toThrow(/nonoverlapping node columns/);
    expect(() => planDependencyRoutes([source, rectangle('other', 260, 32), target], [input])).toThrow(/rounded rank-gap channels/);
    expect(() => planDependencyRoutes([source, source, target], [input])).toThrow();
    expect(() => planDependencyRoutes([source, rectangle('s', 316, 160), target], [input])).toThrow(/duplicate node identities/);
    expect(() => planDependencyRoutes([source, target], [edge('s', 'missing', input.points)])).toThrow(/forward endpoints/);
    expect(() => planDependencyRoutes([source, target], [edge('t', 's', input.points)])).toThrow(/forward endpoints/);
    expect(() => planDependencyRoutes([source, target], [edge('s', 't', [])])).toThrow(/invalid layout waypoints/);
    expect(() => planDependencyRoutes([source, target], [edge('s', 't', [{ x: NaN, y: 1 }, { x: 1, y: 2 }])])).toThrow(/invalid layout waypoints/);
  });
});
