export type TaskStatus = "proposed" | "todo" | "in_progress" | "done";

export type TaskAttachment = {
  readonly path: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PutTaskAttachmentInput = {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
};

export type AttachmentConsumer = (chunk: Uint8Array, signal: AbortSignal) => Promise<void>;

export type ProjectSettings = {
  readonly version: bigint;
  readonly executionWarningMinutes: number;
};

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string;
  readonly settings: ProjectSettings;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PullRequestProperty = {
  readonly url: string;
  readonly title: string;
};

export type TaskProperties = { readonly pullRequests: readonly PullRequestProperty[] };

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly allowAgents: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly version: bigint;
  readonly properties: TaskProperties;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dependsOn: readonly string[];
  readonly blockedBy: readonly string[];
  readonly ready: boolean;
};

export type GraphTask = Omit<Task, "projectId" | "title" | "description" | "version" | "properties"> & {
  readonly titlePreview: string;
  readonly titleTruncated: boolean;
};

export type TaskGraphSummary = {
  readonly total: number;
  readonly proposed: number;
  readonly todo: number;
  readonly inProgress: number;
  readonly done: number;
  readonly ready: number;
  readonly blocked: number;
};

export type TaskGraph = {
  readonly observedAt: string;
  readonly project: Project;
  readonly summary: TaskGraphSummary;
  readonly tasks: readonly GraphTask[];
};

export type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };
export type CreateProjectInput = { readonly name: string; readonly repoUrl: string };
export type CreateTaskInput = {
  readonly title: string;
  readonly description?: string;
  readonly properties?: TaskProperties;
  readonly dependsOn?: readonly string[];
};
export type UpdateTaskInput = {
  readonly version: bigint;
  readonly allowAgents?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly properties?: TaskProperties;
  readonly dependsOn?: readonly string[];
};
export type TaskActionInput = { readonly version: bigint };
export type TaskFilters = { readonly status?: TaskStatus; readonly ready?: boolean; readonly allowAgents?: boolean };
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
