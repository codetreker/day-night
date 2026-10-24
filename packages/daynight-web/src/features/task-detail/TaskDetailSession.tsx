import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, approveTask, getTask, isAbortError, setTaskAgentPermission, setTaskRequiredPlatform, unapproveTask } from "../../api/client";
import { isTaskStale, taskDescriptor } from "./freshness";
import type { ApprovalAction, ExecutionPlatform, GraphTask, TaskDetail } from "../../api/types";

export type ApprovalOperation = { readonly action: ApprovalAction; readonly version: bigint };
export type TaskMutationOperation = ApprovalOperation | { readonly action: "allowAgents"; readonly allowAgents: boolean; readonly version: bigint } |
  { readonly action: "requiredPlatform"; readonly requiredPlatform: ExecutionPlatform | null; readonly version: bigint };
export type TaskMutationState = {
  readonly operation: TaskMutationOperation | null;
  readonly phase: "idle" | "pending" | "confirmed" | "refused" | "conflict" | "unknown" | "reconciled";
  readonly error: unknown;
  readonly reconciling: boolean;
  readonly reconciliationError: unknown;
};
export type DetailState = {
  readonly revision: number;
  readonly loadedRevision: number | null;
  readonly detail: TaskDetail | null;
  readonly status: "loading" | "ready" | "error";
  readonly refreshing: boolean;
  readonly requiresFreshRead: boolean;
  readonly error: unknown;
  readonly mutation: TaskMutationState;
};
type Entry = {
  state: DetailState;
  generation: number;
  read: AbortController | null;
  committedVersion: bigint | null;
  queuedRevision: number | null;
  observedDescriptor: string | null;
  observedTask: GraphTask | undefined;
  readonly listeners: Set<() => void>;
};
const preserveCollection = (previous: TaskDetail | null, detail: TaskDetail): TaskDetail => {
  if (previous === null) return detail;
  const old = previous.properties.pullRequests;
  const fresh = detail.properties.pullRequests;
  if (old === fresh) return detail;
  const unchanged = old.length === fresh.length && old.every((item, index) => item.url === fresh[index]!.url && item.title === fresh[index]!.title);
  return unchanged ? { ...detail, properties: { ...detail.properties, pullRequests: old } } : detail;
};
const idleMutation = (): TaskMutationState => ({ operation: null, phase: "idle", error: null, reconciling: false, reconciliationError: null });
const initialState = (): DetailState => ({ revision: 0, loadedRevision: null, detail: null, status: "loading", refreshing: false, requiresFreshRead: true, error: null, mutation: idleMutation() });
export const approvalAction = (detail: TaskDetail | null): ApprovalAction | null =>
  detail?.status === "proposed" ? "approve" : detail?.status === "todo" ? "unapprove" : null;
const canMutate = (state: DetailState): boolean => state.detail !== null && state.status === "ready" &&
  state.mutation.phase !== "pending" && state.mutation.phase !== "unknown" && !state.mutation.reconciling && state.mutation.reconciliationError === null && !state.requiresFreshRead && state.error === null;
export const canPerformApproval = (state: DetailState, action: ApprovalAction): boolean => approvalAction(state.detail) === action && canMutate(state);
export const canSetAgentPermission = (state: DetailState): boolean => state.detail !== null && state.detail.status !== "in_progress" && canMutate(state);
export const canSetRequiredPlatform = canSetAgentPermission;
export const canApprove = (state: DetailState): boolean => canPerformApproval(state, "approve");
export const canUnapprove = (state: DetailState): boolean => canPerformApproval(state, "unapprove");

export class TaskDetailSessions {
  private readonly entries = new Map<string, Entry>();
  private readonly projects = new Map<string, Set<() => void>>();
  private disposed = false;

