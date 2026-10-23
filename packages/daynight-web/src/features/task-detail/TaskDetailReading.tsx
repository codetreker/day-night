import { useState, type ReactNode } from 'react';
import { attachmentPreviewRoot } from '../../api/client';
import { useI18n } from '../../i18n/LocaleProvider';
import { MarkdownContent } from './MarkdownContent';
import { TaskDetailPanels } from './TaskDetailPanels';
import { TaskAttachmentsPanel, type AttachmentNavigation, type AttachmentUrls } from './attachments/TaskAttachments';
import { resolveAttachmentReference, resolveMarkdownAttachmentUrl } from './attachments/model';
import { useAttachments, type AttachmentApi } from './attachments/useAttachments';

type TaskDetailReadingProps = {
  readonly projectId: string;
  readonly taskId: string;
  readonly description: string;
  readonly overview: (description: ReactNode) => ReactNode;
  readonly onClose: () => void;
  readonly api?: AttachmentApi;
  readonly urls?: AttachmentUrls;
};

export const TaskDetailReading = ({ projectId, taskId, description, overview, onClose, api, urls }: TaskDetailReadingProps) => {
  const { messages } = useI18n();
  const attachments = useAttachments(projectId, taskId, api);
  const [navigation, setNavigation] = useState<AttachmentNavigation | null>(null);
  const previewRoot = urls === undefined ? attachmentPreviewRoot(projectId, taskId) : urls.previewRoot;
  const base = { kind: 'root' } as const;

  return <TaskDetailPanels overview={(showAttachments) => overview(description === ''
    ? <p className="task-detail-description">{messages.inspection.detail.noDescription}</p>
    : <MarkdownContent className="task-description" text={description} resolveUrl={(value) => resolveMarkdownAttachmentUrl(value, base, previewRoot)} onLinkClick={(value, event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.currentTarget.hasAttribute('download') || event.currentTarget.target !== '' || /[?#]/.test(value)) return;
      const reference = resolveAttachmentReference(value, base);
      if (reference.kind === 'native') return;
      event.preventDefault();
      attachments.select(reference.kind === 'relative' ? reference.path : null);
      setNavigation({ invalid: reference.kind !== 'relative' });
      showAttachments();
    }} />)} attachments={(active) => <TaskAttachmentsPanel active={active} projectId={projectId} taskId={taskId} attachments={attachments} navigation={navigation} onInteract={() => setNavigation(null)} onClose={onClose} {...(urls === undefined ? {} : { urls })} />} />;
};
