import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getTask, setTaskAgentPermission, setTaskRequiredPlatform } from '../src/api/client';
import type { GraphTask, Project, TaskDetail, TaskGraph } from '../src/api/types';
import { TaskDetailDialog, type TaskDetailDialogProps } from '../src/features/task-detail/TaskDetailDialog';
import { TaskPlatformBadge, TaskPlatformFeedback } from '../src/features/task-detail/TaskPlatform';
import type { TaskMutationState } from '../src/features/task-detail/TaskDetailSession';
import { buildGraphIndex } from '../src/features/task-graph/model';
import { renderWithLocale } from './helpers/renderWithLocale';

vi.mock('../src/api/client', async (original) => ({ ...await original<typeof import('../src/api/client')>(), getTask: vi.fn(), setTaskAgentPermission: vi.fn(), setTaskRequiredPlatform: vi.fn() }));
vi.mock('../src/features/task-detail/attachments/TaskAttachments', () => ({ TaskAttachmentsPanel: () => <section><input aria-label="Attachment draft" defaultValue="" /></section> }));
vi.mock('../src/features/task-detail/attachments/useAttachments', () => ({ useAttachments: () => ({ select: vi.fn() }) }));
const projectId = '10000000-0000-4000-8000-000000000001';
const taskId = '20000000-0000-4000-8000-000000000001';
const time = '2026-10-24T00:00:00Z';
const project: Project = { id: projectId, name: 'Platform tasks', repoUrl: 'https://example.com/repo', settings: { version: 1n, executionWarningMinutes: 60 }, createdAt: time, updatedAt: time };
const detail: TaskDetail = { id: taskId, projectId, title: 'Reviewed task', description: 'Keep this content', allowAgents: false, requiredPlatform: null, status: 'proposed', version: 9007199254740993n,
  dependsOn: [], externalDependsOn: [], blockedBy: [], ready: false, properties: { pullRequests: [] }, startedAt: null, completedAt: null, createdAt: time, updatedAt: time };
const graphTask = (value: TaskDetail): GraphTask => ({ id: value.id, titlePreview: value.title, titleTruncated: false, status: value.status,
  requiredPlatform: value.requiredPlatform, allowAgents: value.allowAgents, dependsOn: value.dependsOn, externalDependsOn: value.externalDependsOn, blockedBy: value.blockedBy, ready: value.ready,
  startedAt: value.startedAt, completedAt: value.completedAt, createdAt: value.createdAt, updatedAt: value.updatedAt });
const snapshot = (value: TaskDetail, revision = 1) => {
  const graph: TaskGraph = { observedAt: time, project, tasks: [graphTask(value)], summary: { total: 1, proposed: value.status === 'proposed' ? 1 : 0,
    todo: value.status === 'todo' ? 1 : 0, inProgress: value.status === 'in_progress' ? 1 : 0, done: value.status === 'done' ? 1 : 0, ready: value.ready ? 1 : 0, blocked: value.status === 'todo' && !value.ready ? 1 : 0 } };
  return { observedAt: time, graph, index: buildGraphIndex(graph), receivedMonotonic: performance.now(), receivedAt: 1, revision };
};
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const writes = vi.mocked(setTaskRequiredPlatform);
let root: HTMLDivElement;
beforeEach(() => { root = document.createElement('div'); root.id = 'root'; document.body.append(root); vi.mocked(getTask).mockReset(); writes.mockReset(); vi.mocked(setTaskAgentPermission).mockReset(); });
afterEach(() => { cleanup(); root.remove(); });
const open = async (value = detail, locale: 'en' | 'zh-CN' = 'en') => {
  vi.mocked(getTask).mockResolvedValue(value);
  const props: TaskDetailDialogProps = { projectId, taskId: value.id, snapshot: snapshot(value), onClose: vi.fn(), onSelectTask: vi.fn(), onRestoreFocus: vi.fn(), onRefreshGraph: vi.fn() };
  const view = renderWithLocale(<TaskDetailDialog {...props} />, { locale, container: root });
  await screen.findByRole('heading', { name: value.title });
  return { ...view, props };
};
const select = () => screen.getByRole('combobox', { name: 'Execution platform' });
const save = () => screen.getByRole('button', { name: 'Save platform' });

