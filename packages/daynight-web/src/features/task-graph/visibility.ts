import { GraphDataError, type GraphIndex, type ChainProjection } from './model';

export const GRAPH_OVERVIEW_TASK_LIMIT = 50;
export const GRAPH_OVERVIEW_EDGE_LIMIT = 100;
export const GRAPH_EXPANSION_BATCH_SIZE = 20;
export type TaskExpansionDirection = 'prerequisites' | 'successors';
export type TaskExpansion = {
  readonly ids: readonly string[];
  readonly totalHidden: number;
  readonly addedEdges: number;
};
export type TaskExpansions = Readonly<Record<TaskExpansionDirection, TaskExpansion>>;

const projectionIds = (projection: ChainProjection): Set<string> => new Set([...projection.mainIds, ...projection.externalIds]);
const snapshotOrder = (index: GraphIndex): ReadonlyMap<string, number> => new Map([...index.nodes.keys()].map((id, position) => [id, position]));
const neighbors = (index: GraphIndex, allowed: ReadonlySet<string>, order: ReadonlyMap<string, number>, id: string, direction: TaskExpansionDirection): readonly string[] => {
  const candidates = direction === 'successors' ? index.successors.get(id)! : index.nodes.get(id)!.dependsOn;
  return candidates.filter((candidate) => allowed.has(candidate)).sort((left, right) => order.get(left)! - order.get(right)!);
};
const incidentEdges = (index: GraphIndex, visible: ReadonlySet<string>, id: string): number =>
  index.nodes.get(id)!.dependsOn.filter((source) => visible.has(source)).length
  + index.successors.get(id)!.filter((target) => visible.has(target)).length;

export const createGraphOverview = (index: GraphIndex, projection: ChainProjection): Set<string> => {
  const allowed = projectionIds(projection);
  if (allowed.size <= GRAPH_OVERVIEW_TASK_LIMIT && projection.edges.length <= GRAPH_OVERVIEW_EDGE_LIMIT) {
    return new Set([projection.rootId, ...[...index.nodes.keys()].filter((id) => allowed.has(id))]);
  }
  const order = snapshotOrder(index);
  const visible = new Set([projection.rootId]);
  const attempted = new Set(visible);
  const pending = [projection.rootId];
  let edges = 0;
  for (let position = 0; position < pending.length; position++) {
    const id = pending[position]!;
    for (const direction of ['successors', 'prerequisites'] as const) {
      for (const candidate of neighbors(index, allowed, order, id, direction)) {
        if (attempted.has(candidate)) continue;
        attempted.add(candidate);
        const addedEdges = incidentEdges(index, visible, candidate);
        if (visible.size === GRAPH_OVERVIEW_TASK_LIMIT || edges + addedEdges > GRAPH_OVERVIEW_EDGE_LIMIT) continue;
        visible.add(candidate);
        pending.push(candidate);
        edges += addedEdges;
      }
    }
  }
  return visible;
};

export const projectVisibleTasks = (projection: ChainProjection, visibleIds: ReadonlySet<string>): ChainProjection => ({
  rootId: projection.rootId,
  mainIds: new Set([...projection.mainIds].filter((id) => visibleIds.has(id))),
  externalIds: new Set([...projection.externalIds].filter((id) => visibleIds.has(id))),
  edges: projection.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  completed: projection.completed,
});

export const getTaskExpansion = (
  index: GraphIndex,
  projection: ChainProjection,
  visibleIds: ReadonlySet<string>,
  taskId: string,
  direction: TaskExpansionDirection = 'prerequisites',
): TaskExpansion => {
  const allowed = projectionIds(projection);
  if (!allowed.has(taskId) || !visibleIds.has(taskId)) throw new GraphDataError();
  const hidden = neighbors(index, allowed, snapshotOrder(index), taskId, direction).filter((id) => !visibleIds.has(id));
  const ids = hidden.slice(0, GRAPH_EXPANSION_BATCH_SIZE);
  const expanded = new Set([...visibleIds, ...ids]);
  const addedEdges = projection.edges.filter((edge) => expanded.has(edge.source) && expanded.has(edge.target)
    && (!visibleIds.has(edge.source) || !visibleIds.has(edge.target))).length;
  return { ids, totalHidden: hidden.length, addedEdges };
};

export const reconcileVisibleTasks = (projection: ChainProjection, visibleIds: ReadonlySet<string>): Set<string> => {
  const allowed = projectionIds(projection);
  const retained = new Set([...visibleIds].filter((id) => allowed.has(id)));
  retained.add(projection.rootId);
  const connections = new Map([...retained].map((id) => [id, [] as string[]]));
  for (const edge of projection.edges) {
    if (!retained.has(edge.source) || !retained.has(edge.target)) continue;
    connections.get(edge.source)!.push(edge.target);
    connections.get(edge.target)!.push(edge.source);
  }
  const reachable = new Set([projection.rootId]);
  const pending = [projection.rootId];
  for (let position = 0; position < pending.length; position++) for (const neighbor of connections.get(pending[position]!)!) {
    if (reachable.has(neighbor)) continue;
    reachable.add(neighbor);
    pending.push(neighbor);
  }
  return new Set([projection.rootId, ...[...retained].filter((id) => reachable.has(id))]);
};
