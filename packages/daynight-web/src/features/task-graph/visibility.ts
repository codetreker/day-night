import { GraphDataError, type GroupIndex, type GroupProjection } from './model';

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

const projectionIds = (projection: GroupProjection): Set<string> => new Set([...projection.mainIds, ...projection.externalIds]);
const snapshotOrder = (index: GroupIndex): ReadonlyMap<string, number> => new Map([...index.nodes.keys()].map((id, position) => [id, position]));
const neighbors = (index: GroupIndex, allowed: ReadonlySet<string>, order: ReadonlyMap<string, number>, id: string, direction: TaskExpansionDirection): readonly string[] => {
  const candidates = direction === 'successors' ? index.successors.get(id)! : index.nodes.get(id)!.dependsOn;
  return candidates.filter((candidate) => allowed.has(candidate)).sort((left, right) => order.get(left)! - order.get(right)!);
};
const incidentEdges = (index: GroupIndex, visible: ReadonlySet<string>, id: string): number =>
  index.nodes.get(id)!.dependsOn.filter((source) => visible.has(source)).length
  + index.successors.get(id)!.filter((target) => visible.has(target)).length;

export const createGraphOverview = (index: GroupIndex, projection: GroupProjection): Set<string> => {
  const allowed = projectionIds(projection);
  if (allowed.size <= GRAPH_OVERVIEW_TASK_LIMIT && projection.edges.length <= GRAPH_OVERVIEW_EDGE_LIMIT) {
    return new Set([projection.groupId, ...[...index.nodes.keys()].filter((id) => allowed.has(id))]);
  }
  const order = snapshotOrder(index);
  const visible = new Set([projection.groupId]);
  const attempted = new Set(visible);
  const pending = [projection.groupId];
  let edges = 0;
  const connected = new Set<string>();
  const seeds: string[] = [];
  for (const seed of [projection.groupId, ...[...index.nodes.keys()].filter((id) => projection.mainIds.has(id))]) {
    if (connected.has(seed)) continue;
    seeds.push(seed);
    connected.add(seed);
    const component = [seed];
    for (let position = 0; position < component.length; position++) {
      for (const direction of ['successors', 'prerequisites'] as const) {
        for (const id of neighbors(index, allowed, order, component[position]!, direction)) {
          if (connected.has(id)) continue;
          connected.add(id);
          component.push(id);
        }
      }
    }
  }
  let processed = 0;
  for (const seed of seeds) {
    if (!visible.has(seed)) {
      const addedEdges = incidentEdges(index, visible, seed);
      if (visible.size === GRAPH_OVERVIEW_TASK_LIMIT || edges + addedEdges > GRAPH_OVERVIEW_EDGE_LIMIT) continue;
      visible.add(seed);
      attempted.add(seed);
      pending.push(seed);
      edges += addedEdges;
    }
    for (; processed < pending.length; processed++) {
      const id = pending[processed]!;
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
  }
  return visible;
};

export const projectVisibleTasks = (projection: GroupProjection, visibleIds: ReadonlySet<string>): GroupProjection => ({
  groupId: projection.groupId,
  mainIds: new Set([...projection.mainIds].filter((id) => visibleIds.has(id))),
  externalIds: new Set([...projection.externalIds].filter((id) => visibleIds.has(id))),
  edges: projection.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  completed: projection.completed,
});

export const getTaskExpansion = (
  index: GroupIndex,
  projection: GroupProjection,
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

export const reconcileVisibleTasks = (projection: GroupProjection, visibleIds: ReadonlySet<string>): Set<string> => {
  const allowed = projectionIds(projection);
  const retained = new Set([...visibleIds].filter((id) => allowed.has(id)));
  retained.add(projection.groupId);
  return new Set([projection.groupId, ...retained]);
};

export const getMemberExpansion = (index: GroupIndex, projection: GroupProjection, visibleIds: ReadonlySet<string>): TaskExpansion => {
  const hidden = [...index.nodes.keys()].filter((id) => projection.mainIds.has(id) && !visibleIds.has(id));
  const ids = hidden.slice(0, GRAPH_EXPANSION_BATCH_SIZE);
  const expanded = new Set([...visibleIds, ...ids]);
  const addedEdges = projection.edges.filter((edge) => expanded.has(edge.source) && expanded.has(edge.target)
    && (!visibleIds.has(edge.source) || !visibleIds.has(edge.target))).length;
  return { ids, totalHidden: hidden.length, addedEdges };
};
