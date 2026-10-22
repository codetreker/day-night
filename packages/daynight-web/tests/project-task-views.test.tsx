import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTask, getTaskGraph } from '../src/api/client';
import type { GraphTask, TaskGraph } from '../src/api/types';
import { ProjectPage } from '../src/features/projects/ProjectPage';
import type { GraphIndex } from '../src/features/task-graph/model';

vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(), getTask: vi.fn(), getTaskGraph: vi.fn(),
  listAttachments: vi.fn(async () => ({ items: [], nextCursor: null })),
}));
vi.mock('../src/features/task-graph/TaskGraph', () => ({ TaskGraph: ({ index, rootId, onOpenTask }: {
  index: GraphIndex; rootId: string; onOpenTask: (id: string, trigger: HTMLElement) => void;
}) => <button data-testid="graph-node" onClick={(event) => { onOpenTask(rootId, event.currentTarget); }}>图节点 {index.nodes.get(rootId)!.titlePreview}</button> }));

const project = 'project-one';
const otherProject = 'project-two';
const timestamp = '2026-10-20T12:00:00.123456Z';
const seed = (id: string, status: GraphTask['status'] = 'todo', dependsOn: string[] = []): GraphTask => ({
  id, titlePreview: `任务 ${id}`, titleTruncated: false, status, dependsOn, blockedBy: [], ready: false,
  createdAt: timestamp, updatedAt: timestamp,
});
const seeds = [seed('A', 'done'), seed('B', 'todo', ['A']), seed('C'), seed('D', 'done'), seed('E', 'in_progress')];
const snapshot = (items = seeds, id = project): TaskGraph => {
  const tasks = items.map((item) => {
    const blockedBy = item.dependsOn.filter((dependency) => items.find((candidate) => candidate.id === dependency)!.status !== 'done');
    return { ...item, blockedBy, ready: item.status === 'todo' && blockedBy.length === 0 };
  });
  return { project: { id, name: id, repoUrl: '', createdAt: timestamp, updatedAt: timestamp }, tasks,
    summary: { total: tasks.length, todo: tasks.filter((item) => item.status === 'todo').length,
      done: tasks.filter((item) => item.status === 'done').length, inProgress: tasks.filter((item) => item.status === 'in_progress').length,
      ready: tasks.filter((item) => item.ready).length, blocked: tasks.filter((item) => item.status === 'todo' && !item.ready).length } };
};
const graphRequest = vi.mocked(getTaskGraph);
const tab = (view: 'chains' | 'standalone') => screen.getByRole('tab', { name: view === 'chains' ? '任务链' : '独立任务' });
const row = (id: string) => document.getElementById(`standalone-task-${id}`)!;
const key = (kind: string, id = project) => `daynight:${kind}:${id}`;
let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement('div'); root.id = 'root'; document.body.append(root);
  graphRequest.mockReset(); graphRequest.mockImplementation(async (id) => snapshot(seeds, id));
  vi.mocked(getTask).mockReset();
  vi.mocked(getTask).mockImplementation(async (projectId, id) => ({
    id, projectId, title: `详情 ${id}`, description: '', properties: { pullRequests: [] }, status: 'todo', dependsOn: [], blockedBy: [], ready: true,
    createdAt: timestamp, updatedAt: timestamp,
  }));
});
afterEach(() => { cleanup(); root.remove(); });
const mount = () => {
  if (!root.isConnected) document.body.append(root);
  return render(<ProjectPage projectId={project} />, { container: root });
};

const openStandalone = async (id: string) => {
  fireEvent.click(tab('standalone'));
  const trigger = row(id); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '任务详情' });
  await within(dialog).findByRole('heading', { name: `详情 ${id}` });
  return { trigger, dialog };
};

