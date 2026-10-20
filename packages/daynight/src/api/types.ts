export type TaskStatus = "todo" | "in_progress" | "done";

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly version: bigint;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dependsOn: readonly string[];
  readonly blockedBy: readonly string[];
  readonly ready: boolean;
};

export type GraphTask = Omit<Task, "projectId" | "title" | "description" | "version"> & {
  readonly titlePreview: string;
  readonly titleTruncated: boolean;
};

export type TaskGraphSummary = {
  readonly total: number;
  readonly todo: number;
  readonly inProgress: number;
  readonly done: number;
  readonly ready: number;
  readonly blocked: number;
};

export type TaskGraph = {
  readonly project: Project;
  readonly summary: TaskGraphSummary;
  readonly tasks: readonly GraphTask[];
};

export type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };
export type CreateProjectInput = { readonly name: string; readonly repoUrl: string };
export type CreateTaskInput = {
  readonly title: string;
  readonly description?: string;
  readonly dependsOn?: readonly string[];
};
export type UpdateTaskInput = {
  readonly version: bigint;
  readonly title?: string;
  readonly description?: string;
  readonly status?: TaskStatus;
  readonly dependsOn?: readonly string[];
};
export type TaskFilters = { readonly status?: TaskStatus; readonly ready?: boolean };
export type ErrorDetails = {
  readonly taskIds?: readonly string[];
  readonly nodeCount?: number;
  readonly edgeCount?: number;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
};
export type ServerError = {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly details?: ErrorDetails;
};
