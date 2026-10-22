import { fireEvent, screen } from '@testing-library/react';
import { createLocaleRender } from './helpers/renderWithLocale';
import { describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../src/api/types';
import { AttachmentPreview, type AttachmentPreviewState } from '../src/features/task-detail/attachments/AttachmentPreview';
import { dialogFocusables } from '../src/features/task-detail/focus';

const render = createLocaleRender('zh-CN');

const attachment = (path: string, contentType: string): Attachment => ({ path, contentType, sizeBytes: 10, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' });
const ready: AttachmentPreviewState = { path: 'docs/guide.md', status: 'ready', text: null, error: null };
const root = '/api/v1/projects/p/tasks/t/preview/';
const preview = (file: Attachment, changes: Partial<AttachmentPreviewState> = {}) => <AttachmentPreview attachment={file} preview={{ ...ready, ...changes }} url={`${root}${file.path}`} previewRoot={root} onRetry={vi.fn()} onClose={vi.fn()} />;

describe('attachment preview', () => {
  it('renders CommonMark and GFM tables while resolving relative resources and escaping HTML', () => {
    render(preview(attachment('docs/guide.md', 'text/markdown'), { text: '# Guide\n\n| Name | State |\n| --- | --- |\n| UI | Ready |\n\n![Diagram](../images/a%20b.svg)\n\n[Design](nested/design.md#section) [External](https://example.com) [Unsafe](javascript:alert%281%29) [Escape](../../outside)\n\n<script>alert(1)</script>' }));
    expect(screen.getByRole('heading', { name: 'Guide' })).toBeVisible();
    expect(screen.getByRole('table')).toHaveTextContent('UIReady');
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveAttribute('src', `${root}images/a%20b.svg`);
    expect(screen.getByRole('link', { name: 'Design' })).toHaveAttribute('href', `${root}docs/nested/design.md#section`);
    expect(screen.getByRole('link', { name: 'External' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByText('Unsafe')).toHaveAttribute('href', '');
    expect(screen.getByText('Escape')).toHaveAttribute('href', '');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible();
  });

  it('exposes loading, retry, and idle states without displaying private errors', () => {
    const retry = vi.fn();
    const props = { attachment: attachment('a.txt', 'text/plain'), preview: { ...ready, status: 'loading' as const }, url: `${root}a.txt`, previewRoot: root, onRetry: retry, onClose: vi.fn() };
    const view = render(<AttachmentPreview {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载预览');
    view.rerender(<AttachmentPreview {...props} preview={{ ...ready, status: 'error', error: new Error('private') }} />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<AttachmentPreview {...props} preview={{ ...ready, status: 'idle' }} />);
    expect(view.container.querySelector('.attachment-preview-body')).toBeEmptyDOMElement();
  });

  it('uses text, native images, PDF, trusted HTML, and download-only states', () => {
    const view = render(preview(attachment('data.json', 'application/json'), { text: '{\n  "ok": true\n}' }));
    expect(view.container.querySelector('pre')?.textContent).toBe('{\n  "ok": true\n}');
    view.rerender(preview(attachment('image.png', 'image/png')));
    expect(screen.getByRole('img')).toHaveAttribute('src', `${root}image.png`);
    view.rerender(preview(attachment('brief.pdf', 'application/pdf')));
    expect(screen.getByTitle('PDF 预览：brief.pdf')).toHaveAttribute('tabindex', '0');
    view.rerender(preview(attachment('site/index.html', 'text/html')));
    const frame = screen.getByTitle('HTML 预览：site/index.html');
    expect(frame).toHaveAttribute('src', `${root}site/index.html`);
    expect(frame).not.toHaveAttribute('sandbox');
    view.rerender(preview(attachment('archive.zip', 'application/zip')));
    expect(screen.getByText('此文件暂不支持预览，请下载后打开。')).toBeVisible();
  });

  it('shows image loading failures and retries, and handles inaccessible frame documents', () => {
    const view = render(preview(attachment('image.png', 'image/png')));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载预览');
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('无法加载文件预览');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    fireEvent.load(screen.getByRole('img'));
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(preview(attachment('site/index.html', 'text/html')));
    const frame = screen.getByTitle('HTML 预览：site/index.html');
    Object.defineProperty(frame, 'contentDocument', { value: null });
    fireEvent.load(frame);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bridges iframe Escape and boundary Tab to dialog controls and removes old listeners', () => {
    const close = vi.fn();
    const file = attachment('index.html', 'text/html');
    const view = render(<section role="dialog"><button type="button">关闭</button><AttachmentPreview attachment={file} preview={ready} url={`${root}index.html`} previewRoot={root} onRetry={vi.fn()} onClose={close} /><button type="button">后续</button></section>);
    const frame = screen.getByTitle('HTML 预览：index.html') as HTMLIFrameElement;
    const content = frame.contentDocument!;
    content.appendChild(content.createElement('html')).appendChild(content.createElement('body'));
    content.body.innerHTML = '<button id="first">First</button><button id="last">Last</button>';
    fireEvent.load(frame);
    const first = content.getElementById('first')!;
    const last = content.getElementById('last')!;
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(screen.getByRole('button', { name: '后续' })).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
    fireEvent.keyDown(content, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    fireEvent.load(frame);
    fireEvent.keyDown(content, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
    view.unmount();
    fireEvent.keyDown(content, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('handles empty frames without taking focus outside the dialog and ignores detached frames', () => {
    const file = attachment('index.html', 'text/html');
    const view = render(<section role="dialog"><AttachmentPreview attachment={file} preview={ready} url={`${root}index.html`} previewRoot={root} onRetry={vi.fn()} onClose={vi.fn()} /></section>);
    const frame = screen.getByTitle('HTML 预览：index.html') as HTMLIFrameElement;
    fireEvent.load(frame);
    fireEvent.keyDown(frame.contentDocument!, { key: 'Tab' });
    expect(frame).toHaveFocus();
    view.rerender(preview(file));
    const detached = screen.getByTitle('HTML 预览：index.html') as HTMLIFrameElement;
    fireEvent.load(detached);
    expect(fireEvent.keyDown(detached.contentDocument!, { key: 'Tab' })).toBe(true);
  });

  it('uses sequential native controls and editing hosts while excluding inert and collapsed descendants', () => {
    const view = render(<div><button type="button" disabled>Disabled</button><div inert><a href="#">Inert</a></div><details><summary>Directory</summary><button type="button">Hidden file</button><details><summary>Nested</summary><button type="button">Nested file</button></details></details><details open><summary>Open directory</summary><button type="button">Visible file</button></details><input type="hidden" /><a href="#" tabIndex={-1}>Skipped link</a><div contentEditable suppressContentEditableWarning>Editable</div></div>);
    expect(dialogFocusables(view.container).map((element) => element.textContent)).toEqual(['Directory', 'Open directory', 'Visible file', 'Editable']);
  });
});
