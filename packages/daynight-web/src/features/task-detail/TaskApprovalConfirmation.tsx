import type { RefObject } from 'react';
import type { ApprovalAction, TaskDetail } from '../../api/types';
import { useI18n } from '../../i18n/LocaleProvider';
import { TaskConfirmation } from './TaskConfirmation';
import { taskReviewKey } from './freshness';

export type ApprovalConfirmation = { readonly action: ApprovalAction; readonly detail: TaskDetail };

export const matchesApprovalReview = (confirmation: ApprovalConfirmation, detail: TaskDetail | null): boolean =>
  detail !== null && taskReviewKey(confirmation.detail) === taskReviewKey(detail);

export const TaskApprovalConfirmation = ({ confirmation, ...props }: {
  readonly confirmation: ApprovalConfirmation;
  readonly owner: RefObject<HTMLElement | null>;
  readonly fallbackFocus: RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) => {
  const { messages: { inspection: { approval: m } } } = useI18n();
  const approving = confirmation.action === 'approve';
  return <TaskConfirmation {...props} title={approving ? m.approve : m.unapprove} question={approving ? m.approveQuestion : m.unapproveQuestion}
    explanation={approving ? m.explanation : m.unapproveExplanation} taskTitle={confirmation.detail.title}
    confirmLabel={approving ? m.confirmApprove : m.confirmUnapprove} cancelLabel={m.cancel} closeLabel={m.closeConfirmation} />;
};
