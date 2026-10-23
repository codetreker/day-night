import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveTask, getTask, unapproveTask } from '../src/api/client';
import type { ApprovalAction, Project, TaskDetail, TaskGraph } from '../src/api/types';
import type { GraphSnapshot } from '../src/features/projects/useTaskGraph';
import { TaskDetailDialog, type TaskDetailDialogProps } from '../src/features/task-detail/TaskDetailDialog';
import { buildGraphIndex } from '../src/features/task-graph/model';
import { renderWithLocale } from './helpers/renderWithLocale';

vi.mock('../src/api/client', async (original) => ({ ...await original<typeof import('../src/api/client')>(), getTask: vi.fn(), approveTask: vi.fn(), unapproveTask: vi.fn() }));
vi.mock('../src/features/task-detail/attachments/TaskAttachments', () => ({
  TaskAttachmentsPanel: () => <section aria-label="Attachment materials"><input aria-label="Attachment draft" defaultValue="" /></section>,
}));
vi.mock('../src/features/task-detail/attachments/useAttachments', () => ({ useAttachments: () => ({ select: vi.fn() }) }));
const projectId = '10000000-0000-4000-8000-000000000001';
const taskId = '20000000-0000-4000-8000-000000000001';
const dependencyId = '20000000-0000-4000-8000-000000000002';
const time = '2026-10-22T00:00:00Z';
const project: Project = { id: projectId, name: 'Approval project', repoUrl: 'https://example.com/repo', settings: { version: 1n, executionWarningMinutes: 60 }, createdAt: time, updatedAt: time };
const source = (action: ApprovalAction): TaskDetail => ({ externalDependsOn: [], startedAt: null, completedAt: null, id: taskId, projectId, title: 'Reviewed task', description: 'Reviewed content',
  status: action === 'approve' ? 'proposed' : 'todo', version: 9007199254740993n, properties: { pullRequests: [] },
  dependsOn: [dependencyId], blockedBy: [dependencyId], ready: false, createdAt: time, updatedAt: time });
