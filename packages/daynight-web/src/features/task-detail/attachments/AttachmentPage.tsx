import { useEffect, useLayoutEffect, useRef } from 'react';
import { ApiError, attachmentDownloadUrl, attachmentPreviewRoot, attachmentPreviewUrl } from '../../../api/client';
import { LanguageSelector } from '../../../i18n/LanguageSelector';
import { useI18n } from '../../../i18n/LocaleProvider';
import { AttachmentPreview } from './AttachmentPreview';
import type { AttachmentUrls } from './TaskAttachments';
import { useAttachments, type AttachmentApi } from './useAttachments';
import '../../../styles/attachments.css';

type AttachmentPageProps = {
  readonly projectId: string;
  readonly taskId: string;
  readonly path: string;
  readonly api?: AttachmentApi;
  readonly urls?: AttachmentUrls;
};

const AttachmentPageContent = ({ projectId, taskId, path, api, urls }: AttachmentPageProps) => {
  const { messages, format } = useI18n();
  const m = messages.inspection.attachments;
  const attachments = useAttachments(projectId, taskId, api);
  const main = useRef<HTMLElement>(null);
  const selected = attachments.complete ? attachments.items.find((item) => item.path === path) : undefined;
  useLayoutEffect(() => { main.current!.focus(); }, []);
  useEffect(() => {
    attachments.select(selected === undefined ? null : path);
  }, [attachments.select, path, selected]);

  return <main className="attachment-page" ref={main} tabIndex={-1} aria-label={m.preview}>
    <header className="attachment-preview-header attachment-page-header">
      <div><a className="attachment-page-back" href={`/projects/${encodeURIComponent(projectId)}`}>{m.returnToTask}</a><h1 title={path}>{path}</h1>{selected !== undefined && <p>{m.fileMetadata({ contentType: selected.contentType, size: format.bytes(selected.sizeBytes) })}</p>}</div>
      <div className="attachment-preview-actions">
        <a className="button" href={urls === undefined ? attachmentDownloadUrl(projectId, taskId, path) : urls.download(path)} download>{m.download}</a>
        <LanguageSelector />
      </div>
    </header>
    {!attachments.complete ? (
      <div className="attachment-preview-body">
        {attachments.error === null ? <p className="attachment-state" role="status">{m.loading}</p> : <div className="attachment-state attachment-error" role="alert">
          <p>{attachments.items.length === 0 ? m.listError : m.incompleteList}</p>
          {attachments.error instanceof ApiError && attachments.error.requestId !== null && <p className="request-id">{messages.common.requestId}{' '}<code>{attachments.error.requestId}</code></p>}
          <button className="button" type="button" onClick={attachments.reload}>{m.retry}</button>
        </div>}
      </div>
    ) : selected === undefined ? <div className="attachment-preview-body"><div className="attachment-state" role="alert"><p>{m.missing}</p><button className="button" type="button" onClick={attachments.reload}>{m.retry}</button></div></div> : (
      <AttachmentPreview key={`${selected.path}/${selected.updatedAt}`} attachment={selected} preview={attachments.preview.path === path ? attachments.preview : { path, status: 'loading', text: null, error: null }} url={urls === undefined ? attachmentPreviewUrl(projectId, taskId, path) : urls.preview(path)} previewRoot={urls === undefined ? attachmentPreviewRoot(projectId, taskId) : urls.previewRoot} onRetry={attachments.retryPreview} />
    )}
  </main>;
};

export const AttachmentPage = (props: AttachmentPageProps) => <AttachmentPageContent key={`${props.projectId}/${props.taskId}/${props.path}`} {...props} />;
