import { useEffect, useRef, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Attachment } from '../../../api/types';
import { dialogFocusables } from '../focus';
import { attachmentKind, resolveAttachmentUrl } from './model';

export type AttachmentPreviewState = {
  readonly path: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly text: string | null;
  readonly error: unknown;
};

type AttachmentPreviewProps = {
  readonly attachment: Attachment;
  readonly preview: AttachmentPreviewState;
  readonly url: string;
  readonly previewRoot: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
};

const TrustedFrame = ({ url, title, onClose }: { readonly url: string; readonly title: string; readonly onClose: () => void }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loadedFrame, setLoadedFrame] = useState(false);
  const removeListener = useRef<(() => void) | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => () => removeListener.current?.(), []);

  const loaded = () => {
    setLoadedFrame(true);
    removeListener.current?.();
    const frame = frameRef.current!;
    const content = frame.contentDocument;
    if (content === null) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      } else if (event.key === 'Tab') {
        const inner = dialogFocusables(content);
        const active = content.activeElement;
        if (inner.length !== 0 && (event.shiftKey ? active !== inner[0] : active !== inner[inner.length - 1])) return;
        const dialog = frame.closest<HTMLElement>('[role="dialog"]');
        if (dialog === null) return;
        const outer = dialogFocusables(dialog);
        const index = outer.indexOf(frame);
        const target = outer[(index + (event.shiftKey ? -1 : 1) + outer.length) % outer.length]!;
        event.preventDefault();
        target.focus();
      }
    };
    content.addEventListener('keydown', keyDown);
    removeListener.current = () => content.removeEventListener('keydown', keyDown);
  };

  return <div>
    {!loadedFrame && <p className="attachment-state attachment-native-state" role="status">正在加载预览…</p>}
    <iframe className="attachment-frame" ref={frameRef} src={url} title={title} tabIndex={0} onLoad={loaded} />
  </div>;
};

const NativeStatus = ({ status, onRetry }: { readonly status: 'loading' | 'ready' | 'error'; readonly onRetry: () => void }) => status === 'ready' ? null : status === 'loading'
  ? <p className="attachment-state attachment-native-state" role="status">正在加载预览…</p>
  : <div className="attachment-state attachment-native-state attachment-error" role="alert"><p>无法加载文件预览，请重试或下载文件。</p><button className="button" type="button" onClick={onRetry}>重试预览</button></div>;

const ImagePreview = ({ url, path }: { readonly url: string; readonly path: string }) => {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  return <div><NativeStatus status={status} onRetry={() => { setStatus('loading'); setRevision((value) => value + 1); }} />{status !== 'error' && <img key={revision} className="attachment-image" src={url} alt={path} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />}</div>;
};

export const AttachmentPreview = ({ attachment, preview, url, previewRoot, onRetry, onClose }: AttachmentPreviewProps) => {
  const kind = attachmentKind(attachment);
  if (preview.status === 'loading') return <p className="attachment-state" role="status">正在加载预览…</p>;
  if (preview.status === 'error') return (
    <div className="attachment-state attachment-error" role="alert">
      <p>无法读取文件预览，请重试或下载文件。</p>
      <button className="button" type="button" onClick={onRetry}>重试预览</button>
    </div>
  );
  if (preview.status !== 'ready') return null;
  if (kind === 'markdown') return (
    <div className="attachment-markdown">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={(value) => {
        const resolved = resolveAttachmentUrl(value, attachment.path, previewRoot);
        return resolved === null ? '' : defaultUrlTransform(resolved);
      }}>{preview.text}</Markdown>
    </div>
  );
  if (kind === 'text') return <pre className="attachment-text">{preview.text}</pre>;
  if (kind === 'image') return <ImagePreview key={url} url={url} path={attachment.path} />;
  if (kind === 'pdf' || kind === 'html') return <TrustedFrame key={url} url={url} title={`${kind === 'pdf' ? 'PDF' : 'HTML'} 预览：${attachment.path}`} onClose={onClose} />;
  return <p className="attachment-state">此文件暂不支持预览，请下载后打开。</p>;
};
