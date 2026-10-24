import { useLayoutEffect, useRef } from 'react';
import { attachmentPageUrl } from '../../../api/client';
import { navigate } from '../../../app/router';
import { LanguageSelector } from '../../../i18n/LanguageSelector';
import { useI18n } from '../../../i18n/LocaleProvider';
import { TaskAttachmentsPanel, type AttachmentUrls } from './TaskAttachments';
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
  const { messages } = useI18n();
  const m = messages.inspection.attachments;
  const attachments = useAttachments(projectId, taskId, api, { requireCompleteInventory: true });
  const main = useRef<HTMLElement>(null);
  const unselected = attachments.selectedPath === null;
  useLayoutEffect(() => { main.current!.focus(); }, []);
  // A removed file keeps its route so reload and history show its missing state.
  useLayoutEffect(() => {
    attachments.select(path);
  }, [attachments.select, path, unselected]);
  const select = (nextPath: string) => {
    const url = urls === undefined ? attachmentPageUrl(projectId, taskId, nextPath) : urls.page(nextPath);
    if (new URL(url, window.location.href).href !== window.location.href) navigate(url);
  };

  return <main className="attachment-page" ref={main} tabIndex={-1} aria-label={m.preview}>
    <header className="attachment-preview-header attachment-page-header">
      <div><a className="attachment-page-back" href={`/projects/${encodeURIComponent(projectId)}`}>{m.returnToTask}</a>{attachments.selected === undefined && <h1 title={path}>{path}</h1>}</div>
      <LanguageSelector />
    </header>
    <TaskAttachmentsPanel projectId={projectId} taskId={taskId} attachments={attachments} onSelect={select} {...(urls === undefined ? {} : { urls })} />
  </main>;
};

export const AttachmentPage = (props: AttachmentPageProps) => <AttachmentPageContent key={`${props.projectId}/${props.taskId}`} {...props} />;
