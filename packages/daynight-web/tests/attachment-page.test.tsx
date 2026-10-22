import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import type { Attachment, AttachmentPage as Page } from '../src/api/types';
import { AttachmentPage } from '../src/features/task-detail/attachments/AttachmentPage';
import type { AttachmentApi } from '../src/features/task-detail/attachments/useAttachments';
import { createLocaleRender } from './helpers/renderWithLocale';

const render = createLocaleRender('zh-CN');
const projectId = '00000000-0000-4000-8000-000000000100';
const taskId = '00000000-0000-4000-8000-000000000001';
const timestamp = '2026-10-21T00:00:00Z';
const file = (path: string, contentType = 'text/plain'): Attachment => ({ path, contentType, sizeBytes: 12, createdAt: timestamp, updatedAt: timestamp });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const fixture = (items: readonly Attachment[]): AttachmentApi => ({
  list: vi.fn(async () => ({ items, nextCursor: null })),
  readText: vi.fn(async (_project, _task, path) => `Contents of ${path}`),
  checkPreview: vi.fn(async () => {}),
  put: vi.fn(), remove: vi.fn(),
});
const page = (api: AttachmentApi, path = 'docs/readme.md', id = taskId) => <AttachmentPage projectId={projectId} taskId={id} path={path} api={api} />;

describe('standalone attachment reader', () => {
  it('loads all inventory pages before rendering authoritative metadata and shared Markdown', async () => {
    const next = deferred<Page>();
    const item = file('docs/readme.md', 'text/markdown');
    const api = fixture([item]);
    vi.mocked(api.list).mockResolvedValueOnce({ items: [item], nextCursor: 'next' }).mockReturnValueOnce(next.promise);
    vi.mocked(api.readText).mockResolvedValue('# Full document\n\n| File | State |\n| --- | --- |\n| UI | Ready |\n\n![Figure](../images/a%20b.svg)\n\n<script>unsafe()</script>');
    render(page(api));
    expect(screen.getByRole('main')).toHaveFocus();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载附件');
    expect(api.readText).not.toHaveBeenCalled();
    expect(screen.queryByText('找不到此附件，文件可能已被删除。')).toBeNull();
    await act(async () => next.resolve({ items: [], nextCursor: null }));
    await screen.findByRole('heading', { name: 'Full document' });
    expect(screen.getByRole('table')).toHaveTextContent('UIReady');
    expect(screen.getByRole('img', { name: 'Figure' })).toHaveAttribute('src', `/api/v1/projects/${projectId}/tasks/${taskId}/preview/images/a%20b.svg`);
    expect(screen.getByText('<script>unsafe()</script>')).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('heading', { name: item.path })).toHaveAttribute('title', item.path);
    expect(screen.getByRole('link', { name: '返回任务所在项目' })).toHaveAttribute('href', `/projects/${projectId}`);
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('download');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('distinguishes missing files from a partial inventory failure and retries the complete inventory', async () => {
    const api = fixture([]);
    const failure = new ApiError('server', 500, 'server_error', 'inventory-7');
    vi.mocked(api.list).mockResolvedValueOnce({ items: [file('other.txt')], nextCursor: 'next' }).mockRejectedValueOnce(failure);
    render(page(api));
    expect(await screen.findByRole('alert')).toHaveTextContent('附件列表尚未完整加载');
    expect(screen.getByRole('alert')).toHaveTextContent('inventory-7');
    expect(screen.queryByText('找不到此附件，文件可能已被删除。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试附件' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('找不到此附件');
    expect(vi.mocked(api.list).mock.calls[2]?.[2]).toEqual({ limit: 100 });
    vi.mocked(api.list).mockResolvedValueOnce({ items: [file('docs/readme.md')], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: '重试附件' }));
    await screen.findByText('Contents of docs/readme.md');
  });

  it('shows an initial service failure separately from preview errors and retries each owner', async () => {
    const api = fixture([file('docs/readme.md')]);
    vi.mocked(api.list).mockRejectedValueOnce(new Error('private inventory error'));
    vi.mocked(api.readText).mockRejectedValueOnce(new ApiError('server', 500, 'server_error', 'preview-7'));
    render(page(api));
    expect(await screen.findByRole('alert')).toHaveTextContent('附件列表加载失败');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
    fireEvent.click(screen.getByRole('button', { name: '重试附件' }));
    await screen.findByRole('button', { name: '重试预览' });
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取文件预览');
    expect(screen.getByRole('alert')).toHaveTextContent('preview-7');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    await screen.findByText('Contents of docs/readme.md');
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.readText).toHaveBeenCalledTimes(2);
  });

  it('aborts pending text and clears the previous document on file and task navigation', async () => {
    const old = deferred<string>();
    const api = fixture([file('docs/readme.md'), file('next.txt')]);
    vi.mocked(api.readText).mockReturnValueOnce(old.promise);
    const view = render(page(api));
    await waitFor(() => expect(api.readText).toHaveBeenCalledOnce());
    const signal = vi.mocked(api.readText).mock.calls[0]![3];
    view.rerender(page(api, 'next.txt'));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('heading', { name: 'docs/readme.md' })).toBeNull();
    await screen.findByText('Contents of next.txt');
    await act(async () => old.resolve('Late old document'));
    expect(screen.queryByText('Late old document')).toBeNull();
    const pending = deferred<Page>();
    vi.mocked(api.list).mockReturnValueOnce(pending.promise);
    view.rerender(page(api, 'next.txt', '00000000-0000-4000-8000-000000000002'));
    expect(screen.queryByText('Contents of next.txt')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('正在加载附件');
    const request = vi.mocked(api.list).mock.calls.at(-1)![3];
    view.unmount();
    expect(request.aborted).toBe(true);
    await act(async () => pending.reject(new Error('Late list failure')));
  });

  it.each([
    ['data.json', 'application/json', 'text'], ['image.svg', 'image/svg+xml', 'image'],
    ['site/index.html', 'text/html', 'HTML'], ['report.pdf', 'application/pdf', 'PDF'], ['archive.bin', 'application/octet-stream', 'unsupported'],
  ])('uses the shared renderer and injected URLs for %s', async (path, contentType, kind) => {
    const api = fixture([file(path, contentType)]);
    const urls = { previewRoot: '/fixtures/', preview: (name: string) => `/fixtures/${name}`, download: (name: string) => `/downloads/${name}`, page: (name: string) => `/reader/${name}` };
    render(<AttachmentPage projectId={projectId} taskId={taskId} path={path} api={api} urls={urls} />);
    if (kind === 'text') await screen.findByText(`Contents of ${path}`);
    else if (kind === 'image') expect(await screen.findByRole('img')).toHaveAttribute('src', `/fixtures/${path}`);
    else if (kind === 'unsupported') await screen.findByText('此文件暂不支持预览，请下载后打开。');
    else {
      const frame = await screen.findByTitle(`${kind} 预览：${path}`) as HTMLIFrameElement;
      expect(frame).toHaveAttribute('src', `/fixtures/${path}`);
      fireEvent.load(frame);
      expect(fireEvent.keyDown(frame.contentDocument!, { key: 'Escape' })).toBe(true);
      expect(fireEvent.keyDown(frame.contentDocument!, { key: 'Tab' })).toBe(true);
    }
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('href', `/downloads/${path}`);
  });
});
