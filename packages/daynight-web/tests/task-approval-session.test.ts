import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, approveTask, getTask, unapproveTask } from '../src/api/client';
import type { TaskDetail } from '../src/api/types';
import { canApprove, canUnapprove, TaskDetailSessions } from '../src/features/task-detail/TaskDetailSession';

vi.mock('../src/api/client', async (original) => ({ ...await original<typeof import('../src/api/client')>(), approveTask: vi.fn(), unapproveTask: vi.fn(), getTask: vi.fn() }));
const project = '10000000-0000-4000-8000-000000000001';
const otherProject = '10000000-0000-4000-8000-000000000002';
const task = '20000000-0000-4000-8000-000000000001';
const otherTask = '20000000-0000-4000-8000-000000000002';
const dependency = '20000000-0000-4000-8000-000000000003';
const version = 9007199254740993n;
const proposed: TaskDetail = { allowAgents: false, startedAt: null, completedAt: null, id: task, projectId: project, version, title: 'Reviewed task', description: 'Complete original description',
  properties: { pullRequests: [] }, status: 'proposed', dependsOn: [dependency], blockedBy: [dependency], ready: false,
  createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' };
const approved: TaskDetail = { ...proposed, status: 'todo', version: version + 1n, updatedAt: '2026-10-22T00:01:00Z' };
const reads = vi.mocked(getTask);
const writes = vi.mocked(approveTask);
const withdrawals = vi.mocked(unapproveTask);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const open = async (sessions: TaskDetailSessions, projectId = project, taskId = task) => {
  sessions.load(projectId, taskId, 1);
  await waitFor(() => expect(sessions.snapshot(projectId, taskId).status).toBe('ready'));
};
beforeEach(() => { reads.mockReset().mockResolvedValue(proposed); writes.mockReset(); withdrawals.mockReset(); });

describe('task approval session ownership', () => {
  it('submits one explicit exact-version approval with unfinished prerequisites and publishes its confirmed result', async () => {
    const sessions = new TaskDetailSessions();
    const mutation = deferred<TaskDetail>();
    writes.mockReturnValueOnce(mutation.promise);
    const refresh = vi.fn();
    sessions.subscribeProject(project, refresh);
    await open(sessions);
    expect(writes).not.toHaveBeenCalled();
    sessions.approve(project, task); sessions.approve(project, task);
    expect(writes).toHaveBeenCalledExactlyOnceWith(project, task, version, expect.any(AbortSignal));
    expect(sessions.snapshot(project, task).mutation.phase).toBe('pending');
    expect(canApprove(sessions.snapshot(project, task))).toBe(false);
    mutation.resolve(approved);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('confirmed'));
    expect(sessions.snapshot(project, task).detail).toEqual(approved);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(canApprove(sessions.snapshot(project, task))).toBe(false);
  });

  it('retains one pending write across closing, reopening and switching projects without publishing to another identity', async () => {
    const sessions = new TaskDetailSessions();
    const mutation = deferred<TaskDetail>(); writes.mockReturnValueOnce(mutation.promise);
    const release = sessions.subscribe(project, task, vi.fn());
    const releaseProject = sessions.subscribeProject(project, vi.fn());
    await open(sessions); sessions.approve(project, task); release(); releaseProject();
    const signal = writes.mock.calls[0]![3];
    sessions.load(project, task, 2); sessions.approve(project, task);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    const refreshOther = vi.fn(); sessions.subscribeProject(otherProject, refreshOther);
    reads.mockResolvedValueOnce({ ...proposed, id: otherTask, projectId: otherProject });
    await open(sessions, otherProject, otherTask);
    mutation.resolve(approved);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toEqual(approved));
    expect(sessions.snapshot(otherProject, otherTask).detail?.status).toBe('proposed');
    expect(refreshOther).not.toHaveBeenCalled();
  });

  it('retains the original server refusal and requires another deliberate click to retry', async () => {
    const sessions = new TaskDetailSessions();
    const error = new ApiError('server', 409, 'invalid_transition', 'refusal-id');
    writes.mockRejectedValueOnce(error);
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('refused'));
    expect(sessions.snapshot(project, task).mutation.error).toBe(error);
    expect(sessions.snapshot(project, task).detail).toBe(proposed);
    expect(canApprove(sessions.snapshot(project, task))).toBe(true);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('reloads a conflicted proposed task and uses its newly reviewed version only on a fresh click', async () => {
    const sessions = new TaskDetailSessions();
    const updated = { ...proposed, title: 'Changed task content', version: version + 1n };
    const error = new ApiError('server', 409, 'version_conflict', 'conflict-id');
    reads.mockResolvedValueOnce(proposed).mockResolvedValueOnce(updated);
    writes.mockRejectedValueOnce(error).mockResolvedValueOnce({ ...approved, version: version + 2n });
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toBe(updated));
    expect(sessions.snapshot(project, task).mutation).toMatchObject({ phase: 'conflict', error, reconciling: false });
    expect(canApprove(sessions.snapshot(project, task))).toBe(true);
    expect(writes).toHaveBeenCalledTimes(1);
    sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('confirmed'));
    expect(writes.mock.calls[1]?.[2]).toBe(updated.version);
  });

  it('hides approval when a conflict reload finds that another caller already approved the task', async () => {
    const sessions = new TaskDetailSessions();
    reads.mockResolvedValueOnce(proposed).mockResolvedValueOnce(approved);
    writes.mockRejectedValueOnce(new ApiError('server', 409, 'version_conflict', 'other-id'));
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toBe(approved));
    expect(canApprove(sessions.snapshot(project, task))).toBe(false);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('reconciles an uncertain write applied=%s without resubmitting and preserves its actual error', async (applied) => {
    const sessions = new TaskDetailSessions();
    const error = new ApiError('network');
    reads.mockResolvedValueOnce(proposed).mockResolvedValueOnce(applied ? approved : proposed);
    writes.mockRejectedValueOnce(error);
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('reconciled'));
    expect(sessions.snapshot(project, task).mutation.error).toBe(error);
    expect(sessions.snapshot(project, task).detail).toBe(applied ? approved : proposed);
    expect(canApprove(sessions.snapshot(project, task))).toBe(!applied);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('requires explicit state refresh after failed uncertain-write reconciliation, including after reopening', async () => {
    const sessions = new TaskDetailSessions();
    const writeError = new ApiError('protocol', 200);
    const readError = new ApiError('network');
    reads.mockResolvedValueOnce(proposed).mockRejectedValueOnce(readError).mockResolvedValueOnce(approved);
    writes.mockRejectedValueOnce(writeError);
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.reconciliationError).toBe(readError));
    expect(sessions.snapshot(project, task).mutation.error).toBe(writeError);
    expect(canApprove(sessions.snapshot(project, task))).toBe(false);
    sessions.load(project, task, 2); sessions.approve(project, task);
    expect(reads).toHaveBeenCalledTimes(2); expect(writes).toHaveBeenCalledTimes(1);
    sessions.reconcile(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toBe(approved));
    expect(sessions.snapshot(project, task).mutation).toMatchObject({ phase: 'reconciled', error: writeError, reconciliationError: null });
  });

  it('reconciles a server failure that cannot prove rollback instead of treating it as a refusal', async () => {
    const sessions = new TaskDetailSessions();
    const error = new ApiError('server', 500, 'internal_error', 'server-failure-id');
    reads.mockResolvedValueOnce(proposed).mockResolvedValueOnce(approved);
    writes.mockRejectedValueOnce(error);
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('reconciled'));
    expect(sessions.snapshot(project, task).detail).toBe(approved);
    expect(sessions.snapshot(project, task).mutation.error).toBe(error);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('keeps a cancelled reconciliation unknown and permits an explicit state check', async () => {
    const sessions = new TaskDetailSessions();
    const cancelled = new DOMException('Transport cancelled', 'AbortError');
    reads.mockResolvedValueOnce(proposed).mockRejectedValueOnce(cancelled).mockResolvedValueOnce(approved);
    writes.mockRejectedValueOnce(new ApiError('network'));
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.reconciliationError).toBe(cancelled));
    expect(sessions.snapshot(project, task).mutation.reconciling).toBe(false);
    expect(canApprove(sessions.snapshot(project, task))).toBe(false);
    sessions.reconcile(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toBe(approved));
  });

  it('lets write reconciliation finish after the details close and ignores an earlier cancelled detail read', async () => {
    const sessions = new TaskDetailSessions();
    const reconciliation = deferred<TaskDetail>();
    reads.mockResolvedValueOnce(proposed).mockReturnValueOnce(reconciliation.promise);
    writes.mockRejectedValueOnce(new ApiError('network'));
    const release = sessions.subscribe(project, task, vi.fn());
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.reconciling).toBe(true));
    const signal = reads.mock.calls[1]![2]; release(); sessions.releaseRead(project, task);
    expect(signal.aborted).toBe(false);
    reconciliation.resolve(approved);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('reconciled'));
    expect(sessions.snapshot(project, task).detail).toBe(approved);
  });

  it('keeps confirmed detail through failed or stale follow-up reads and never reinstates approval', async () => {
    const sessions = new TaskDetailSessions();
    const error = new ApiError('network');
    writes.mockResolvedValueOnce(approved);
    reads.mockResolvedValueOnce(proposed).mockRejectedValueOnce(error).mockResolvedValueOnce(proposed).mockResolvedValueOnce(approved);
    await open(sessions); sessions.approve(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('confirmed'));
    sessions.load(project, task, 2);
    await waitFor(() => expect(sessions.snapshot(project, task).error).toBe(error));
    expect(sessions.snapshot(project, task).detail).toBe(approved);
    sessions.load(project, task, 3);
    await waitFor(() => expect(sessions.snapshot(project, task).error).toMatchObject({ kind: 'protocol' }));
    expect(sessions.snapshot(project, task).detail).toBe(approved);
    expect(canApprove(sessions.snapshot(project, task))).toBe(false);
    sessions.load(project, task, 4);
    await waitFor(() => expect(sessions.snapshot(project, task).error).toBeNull());
    expect(sessions.snapshot(project, task).detail).toBe(approved);
  });

  it('cleans view reads on disposal without cancelling an already submitted approval', async () => {
    const sessions = new TaskDetailSessions(); const mutation = deferred<TaskDetail>();
    writes.mockReturnValueOnce(mutation.promise);
    await open(sessions); sessions.approve(project, task); sessions.dispose();
    expect(writes.mock.calls[0]![3].aborted).toBe(false);
    mutation.reject(new ApiError('network'));
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('unknown'));
    expect(reads).toHaveBeenCalledTimes(1);
  });
});