describe('explicit platform editor', () => {
  it('saves only after an explicit action and preserves the confirmed badge while pending', async () => {
    await open(); const pending = deferred<TaskDetail>(); writes.mockReturnValueOnce(pending.promise);
    expect(select()).toHaveValue(''); expect(save()).toBeDisabled();
    fireEvent.change(select(), { target: { value: 'linux' } });
    expect(writes).not.toHaveBeenCalled(); expect(save()).toBeEnabled();
    expect(document.querySelector('.task-detail-badges .task-platform')).toHaveTextContent('Any platform');
    fireEvent.click(save());
    expect(writes).toHaveBeenCalledExactlyOnceWith(projectId, taskId, 'linux', detail.version, expect.any(AbortSignal));
    expect(select()).toBeDisabled(); expect(save()).toBeDisabled(); expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve task' })).toBeDisabled();
    await act(async () => pending.resolve({ ...detail, requiredPlatform: 'linux', version: detail.version + 1n }));
    await screen.findByText('Execution platform updated.');
    expect(select()).toHaveValue('linux'); expect(save()).toBeDisabled(); expect(screen.getByRole('switch')).toBeEnabled();
    expect(document.querySelector('.task-detail-badges .task-platform')).toHaveTextContent('Linux');
    expect(screen.queryByRole('region', { name: 'Task approval' })).toBeNull();
  });
  it('clears with Any platform and sends null', async () => {
    await open({ ...detail, requiredPlatform: 'windows' });
    writes.mockResolvedValueOnce({ ...detail, version: detail.version + 1n });
    fireEvent.change(select(), { target: { value: '' } }); fireEvent.click(save());
    expect(writes).toHaveBeenCalledExactlyOnceWith(projectId, taskId, null, detail.version, expect.any(AbortSignal));
    await screen.findByText('Execution platform updated.'); expect(select()).toHaveValue('');
  });
  it('resets a draft when a refreshed version changes the task, then saves only the newly reviewed choice', async () => {
    const { rerender, props } = await open(); fireEvent.change(select(), { target: { value: 'linux' } });
    const changed = { ...detail, requiredPlatform: 'windows' as const, version: detail.version + 1n, updatedAt: '2026-10-24T00:01:00Z' };
    vi.mocked(getTask).mockResolvedValueOnce(changed); rerender(<TaskDetailDialog {...props} snapshot={snapshot(changed, 2)} />);
    await waitFor(() => expect(select()).toHaveValue('windows')); expect(save()).toBeDisabled(); expect(writes).not.toHaveBeenCalled();
    fireEvent.change(select(), { target: { value: 'macos' } }); writes.mockResolvedValueOnce({ ...changed, requiredPlatform: 'macos', version: changed.version + 1n });
    fireEvent.click(save()); expect(writes).toHaveBeenCalledExactlyOnceWith(projectId, taskId, 'macos', changed.version, expect.any(AbortSignal));
    await screen.findByText('Execution platform updated.');
  });
  it('retains attachment state during a save and locks platform writes while automatic execution is pending', async () => {
    await open(); fireEvent.click(screen.getByRole('tab', { name: 'Attachments' }));
    const draft = screen.getByRole('textbox', { name: 'Attachment draft' }); fireEvent.change(draft, { target: { value: 'Preserve attachment draft' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const pending = deferred<TaskDetail>(); vi.mocked(setTaskAgentPermission).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('switch')); fireEvent.click(screen.getByRole('button', { name: 'Enable automatic execution' }));
    expect(select()).toBeDisabled(); expect(save()).toBeDisabled(); expect(writes).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ...detail, allowAgents: true, version: detail.version + 1n }));
    await waitFor(() => expect(select()).toBeEnabled());
    fireEvent.click(screen.getByRole('tab', { name: 'Attachments' })); expect(draft).toHaveValue('Preserve attachment draft');
  });
  it('keeps the old platform and draft after a permission refusal, requiring a fresh explicit save', async () => {
    await open(); writes.mockRejectedValueOnce(new ApiError('server', 403, 'forbidden', 'platform-refusal'));
    fireEvent.change(select(), { target: { value: 'linux' } }); fireEvent.click(save());
    await screen.findByText('platform-refusal'); expect(select()).toHaveValue('linux');
    expect(document.querySelector('.task-detail-badges .task-platform')).toHaveTextContent('Any platform');
    expect(writes).toHaveBeenCalledTimes(1); expect(save()).toBeEnabled();
  });
  it('reconciles a conflict and resets the draft to the current platform without retry', async () => {
    const current = { ...detail, requiredPlatform: 'macos' as const, version: detail.version + 1n };
    await open(); vi.mocked(getTask).mockResolvedValueOnce(current); writes.mockRejectedValueOnce(new ApiError('server', 409, 'version_conflict'));
    fireEvent.change(select(), { target: { value: 'linux' } }); fireEvent.click(save());
    await screen.findByText('The task changed. Review its current platform before saving another change.');
    expect(select()).toHaveValue('macos'); expect(save()).toBeDisabled(); expect(writes).toHaveBeenCalledTimes(1);
  });
  it('blocks every write after an unknown result until the actual task is read', async () => {
    await open(); vi.mocked(getTask).mockRejectedValueOnce(new ApiError('network')); writes.mockRejectedValueOnce(new ApiError('network'));
    fireEvent.change(select(), { target: { value: 'linux' } }); fireEvent.click(save());
    const check = await screen.findByRole('button', { name: 'Check actual task' });
    await waitFor(() => expect(check).toBeEnabled());
    expect(select()).toBeDisabled(); expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve task' })).toBeDisabled();
    vi.mocked(getTask).mockResolvedValueOnce({ ...detail, requiredPlatform: 'linux', version: detail.version + 1n }); fireEvent.click(check);
    await screen.findByText('The actual task has been read. The displayed platform is confirmed.');
    expect(select()).toHaveValue('linux'); expect(select()).toBeEnabled(); expect(writes).toHaveBeenCalledTimes(1);
  });
  it('locks an executing task and renders all Chinese platform labels', async () => {
    await open({ ...detail, status: 'in_progress', requiredPlatform: 'windows' }, 'zh-CN');
    const platform = screen.getByRole('combobox', { name: '执行平台' });
    expect(platform).toBeDisabled(); expect(platform).toHaveValue('windows'); expect(screen.getByRole('button', { name: '保存平台' })).toBeDisabled();
    expect(within(platform).getAllByRole('option').map((option) => option.textContent)).toEqual(['不限平台', 'Windows', 'Linux', 'macOS']);
    expect(screen.getByText('任务已被领取，执行结束或解除领取前无法修改执行平台。')).toBeVisible();
  });
  it('localizes badges and ignores platform feedback for other operation kinds', () => {
    const idle: TaskMutationState = { operation: null, phase: 'idle', error: null, reconciling: false, reconciliationError: null };
    const view = renderWithLocale(<><TaskPlatformBadge requiredPlatform={null} compact /><TaskPlatformFeedback mutation={idle} onReconcile={vi.fn()} /></>, { locale: 'zh-CN' });
    expect(screen.getByText('不限平台')).toHaveClass('task-platform-compact'); expect(document.querySelector('.task-platform-feedback')).toBeNull(); view.unmount();
  });
  it.each([new ApiError('protocol'), new ApiError('server', 409, 'invalid_transition'), new ApiError('server', 404, 'not_found'), new Error('unexpected')])('renders actionable platform failures %#', (error) => {
    const mutation: TaskMutationState = { operation: { action: 'requiredPlatform', requiredPlatform: 'linux', version: detail.version }, phase: 'refused', error, reconciling: false, reconciliationError: null };
    renderWithLocale(<TaskPlatformFeedback mutation={mutation} onReconcile={vi.fn()} />, { locale: 'en' });
    expect(screen.getByRole('alert')).toBeVisible();
  });
});