describe('project task views', () => {
  it('classifies complete dependencies independently from status and keeps summary and API order intact', async () => {
    const complete = snapshot(); graphRequest.mockResolvedValue(complete);
    mount(); await screen.findByRole('tab', { name: '任务链' });
    expect(tab('chains')).toHaveAttribute('aria-selected', 'true');
    expect(tab('chains')).toHaveTextContent('任务链1'); expect(tab('standalone')).toHaveTextContent('独立任务3');
    expect(document.querySelectorAll('.root-toggle')).toHaveLength(1);
    expect(document.getElementById('task-root-A')).toBeVisible();
    expect(screen.getByLabelText('显示 1 条，共 1 条任务链')).toHaveTextContent('1 / 1');
    fireEvent.click(tab('standalone'));
    expect([...document.querySelectorAll('.standalone-row')].map((item) => item.id)).toEqual(['standalone-task-E', 'standalone-task-C']);
    expect(screen.queryByTestId('graph-node')).toBeNull();
    expect(row('C')).toHaveTextContent('可开始'); expect(row('E')).toHaveTextContent('进行中');
    expect(document.getElementById('standalone-task-B')).toBeNull();
    expect(screen.getByRole('checkbox', { name: '显示已完成独立任务（1）' })).not.toBeChecked();
    expect(within(screen.getByRole('region', { name: '项目任务统计' })).getByText('5')).toBeVisible();
    expect(complete.tasks.map(({ id }) => id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it('opens the real drawer directly and returns focus to its standalone row', async () => {
    mount(); await screen.findByRole('tab', { name: '独立任务' });
    const { trigger, dialog } = await openStandalone('C');
    expect(screen.queryByTestId('graph-node')).toBeNull();
    expect(root).toHaveAttribute('inert');
    expect(within(dialog).getByRole('button', { name: '关闭任务详情' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(root).not.toHaveAttribute('inert');
  });

  it('uses roving tab focus with wrapping arrows, Home and End without requesting another snapshot', async () => {
    mount(); await screen.findByRole('tab', { name: '任务链' }); tab('chains').focus();
    fireEvent.keyDown(tab('chains'), { key: 'ArrowRight' });
    expect(tab('standalone')).toHaveFocus(); expect(tab('standalone')).toHaveAttribute('tabindex', '0');
    expect(tab('chains')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: '独立任务' })).toBeVisible();
    fireEvent.keyDown(tab('standalone'), { key: 'ArrowLeft' }); expect(tab('chains')).toHaveFocus();
    fireEvent.keyDown(tab('chains'), { key: 'Home' }); expect(tab('standalone')).toHaveFocus();
    fireEvent.keyDown(tab('standalone'), { key: 'End' }); expect(tab('chains')).toHaveFocus();
    fireEvent.keyDown(tab('chains'), { key: 'ArrowDown' }); expect(tab('chains')).toHaveFocus();
    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it('remembers each filter, selected view and explicit chain collapse across remounts and project navigation', async () => {
    let view = mount(); await screen.findByRole('tab', { name: '任务链' });
    fireEvent.click(document.getElementById('task-root-A')!);
    fireEvent.click(screen.getByRole('checkbox', { name: /^显示已完成任务链/ }));
    fireEvent.click(tab('standalone')); fireEvent.click(screen.getByRole('checkbox', { name: /^显示已完成独立任务/ }));
    expect(row('D')).toBeVisible();
    cleanup(); view = mount(); await screen.findByRole('tab', { name: '独立任务' });
    expect(tab('standalone')).toHaveAttribute('aria-selected', 'true'); expect(row('D')).toBeVisible();
    fireEvent.click(tab('chains')); expect(screen.queryByTestId('graph-node')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /^显示已完成任务链/ })).toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(key('project-view'))!)).toEqual({ expandedRootId: null });
    expect(window.localStorage.getItem(key('completed-chains'))).toBe('true');
    view.rerender(<ProjectPage projectId={otherProject} />); await screen.findByRole('heading', { name: otherProject });
    expect(tab('chains')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tab('standalone')); expect(screen.getByRole('checkbox', { name: /^显示已完成独立任务/ })).not.toBeChecked();
    view.rerender(<ProjectPage projectId={project} />); await screen.findByRole('heading', { name: project });
    expect(tab('chains')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tab('standalone')); expect(screen.getByRole('checkbox', { name: /^显示已完成独立任务/ })).toBeChecked();
  });

  it('saves separate scroll positions, restores on switching and reload, and isolates another project', async () => {
    let scroll = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll);
    vi.mocked(window.scrollTo).mockImplementation((options) => { scroll = (options as ScrollToOptions).top!; });
    let view = mount(); await screen.findByRole('tab', { name: '任务链' });
    scroll = 320; fireEvent.scroll(window); fireEvent.click(tab('standalone'));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    scroll = 540; fireEvent.scroll(window); fireEvent.click(tab('chains'));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'instant' });
    fireEvent.click(tab('standalone')); expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 540, behavior: 'instant' });
    expect(JSON.parse(window.localStorage.getItem(key('task-view-scroll'))!)).toEqual({ chains: 320, standalone: 540 });
    cleanup(); view = mount(); await screen.findByRole('tab', { name: '独立任务' });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 540, behavior: 'instant' });
    view.rerender(<ProjectPage projectId={otherProject} />); await screen.findByRole('heading', { name: otherProject });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
  });

  it('distinguishes absent categories, hidden completed rows and an entirely empty project', async () => {
    graphRequest.mockResolvedValueOnce(snapshot([seed('D', 'done')])).mockResolvedValueOnce(snapshot([]));
    mount(); await screen.findByRole('heading', { name: '暂无任务链' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(tab('standalone')); expect(screen.getByRole('heading', { name: '所有独立任务已完成' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '显示已完成独立任务' }));
    expect(screen.getByRole('checkbox')).toHaveFocus(); expect(row('D')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '刷新' })); await screen.findByRole('heading', { name: '还没有任务' });
    expect(screen.queryByRole('tab')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps details when refresh adds an edge and returns focus to the active category tab when its row vanishes', async () => {
    graphRequest.mockResolvedValueOnce(snapshot([seed('C')])).mockResolvedValueOnce(snapshot([seed('C'), seed('child', 'todo', ['C'])]));
    mount(); await screen.findByRole('tab', { name: '独立任务' }); const { trigger, dialog } = await openStandalone('C');
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新任务图' }));
    await screen.findByRole('heading', { name: '暂无独立任务' });
    expect(trigger.isConnected).toBe(false); expect(dialog).toBeVisible();
    await waitFor(() => expect(getTask).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(tab('standalone')).toHaveFocus());
    fireEvent.click(tab('chains')); expect(document.getElementById('task-root-C')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps details while refresh removes an edge and falls back to the still-active chain tab', async () => {
    graphRequest.mockResolvedValueOnce(snapshot([seed('A'), seed('B', 'todo', ['A'])])).mockResolvedValueOnce(snapshot([seed('A'), seed('B')]));
    mount(); fireEvent.click(await screen.findByTestId('graph-node'));
    const dialog = await screen.findByRole('dialog', { name: '任务详情' }); await within(dialog).findByRole('heading', { name: '详情 A' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新任务图' }));
    await screen.findByRole('heading', { name: '暂无任务链' }); expect(dialog).toBeVisible();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); await waitFor(() => expect(tab('chains')).toHaveFocus());
    fireEvent.click(tab('standalone')); expect(row('A')).toBeVisible(); expect(row('B')).toBeVisible();
  });
});

const newPreferences = [
  ['task-view', '"invalid"', /^浏览器保存的任务页签无效/],
  ['completed-standalone-tasks', '{}', /^浏览器保存的已完成独立任务显示偏好无效/],
  ['task-view-scroll', '{"chains":-1,"standalone":0}', /^浏览器保存的任务浏览位置无效/],
] as const;

describe('task view storage failures', () => {
  it.each(newPreferences)('rejects invalid %s data while preserving usable defaults', async (kind, value, notice) => {
    window.localStorage.setItem(key(kind), value); mount(); await screen.findByRole('tab', { name: '任务链' });
    expect(screen.getByText(notice)).toBeVisible(); expect(tab('chains')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tab('standalone')); expect(row('C')).toBeVisible();
  });

  it('reports each unreadable preference independently and keeps all controls usable', async () => {
    const read = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
      if (newPreferences.some(([kind]) => name === key(kind))) throw new DOMException('Denied', 'SecurityError');
      return read.call(this, name);
    });
    mount(); await screen.findByRole('tab', { name: '任务链' });
    expect(screen.getByText(/^无法读取浏览器保存的任务页签/)).toBeVisible();
    expect(screen.getByText(/^无法读取浏览器保存的已完成独立任务显示偏好/)).toBeVisible();
    expect(screen.getByText(/^无法读取浏览器保存的任务浏览位置/)).toBeVisible();
    fireEvent.click(tab('standalone')); fireEvent.click(screen.getByRole('checkbox'));
    expect(row('D')).toBeVisible();
  });

  it('applies choices after failed writes and clears each write notice when persistence recovers', async () => {
    let scroll = 0; vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll);
    const write = Storage.prototype.setItem;
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
      if (newPreferences.some(([kind]) => name === key(kind))) throw new DOMException('Full', 'QuotaExceededError');
      write.call(this, name, value);
    });
    mount(); await screen.findByRole('tab', { name: '任务链' });
    scroll = 100; fireEvent.scroll(window); fireEvent.click(tab('standalone')); fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/^任务页签无法保存到浏览器/)).toBeVisible();
    expect(screen.getByText(/^任务浏览位置无法保存到浏览器/)).toBeVisible();
    expect(screen.getByText(/^已完成独立任务显示偏好无法保存到浏览器/)).toBeVisible(); expect(row('D')).toBeVisible();
    fail.mockRestore(); scroll = 200; fireEvent.scroll(window); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(tab('chains'));
    expect(screen.queryByText(/^任务页签无法保存到浏览器/)).toBeNull();
    expect(screen.queryByText(/^任务浏览位置无法保存到浏览器/)).toBeNull();
    expect(screen.queryByText(/^已完成独立任务显示偏好无法保存到浏览器/)).toBeNull();
  });
});
