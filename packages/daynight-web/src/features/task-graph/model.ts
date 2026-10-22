import type { GraphTask, TaskGraph, TaskGraphSummary, TaskStatus } from "../../api/types";

export type RootProgress = {
  readonly total: number;
  readonly done: number;
  readonly status: TaskStatus;
};

export type GraphIndex = {
  readonly nodes: ReadonlyMap<string, GraphTask>;
  readonly successors: ReadonlyMap<string, readonly string[]>;
  readonly roots: readonly string[];
  readonly sharedIds: ReadonlySet<string>;
  readonly rootProgress: ReadonlyMap<string, RootProgress>;
};

export type ProjectionEdge = {
  readonly source: string;
  readonly target: string;
  readonly external: boolean;
};

export type RootProjection = {
  readonly rootId: string;
  readonly mainIds: ReadonlySet<string>;
  readonly externalIds: ReadonlySet<string>;
  readonly edges: readonly ProjectionEdge[];
  readonly completed: number;
};

export class GraphDataError extends Error {
  constructor(reason: "invalid" | "limit" = "invalid") {
    super(reason === "limit" ? "Task graph exceeds the supported size." : "Task graph data is incomplete or inconsistent.");
    this.name = "GraphDataError";
  }
}

const rejectGraph = (): never => {
  throw new GraphDataError();
};

const reachable = (successors: GraphIndex["successors"], rootId: string): Set<string> => {
  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const successor of successors.get(id)!) pending.push(successor);
  }
  return result;
};

export const buildGraphIndex = (graph: TaskGraph): GraphIndex => {
  if (typeof graph !== "object" || graph === null || !Array.isArray(graph.tasks) ||
    typeof graph.summary !== "object" || graph.summary === null) return rejectGraph();
  if (graph.tasks.length > 1000) throw new GraphDataError("limit");
  const nodes = new Map<string, GraphTask>();
  const successors = new Map<string, string[]>();
  const roots: string[] = [];
  let edgeCount = 0;
  for (const task of graph.tasks) {
    if (typeof task !== "object" || task === null || typeof task.id !== "string" || task.id === "" || nodes.has(task.id) ||
      !Array.isArray(task.dependsOn) || !Array.isArray(task.blockedBy) ||
      (task.status !== "proposed" && task.status !== "todo" && task.status !== "in_progress" && task.status !== "done") || typeof task.ready !== "boolean") {
      return rejectGraph();
    }
    edgeCount += task.dependsOn.length;
    if (edgeCount > 5000) throw new GraphDataError("limit");
    if (new Set(task.dependsOn).size !== task.dependsOn.length || new Set(task.blockedBy).size !== task.blockedBy.length) {
      return rejectGraph();
    }
    nodes.set(task.id, task);
    successors.set(task.id, []);
    if (task.dependsOn.length === 0) roots.push(task.id);
  }

  const actual: { -readonly [Key in keyof TaskGraphSummary]: number } = {
    total: nodes.size, proposed: 0, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0,
  };
  for (const task of nodes.values()) {
    const blocked = new Set<string>();
    for (const predecessorId of task.dependsOn) {
      const predecessor = nodes.get(predecessorId);
      if (predecessor === undefined || predecessorId === task.id) return rejectGraph();
      successors.get(predecessorId)!.push(task.id);
      if (predecessor.status !== "done") blocked.add(predecessorId);
    }
    if (blocked.size !== task.blockedBy.length || task.blockedBy.some((id) => !blocked.has(id)) ||
      task.ready !== (task.status === "todo" && blocked.size === 0) ||
      ((task.status === "in_progress" || task.status === "done") && blocked.size !== 0)) return rejectGraph();
    if (task.status === "proposed") actual.proposed++;
    else if (task.status === "todo") {
      actual.todo++;
      if (task.ready) actual.ready++;
      else actual.blocked++;
    } else if (task.status === "in_progress") actual.inProgress++;
    else actual.done++;
  }
  for (const key of Object.keys(actual) as (keyof TaskGraphSummary)[]) {
    if (graph.summary[key] !== actual[key]) return rejectGraph();
  }

  const degrees = new Map([...nodes.values()].map((task) => [task.id, task.dependsOn.length]));
  const pending = [...roots];
  for (let position = 0; position < pending.length; position++) {
    for (const successor of successors.get(pending[position]!)!) {
      const degree = degrees.get(successor)! - 1;
      degrees.set(successor, degree);
      if (degree === 0) pending.push(successor);
    }
  }
  if (pending.length !== nodes.size) return rejectGraph();

  const rootProgress = new Map<string, RootProgress>();
  const rootCount = new Map<string, number>();
  const sharedIds = new Set<string>();
  for (const root of roots) {
    const mainIds = reachable(successors, root);
    let done = 0;
    let inProgress = false;
    let todo = false;
    for (const id of mainIds) {
      const status = nodes.get(id)!.status;
      if (status === "done") done++;
      else if (status === "in_progress") inProgress = true;
      else if (status === "todo") todo = true;
      const count = (rootCount.get(id) ?? 0) + 1;
      rootCount.set(id, count);
      if (count > 1) sharedIds.add(id);
    }
    const status = done === mainIds.size ? "done" : done > 0 || inProgress ? "in_progress" : todo ? "todo" : "proposed";
    rootProgress.set(root, { total: mainIds.size, done, status });
  }
  return { nodes, successors, roots, sharedIds, rootProgress };
};

export const projectRoot = (index: GraphIndex, rootId: string): RootProjection => {
  if (!index.roots.includes(rootId)) return rejectGraph();
  const mainIds = reachable(index.successors, rootId);
  const visibleIds = new Set(mainIds);
  const pending = [...mainIds];
  while (pending.length > 0) {
    for (const source of index.nodes.get(pending.pop()!)!.dependsOn) {
      if (visibleIds.has(source)) continue;
      visibleIds.add(source);
      pending.push(source);
    }
  }
  const externalIds = new Set<string>();
  const edges: ProjectionEdge[] = [];
  for (const task of index.nodes.values()) {
    if (!visibleIds.has(task.id)) continue;
    if (!mainIds.has(task.id)) externalIds.add(task.id);
    for (const source of task.dependsOn) {
      edges.push({ source, target: task.id, external: !mainIds.has(source) });
    }
  }
  return { rootId, mainIds, externalIds, edges, completed: index.rootProgress.get(rootId)!.done };
};

export const tracePrerequisites = (index: GraphIndex, taskId: string): ReadonlySet<string> => {
  if (!index.nodes.has(taskId)) return rejectGraph();
  const result = new Set<string>();
  const pending = [taskId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const source of index.nodes.get(id)!.dependsOn) pending.push(source);
  }
  return result;
};