const result = (detail: TaskDetail, action: ApprovalAction): TaskDetail => ({ ...detail, status: action === 'approve' ? 'todo' : 'proposed', version: detail.version + 1n, updatedAt: '2026-10-22T00:01:00Z' });
const snapshot = (detail: TaskDetail, revision = 1): GraphSnapshot => {
  const tasks = [detail, { ...detail, id: dependencyId, title: 'Prerequisite', dependsOn: [], blockedBy: [], status: 'proposed' as const }];
  const graph: TaskGraph = { observedAt: time, project, tasks: tasks.map(({ version: _version, projectId: _project, title, description: _description, properties: _properties, ...task }) => ({ ...task, titlePreview: title, titleTruncated: false })),
    summary: { total: 2, proposed: tasks.filter((task) => task.status === 'proposed').length, todo: tasks.filter((task) => task.status === 'todo').length, inProgress: 0, done: 0, ready: 0, blocked: tasks.filter((task) => task.status === 'todo').length } };
  return { observedAt: time, graph, index: buildGraphIndex(graph), receivedMonotonic: performance.now(), receivedAt: 1, revision };
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const names = { approve: { action: 'Approve task', confirm: 'Confirm approval' }, unapprove: { action: 'Unapprove task', confirm: 'Confirm withdrawal' } };
let root: HTMLDivElement;
beforeEach(() => { root = document.createElement('div'); root.id = 'root'; document.body.append(root); vi.mocked(getTask).mockReset(); vi.mocked(approveTask).mockReset(); vi.mocked(unapproveTask).mockReset(); });
afterEach(() => { cleanup(); root.remove(); });
const open = async (detail: TaskDetail) => {
  vi.mocked(getTask).mockResolvedValue(detail);
  const props: TaskDetailDialogProps = { projectId, taskId, snapshot: snapshot(detail), onClose: vi.fn(), onRestoreFocus: vi.fn(), onRefreshGraph: vi.fn(), onSelectTask: vi.fn() };
  const view = renderWithLocale(<TaskDetailDialog {...props} />, { locale: 'en', container: root });
  await screen.findByRole('heading', { name: detail.title });
  return { ...view, props, dialog: screen.getByRole('dialog', { name: 'Task details' }) };
};

describe.each(['approve', 'unapprove'] as const)('%s task confirmation', (action) => {
  it('opens from the task title on either tab and cancels without submitting or replacing the attachment draft', async () => {
    const { dialog, props } = await open(source(action));
    const opener = within(dialog).getByRole('button', { name: names[action].action });
    expect(opener.closest('.task-detail-title-row')).toContainElement(within(dialog).getByRole('heading', { name: 'Reviewed task' }));
    expect(dialog.querySelector('.task-detail-panel-overview .task-detail-title-action')).toBeNull();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Attachments' }));
    const draft = within(dialog).getByRole('textbox', { name: 'Attachment draft' });
    fireEvent.change(draft, { target: { value: 'Retained review notes' } });
    opener.focus(); fireEvent.click(opener);
    let confirmation = screen.getByRole('alertdialog', { name: names[action].action });
    expect(dialog).toHaveAttribute('inert');
    expect(within(confirmation).getByText('Reviewed task')).toBeVisible();
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(approveTask).not.toHaveBeenCalled(); expect(unapproveTask).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(opener).toHaveFocus(); expect(dialog).not.toHaveAttribute('inert');
    expect(draft).toHaveValue('Retained review notes');
    fireEvent.click(opener); confirmation = screen.getByRole('alertdialog', { name: names[action].action });
    const user = userEvent.setup();
    await user.tab({ shift: true });
    expect(confirmation.querySelector('.dialog-body')).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(confirmation).getByRole('button', { name: 'Close confirmation' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(confirmation).getByRole('button', { name: names[action].confirm })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(opener).toHaveFocus(); expect(props.onClose).not.toHaveBeenCalled();
    expect(draft).toHaveValue('Retained review notes'); expect(approveTask).not.toHaveBeenCalled(); expect(unapproveTask).not.toHaveBeenCalled();
  });

  it('submits only the confirmed exact version and retains one pending operation across repeated confirmation', async () => {
    const detail = source(action); const mutation = deferred<TaskDetail>();
    const mutate = vi.mocked(action === 'approve' ? approveTask : unapproveTask); mutate.mockReturnValueOnce(mutation.promise);
    const { dialog } = await open(detail);
    const opener = within(dialog).getByRole('button', { name: names[action].action }); opener.focus(); fireEvent.click(opener);
    const confirmation = screen.getByRole('alertdialog', { name: names[action].action });
    expect(within(confirmation).getByText(action === 'approve' ? 'Approval moves this task to To do. Unfinished prerequisites will continue to block it.' : 'Unapproving returns this task to Proposed, so it cannot be claimed until it is approved again. Task content, dependencies and attachments are retained.')).toBeVisible();
    const confirm = within(confirmation).getByRole('button', { name: names[action].confirm });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mutate).toHaveBeenCalledExactlyOnceWith(projectId, taskId, detail.version, expect.any(AbortSignal));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(within(dialog).getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(within(dialog).getByRole('heading', { name: detail.title })).toHaveFocus();
    await act(async () => { mutation.resolve(result(detail, action)); });
    await within(dialog).findByText(action === 'approve' ? 'Approval confirmed.' : 'Approval withdrawn. The task is proposed again.');
    expect(within(dialog).getByRole('button', { name: names[action === 'approve' ? 'unapprove' : 'approve'].action })).toBeEnabled();
    expect(within(dialog).queryByText('Ready', { selector: '.task-detail-ready' })).toBeNull();
  });

  it('invalidates an open confirmation when a current read changes the reviewed task', async () => {
    const detail = source(action); const fresh = { ...detail, title: 'Revised task', version: detail.version + 1n, updatedAt: '2026-10-22T00:00:30Z' };
    const { dialog, props, rerender } = await open(detail);
    fireEvent.click(within(dialog).getByRole('button', { name: names[action].action }));
    const oldConfirm = within(screen.getByRole('alertdialog')).getByRole('button', { name: names[action].confirm });
    vi.mocked(getTask).mockResolvedValueOnce(fresh);
    rerender(<TaskDetailDialog {...props} snapshot={snapshot(fresh, 2)} />);
    await within(dialog).findByRole('heading', { name: 'Revised task' });
    expect(screen.queryByRole('alertdialog')).toBeNull(); fireEvent.click(oldConfirm);
    expect(approveTask).not.toHaveBeenCalled(); expect(unapproveTask).not.toHaveBeenCalled();
    const mutate = vi.mocked(action === 'approve' ? approveTask : unapproveTask); mutate.mockResolvedValueOnce(result(fresh, action));
    fireEvent.click(within(dialog).getByRole('button', { name: names[action].action }));
    const current = screen.getByRole('alertdialog', { name: names[action].action });
    expect(within(current).getByText('Revised task')).toBeVisible(); fireEvent.click(within(current).getByRole('button', { name: names[action].confirm }));
    await waitFor(() => expect(mutate).toHaveBeenCalledExactlyOnceWith(projectId, taskId, fresh.version, expect.any(AbortSignal)));
  });
});
