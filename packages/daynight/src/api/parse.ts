import { isNonemptyText, isText } from "../platform/text.js";
import type { ErrorDetails, GraphTask, Page, Project, ServerError, Task, TaskGraph, TaskGraphSummary, TaskStatus } from "./types.js";

export class ProtocolError extends Error {
  constructor(message = "The server returned an invalid response.") { super(message); this.name = "ProtocolError"; }
}
const malformed = (): never => { throw new ProtocolError(); };
const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
};
const text = (value: unknown, nonempty = false): string => {
  if (!isText(value) || (nonempty && !isNonemptyText(value))) return malformed();
  return value;
};
const bool = (value: unknown): boolean => typeof value === "boolean" ? value : malformed();
const count = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : malformed();
export const canonicalId = (value: string): string | null => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
const id = (value: unknown): string => {
  const parsed = text(value);
  if (canonicalId(parsed) !== parsed) return malformed();
  return parsed;
};
const timestamp = (value: unknown): string => {
  const parsed = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(parsed)) return malformed();
  const milliseconds = Date.parse(parsed);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== parsed.slice(0, 19)) return malformed();
  return parsed;
};
const array = <T>(value: unknown, parse: (item: unknown) => T): T[] => Array.isArray(value) ? value.map(parse) : malformed();
const ids = (value: unknown): string[] => {
  const parsed = array(value, id);
  if (new Set(parsed).size !== parsed.length) return malformed();
  return parsed;
};
const status = (value: unknown): TaskStatus => value === "todo" || value === "in_progress" || value === "done" ? value : malformed();

export const parseProject = (value: unknown, expectedId?: string): Project => {
  const data = record(value);
  const parsed = { id: id(data.id), name: text(data.name, true), repoUrl: text(data.repoUrl, true), createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) };
  if (expectedId !== undefined && parsed.id !== expectedId) return malformed();
  return parsed;
};

const dependencyState = (data: Record<string, unknown>) => {
  const parsed = { id: id(data.id), status: status(data.status), dependsOn: ids(data.dependsOn), blockedBy: ids(data.blockedBy), ready: bool(data.ready), createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) };
  if (parsed.dependsOn.includes(parsed.id) || parsed.blockedBy.some((item) => !parsed.dependsOn.includes(item)) || parsed.ready !== (parsed.status === "todo" && parsed.blockedBy.length === 0)) return malformed();
  return parsed;
};

export const parseTask = (value: unknown, projectId: string, taskId?: string): Task => {
  const data = record(value);
  const version = data.version;
  if (typeof version !== "bigint" || version < 1n || version > 9_223_372_036_854_775_807n) return malformed();
  const parsed = { ...dependencyState(data), projectId: id(data.projectId), title: text(data.title, true), description: text(data.description), version };
  if (parsed.projectId !== projectId || (taskId !== undefined && parsed.id !== taskId)) return malformed();
  return parsed;
};

export const parsePage = <T extends { readonly id: string }>(value: unknown, parse: (item: unknown) => T): Page<T> => {
  const data = record(value);
  const items = array(data.items, parse);
  if (items.length > 100 || new Set(items.map((item) => item.id)).size !== items.length) return malformed();
  let nextCursor: string | null = null;
  if (data.nextCursor !== null) {
    nextCursor = text(data.nextCursor, true);
    if (items.length === 0) return malformed();
  }
  return { items, nextCursor };
};

const graphTask = (value: unknown): GraphTask => {
  const data = record(value);
  const parsed = { ...dependencyState(data), titlePreview: text(data.titlePreview), titleTruncated: bool(data.titleTruncated) };
  const characters = Array.from(parsed.titlePreview).length;
  if (characters === 0 || characters > 160 || (parsed.titleTruncated && characters !== 160)) return malformed();
  return parsed;
};
const summary = (value: unknown): TaskGraphSummary => {
  const data = record(value);
  return { total: count(data.total), todo: count(data.todo), inProgress: count(data.inProgress), done: count(data.done), ready: count(data.ready), blocked: count(data.blocked) };
};

export const parseTaskGraph = (value: unknown, projectId: string): TaskGraph => {
  const data = record(value);
  const parsed = { project: parseProject(data.project, projectId), summary: summary(data.summary), tasks: array(data.tasks, graphTask) };
  const byId = new Map(parsed.tasks.map((task) => [task.id, task]));
  if (parsed.tasks.length > 1000 || byId.size !== parsed.tasks.length || parsed.tasks.reduce((sum, task) => sum + task.dependsOn.length, 0) > 5000) return malformed();
  const expected = { total: parsed.tasks.length, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 };
  for (const task of parsed.tasks) {
    if (task.status === "todo") { expected.todo++; if (task.ready) expected.ready++; else expected.blocked++; }
    else if (task.status === "in_progress") expected.inProgress++;
    else expected.done++;
    const blocked = task.dependsOn.filter((dependency) => {
      const target = byId.get(dependency);
      if (target === undefined) return malformed();
      return target.status !== "done";
    });
    if (blocked.length !== task.blockedBy.length || blocked.some((dependency) => !task.blockedBy.includes(dependency))) return malformed();
  }
  for (const key of Object.keys(expected) as (keyof TaskGraphSummary)[]) if (expected[key] !== parsed.summary[key]) return malformed();
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (taskId: string): void => {
    if (active.has(taskId)) return malformed();
    if (visited.has(taskId)) return;
    active.add(taskId);
    for (const dependency of byId.get(taskId)!.dependsOn) visit(dependency);
    active.delete(taskId);
    visited.add(taskId);
  };
  for (const task of parsed.tasks) visit(task.id);
  return parsed;
};

export const parseServerError = (value: unknown): ServerError => {
  const data = record(record(value).error);
  const code = text(data.code, true);
  const requestId = text(data.requestId, true);
  const message = text(data.message, true);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(code) || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(requestId)) return malformed();
  let details: ErrorDetails | undefined;
  if (data.details !== undefined) {
    const raw = record(data.details);
    details = {
      ...(raw.taskIds === undefined ? {} : { taskIds: ids(raw.taskIds) }),
      ...(raw.nodeCount === undefined ? {} : { nodeCount: count(raw.nodeCount) }),
      ...(raw.edgeCount === undefined ? {} : { edgeCount: count(raw.edgeCount) }),
      ...(raw.maxNodes === undefined ? {} : { maxNodes: count(raw.maxNodes) }),
      ...(raw.maxEdges === undefined ? {} : { maxEdges: count(raw.maxEdges) }),
    };
  }
  if (code === "graph_limit_exceeded" && (details?.nodeCount === undefined || details.edgeCount === undefined || details.maxNodes !== 1000 || details.maxEdges !== 5000 || (details.nodeCount <= details.maxNodes && details.edgeCount <= details.maxEdges))) return malformed();
  return { code, message, requestId, ...(details === undefined ? {} : { details }) };
};
