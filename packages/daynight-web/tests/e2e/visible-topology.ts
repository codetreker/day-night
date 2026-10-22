import type { GeometryExpectation } from './dependency-geometry';

export const inducedTopology = (full: GeometryExpectation, nodeIds: readonly string[]): GeometryExpectation => {
  const visible = new Set(nodeIds);
  if (visible.size !== nodeIds.length || nodeIds.some((id) => !full.nodes.some((node) => node.id === id))) throw new Error('Visible task identities differ from the complete API projection.');
  return { nodes: full.nodes.filter((node) => visible.has(node.id)), edges: full.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)) };
};

export const expectedOverview = (full: GeometryExpectation, rootId: string, snapshotOrder: readonly string[]): GeometryExpectation => {
  if (full.nodes.length <= 50 && full.edges.length <= 100) return full;
  const order = new Map(snapshotOrder.map((id, position) => [id, position]));
  const neighbors = (id: string, downstream: boolean) => full.edges.filter((edge) => downstream ? edge.source === id : edge.target === id)
    .map((edge) => downstream ? edge.target : edge.source).sort((a, b) => order.get(a)! - order.get(b)!);
  const visible = new Set([rootId]); const queue = [rootId];
  for (let position = 0; position < queue.length && visible.size < 50; position++) {
    for (const id of [...neighbors(queue[position]!, true), ...neighbors(queue[position]!, false)]) {
      if (visible.has(id) || visible.size === 50) continue;
      const candidate = [...visible, id];
      if (inducedTopology(full, candidate).edges.length > 100) continue;
      visible.add(id); queue.push(id);
    }
  }
  return inducedTopology(full, [...visible]);
};

export const expectedBatch = (full: GeometryExpectation, visibleIds: readonly string[], taskId: string, direction: 'upstream' | 'downstream', snapshotOrder: readonly string[]): GeometryExpectation => {
  const visible = new Set(visibleIds); const order = new Map(snapshotOrder.map((id, position) => [id, position]));
  const neighbors = full.edges.filter((edge) => direction === 'downstream' ? edge.source === taskId : edge.target === taskId)
    .map((edge) => direction === 'downstream' ? edge.target : edge.source).filter((id) => !visible.has(id)).sort((a, b) => order.get(a)! - order.get(b)!).slice(0, 20);
  return inducedTopology(full, [...visibleIds, ...neighbors]);
};
