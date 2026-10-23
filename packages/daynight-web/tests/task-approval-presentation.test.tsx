import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import type { TaskDetail } from '../src/api/types';
import { TaskApproval } from '../src/features/task-detail/TaskApproval';
import type { ApprovalState } from '../src/features/task-detail/TaskDetailSession';
import { LanguageSelector } from '../src/i18n/LanguageSelector';
import { renderWithLocale } from './helpers/renderWithLocale';
const detail: TaskDetail = { externalDependsOn: [], startedAt: null, completedAt: null, id: 'task', projectId: 'project', version: 1n, title: 'Task content', description: '',
  properties: { pullRequests: [] }, status: 'proposed', dependsOn: [], blockedBy: [], ready: false, createdAt: '', updatedAt: '' };
const idle: ApprovalState = { operation: null, phase: 'idle', error: null, reconciling: false, reconciliationError: null };
const mount = (approval = idle, task = detail) => {
  const onReconcile = vi.fn();
  const view = renderWithLocale(<><LanguageSelector /><TaskApproval detail={task} approval={approval} onReconcile={onReconcile} /></>, { locale: 'en' });
  return { ...view, onReconcile };
};

describe('task approval feedback', () => {
  it.each(['proposed', 'todo', 'in_progress', 'done'] as const)('keeps an ordinary %s overview free of duplicate title actions', (status) => {
    mount(idle, { ...detail, status });
    expect(screen.queryByRole('region', { name: 'Task approval' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve|Unapprove/ })).toBeNull();
  });
  it('announces pending state while retaining reviewed content without another mutation entry', () => {
    mount({ ...idle, operation: { action: 'approve', version: 1n }, phase: 'pending' });
    const section = screen.getByRole('region', { name: 'Task approval' });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).getByRole('status')).toHaveTextContent('Submitting the approval operation.');
    expect(within(section).queryByRole('button')).toBeNull();
  });
  it.each(['approve', 'unapprove'] as const)('describes the confirmed %s operation in both languages', (action) => {
    mount({ ...idle, phase: 'confirmed', operation: { action, version: 1n } }, { ...detail, status: action === 'approve' ? 'todo' : 'proposed' });
    expect(screen.getByRole('status')).toHaveTextContent(action === 'approve' ? 'Approval confirmed.' : 'Approval withdrawn. The task is proposed again.');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-CN' } });
    expect(screen.getByRole('status')).toHaveTextContent(action === 'approve' ? '批准成功。' : '已撤回审批，任务回到待审批状态。');
  });
  it('keeps mutation and reconciliation failures visible and offers only explicit state checking while unknown', () => {
    const writeError = new ApiError('protocol', 200, 'protocol', 'write-request');
    const readError = new ApiError('network', null, 'network', 'read-request');
    const { onReconcile } = mount({ ...idle, phase: 'unknown', operation: { action: 'unapprove', version: 1n }, error: writeError, reconciliationError: readError });
    expect(screen.getByText('write-request')).toBeVisible(); expect(screen.getByText('read-request')).toBeVisible();
    expect(screen.getByText(/The approval operation outcome is unknown/)).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('button', { name: 'Approve task' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check task state' }));
    expect(onReconcile).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-CN' } });
    expect(screen.getByRole('button', { name: '检查任务状态' })).toBeEnabled();
  });
  it.each([
    [new ApiError('server', 409, 'version_conflict', 'version-request'), 'The task version changed before this approval operation could be applied.'],
    [new ApiError('server', 409, 'invalid_transition', 'transition-request'), 'Only proposed tasks can be approved, and only to-do tasks can have approval withdrawn.'],
    [new ApiError('server', 404, 'not_found', 'notfound-request'), 'The task or project is no longer available.'],
    [new ApiError('server', 400, 'validation_failed', 'validation-request'), 'The service refused the approval operation.'],
    [new Error('transport failure'), 'The approval operation failed.'],
  ])('shows refusal with accessible error feedback %#', (error, text) => {
    mount({ ...idle, phase: 'refused', error });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
  it.each(['in_progress', 'done'] as const)('reports a reconciled %s task without falsely claiming unfinished prerequisites', (status) => {
    mount({ ...idle, phase: 'reconciled', error: new ApiError('network') }, { ...detail, status });
    expect(screen.getByText('The current task state has been loaded.')).toBeVisible();
    expect(screen.queryByText('The task is approved. Unfinished prerequisites still block it.')).toBeNull();
  });
});
