import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api/client';
import { LanguageSelector } from '../../i18n/LanguageSelector';
import { useI18n } from '../../i18n/LocaleProvider';
import { useBodyScrollLock } from '../../app/useBodyScrollLock';
import type { TaskStatus } from '../../api/types';
import type { GraphSnapshot } from '../projects/useTaskGraph';
import { isTaskStale } from './freshness';
import { dialogFocusables } from './focus';
import { approvalAction, TaskDetailSessionBoundary } from './TaskDetailSession';
import { useTaskDetail } from './useTaskDetail';
import { TaskApproval } from './TaskApproval';
import { matchesApprovalReview, TaskApprovalConfirmation, type ApprovalConfirmation } from './TaskApprovalConfirmation';
import { TaskDetailReading } from './TaskDetailReading';
import { TaskPullRequests } from './TaskPullRequests';
import '../../styles/task-detail.css';

export type TaskDetailDialogProps = {
  readonly projectId: string;
  readonly taskId: string;
  readonly snapshot: GraphSnapshot;
  readonly onSelectTask: (id: string) => void;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
  readonly onRefreshGraph: () => void;
};

const StatusBadge = ({ status }: { readonly status: TaskStatus }) => {
  const { messages } = useI18n();
  return <span className={`task-detail-status task-detail-status-${status}`}>{messages.common.status[status]}</span>;
};

const DetailError = ({ error }: { readonly error: unknown }) => {
  const { messages } = useI18n();
  const m = messages.inspection.detail;
  return <>
    <p>{error instanceof ApiError && error.kind === 'network'
      ? m.networkError
      : error instanceof ApiError && error.code === 'not_found' ? m.notFoundError : m.loadError}</p>
    {error instanceof ApiError && error.requestId !== null && (
      <p className="request-id">{messages.common.requestId}{' '}<code>{error.requestId}</code></p>
    )}
  </>;
};

