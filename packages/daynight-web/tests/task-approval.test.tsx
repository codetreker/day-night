import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, approveTask, getTask, getTaskGraph } from '../src/api/client';
import type { TaskDetail, TaskGraph } from '../src/api/types';
import { App } from '../src/app/App';
import { ProjectPage } from '../src/features/projects/ProjectPage';
import { renderWithLocale } from './helpers/renderWithLocale';
import { installGraphMeasurements } from './graph-measurements';

vi.mock('../src/api/client', async (original) => ({ ...await original<typeof import('../src/api/client')>(),
  getTask: vi.fn(), getTaskGraph: vi.fn(), approveTask: vi.fn(), listAttachments: vi.fn(async () => ({ items: [], nextCursor: null })),
}));
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const project = id(100); const parent = id(1); const child = id(2); const standalone = id(3);
const time = '2026-10-22T00:00:00Z';
const seed = (number: number, dependsOn: readonly string[] = []): TaskDetail => ({ id: id(number), projectId: project,
  version: 9007199254740993n, title: `Task ${number}`, description: `Complete description ${number}`, properties: { pullRequests: [] },
  status: 'proposed', dependsOn, blockedBy: dependsOn, ready: false, createdAt: time, updatedAt: time });
let records: Map<string, TaskDetail>;
const graph = (): TaskGraph => {
  const tasks = [...records.values()].map((task) => {
    const blockedBy = task.dependsOn.filter((dependency) => records.get(dependency)!.status !== 'done');
    return { id: task.id, titlePreview: task.title, titleTruncated: false, status: task.status, dependsOn: task.dependsOn,
      blockedBy, ready: task.status === 'todo' && blockedBy.length === 0, createdAt: time, updatedAt: task.updatedAt };
  });
  return { project: { id: project, name: 'Approval project', repoUrl: 'https://example.com/repo', createdAt: time, updatedAt: time }, tasks,
    summary: { total: tasks.length, proposed: tasks.filter((task) => task.status === 'proposed').length,
      todo: tasks.filter((task) => task.status === 'todo').length, inProgress: tasks.filter((task) => task.status === 'in_progress').length, done: tasks.filter((task) => task.status === 'done').length,
      ready: tasks.filter((task) => task.ready).length, blocked: tasks.filter((task) => task.status === 'todo' && !task.ready).length } };
};
const commit = (taskId = child): TaskDetail => {
  const prior = records.get(taskId)!;
  const result: TaskDetail = { ...prior, status: 'todo', version: prior.version + 1n,
    ready: prior.blockedBy.length === 0, updatedAt: '2026-10-22T00:01:00Z' };
  records.set(taskId, result); return result;
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject };
};
const stat = (label: string) => screen.getByText(label, { selector: '.stat-label' }).parentElement!.querySelector('.stat-number')!;
let root: HTMLDivElement;
beforeEach(() => {
  installGraphMeasurements();
  root = document.createElement('div'); root.id = 'root'; document.body.append(root);
  records = new Map([seed(1), seed(2, [parent]), seed(3)].map((task) => [task.id, task]));
  vi.mocked(getTaskGraph).mockReset().mockImplementation(async () => graph());
  vi.mocked(getTask).mockReset().mockImplementation(async (_project, taskId) => records.get(taskId)!);
  vi.mocked(approveTask).mockReset();
});
afterEach(() => { cleanup(); root.remove(); });
const mount = () => renderWithLocale(<ProjectPage projectId={project} />, { locale: 'en', container: root });
const openChild = async () => {
  const node = await screen.findByRole('button', { name: 'Task 2, Proposed, blocked' });
  fireEvent.click(node);
  const dialog = screen.getByRole('dialog', { name: 'Task details' });
  await within(dialog).findByRole('heading', { name: 'Task 2' });
  return dialog;
};

