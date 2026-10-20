import type {
  GraphLimitDetails,
  GraphTask,
  Project,
  ProjectPage,
  TaskDetail,
  TaskGraph,
  TaskGraphSummary,
  TaskStatus,
} from "./types";

const malformed = (): never => {
  throw new Error("The server returned an invalid response.");
};

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
};

const string = (value: unknown): string => {
  if (typeof value !== "string") return malformed();
  return value;
};

const nonemptyString = (value: unknown): string => {
  const parsed = string(value);
  if (parsed.trim() === "" || parsed.includes("\0")) return malformed();
  return parsed;
};

const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") return malformed();
  return value;
};

const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return malformed();
  return value;
};

export const canonicalId = (value: string): string | null =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;

const id = (value: unknown): string => {
  const parsed = canonicalId(string(value));
  if (parsed === null) return malformed();
  return parsed;
};

const timestamp = (value: unknown): string => {
  const parsed = string(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(parsed)) return malformed();
  const milliseconds = Date.parse(parsed);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== parsed.slice(0, 19)) {
    return malformed();
  }
  return parsed;
};

const array = <T>(value: unknown, parse: (item: unknown) => T): T[] => {
  if (!Array.isArray(value)) return malformed();
  return value.map(parse);
};

const ids = (value: unknown): string[] => {
  const values = array(value, id);
  if (new Set(values).size !== values.length) return malformed();
  return values;
};

const status = (value: unknown): TaskStatus => {
  if (value !== "todo" && value !== "in_progress" && value !== "done") return malformed();
  return value;
};

const project = (value: unknown): Project => {
  const data = record(value);
  return {
    id: id(data.id),
    name: nonemptyString(data.name),
    repoUrl: nonemptyString(data.repoUrl),
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
  };
};

export const parseProjectPage = (value: unknown): ProjectPage => {
  const data = record(value);
  const items = array(data.items, project);
  if (new Set(items.map((item) => item.id)).size !== items.length) return malformed();
  return { items, nextCursor: data.nextCursor === null ? null : nonemptyString(data.nextCursor) };
};

const graphTask = (value: unknown): GraphTask => {
  const data = record(value);
  return {
    id: id(data.id),
    titlePreview: string(data.titlePreview),
    titleTruncated: boolean(data.titleTruncated),
    status: status(data.status),
    dependsOn: ids(data.dependsOn),
    blockedBy: ids(data.blockedBy),
    ready: boolean(data.ready),
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
  };
};

const summary = (value: unknown): TaskGraphSummary => {
  const data = record(value);
  return {
    total: count(data.total),
    todo: count(data.todo),
    inProgress: count(data.inProgress),
    done: count(data.done),
    ready: count(data.ready),
    blocked: count(data.blocked),
  };
};

export const parseTaskGraph = (value: unknown, projectId: string): TaskGraph => {
  const data = record(value);
  const parsed = { project: project(data.project), summary: summary(data.summary), tasks: array(data.tasks, graphTask) };
  if (parsed.project.id !== projectId || new Set(parsed.tasks.map((task) => task.id)).size !== parsed.tasks.length) {
    return malformed();
  }
  return parsed;
};

export const parseTaskDetail = (value: unknown, projectId: string, taskId: string): TaskDetail => {
  const data = record(value);
  const parsed = {
    id: id(data.id),
    projectId: id(data.projectId),
    title: nonemptyString(data.title),
    description: string(data.description),
    status: status(data.status),
    dependsOn: ids(data.dependsOn),
    blockedBy: ids(data.blockedBy),
    ready: boolean(data.ready),
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
  };
  if (parsed.projectId !== projectId || parsed.id !== taskId) return malformed();
  return parsed;
};

export type ServerError = {
  readonly code: string;
  readonly requestId: string;
  readonly graphLimit?: GraphLimitDetails;
};

export const parseServerError = (value: unknown): ServerError => {
  const data = record(record(value).error);
  const code = string(data.code);
  const requestId = string(data.requestId);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(code) || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(requestId)) return malformed();
  string(data.message);
  if (code !== "graph_limit_exceeded") return { code, requestId };
  const details = record(data.details);
  return {
    code,
    requestId,
    graphLimit: {
      nodeCount: count(details.nodeCount),
      edgeCount: count(details.edgeCount),
      maxNodes: count(details.maxNodes),
      maxEdges: count(details.maxEdges),
    },
  };
};