describe('two-way approval session ownership', () => {
  it('uses one operation owner through approval, withdrawal and renewed approval with exact successive versions', async () => {
    const sessions = new TaskDetailSessions();
    const withdrawn: TaskDetail = { ...proposed, version: version + 2n, updatedAt: '2026-10-22T00:02:00Z' };
    const reapproved: TaskDetail = { ...approved, version: version + 3n, updatedAt: '2026-10-22T00:03:00Z' };
    writes.mockResolvedValueOnce(approved).mockResolvedValueOnce(reapproved);
    withdrawals.mockResolvedValueOnce(withdrawn);
    await open(sessions);
    sessions.performApproval(project, task, 'approve', version);
    await waitFor(() => expect(canUnapprove(sessions.snapshot(project, task))).toBe(true));
    sessions.performApproval(project, task, 'unapprove', approved.version);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toEqual(withdrawn));
    expect(sessions.snapshot(project, task).mutation.operation).toEqual({ action: 'unapprove', version: approved.version });
    sessions.performApproval(project, task, 'approve', withdrawn.version);
    await waitFor(() => expect(sessions.snapshot(project, task).detail).toEqual(reapproved));
    expect(writes.mock.calls.map((call) => call[2])).toEqual([version, version + 2n]);
    expect(withdrawals).toHaveBeenCalledExactlyOnceWith(project, task, version + 1n, expect.any(AbortSignal));
  });

  it('refuses an earlier confirmation version or the opposite source state without issuing a mutation', async () => {
    const sessions = new TaskDetailSessions();
    reads.mockResolvedValueOnce(approved);
    await open(sessions);
    sessions.performApproval(project, task, 'unapprove', version);
    sessions.performApproval(project, task, 'approve', approved.version);
    expect(withdrawals).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });

  it('retains a pending withdrawal across reopening and permits only one submission', async () => {
    const sessions = new TaskDetailSessions(); const mutation = deferred<TaskDetail>();
    reads.mockResolvedValueOnce(approved); withdrawals.mockReturnValueOnce(mutation.promise);
    await open(sessions);
    sessions.unapprove(project, task); sessions.unapprove(project, task);
    sessions.load(project, task, 2);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(canUnapprove(sessions.snapshot(project, task))).toBe(false);
    expect(withdrawals).toHaveBeenCalledExactlyOnceWith(project, task, approved.version, expect.any(AbortSignal));
    mutation.resolve({ ...proposed, version: approved.version + 1n });
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('confirmed'));
    expect(canApprove(sessions.snapshot(project, task))).toBe(true);
  });

  it('reconciles an uncertain withdrawal without retrying and retains the action-specific result', async () => {
    const sessions = new TaskDetailSessions(); const failure = new ApiError('network');
    const withdrawn = { ...proposed, version: approved.version + 1n };
    reads.mockResolvedValueOnce(approved).mockResolvedValueOnce(withdrawn);
    withdrawals.mockRejectedValueOnce(failure);
    await open(sessions); sessions.unapprove(project, task);
    await waitFor(() => expect(sessions.snapshot(project, task).mutation.phase).toBe('reconciled'));
    expect(sessions.snapshot(project, task).detail).toEqual(withdrawn);
    expect(sessions.snapshot(project, task).mutation).toMatchObject({ operation: { action: 'unapprove', version: approved.version }, error: failure });
    expect(withdrawals).toHaveBeenCalledTimes(1); expect(writes).not.toHaveBeenCalled();
  });
});
