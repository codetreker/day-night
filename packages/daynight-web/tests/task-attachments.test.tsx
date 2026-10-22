import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createLocaleRender } from './helpers/renderWithLocale';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import type { Attachment, AttachmentPage } from '../src/api/types';
import { TaskAttachments } from '../src/features/task-detail/attachments/TaskAttachments';
import type { AttachmentApi } from '../src/features/task-detail/attachments/useAttachments';

const render = createLocaleRender('zh-CN');

const timestamp = '2026-10-21T00:00:00Z';
const file = (path: string, contentType = 'text/plain'): Attachment => ({ path, contentType, sizeBytes: 12, createdAt: timestamp, updatedAt: timestamp });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const fixture = (initial: readonly Attachment[] = []) => {
  const files = new Map(initial.map((item) => [item.path, item]));
  let revision = 0;
  const api: AttachmentApi = {
    list: vi.fn(async () => ({ items: [...files.values()], nextCursor: null })),
    readText: vi.fn(async (_project, _task, path) => `Contents of ${path}`),
    checkPreview: vi.fn(async () => {}),
    put: vi.fn(async (_project, _task, path, source) => {
      const item = { ...file(path, source.type), sizeBytes: source.size, updatedAt: new Date(Date.now() + ++revision).toISOString() };
      files.set(path, item);
      return item;
    }),
    remove: vi.fn(async (_project, _task, path) => { files.delete(path); }),
  };
  return api;
};
const open = (api: AttachmentApi, taskId = '00000000-0000-4000-8000-000000000001') => render(<TaskAttachments projectId="00000000-0000-4000-8000-000000000100" taskId={taskId} api={api} onClose={vi.fn()} />);

