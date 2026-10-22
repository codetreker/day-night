import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, approveTask, getTask, isAbortError } from "../../api/client";
import type { TaskDetail } from "../../api/types";

export type ApprovalState = {
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
  readonly error: unknown;
  readonly approval: ApprovalState;
};
type Entry = {
  state: DetailState;
  generation: number;
  read: AbortController | null;
  committedVersion: bigint | null;
  readonly listeners: Set<() => void>;
};
const idleApproval = (): ApprovalState => ({ phase: "idle", error: null, reconciling: false, reconciliationError: null });
const initialState = (): DetailState => ({ revision: 0, loadedRevision: null, detail: null, status: "loading", refreshing: false, error: null, approval: idleApproval() });
export const canApprove = (state: DetailState): boolean => state.detail?.status === "proposed" && state.status === "ready" &&
  state.approval.phase !== "pending" && state.approval.phase !== "unknown" && !state.approval.reconciling && state.approval.reconciliationError === null && !state.refreshing && state.error === null;

export class TaskDetailSessions {
  private readonly entries = new Map<string, Entry>();
  private readonly projects = new Map<string, Set<() => void>>();
  private disposed = false;

  private entry(projectId: string, taskId: string): Entry {
    const key = `${projectId}/${taskId}`;
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { state: initialState(), generation: 0, read: null, committedVersion: null, listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }
  private publish(entry: Entry, state: DetailState): void {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  }
  snapshot = (projectId: string, taskId: string): DetailState => this.entry(projectId, taskId).state;
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
    entry.read?.abort();
    entry.read = null;
  }
  releaseRead(projectId: string, taskId: string): void {
    if (!this.entry(projectId, taskId).state.approval.reconciling) this.cancelRead(projectId, taskId);
  }
  load(projectId: string, taskId: string, revision: number, mode: "open" | "refresh" = "refresh"): void {
    const entry = this.entry(projectId, taskId);
    if (entry.state.approval.phase === "pending" || entry.state.approval.phase === "unknown" || entry.state.approval.reconciling) return;
    void this.read(projectId, taskId, revision, false, mode === "refresh");
  }
  reconcile(projectId: string, taskId: string): void {
    const entry = this.entry(projectId, taskId);
    if (entry.state.approval.phase === "pending" || entry.state.approval.reconciling) return;
    void this.read(projectId, taskId, entry.state.revision, true, true);
  }
  private async read(projectId: string, taskId: string, revision: number, reconciliation: boolean, retainLoaded: boolean): Promise<void> {
    if (this.disposed) return;
    const entry = this.entry(projectId, taskId);
    this.cancelRead(projectId, taskId);
    const controller = new AbortController();
    entry.read = controller;
    const generation = entry.generation;
    const retain = entry.state.detail !== null && (retainLoaded || entry.state.approval.phase !== "idle");
    this.publish(entry, { ...entry.state, revision, loadedRevision: retain ? entry.state.loadedRevision : null, detail: retain ? entry.state.detail : null,
      status: retain ? "ready" : "loading", refreshing: retain, error: null,
      approval: reconciliation ? { ...entry.state.approval, reconciling: true, reconciliationError: null } : entry.state.approval });
    try {
      const detail = await getTask(projectId, taskId, controller.signal);
      if (controller.signal.aborted || generation !== entry.generation || this.disposed) return;
      if (detail.projectId !== projectId || detail.id !== taskId || entry.committedVersion !== null && detail.version < entry.committedVersion) throw new ApiError("protocol");
      const approval = reconciliation
        ? { ...entry.state.approval, phase: entry.state.approval.phase === "unknown" ? "reconciled" as const : entry.state.approval.phase, reconciling: false, reconciliationError: null }
        : entry.state.approval;
      this.publish(entry, { revision, loadedRevision: revision, detail, status: "ready", refreshing: false, error: null, approval });
      if (reconciliation) this.refreshProject(projectId);
    } catch (error) {
      if (controller.signal.aborted || generation !== entry.generation || this.disposed || !retain && !reconciliation && isAbortError(error)) return;
      this.publish(entry, { ...entry.state, status: retain ? "ready" : "error", refreshing: false,
        error: reconciliation ? null : error,
        approval: reconciliation ? { ...entry.state.approval, reconciling: false, reconciliationError: error } : entry.state.approval });
    } finally {
      if (generation === entry.generation) entry.read = null;
    }
  }
  approve(projectId: string, taskId: string): void {
    const entry = this.entry(projectId, taskId);
    if (!canApprove(entry.state)) return;
    const version = entry.state.detail!.version;
    this.cancelRead(projectId, taskId);
    this.publish(entry, { ...entry.state, refreshing: false, error: null, approval: { phase: "pending", error: null, reconciling: false, reconciliationError: null } });
    // Submitted writes outlive their dialog; closing a view does not undo a server mutation.
    void (async () => {
      try {
        const detail = await approveTask(projectId, taskId, version, new AbortController().signal);
        if (detail.projectId !== projectId || detail.id !== taskId || detail.status !== "todo" || detail.version !== version + 1n) throw new ApiError("protocol");
        entry.committedVersion = detail.version;
        this.publish(entry, { ...entry.state, detail, loadedRevision: entry.state.revision, status: "ready", refreshing: false, error: null,
          approval: { phase: "confirmed", error: null, reconciling: false, reconciliationError: null } });
        this.refreshProject(projectId);
      } catch (error) {
        const phase = error instanceof ApiError && error.kind === "server" && error.status !== null && error.status >= 400 && error.status < 500
          ? error.code === "version_conflict" ? "conflict" : "refused" : "unknown";
        this.publish(entry, { ...entry.state, approval: { phase, error, reconciling: false, reconciliationError: null } });
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
