import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import type { TaskDetail } from '../src/api/types';
import { TaskApproval } from '../src/features/task-detail/TaskApproval';
import type { ApprovalState } from '../src/features/task-detail/TaskDetailSession';
import { LanguageSelector } from '../src/i18n/LanguageSelector';
import { renderWithLocale } from './helpers/renderWithLocale';
const detail: TaskDetail = { startedAt: null, completedAt: null, id: 'task', projectId: 'project', version: 1n, title: 'Task content', description: '',
  properties: { pullRequests: [] }, status: 'proposed', dependsOn: [], blockedBy: [], ready: false, createdAt: '', updatedAt: '' };
const idle: ApprovalState = { phase: 'idle', error: null, reconciling: false, reconciliationError: null };
const mount = (approval = idle, task = detail, enabled = true) => {
  const onApprove = vi.fn(); const onReconcile = vi.fn();
  const view = renderWithLocale(<><LanguageSelector /><TaskApproval detail={task} approval={approval} canApprove={enabled} onApprove={onApprove} onReconcile={onReconcile} /></>, { locale: 'en' });
  return { ...view, onApprove, onReconcile };
};

describe('task approval presentation', () => {
  it.each(['todo', 'in_progress', 'done'] as const)('offers no approval on an ordinary %s detail', (status) => {
    mount(idle, { ...detail, status }, false);
    expect(screen.queryByRole('region', { name: 'Task approval' })).toBeNull();
  });
  it('requires an explicit action and explains unfinished prerequisites in both languages', () => {
    const { onApprove } = mount();
    expect(screen.getByText('Approval moves this task to To do. Unfinished prerequisites will continue to block it.')).toBeVisible();
    expect(onApprove).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-CN' } });
    expect(screen.getByText('批准后进入待处理；前置未完成时，任务仍会被阻塞。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '批准任务' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
  it('announces pending state and disables activation while retaining the reviewed content', () => {
    const { onApprove } = mount({ ...idle, phase: 'pending' }, detail, false);
    const section = screen.getByRole('region', { name: 'Task approval' });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).getByRole('status')).toHaveTextContent('Submitting approval.');
    fireEvent.click(screen.getByRole('button', { name: 'Approving…' }));
    expect(onApprove).not.toHaveBeenCalled();
  });
  it('keeps mutation and reconciliation failures visible and offers only explicit state checking while unknown', () => {
    const writeError = new ApiError('protocol', 200, 'protocol', 'write-request');
    const readError = new ApiError('network', null, 'network', 'read-request');
    const { onApprove, onReconcile } = mount({ ...idle, phase: 'unknown', error: writeError, reconciliationError: readError }, detail, false);
    expect(screen.getByText('write-request')).toBeVisible(); expect(screen.getByText('read-request')).toBeVisible();
    expect(screen.getByText(/The approval outcome is unknown/)).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Approve task' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check task state' }));
    expect(onReconcile).toHaveBeenCalledTimes(1); expect(onApprove).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-CN' } });
    expect(screen.getByRole('button', { name: '检查任务状态' })).toBeEnabled();
    expect(screen.getByText('write-request')).toBeVisible(); expect(screen.getByText('read-request')).toBeVisible();
  });
  it.each([
    [new ApiError('server', 409, 'version_conflict', 'version-request'), 'The task version changed before this approval could be applied.'],
    [new ApiError('server', 409, 'invalid_transition', 'transition-request'), 'Only a proposed task can be approved.'],
    [new ApiError('server', 404, 'not_found', 'notfound-request'), 'The task or project is no longer available.'],
    [new ApiError('server', 400, 'validation_failed', 'validation-request'), 'The service refused the approval request.'],
    [new Error('transport failure'), 'The approval request failed.'],
  ])('shows the approval refusal with accessible error feedback %#', (error, text) => {
    mount({ ...idle, phase: 'refused', error });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Approve task' })).toBeEnabled();
  });
  it.each(['in_progress', 'done'] as const)('reports a reconciled %s task without falsely claiming unfinished prerequisites', (status) => {
    mount({ ...idle, phase: 'reconciled', error: new ApiError('network') }, { ...detail, status }, false);
    expect(screen.queryByRole('button', { name: 'Approve task' })).toBeNull();
    expect(screen.getByText('The current task state has been loaded.')).toBeVisible();
    expect(screen.queryByText('The task is approved. Unfinished prerequisites still block it.')).toBeNull();
  });
});
