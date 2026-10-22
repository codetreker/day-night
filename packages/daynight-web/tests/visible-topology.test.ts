import { describe, expect, it } from 'vitest';
import { expectedBatch, expectedOverview, inducedTopology } from './e2e/visible-topology';
import type { GeometryExpectation } from './e2e/dependency-geometry';
const graph = (count: number): GeometryExpectation => ({ nodes: Array.from({ length: count }, (_, index) => ({ id: String(index) })), edges: Array.from({ length: count - 1 }, (_, index) => ({ id: `0->${index + 1}`, source: '0', target: String(index + 1), external: false })) });
describe('independent visible API topology expectations', () => {
  it('retains exact small graphs and bounds the deterministic root-anchored overview', () => {
    const fifty = graph(50); expect(expectedOverview(fifty, '0', fifty.nodes.map(({ id }) => id))).toEqual(fifty);
    const fiftyOne = graph(51); const overview = expectedOverview(fiftyOne, '0', fiftyOne.nodes.map(({ id }) => id));
    expect(overview.nodes.map(({ id }) => id)).toEqual(fiftyOne.nodes.slice(0, 50).map(({ id }) => id));
    expect(overview.edges).toHaveLength(49);
  });
  it('shows exactly one hundred edges in full and bounds a one-hundred-and-one-edge projection', () => {
    const nodes = Array.from({ length: 15 }, (_, index) => ({ id: String(index) }));
    const edges = nodes.flatMap((target, index) => nodes.slice(0, index).map((source) => ({ id: `${source.id}->${target.id}`, source: source.id, target: target.id, external: false })));
    const hundred = { nodes, edges: edges.slice(0, 100) }; const hundredOne = { nodes, edges: edges.slice(0, 101) }; const order = nodes.map(({ id }) => id);
    expect(expectedOverview(hundred, '0', order)).toEqual(hundred);
    const overview = expectedOverview(hundredOne, '0', order);
    expect(overview.edges.length).toBeLessThanOrEqual(100); expect(overview.nodes.length).toBeLessThan(15);
  });
  it('includes every induced edge and rejects duplicate or unknown visible identities', () => {
    const full = graph(4); expect(inducedTopology(full, ['0', '2', '3']).edges.map(({ id }) => id)).toEqual(['0->2', '0->3']);
    expect(() => inducedTopology(full, ['0', '0'])).toThrow(); expect(() => inducedTopology(full, ['missing'])).toThrow();
  });
  it('expands at most twenty hidden direct neighbors without a manual edge limit', () => {
    const full = graph(80); const order = full.nodes.map(({ id }) => id);
    expect(expectedBatch(full, ['0'], '0', 'downstream', order).nodes).toHaveLength(21);
    const dense: GeometryExpectation = { nodes: full.nodes, edges: full.nodes.flatMap((node, index) => index === 0 ? [] : [
      { id: `0->${node.id}`, source: '0', target: node.id, external: false },
      ...full.nodes.slice(1, index).map((previous) => ({ id: `${previous.id}->${node.id}`, source: previous.id, target: node.id, external: false })),
    ]) };
    expect(expectedBatch(dense, ['0', '1', '2', '3', '4'], '0', 'downstream', order).edges.length).toBeGreaterThan(100);
  });
});
