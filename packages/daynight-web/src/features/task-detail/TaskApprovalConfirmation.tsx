import { useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ApprovalAction, TaskDetail } from '../../api/types';
import { useI18n } from '../../i18n/LocaleProvider';
import { dialogFocusables } from './focus';
import '../../styles/auth.css';

export type ApprovalConfirmation = {
  readonly action: ApprovalAction;
  readonly detail: TaskDetail;
};

const reviewKey = (detail: TaskDetail): string => JSON.stringify([
  detail.projectId, detail.id, detail.version.toString(), detail.status, detail.title, detail.updatedAt,
  detail.ready, [...detail.dependsOn].sort(), [...detail.blockedBy].sort(),
]);

export const matchesApprovalReview = (confirmation: ApprovalConfirmation, detail: TaskDetail | null): boolean =>
  detail !== null && reviewKey(confirmation.detail) === reviewKey(detail);

export const TaskApprovalConfirmation = ({ confirmation, owner, fallbackFocus, onCancel, onConfirm }: {
  readonly confirmation: ApprovalConfirmation;
  readonly owner: RefObject<HTMLElement | null>;
  readonly fallbackFocus: RefObject<HTMLElement | null>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) => {
  const { messages: { inspection: { approval: m } } } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const restoreOpener = useRef(true);
  const callbacks = useRef({ onCancel });
  callbacks.current = { onCancel };
  useLayoutEffect(() => {
    const parent = owner.current!;
    const opener = document.activeElement;
    const wasInert = parent.hasAttribute('inert');
    parent.setAttribute('inert', '');
    cancel.current!.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); callbacks.current.onCancel();
      } else if (event.key === 'Tab') {
        const items = dialogFocusables(dialog.current!);
        const first = items[0]!; const last = items[items.length - 1]!;
        if (!dialog.current!.contains(document.activeElement) || !event.shiftKey && document.activeElement === last) {
          event.preventDefault(); event.stopPropagation(); first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); event.stopPropagation(); last.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (!wasInert) parent.removeAttribute('inert');
      if (restoreOpener.current && opener instanceof HTMLButtonElement && opener.isConnected && !opener.disabled) opener.focus();
      else fallbackFocus.current?.focus();
    };
  }, [owner, fallbackFocus]);
  const approving = confirmation.action === 'approve';
  return createPortal(<div className="auth-modal-backdrop task-approval-confirmation-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="auth-dialog task-approval-confirmation" ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header className="dialog-header"><h2 id={titleId}>{approving ? m.approve : m.unapprove}</h2><button className="close-button" type="button" aria-label={m.closeConfirmation} onClick={onCancel}>×</button></header>
      <div className="dialog-body" id={descriptionId} tabIndex={0}><p>{approving ? m.approveQuestion : m.unapproveQuestion}</p><p className="task-approval-confirmation-task">{confirmation.detail.title}</p><p>{approving ? m.explanation : m.unapproveExplanation}</p></div>
      <footer className="dialog-footer"><button className="button" type="button" ref={cancel} onClick={onCancel}>{m.cancel}</button><button className="button primary" type="button" onClick={() => { restoreOpener.current = false; onConfirm(); }}>{approving ? m.confirmApprove : m.confirmUnapprove}</button></footer>
    </section>
  </div>, document.body);
};
