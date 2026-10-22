import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createLocaleRender } from './helpers/renderWithLocale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';

const render = createLocaleRender('zh-CN');

const projectId = '00000000-0000-4000-8000-000000000001';
const projectPage = () => new Response(JSON.stringify({ items: [{
  id: projectId, name: '真实项目', repoUrl: 'https://github.com/example/repo',
  createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T09:00:00Z',
}], nextCursor: null }), { headers: { 'Content-Type': 'application/json' } });

const taskGraph = () => new Response(JSON.stringify({
  project: { id: projectId, name: '项目任务页面', repoUrl: 'https://github.com/example/repo',
    createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T09:00:00Z' },
  tasks: [], summary: { total: 0, proposed: 0, todo: 0, inProgress: 0, done: 0, ready: 0, blocked: 0 },
}), { headers: { 'Content-Type': 'application/json' } });

describe('application navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.endsWith('/task-graph') ? taskGraph() : projectPage()));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('navigates via real card hrefs, focuses the main content, and restores the list through browser back and forward', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: '真实项目' });
    expect(document.title).toBe('项目 · Daynight');
    expect(screen.getByRole('link', { name: '项目' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('heading', { name: '真实项目' }).closest('a')!);
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
    await screen.findByRole('heading', { name: '项目任务页面' });
    expect(document.title).toBe('项目任务 · Daynight');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(screen.queryByRole('heading', { name: '真实项目' })).toBeNull();
    await act(async () => { window.history.back(); });
    await screen.findByRole('heading', { name: '真实项目' });
    expect(window.location.pathname).toBe('/');
    await act(async () => { window.history.forward(); });
    await screen.findByRole('heading', { name: '项目任务页面' });
    expect(window.location.pathname).toBe(`/projects/${projectId}`);
  });

  it.each(['/unknown', '/projects/not-a-uuid'])('returns from an unregistered route %s through the visible list link', async (path) => {
    window.history.replaceState(null, '', path);
    render(<App />);
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: '返回项目列表' }));
    await screen.findByRole('heading', { name: '真实项目' });
    expect(window.location.pathname).toBe('/');
  });

  it('loads a valid project deep link through the graph API', async () => {
    window.history.replaceState(null, '', `/projects/${projectId}`);
    render(<App />);
    await screen.findByRole('heading', { name: '项目任务页面' });
    expect(fetch).toHaveBeenCalledWith(`/api/v1/projects/${projectId}/task-graph`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('heading', { name: '还没有任务' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '项目' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('link', { name: '← 项目' }));
    await screen.findByRole('heading', { name: '真实项目' });
  });

  it('uses the sidebar and breadcrumb as keyboard-accessible navigation controls', async () => {
    window.history.replaceState(null, '', '/unknown');
    render(<App />);
    const sidebar = screen.getByRole('link', { name: '项目' });
    sidebar.focus();
    expect(document.activeElement).toBe(sidebar);
    fireEvent.click(sidebar);
    await screen.findByRole('heading', { name: '真实项目' });
    window.history.pushState(null, '', '/another');
    fireEvent.popState(window);
    fireEvent.click(screen.getByRole('link', { name: '工作空间' }));
    await screen.findByRole('heading', { name: '真实项目' });
    expect(screen.getByRole('link', { name: '跳到主要内容' }).getAttribute('href')).toBe('#main-content');
  });

  it('cancels list requests when navigation unmounts the list and ignores late data', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const signal = fetchMock.mock.calls[0]?.[1].signal as AbortSignal;
    window.history.pushState(null, '', '/unknown');
    fireEvent.popState(window);
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(projectPage()); });
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '真实项目' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserves modified clicks on global navigation links', async () => {
    window.history.replaceState(null, '', '/unknown');
    render(<App />);
    const brand = screen.getByRole('link', { name: 'Daynight 项目首页' });
    let intercepted = true;
    const preventNavigation = (event: Event) => { intercepted = event.defaultPrevented; event.preventDefault(); };
    document.addEventListener('click', preventNavigation);
    fireEvent.click(brand, { metaKey: true });
    document.removeEventListener('click', preventNavigation);
    expect(intercepted).toBe(false);
    await waitFor(() => { expect(window.location.pathname).toBe('/unknown'); });
  });
});