describe('task attachments', () => {
  it('starts with upload controls collapsed and retains the mounted draft when toggled', async () => {
    const api = fixture();
    open(api);
    await screen.findByText('暂无附件，上传文件后即可在这里浏览。');
    const user = userEvent.setup();
    const summary = screen.getByText('上传文件', { selector: 'summary' });
    const disclosure = summary.parentElement!;
    const input = screen.getByLabelText('选择一个文件') as HTMLInputElement;
    expect(disclosure).not.toHaveAttribute('open');
    expect(input).not.toBeVisible();
    expect(screen.getByLabelText('目标相对路径')).not.toBeVisible();
    await user.click(summary);
    expect(disclosure).toHaveAttribute('open');
    expect(input).toBeVisible();
    const source = new File(['draft'], 'draft.txt', { type: 'text/plain' });
    await user.upload(input, source);
    const path = screen.getByRole('textbox', { name: '目标相对路径' });
    await user.clear(path);
    await user.type(path, 'drafts/unsent.txt');
    await user.click(summary);
    expect(input).not.toBeVisible();
    await user.click(summary);
    expect(screen.getByLabelText('选择一个文件')).toBe(input);
    expect(screen.getByRole('textbox', { name: '目标相对路径' })).toBe(path);
    expect(input.files?.[0]).toBe(source);
    expect(path).toHaveValue('drafts/unsent.txt');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('loads a native directory tree, keeps names as text, and selects files for preview and download', async () => {
    const first = deferred<AttachmentPage>();
    const api = { ...fixture(), list: vi.fn().mockReturnValue(first.promise) };
    open(api);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载附件');
    expect(screen.getByRole('button', { name: '刷新附件' })).toBeDisabled();
    await act(async () => first.resolve({ items: [file('docs/readme.md', 'text/markdown'), file('<img onerror=bad>.txt')], nextCursor: null }));
    expect(screen.getByRole('heading', { name: '附件 · 2' })).toBeVisible();
    expect(screen.getByText('docs').tagName).toBe('SUMMARY');
    expect(screen.getByRole('button', { name: /<img onerror=bad>.txt/ })).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /readme.md/ }));
    await screen.findByText('Contents of docs/readme.md');
    expect(screen.getByRole('button', { name: /readme.md/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('href', '/api/v1/projects/00000000-0000-4000-8000-000000000100/tasks/00000000-0000-4000-8000-000000000001/attachments/files/docs/readme.md');
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('download');
  });

  it('keeps a real new-tab link bound to the current selection while its content is pending', async () => {
    const pending = deferred<string>();
    const api = fixture([file('docs/设计 #?%.md', 'text/markdown'), file('next.txt')]);
    const readText = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('Next content');
    open({ ...api, readText });
    fireEvent.click(await screen.findByRole('button', { name: /设计/ }));
    const link = screen.getByRole('link', { name: '在新标签页打开' });
    expect(link).toHaveAttribute('href', '/projects/00000000-0000-4000-8000-000000000100/tasks/00000000-0000-4000-8000-000000000001/attachments/docs/%E8%AE%BE%E8%AE%A1%20%23%3F%25.md');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.previousElementSibling).toBe(screen.getByRole('link', { name: '下载' }));
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('正在加载预览');
    fireEvent.click(screen.getByRole('button', { name: /next.txt/ }));
    expect(link).toHaveAttribute('href', expect.stringContaining('/attachments/next.txt'));
    await screen.findByText('Next content');
    await act(async () => pending.resolve('Stale document'));
    expect(screen.queryByText('Stale document')).toBeNull();
  });

  it('uploads one file, validates the target path, directly overwrites, and deletes with attachment-only reloads', async () => {
    const api = fixture([file('docs/readme.md')]);
    open(api);
    await screen.findByRole('button', { name: /readme.md/ });
    const user = userEvent.setup();
    await user.click(screen.getByText('上传文件', { selector: 'summary' }));
    const source = new File(['new contents'], 'readme.md', { type: 'text/markdown' });
    const input = screen.getByLabelText('选择一个文件') as HTMLInputElement;
    expect(input).not.toHaveAttribute('multiple');
    expect(input).not.toHaveAttribute('webkitdirectory');
    await user.upload(input, source);
    const path = screen.getByRole('textbox', { name: '目标相对路径' });
    expect(path).toHaveValue('readme.md');
    await user.clear(path);
    await user.type(path, '../outside.md');
    await user.click(screen.getByRole('button', { name: '上传文件' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的相对文件路径');
    expect(api.put).not.toHaveBeenCalled();
    await user.clear(path);
    await user.type(path, 'docs/readme.md');
    await user.click(screen.getByRole('button', { name: '上传文件' }));
    await screen.findByRole('heading', { name: 'docs/readme.md' });
    expect(api.put).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 'docs/readme.md', source, expect.any(AbortSignal));
    expect(path).toHaveValue('');
    expect(input.files).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '附件 · 1' })).toBeVisible();
    expect(api.list).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: '删除' }));
    await screen.findByText('暂无附件，上传文件后即可在这里浏览。');
    expect(api.remove).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 'docs/readme.md', expect.any(AbortSignal));
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('region', { name: '附件预览' })).toBeNull();
  });

  it('retains upload form and current preview after failed writes and exposes request IDs without private details', async () => {
    const api = fixture([file('old.txt')]);
    const put = vi.fn().mockRejectedValueOnce(new ApiError('server', 500, 'internal_error', 'upload-123')).mockImplementation(api.put);
    const remove = vi.fn().mockRejectedValue(new Error('private delete failure'));
    open({ ...api, put, remove });
    await screen.findByRole('button', { name: /old.txt/ });
    fireEvent.click(screen.getByRole('button', { name: /old.txt/ }));
    await screen.findByText('Contents of old.txt');
    const user = userEvent.setup();
    await user.click(screen.getByText('上传文件', { selector: 'summary' }));
    const input = screen.getByLabelText('选择一个文件') as HTMLInputElement;
    const source = new File(['next'], 'next.txt', { type: 'text/plain' });
    await user.upload(input, source);
    await user.click(screen.getByRole('button', { name: '上传文件' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('upload-123');
    expect(screen.getByRole('textbox', { name: '目标相对路径' })).toHaveValue('next.txt');
    expect(input.files?.[0]).toBe(source);
    expect(screen.getByText('Contents of old.txt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private delete failure');
    expect(screen.getByText('Contents of old.txt')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '上传文件' }));
    await screen.findByRole('heading', { name: 'next.txt' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('distinguishes incomplete lists from empty lists and retries from the beginning', async () => {
    const api = fixture();
    const list = vi.fn().mockRejectedValueOnce(new Error('private list error')).mockResolvedValueOnce({ items: [file('partial.txt')], nextCursor: 'next' }).mockRejectedValueOnce(new Error('next page failed')).mockResolvedValue({ items: [], nextCursor: null });
    open({ ...api, list });
    expect(await screen.findByRole('alert')).toHaveTextContent('附件列表加载失败');
    expect(screen.queryByText('暂无附件，上传文件后即可在这里浏览。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试附件' }));
    await screen.findByRole('button', { name: /partial.txt/ });
    expect(screen.getByRole('alert')).toHaveTextContent('附件列表尚未完整加载');
    expect(screen.getByRole('heading', { name: '附件' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试附件' }));
    await screen.findByText('暂无附件，上传文件后即可在这里浏览。');
    expect(list.mock.calls[3]?.[2]).toEqual({ limit: 100 });
  });

  it('retries text previews and uses injected native preview and download URLs', async () => {
    const api = fixture([file('text.txt'), file('image.svg', 'image/svg+xml')]);
    const readText = vi.fn().mockRejectedValueOnce(new Error('private preview')).mockResolvedValue('Recovered');
    render(<TaskAttachments projectId="00000000-0000-4000-8000-000000000100" taskId="task" api={{ ...api, readText }} onClose={vi.fn()} urls={{ page: (path) => `/reader/${path}`, previewRoot: '/fixtures/', preview: (path) => `/fixtures/${path}`, download: (path) => `/downloads/${path}` }} />);
    fireEvent.click(await screen.findByRole('button', { name: /text.txt/ }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private preview');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    await screen.findByText('Recovered');
    fireEvent.click(screen.getByRole('button', { name: /image.svg/ }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', '/fixtures/image.svg');
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('href', '/downloads/image.svg');
  });

  it('retries HTML availability failures before mounting its native frame and reloads successful overwrites', async () => {
    const api = fixture([file('site/index.html', 'text/html')]);
    const checkPreview = vi.fn().mockRejectedValueOnce(new Error('private native preview')).mockResolvedValue(undefined);
    open({ ...api, checkPreview });
    fireEvent.click(await screen.findByRole('button', { name: /index.html/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取文件预览');
    expect(screen.queryByTitle('HTML 预览：site/index.html')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    const oldFrame = await screen.findByTitle('HTML 预览：site/index.html');
    fireEvent.load(oldFrame);
    expect(checkPreview).toHaveBeenCalledTimes(2);
    const user = userEvent.setup();
    await user.click(screen.getByText('上传文件', { selector: 'summary' }));
    await user.upload(screen.getByLabelText('选择一个文件'), new File(['<p>new</p>'], 'index.html', { type: 'text/html' }));
    const path = screen.getByRole('textbox', { name: '目标相对路径' });
    await user.clear(path);
    await user.type(path, 'site/index.html');
    await user.click(screen.getByRole('button', { name: '上传文件' }));
    await waitFor(() => expect(screen.getByTitle('HTML 预览：site/index.html')).not.toBe(oldFrame));
    expect(screen.getByTitle('HTML 预览：site/index.html')).toHaveAttribute('src', '/api/v1/projects/00000000-0000-4000-8000-000000000100/tasks/00000000-0000-4000-8000-000000000001/preview/site/index.html');
    expect(checkPreview).toHaveBeenCalledTimes(3);
  });

  it('clears previous task preview and form synchronously and aborts old work', async () => {
    const next = deferred<AttachmentPage>();
    const api = fixture([file('old.txt')]);
    const list = vi.fn().mockImplementationOnce(api.list).mockReturnValue(next.promise);
    const injected = { ...api, list };
    const view = open(injected);
    fireEvent.click(await screen.findByRole('button', { name: /old.txt/ }));
    await screen.findByText('Contents of old.txt');
    const user = userEvent.setup();
    await user.click(screen.getByText('上传文件', { selector: 'summary' }));
    await user.upload(screen.getByLabelText('选择一个文件'), new File(['old'], 'old-upload.txt'));
    view.rerender(<TaskAttachments projectId="00000000-0000-4000-8000-000000000100" taskId="00000000-0000-4000-8000-000000000002" api={injected} onClose={vi.fn()} />);
    expect(screen.queryByText('Contents of old.txt')).toBeNull();
    expect(screen.getByText('上传文件', { selector: 'summary' }).parentElement).not.toHaveAttribute('open');
    expect(screen.getByLabelText('目标相对路径')).toHaveValue('');
    expect(screen.getByLabelText('选择一个文件')).not.toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('正在加载附件');
    expect(vi.mocked(api.readText).mock.calls[0]?.[3].aborted).toBe(true);
    await act(async () => next.resolve({ items: [], nextCursor: null }));
    expect(screen.getByText('暂无附件，上传文件后即可在这里浏览。')).toBeVisible();
    expect(within(screen.getByRole('region', { name: '附件 · 0' })).queryByRole('region', { name: '附件预览' })).toBeNull();
  });
});