describe('approval in shared production task details', () => {
  it('owns pending approval across real App project routes and isolates its late result from the current project', async () => {
    const otherProject = id(200); const otherTask = id(4);
    const other = { ...seed(4), projectId: otherProject };
    const otherGraph: TaskGraph = {
      project: { ...graph().project, id: otherProject, name: 'Other project' },
      tasks: [{ id: otherTask, titlePreview: other.title, titleTruncated: false, status: 'proposed',
        dependsOn: [], blockedBy: [], ready: false, createdAt: time, updatedAt: time }],
      summary: { total: 1, proposed: 1, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 },
    };
    vi.mocked(getTaskGraph).mockImplementation(async (projectId) => projectId === project ? graph() : otherGraph);
    vi.mocked(getTask).mockImplementation(async (projectId, taskId) => projectId === project ? records.get(taskId)! : other);
    const mutation = deferred<TaskDetail>(); vi.mocked(approveTask).mockReturnValueOnce(mutation.promise);
    window.history.replaceState(null, '', `/projects/${project}`);
    renderWithLocale(<App />, { locale: 'en', container: root });
    const navigateProject = async (projectId: string, name: string) => {
      act(() => { window.history.pushState(null, '', `/projects/${projectId}`); window.dispatchEvent(new PopStateEvent('popstate')); });
      await screen.findByRole('heading', { name });
    };
    const openStandalone = async (title: string) => {
      fireEvent.click(screen.getByRole('tab', { name: 'Standalone tasks' }));
      fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
      const dialog = screen.getByRole('dialog', { name: 'Task details' });
      await within(dialog).findByRole('heading', { name: title });
      return dialog;
    };
    const close = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close task details' }));
    await screen.findByRole('heading', { name: 'Approval project' });
    let dialog = await openStandalone('Task 3');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve task' }));
    close(dialog);
    await navigateProject(otherProject, 'Other project');
    dialog = await openStandalone('Task 4');
    expect(within(dialog).getByRole('button', { name: 'Approve task' })).toBeEnabled();
    close(dialog);
    await navigateProject(project, 'Approval project');
    dialog = await openStandalone('Task 3');
    expect(within(dialog).getByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(approveTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getTask).mock.calls.filter(([projectId, taskId]) => projectId === project && taskId === standalone)).toHaveLength(1);
    close(dialog);
    await navigateProject(otherProject, 'Other project');
    dialog = await openStandalone('Task 4');
    const otherGraphCalls = vi.mocked(getTaskGraph).mock.calls.filter(([projectId]) => projectId === otherProject).length;
    await act(async () => { mutation.resolve(commit(standalone)); });
    expect(within(dialog).getByRole('heading', { name: 'Task 4' })).toBeVisible();
    expect(within(dialog).getByText('Proposed', { selector: '.task-detail-status' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Approve task' })).toBeEnabled();
    expect(vi.mocked(getTaskGraph).mock.calls.filter(([projectId]) => projectId === otherProject)).toHaveLength(otherGraphCalls);
    close(dialog);
    await navigateProject(project, 'Approval project');
    dialog = await openStandalone('Task 3');
    expect(within(dialog).getByText('To do', { selector: '.task-detail-status' })).toBeVisible();
    expect(within(dialog).getByText('Approval confirmed.')).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Approve task' })).toBeNull();
    expect(approveTask).toHaveBeenCalledExactlyOnceWith(project, standalone, 9007199254740993n, expect.any(AbortSignal));
  });

  it.each(['in_progress', 'done'] as const)('retains approval confirmation when a later detail read reaches %s without claiming it is still todo', async (status) => {
    vi.mocked(approveTask).mockImplementation(async () => commit(standalone));
    mount(); await screen.findByRole('tab', { name: 'Standalone tasks' });
    fireEvent.click(screen.getByRole('tab', { name: 'Standalone tasks' }));
    fireEvent.click(screen.getByRole('button', { name: /Task 3/ }));
    let dialog = screen.getByRole('dialog', { name: 'Task details' });
    await within(dialog).findByRole('heading', { name: 'Task 3' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve task' }));
    await within(dialog).findByText('Approval confirmed.');
    const current = records.get(standalone)!;
    records.set(standalone, { ...current, status, ready: false, version: current.version + 1n, updatedAt: '2026-10-22T00:02:00Z' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close task details' }));
    fireEvent.click(screen.getByRole('button', { name: /Task 3/ }));
    dialog = screen.getByRole('dialog', { name: 'Task details' });
    await within(dialog).findByText(status === 'done' ? 'Done' : 'In progress', { selector: '.task-detail-status' });
    expect(within(dialog).getByText('Approval confirmed.')).toBeVisible();
    expect(within(dialog).getByText('The current task state has been loaded.')).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Approve task' })).toBeNull();
    fireEvent.change(within(dialog).getByRole('combobox', { name: '语言 / Language' }), { target: { value: 'zh-CN' } });
    expect(within(dialog).getByText('批准成功。')).toBeVisible();
    expect(within(dialog).getByText(status === 'done' ? '已完成' : '进行中', { selector: '.task-detail-status' })).toBeVisible();
  });

  it('approves a blocked graph task once across close/reopen and refreshes rows/counts without losing fullscreen or zoom', async () => {
    const mutation = deferred<TaskDetail>(); vi.mocked(approveTask).mockReturnValueOnce(mutation.promise);
    mount(); await screen.findByRole('button', { name: 'Task 2, Proposed, blocked' });
    const canvas = document.querySelector('.task-graph-canvas');
    const viewport = () => document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
    const initial = viewport(); fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(viewport()).not.toBe(initial));
    const transform = viewport();
    fireEvent.click(screen.getByRole('button', { name: 'View fullscreen' }));
    let dialog = await openChild();
    expect(within(dialog).getByRole('region', { name: 'Unfinished prerequisites' })).toHaveTextContent('Task 1');
    const action = within(dialog).getByRole('button', { name: 'Approve task' });
    fireEvent.click(action); fireEvent.click(action);
    expect(action).toBeDisabled();
    expect(within(dialog).getByRole('region', { name: 'Task approval' })).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close task details' }));
    dialog = await openChild();
    expect(within(dialog).getByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(approveTask).toHaveBeenCalledExactlyOnceWith(project, child, 9007199254740993n, expect.any(AbortSignal));
    expect(getTask).toHaveBeenCalledTimes(1);
    await act(async () => { mutation.resolve(commit()); });
    await waitFor(() => expect(stat('Proposed')).toHaveTextContent('2'));
    expect(stat('To do')).toHaveTextContent('1'); expect(stat('Blocked')).toHaveTextContent('1'); expect(stat('Ready')).toHaveTextContent('0');
    expect(within(dialog).queryByRole('button', { name: 'Approve task' })).toBeNull();
    expect(within(dialog).getByText('Approval confirmed.')).toBeVisible();
    expect(within(dialog).getByText('Blocked', { selector: '.task-detail-blocked' })).toBeVisible();
    expect(document.querySelector('.root-status')).toHaveTextContent('To do');
    expect(document.querySelector('.task-graph-canvas')).toBe(canvas); expect(viewport()).toBe(transform);
    expect(screen.getByRole('dialog', { name: 'Task dependency graph fullscreen view', hidden: true })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Task 2, To do, blocked' })).toHaveFocus());
    expect(viewport()).toBe(transform);
  });

  it('retains confirmed todo details and exposes truthful stale feedback if graph refresh fails', async () => {
    vi.mocked(approveTask).mockImplementation(async () => commit());
    vi.mocked(getTaskGraph).mockResolvedValueOnce(graph()).mockRejectedValueOnce(new ApiError('network')).mockImplementation(async () => graph());
    mount(); const dialog = await openChild();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve task' }));
    await within(dialog).findByText('Approval confirmed.');
    await screen.findByRole('heading', { name: 'Refresh failed' });
    expect(within(dialog).getByText(/Approval is confirmed and its result is retained/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Approve task' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Task 2' })).toBeVisible();
    expect(stat('Proposed')).toHaveTextContent('3');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh task graph' }));
    await waitFor(() => expect(stat('Proposed')).toHaveTextContent('2'));
    expect(within(dialog).queryByText(/Approval is confirmed and its result is retained/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Approve task' })).toBeNull();
  });

  it('ignores a graph response started before approval and keeps a later selected task isolated', async () => {
    const obsolete = deferred<TaskGraph>(); const fresh = deferred<TaskGraph>(); const mutation = deferred<TaskDetail>();
    vi.mocked(getTaskGraph).mockResolvedValueOnce(graph()).mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(fresh.promise);
    vi.mocked(approveTask).mockReturnValueOnce(mutation.promise);
    mount(); await screen.findByRole('heading', { name: 'Approval project' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const oldSignal = vi.mocked(getTaskGraph).mock.calls[1]![1]; const oldGraph = graph();
    const dialog = await openChild(); fireEvent.click(within(dialog).getByRole('button', { name: 'Approve task' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close task details' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Standalone tasks' }));
    fireEvent.click(screen.getByRole('button', { name: /Task 3/ }));
    const otherDialog = screen.getByRole('dialog', { name: 'Task details' });
    await within(otherDialog).findByRole('heading', { name: 'Task 3' });
    await act(async () => { mutation.resolve(commit()); });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { obsolete.resolve(oldGraph); });
    expect(within(otherDialog).getByRole('heading', { name: 'Task 3' })).toBeVisible();
    await act(async () => { fresh.resolve(graph()); });
    await within(otherDialog).findByRole('heading', { name: 'Task 3' });
    expect(stat('Proposed')).toHaveTextContent('2');
    expect(within(otherDialog).getByText('Proposed', { selector: '.task-detail-status' })).toBeVisible();
    expect(within(otherDialog).getByRole('button', { name: 'Approve task' })).toBeEnabled();
    expect(approveTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'Standalone tasks', hidden: true })).toHaveAttribute('aria-selected', 'true');
  });
});
