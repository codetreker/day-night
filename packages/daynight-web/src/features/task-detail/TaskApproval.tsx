import { useLayoutEffect, useRef } from 'react';
import { ApiError } from '../../api/client';
import type { TaskDetail } from '../../api/types';
import { useI18n } from '../../i18n/LocaleProvider';
import type { TaskMutationState } from './TaskDetailSession';

const ApprovalError = ({ error }: { readonly error: unknown }) => {
  const { messages: { inspection: { approval: m }, common } } = useI18n();
  const message = error instanceof ApiError
    ? error.kind === 'network' ? m.networkError : error.kind === 'protocol' ? m.protocolError
      : error.code === 'version_conflict' ? m.versionConflict : error.code === 'invalid_transition' ? m.invalidTransition
        : error.code === 'not_found' ? m.notFound : m.refused
    : m.requestFailed;
  return <><p>{message}</p>{error instanceof ApiError && error.requestId !== null && <p className="request-id">{common.requestId}{' '}<code>{error.requestId}</code></p>}</>;
};

export const TaskApproval = ({ detail, approval, onReconcile }: {
  readonly detail: TaskDetail | null;
  readonly approval: TaskMutationState;
  readonly onReconcile: () => void;
}) => {
  const { messages: { inspection: { approval: m } } } = useI18n();
  const message = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (approval.phase !== 'idle' && document.activeElement === document.body) message.current?.focus();
  }, [approval.phase, detail?.status]);
  if (approval.phase === 'idle' || approval.operation?.action === 'allowAgents') return null;
  const busy = approval.phase === 'pending' || approval.reconciling;
  const unresolved = approval.phase === 'unknown' || approval.reconciliationError !== null;
  const summary = approval.reconciling ? m.checking : approval.phase === 'pending' ? m.pending
    : approval.phase === 'confirmed' ? approval.operation?.action === 'unapprove' ? m.unapproved : m.confirmed
      : approval.phase === 'unknown' ? m.unknown : approval.phase === 'conflict' ? m.conflict : approval.phase === 'reconciled' ? m.reconciled : null;
  return <section className={`task-approval${approval.phase === 'confirmed' ? ' task-approval-confirmed' : ''}`} aria-label={m.title} aria-busy={busy}>
    <h4>{m.title}</h4>
    {detail !== null && <p className="task-approval-description">{detail.status === 'proposed' ? m.proposedState : detail.status !== 'todo' ? m.currentState : detail.ready ? m.approvedReady : m.approvedBlocked}</p>}
    {unresolved && <div className="task-approval-controls"><button className="button" type="button" disabled={busy} onClick={onReconcile}>{approval.reconciling ? m.checking : m.checkState}</button></div>}
    {summary !== null && <p className="task-approval-message" ref={message} tabIndex={-1} role={unresolved || approval.phase === 'conflict' ? 'alert' : 'status'}>{summary}</p>}
    {approval.error !== null && <div className="task-approval-error" role="alert"><ApprovalError error={approval.error} /></div>}
    {approval.reconciliationError !== null && <div className="task-approval-error" role="alert"><p>{m.checkFailed}</p><ApprovalError error={approval.reconciliationError} /></div>}
  </section>;
};