const TaskDetailView = ({ projectId, taskId, snapshot, onSelectTask, onClose, onRestoreFocus, onRefreshGraph }: TaskDetailDialogProps) => {
  const { messages, format } = useI18n();
  const m = messages.inspection.detail;
  const task = useTaskDetail(projectId, taskId, snapshot.revision, snapshot.index.nodes.get(taskId));
  const { detail, status, error, retry } = task;
  const [confirmation, setConfirmation] = useState<ApprovalConfirmation | null>(null);
  const action = approvalAction(detail);
  const canAct = action === 'approve' ? task.canApprove : action === 'unapprove' ? task.canUnapprove : false;
  const confirmationValid = confirmation !== null && matchesApprovalReview(confirmation, detail) &&
    confirmation.action === action && canAct;
  const confirmationOpen = confirmation !== null && confirmationValid;
  useLayoutEffect(() => { if (confirmation !== null && !confirmationValid) setConfirmation(null); }, [confirmation, confirmationValid]);
  const headingId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef({ onClose, onRestoreFocus, confirmationOpen });
  callbacks.current = { onClose, onRestoreFocus, confirmationOpen };
  useBodyScrollLock(true);

  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (root === null) throw new Error('The application root is required for the task detail dialog.');
    const wasInert = root.hasAttribute('inert');
    root.setAttribute('inert', '');
    closeRef.current!.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (callbacks.current.confirmationOpen || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacks.current.onClose();
      } else if (event.key === 'Tab') {
        const dialog = dialogRef.current!;
        const buttons = dialogFocusables(dialog);
        const first = buttons[0]!;
        const last = buttons[buttons.length - 1]!;
        const active = document.activeElement;
        if (!dialog.contains(active) || (!event.shiftKey && active === last)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (!wasInert) root.removeAttribute('inert');
    };
  }, [projectId]);

  useEffect(() => () => {
    // Restore after sibling DOM removals so a disappearing trigger cannot capture focus.
    callbacks.current.onRestoreFocus();
  }, []);

  useLayoutEffect(() => {
    if (!confirmationOpen && !dialogRef.current!.contains(document.activeElement)) closeRef.current!.focus();
  }, [taskId, status, error, snapshot.revision, confirmationOpen]);

  const snapshotNode = snapshot.index.nodes.get(taskId);
  const retainedDetail = detail !== null && (error !== null || task.requiresFreshRead);
  const stale = detail !== null && !task.refreshing && !retainedDetail && isTaskStale(snapshotNode, detail);
  const successors = snapshot.index.successors.get(taskId);
  const relation = (id: string) => {
    const node = snapshot.index.nodes.get(id);
    return (
      <li key={id}>
        <button className="task-detail-relation" type="button" onClick={() => onSelectTask(id)}>
          <span className={`task-detail-relation-dot${node === undefined ? '' : ` task-detail-dot-${node.status}`}`} aria-hidden="true" />
          <span>{node === undefined ? id : `${node.titlePreview}${node.titleTruncated ? '…' : ''}`}</span>
          <span className="task-detail-relation-arrow" aria-hidden="true">↗</span>
        </button>
      </li>
    );
  };

  return createPortal(
    <div className="task-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !confirmationOpen) onClose(); }}>
      <section className="task-detail-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="task-detail-header">
          <h2 id={headingId}>{m.title}</h2>
          <LanguageSelector />
          <button className="button task-detail-close" type="button" ref={closeRef} aria-label={m.close} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="task-detail-body">
          {status === 'loading' && (
            <div className="task-detail-state" role="status"><span className="spinner" aria-hidden="true" /><p>{m.loading}</p></div>
          )}
          {status === 'error' && (
            <div className="task-detail-state task-detail-error" role="alert">
              <h3>{m.failed}</h3>
              <DetailError error={error} />
              <button className="button primary" type="button" onClick={retry}>{m.retry}</button>
            </div>
          )}
          {detail !== null && error !== null && (
            <div className="task-detail-read-error" role="alert" tabIndex={0}>
              <h3>{m.refreshFailed}</h3>
              <DetailError error={error} />
              <p>{m.retainedData}</p>
              <button className="button" type="button" onClick={retry}>{m.retry}</button>
            </div>
          )}
          {detail === null && task.approval.phase !== 'idle' && <div className="task-detail-approval">
            <TaskApproval detail={null} approval={task.approval} onReconcile={task.reconcile} />
          </div>}
          {detail !== null && (
            <>
              <div className="task-detail-heading">
                <p className="task-detail-id">{detail.id}</p>
                <div className="task-detail-title-row">
                  <h3 className="task-detail-title" ref={titleRef} tabIndex={0} title={detail.title}>{detail.title}</h3>
                  {action !== null && <button className={`button task-detail-title-action${action === 'approve' ? ' primary' : ''}`} type="button" disabled={!canAct} onClick={() => setConfirmation({ action, detail })}>{task.approval.phase === 'pending' ? messages.inspection.approval.submitting : action === 'approve' ? messages.inspection.approval.approve : messages.inspection.approval.unapprove}</button>}
                </div>
                <div className="task-detail-badges">
                  <StatusBadge status={detail.status} />
                  {detail.status === 'todo' && <span className={detail.ready ? 'task-detail-ready' : 'task-detail-blocked'}>{detail.ready ? m.ready : m.blocked}</span>}
                </div>
                {retainedDetail && <p className="task-detail-retained" role="status">{m.retainedDetail}</p>}
                {stale && (
                  <div className="task-detail-stale" role="status">
                    <p>{task.approval.phase === 'confirmed' ? messages.inspection.approval.confirmedSnapshot : m.stale}</p>
                    <button className="button" type="button" onClick={onRefreshGraph}>{m.refreshGraph}</button>
                  </div>
                )}
              </div>
              <TaskDetailReading key={`${projectId}/${taskId}`} projectId={projectId} taskId={taskId} description={detail.description} onClose={onClose} overview={(description) => <>
                <div className="task-detail-approval"><TaskApproval detail={detail} approval={task.approval} onReconcile={task.reconcile} /></div>
                <div className="task-detail-columns">
                  <div className="task-detail-main">
                    <section className="task-detail-section" aria-label={m.description}>
                      <h4>{m.description}</h4>
                      {description}
                    </section>
                    <TaskPullRequests pullRequests={detail.properties.pullRequests} />
                  </div>
                  <aside className="task-detail-aside" aria-label={m.relationsMetadata}>
                    <section className="task-detail-section" aria-label={m.dependencies}>
                      <h4>{m.countedHeading({ label: m.dependencies, count: format.number(detail.dependsOn.length) })}</h4>
                      {detail.dependsOn.length === 0 ? <p className="task-detail-description">{m.noDependencies}</p> : <ul className="task-detail-relations">{detail.dependsOn.map(relation)}</ul>}
                    </section>
                    <section className="task-detail-section" aria-label={m.blockers}>
                      <h4>{m.countedHeading({ label: m.blockers, count: format.number(detail.blockedBy.length) })}</h4>
                      {detail.blockedBy.length === 0 ? <p className="task-detail-description">{m.noBlockers}</p> : <ul className="task-detail-relations">{detail.blockedBy.map(relation)}</ul>}
                    </section>
                    <section className="task-detail-section" aria-label={m.successors}>
                      <h4>{successors === undefined ? m.successors : m.countedHeading({ label: m.successors, count: format.number(successors.length) })}</h4>
                      {successors === undefined
                        ? <p className="task-detail-description">{m.successorsMissing}</p>
                        : successors.length === 0 ? <p className="task-detail-description">{m.noSuccessors}</p> : <ul className="task-detail-relations">{successors.map(relation)}</ul>}
                    </section>
                    <dl className="task-detail-section task-detail-metadata">
                      <div><dt>{m.created}</dt><dd><time dateTime={detail.createdAt}>{format.dateTime(detail.createdAt)}</time></dd></div>
                      <div><dt>{m.updated}</dt><dd><time dateTime={detail.updatedAt}>{format.dateTime(detail.updatedAt)}</time></dd></div>
                      <div><dt>{m.taskId}</dt><dd className="task-detail-full-id">{detail.id}</dd></div>
                    </dl>
                  </aside>
                </div></>} />
            </>
          )}
        </div>
        <footer className="task-detail-footer">{m.footer}</footer>
      </section>
      {confirmationOpen && <TaskApprovalConfirmation confirmation={confirmation} owner={dialogRef} fallbackFocus={titleRef}
        onCancel={() => setConfirmation(null)} onConfirm={() => {
          if (!confirmationValid) return;
          setConfirmation(null);
          task.performApproval(confirmation.action, confirmation.detail.version);
        }} />}
    </div>,
    document.body,
  );
};

export const TaskDetailDialog = (props: TaskDetailDialogProps) => <TaskDetailSessionBoundary><TaskDetailView {...props} /></TaskDetailSessionBoundary>;