  private entry(projectId: string, taskId: string): Entry {
    const key = `${projectId}/${taskId}`;
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { state: initialState(), generation: 0, read: null, committedVersion: null, queuedRevision: null, observedDescriptor: null, observedTask: undefined, listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }
  private publish(entry: Entry, state: DetailState): void {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  }
  snapshot = (projectId: string, taskId: string): DetailState => this.entry(projectId, taskId).state;
  // Unchanged polling receipts do not invalidate an observed task version.
  requiresFreshRead(projectId: string, taskId: string, task: GraphTask | undefined): boolean {
    const entry = this.entry(projectId, taskId);
    return entry.state.requiresFreshRead || entry.observedDescriptor !== taskDescriptor(task) &&
      entry.state.detail !== null && task !== undefined && isTaskStale(task, entry.state.detail);
  }
  observe(projectId: string, taskId: string, task: GraphTask | undefined): void {
    const entry = this.entry(projectId, taskId);
    const requiresFreshRead = this.requiresFreshRead(projectId, taskId, task);
    entry.observedDescriptor = taskDescriptor(task);
    entry.observedTask = task;
    if (requiresFreshRead !== entry.state.requiresFreshRead) this.publish(entry, { ...entry.state, requiresFreshRead });
  }
  subscribe = (projectId: string, taskId: string, listener: () => void): (() => void) => {
    const entry = this.entry(projectId, taskId);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) this.releaseRead(projectId, taskId);
    };
  };
  subscribeProject = (projectId: string, listener: () => void): (() => void) => {
    let listeners = this.projects.get(projectId);
    if (listeners === undefined) {
      listeners = new Set();
      this.projects.set(projectId, listeners);
    }
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  private refreshProject(projectId: string): void {
    if (this.disposed) return;
    for (const listener of this.projects.get(projectId) ?? []) listener();
  }
  cancelRead(projectId: string, taskId: string): void {
    const entry = this.entry(projectId, taskId);
    entry.generation++;
    entry.queuedRevision = null;
    entry.read?.abort();
    entry.read = null;
  }
  releaseRead(projectId: string, taskId: string): void {
    if (!this.entry(projectId, taskId).state.mutation.reconciling) this.cancelRead(projectId, taskId);
  }
  load(projectId: string, taskId: string, revision: number, mode: "open" | "refresh" | "automatic" = "refresh"): void {
    const entry = this.entry(projectId, taskId);
    if (entry.state.mutation.phase === "pending" || entry.state.mutation.phase === "unknown" || entry.state.mutation.reconciling) return;
    if (mode === "automatic") {
      if (document.visibilityState === "hidden") return;
      if (entry.read !== null) { entry.queuedRevision = revision; return; }
    }
    void this.read(projectId, taskId, revision, false, mode !== "open", mode === "automatic");
  }
  reconcile(projectId: string, taskId: string): void {
    const entry = this.entry(projectId, taskId);
    if (entry.state.mutation.phase === "pending" || entry.state.mutation.reconciling) return;
    void this.read(projectId, taskId, entry.state.revision, true, true);
  }
  private async read(projectId: string, taskId: string, revision: number, reconciliation: boolean, retainLoaded: boolean, automatic = false): Promise<void> {
    if (this.disposed) return;
    const entry = this.entry(projectId, taskId);
    this.cancelRead(projectId, taskId);
    const controller = new AbortController();
    entry.read = controller;
    const generation = entry.generation;
    const observedDescriptor = entry.observedDescriptor;
    const retain = entry.state.detail !== null && (retainLoaded || entry.state.mutation.phase !== "idle");
    this.publish(entry, { ...entry.state, revision, loadedRevision: retain ? entry.state.loadedRevision : null, detail: retain ? entry.state.detail : null,
      requiresFreshRead: !automatic || entry.state.requiresFreshRead,
      status: retain ? "ready" : automatic && entry.state.error !== null ? "error" : "loading", refreshing: retain, error: automatic ? entry.state.error : null,
      mutation: reconciliation ? { ...entry.state.mutation, reconciling: true, reconciliationError: null } : entry.state.mutation });
    try {
      const detail = await getTask(projectId, taskId, controller.signal);
      if (controller.signal.aborted || generation !== entry.generation || this.disposed) return;
      if (detail.projectId !== projectId || detail.id !== taskId || entry.committedVersion !== null && detail.version < entry.committedVersion) throw new ApiError("protocol");
      const mutation = reconciliation
        ? { ...entry.state.mutation, phase: entry.state.mutation.phase === "unknown" ? "reconciled" as const : entry.state.mutation.phase, reconciling: false, reconciliationError: null }
        : entry.state.mutation;
      // A descriptor changed during this read must match its response before a mutation can use that version.
      const requiresFreshRead = entry.observedDescriptor !== observedDescriptor && entry.observedTask !== undefined && isTaskStale(entry.observedTask, detail);
      this.publish(entry, { revision, loadedRevision: revision, detail: preserveCollection(entry.state.detail, detail), status: "ready", refreshing: false, requiresFreshRead, error: null, mutation });
      if (reconciliation) this.refreshProject(projectId);
    } catch (error) {
      if (controller.signal.aborted || generation !== entry.generation || this.disposed || !retain && !reconciliation && isAbortError(error)) return;
      const missing = error instanceof ApiError && error.status === 404;
      const detail = missing ? null : entry.state.detail;
      this.publish(entry, { ...entry.state, detail, loadedRevision: missing ? null : entry.state.loadedRevision, status: detail !== null ? "ready" : "error", refreshing: false,
        error: reconciliation && detail !== null ? null : error,
        mutation: reconciliation ? { ...entry.state.mutation, reconciling: false, reconciliationError: error } : entry.state.mutation });
    } finally {
      if (generation === entry.generation) {
        entry.read = null;
        const queued = entry.queuedRevision;
        entry.queuedRevision = null;
        if (queued !== null && entry.listeners.size > 0 && !this.disposed) this.load(projectId, taskId, queued, "automatic");
      }
    }
  }
  approve(projectId: string, taskId: string): void {
    const state = this.entry(projectId, taskId).state;
    if (canApprove(state)) this.performApproval(projectId, taskId, "approve", state.detail!.version);
  }
  unapprove(projectId: string, taskId: string): void {
    const state = this.entry(projectId, taskId).state;
    if (canUnapprove(state)) this.performApproval(projectId, taskId, "unapprove", state.detail!.version);
  }
  performApproval(projectId: string, taskId: string, action: ApprovalAction, version: bigint): void {
    const entry = this.entry(projectId, taskId);
    if (!canPerformApproval(entry.state, action) || entry.state.detail!.version !== version) return;
    this.performMutation(projectId, taskId, { action, version });
  }
  setAgentPermission(projectId: string, taskId: string, allowAgents: boolean, version: bigint): void {
    const state = this.entry(projectId, taskId).state;
    if (!canSetAgentPermission(state) || state.detail!.version !== version || state.detail!.allowAgents === allowAgents) return;
    this.performMutation(projectId, taskId, { action: "allowAgents", allowAgents, version });
  }
  setRequiredPlatform(projectId: string, taskId: string, requiredPlatform: ExecutionPlatform | null, version: bigint): void {
    const state = this.entry(projectId, taskId).state;
    if (!canSetRequiredPlatform(state) || state.detail!.version !== version || state.detail!.requiredPlatform === requiredPlatform) return;
    this.performMutation(projectId, taskId, { action: "requiredPlatform", requiredPlatform, version });
  }
  private performMutation(projectId: string, taskId: string, operation: TaskMutationOperation): void {
    const entry = this.entry(projectId, taskId);
    const previous = entry.state.detail!;
    this.cancelRead(projectId, taskId);
    this.publish(entry, { ...entry.state, refreshing: false, error: null, mutation: { operation, phase: "pending", error: null, reconciling: false, reconciliationError: null } });
    // Submitted writes outlive their dialog; closing a view does not undo a server mutation.
    void (async () => {
      try {
        const signal = new AbortController().signal;
        const detail = operation.action === "allowAgents"
          ? await setTaskAgentPermission(projectId, taskId, operation.allowAgents, operation.version, signal)
          : operation.action === "requiredPlatform"
            ? await setTaskRequiredPlatform(projectId, taskId, operation.requiredPlatform, operation.version, signal)
            : await (operation.action === "approve" ? approveTask : unapproveTask)(projectId, taskId, operation.version, signal);
        const validResult = operation.action === "allowAgents"
          ? detail.status === previous.status && detail.allowAgents === operation.allowAgents && detail.requiredPlatform === previous.requiredPlatform
          : operation.action === "requiredPlatform"
            ? detail.status === previous.status && detail.requiredPlatform === operation.requiredPlatform && detail.allowAgents === previous.allowAgents
            : detail.status === (operation.action === "approve" ? "todo" : "proposed") && detail.allowAgents === previous.allowAgents && detail.requiredPlatform === previous.requiredPlatform;
        if (detail.projectId !== projectId || detail.id !== taskId || !validResult || detail.version !== operation.version + 1n) throw new ApiError("protocol");
        entry.committedVersion = detail.version;
        this.publish(entry, { ...entry.state, detail: preserveCollection(entry.state.detail, detail), status: "ready", refreshing: false, requiresFreshRead: false, error: null,
          mutation: { operation, phase: "confirmed", error: null, reconciling: false, reconciliationError: null } });
        this.refreshProject(projectId);
      } catch (error) {
        const phase = error instanceof ApiError && error.kind === "server" && error.status !== null && error.status >= 400 && error.status < 500
          ? error.code === "version_conflict" ? "conflict" : "refused" : "unknown";
        this.publish(entry, { ...entry.state, mutation: { operation, phase, error, reconciling: false, reconciliationError: null } });
        if (phase === "conflict" || phase === "unknown") {
          if (phase === "conflict") this.refreshProject(projectId);
          if (!this.disposed) await this.read(projectId, taskId, entry.state.revision, true, true);
        }
      }
    })();
  }
  dispose(): void {
    this.disposed = true;
    this.projects.clear();
    for (const entry of this.entries.values()) {
      entry.generation++;
      entry.read?.abort();
      entry.listeners.clear();
    }
  }
}
const Context = createContext<TaskDetailSessions | null>(null);
export const TaskDetailSessionProvider = ({ children }: { readonly children: ReactNode }) => {
  const [sessions] = useState(() => new TaskDetailSessions());
  useEffect(() => () => { sessions.dispose(); }, [sessions]);
  return <Context.Provider value={sessions}>{children}</Context.Provider>;
};
export const TaskDetailSessionBoundary = ({ children }: { readonly children: ReactNode }) =>
  useContext(Context) === null ? <TaskDetailSessionProvider>{children}</TaskDetailSessionProvider> : children;
export const useTaskDetailSessions = (): TaskDetailSessions => {
  const sessions = useContext(Context);
  if (sessions === null) throw new Error("Task detail sessions are required.");
  return sessions;
};
