import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/LocaleProvider';
import { useBodyScrollLock } from '../../app/useBodyScrollLock';
import type { GraphSnapshot } from '../projects/useTaskGraph';
import { isTaskStale } from './freshness';
import { dialogFocusables } from './focus';
import { TaskDetailSessionBoundary } from './TaskDetailSession';
import { useTaskDetail } from './useTaskDetail';
import { TaskStatusFeedback, TaskStatusMenu } from './TaskStatus';
import { matchesAgentPermissionReview, TaskAgentPermissionConfirmation, TaskAgentPermissionFeedback, TaskAgentPermissionSwitch, type AgentPermissionConfirmation } from './TaskAgentPermission';
import { matchesStatusReview, TaskStatusConfirmation, type StatusConfirmation } from './TaskStatusConfirmation';
import { TaskDetailReading } from './TaskDetailReading';
import { TaskPlatform, TaskPlatformBadge, TaskPlatformFeedback } from './TaskPlatform';
import { TaskId } from './TaskId';
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
  type TaskConfirmationState = StatusConfirmation | (AgentPermissionConfirmation & { readonly kind: 'allowAgents' });
  const [confirmation, setConfirmation] = useState<TaskConfirmationState | null>(null);
  const confirmationValid = confirmation !== null && (confirmation.kind === 'status'
    ? matchesStatusReview(confirmation, detail) && task.canSetStatus
    : matchesAgentPermissionReview(confirmation, detail) && task.canSetAgentPermission);
  const confirmationOpen = confirmation !== null && confirmationValid;
  useLayoutEffect(() => { if (confirmation !== null && !confirmationValid) setConfirmation(null); }, [confirmation, confirmationValid]);
  const headingId = useId();
  const automationFeedbackId = useId();
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
  const relation = (id: string, external: boolean) => {
    const node = snapshot.index.nodes.get(id);
    const title = node === undefined ? id : `${node.titlePreview}${node.titleTruncated ? '…' : ''}`;
    const kind = external ? m.externalDependency : m.ordinaryDependency;
    return (
      <li key={id}>
        <button className="task-detail-relation" type="button" aria-label={m.relationLabel({ title, kind })} onClick={() => onSelectTask(id)}>
          <span className={`task-detail-relation-dot${node === undefined ? '' : ` task-detail-dot-${node.status}`}`} aria-hidden="true" />
          <span>{title}</span>
          <span className={`task-detail-relation-kind${external ? ' task-detail-relation-external' : ''}`}>{kind}</span>
          <span className="task-detail-relation-arrow" aria-hidden="true">↗</span>
        </button>
      </li>
    );
  };

  return createPortal(
    <div className="task-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !confirmationOpen) onClose(); }}>
      <section className="task-detail-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="task-detail-header">
          <div className="task-detail-title-row">
            <h2 id={headingId} className="task-detail-title" ref={titleRef} tabIndex={detail === null ? -1 : 0} title={detail?.title}>{detail === null ? status === 'error' ? m.failed : m.loading : detail.title}</h2>
            {detail !== null && <TaskStatusMenu status={detail.status} disabled={!task.canSetStatus} onSelect={(status) => setConfirmation({ kind: 'status', status, detail })} />}
          </div>
          <button className="button task-detail-close" type="button" ref={closeRef} aria-label={m.close} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="task-detail-body">
          {status === 'loading' && (
            <div className="task-detail-state" role="status" aria-label={m.loading}><span className="spinner" aria-hidden="true" /></div>
          )}
          {status === 'error' && (
            <div className="task-detail-state task-detail-error" role="alert" aria-labelledby={headingId}>
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
          {detail === null && task.mutation.phase !== 'idle' && <div className="task-detail-status-feedback">
            <TaskStatusFeedback detail={null} mutation={task.mutation} onReconcile={task.reconcile} />
            <TaskPlatformFeedback mutation={task.mutation} onReconcile={task.reconcile} />
          </div>}
          {detail !== null && (
            <>
              <div className="task-detail-heading">
                <div className="task-detail-status-row">
                  <div className="task-detail-badges">
                    {detail.status === 'todo' && <span className={detail.ready ? 'task-detail-ready' : 'task-detail-blocked'}>{detail.ready ? m.ready : m.blocked}</span>}
                    <TaskPlatformBadge requiredPlatform={detail.requiredPlatform} />
                  </div>
                  <TaskAgentPermissionSwitch detail={detail} disabled={!task.canSetAgentPermission} describedBy={automationFeedbackId}
                    onClick={() => setConfirmation({ kind: 'allowAgents', detail, allowAgents: !detail.allowAgents })} />
                </div>
                <TaskStatusFeedback detail={detail} mutation={task.mutation} onReconcile={task.reconcile} />
                <TaskAgentPermissionFeedback key={`${projectId}/${taskId}`} id={automationFeedbackId} detail={detail} mutation={task.mutation} onReconcile={task.reconcile} />
                {retainedDetail && <p className="task-detail-retained" role="status">{m.retainedDetail}</p>}
                {stale && (
                  <div className="task-detail-stale" role="status">
                    <p>{task.mutation.phase === 'confirmed' && task.mutation.operation?.action === 'status' ? messages.inspection.status.confirmedSnapshot : m.stale}</p>
                    <button className="button" type="button" onClick={onRefreshGraph}>{m.refreshGraph}</button>
                  </div>
                )}
              </div>
              <TaskDetailReading key={`${projectId}/${taskId}`} projectId={projectId} taskId={taskId} description={detail.description} onClose={onClose} overview={(description) => <>
                <div className="task-detail-columns">
                  <div className="task-detail-main">
                    <section className="task-detail-section" aria-label={m.description}>
                      <h4>{m.description}</h4>
                      {description}
                    </section>
                    <TaskPlatform detail={detail} disabled={!task.canSetRequiredPlatform} mutation={task.mutation} onSave={task.setRequiredPlatform} onReconcile={task.reconcile} />
                    <TaskPullRequests pullRequests={detail.properties.pullRequests} />
                  </div>
                  <aside className="task-detail-aside" aria-label={m.relationsMetadata}>
                    <section className="task-detail-section" aria-label={m.dependencies}>
                      <h4>{m.countedHeading({ label: m.dependencies, count: format.number(detail.dependsOn.length) })}</h4>
                      {detail.dependsOn.length === 0 ? <p className="task-detail-description">{m.noDependencies}</p> : <ul className="task-detail-relations">{detail.dependsOn.map((id) => relation(id, detail.externalDependsOn.includes(id)))}</ul>}
                    </section>
                    <section className="task-detail-section" aria-label={m.blockers}>
                      <h4>{m.countedHeading({ label: m.blockers, count: format.number(detail.blockedBy.length) })}</h4>
                      {detail.blockedBy.length === 0 ? <p className="task-detail-description">{m.noBlockers}</p> : <ul className="task-detail-relations">{detail.blockedBy.map((id) => relation(id, detail.externalDependsOn.includes(id)))}</ul>}
                    </section>
                    <section className="task-detail-section" aria-label={m.successors}>
                      <h4>{successors === undefined ? m.successors : m.countedHeading({ label: m.successors, count: format.number(successors.length) })}</h4>
                      {successors === undefined
                        ? <p className="task-detail-description">{m.successorsMissing}</p>
                        : successors.length === 0 ? <p className="task-detail-description">{m.noSuccessors}</p> : <ul className="task-detail-relations">{successors.map((id) => relation(id, snapshot.index.nodes.get(id)!.externalDependsOn.includes(taskId)))}</ul>}
                    </section>
                    <dl className="task-detail-section task-detail-metadata">
                      <div><dt>{m.created}</dt><dd><time dateTime={detail.createdAt}>{format.dateTime(detail.createdAt)}</time></dd></div>
                      <div><dt>{m.updated}</dt><dd><time dateTime={detail.updatedAt}>{format.dateTime(detail.updatedAt)}</time></dd></div>
                      <div><dt>{m.taskId}</dt><dd className="task-detail-full-id"><TaskId key={`${projectId}/${taskId}`} value={detail.id} /></dd></div>
                    </dl>
                  </aside>
                </div></>} />
            </>
          )}
        </div>
        <footer className="task-detail-footer">{m.footer}</footer>
      </section>
      {confirmation !== null && confirmationValid && (confirmation.kind === 'status'
        ? <TaskStatusConfirmation confirmation={confirmation} owner={dialogRef} fallbackFocus={titleRef}
          onCancel={() => setConfirmation(null)} onConfirm={() => {
            setConfirmation(null);
            task.setStatus(confirmation.status, confirmation.detail.version);
          }} />
        : <TaskAgentPermissionConfirmation confirmation={confirmation} owner={dialogRef} fallbackFocus={titleRef}
          onCancel={() => setConfirmation(null)} onConfirm={() => {
            setConfirmation(null);
            task.setAgentPermission(confirmation.allowAgents, confirmation.detail.version);
          }} />)}
    </div>,
    document.body,
  );
};

export const TaskDetailDialog = (props: TaskDetailDialogProps) => <TaskDetailSessionBoundary><TaskDetailView {...props} /></TaskDetailSessionBoundary>;
