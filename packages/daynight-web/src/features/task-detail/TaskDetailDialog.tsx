import { createPortal } from 'react-dom';
import { TaskDetailSessionBoundary } from './TaskDetailSession';
import { TaskDetailSurface, type TaskDetailSurfaceProps } from './TaskDetailSurface';

export type TaskDetailDialogProps = Omit<TaskDetailSurfaceProps, 'presentation' | 'navigation' | 'onNavigate' | 'attachmentApi' | 'attachmentUrls' | 'detailUrl' | 'onClose' | 'onRestoreFocus'> & {
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
};

export const TaskDetailDialog = (props: TaskDetailDialogProps) => <TaskDetailSessionBoundary>{createPortal(<TaskDetailSurface {...props} presentation="dialog" />, document.body)}</TaskDetailSessionBoundary>;
