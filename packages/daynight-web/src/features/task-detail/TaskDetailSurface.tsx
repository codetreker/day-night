import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { taskDetailUrl, type TaskDetailNavigation } from '../../app/router';
import { LanguageSelector } from '../../i18n/LanguageSelector';
import type { AttachmentApi } from './attachments/useAttachments';
import type { AttachmentUrls } from './attachments/TaskAttachments';
import { useI18n } from '../../i18n/LocaleProvider';
import { useBodyScrollLock } from '../../app/useBodyScrollLock';
import type { TaskStatus } from '../../api/types';
import type { GraphSnapshot } from '../projects/useTaskGraph';
import { isTaskStale } from './freshness';
import { dialogFocusables } from './focus';
import { approvalAction } from './TaskDetailSession';
import { useTaskDetail } from './useTaskDetail';
import { TaskApproval } from './TaskApproval';
import { matchesAgentPermissionReview, TaskAgentPermissionConfirmation, TaskAgentPermissionFeedback, TaskAgentPermissionSwitch, type AgentPermissionConfirmation } from './TaskAgentPermission';
import { matchesApprovalReview, TaskApprovalConfirmation, type ApprovalConfirmation } from './TaskApprovalConfirmation';
import { TaskDetailReading } from './TaskDetailReading';
import { TaskPlatform, TaskPlatformBadge, TaskPlatformFeedback } from './TaskPlatform';
import { TaskId } from './TaskId';
import { TaskPullRequests } from './TaskPullRequests';
import '../../styles/task-detail.css';

type TaskDetailCommonProps = {
  readonly attachmentApi?: AttachmentApi;
  readonly attachmentUrls?: AttachmentUrls;
  readonly detailUrl?: (taskId: string, navigation: TaskDetailNavigation) => string;
  readonly projectId: string;
  readonly taskId: string;
  readonly snapshot: GraphSnapshot;
  readonly onSelectTask: (id: string) => void;
  readonly onRefreshGraph: () => void;
};
export type TaskDetailSurfaceProps = TaskDetailCommonProps & ({
  readonly presentation: 'dialog';
  readonly navigation?: TaskDetailNavigation;
  readonly onNavigate?: (navigation: TaskDetailNavigation) => void;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
} | {
  readonly presentation: 'page';
  readonly navigation: TaskDetailNavigation;
  readonly onNavigate: (navigation: TaskDetailNavigation) => void;
  readonly onClose?: never;
  readonly onRestoreFocus?: never;
});

export const TaskDetailPageBar = ({ projectId }: { readonly projectId: string }) => {
  const { messages } = useI18n();
  return <div className="task-detail-page-topbar"><a className="task-detail-page-back" href={`/projects/${encodeURIComponent(projectId)}`}>{messages.inspection.detail.returnToProject}</a><LanguageSelector /></div>;
};

const StatusBadge = ({ status }: { readonly status: TaskStatus }) => {
  const { messages } = useI18n();
  return <span className={`task-detail-status task-detail-status-${status}`}>{messages.common.status[status]}</span>;
};

const TaskDetailError = ({ error }: { readonly error: unknown }) => {
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

export const TaskDetailSurface = ({ projectId, taskId, snapshot, onSelectTask, onClose, onRestoreFocus, onRefreshGraph, presentation, navigation, onNavigate, attachmentApi, attachmentUrls, detailUrl }: TaskDetailSurfaceProps) => {
  const modal = presentation === 'dialog';
  const scope = `${projectId}/${taskId}`;
  const [localNavigation, setLocalNavigation] = useState<{ readonly scope: string; readonly value: TaskDetailNavigation }>({ scope, value: { tab: 'overview', path: null } });
  const selection = navigation === undefined ? localNavigation.scope === scope ? localNavigation.value : { tab: 'overview', path: null } as const : navigation;
  const changeSelection = (next: TaskDetailNavigation) => { setLocalNavigation({ scope, value: next }); onNavigate?.(next); };
  const popout = detailUrl === undefined ? taskDetailUrl(projectId, taskId, selection) : detailUrl(taskId, selection);
  const Surface = modal ? 'section' : 'main';
  const { messages, format } = useI18n();
  const m = messages.inspection.detail;
  const task = useTaskDetail(projectId, taskId, snapshot.revision, snapshot.index.nodes.get(taskId));
  const { detail, status, error, retry } = task;
  const [confirmation, setConfirmation] = useState<ApprovalConfirmation | null>(null);
  const [permissionConfirmation, setPermissionConfirmation] = useState<AgentPermissionConfirmation | null>(null);
  const action = approvalAction(detail);
  const canAct = action === 'approve' ? task.canApprove : action === 'unapprove' ? task.canUnapprove : false;
  const confirmationValid = confirmation !== null && matchesApprovalReview(confirmation, detail) &&
    confirmation.action === action && canAct;
  const permissionConfirmationValid = permissionConfirmation !== null && matchesAgentPermissionReview(permissionConfirmation, detail) && task.canSetAgentPermission;
  const confirmationOpen = confirmation !== null && confirmationValid || permissionConfirmation !== null && permissionConfirmationValid;
  useLayoutEffect(() => { if (confirmation !== null && !confirmationValid) setConfirmation(null); }, [confirmation, confirmationValid]);
  useLayoutEffect(() => { if (permissionConfirmation !== null && !permissionConfirmationValid) setPermissionConfirmation(null); }, [permissionConfirmation, permissionConfirmationValid]);
  const headingId = useId();
  const automationFeedbackId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef({ onClose, onRestoreFocus, confirmationOpen });
  callbacks.current = { onClose, onRestoreFocus, confirmationOpen };
  useBodyScrollLock(modal);

  useLayoutEffect(() => {
    if (!modal) { dialogRef.current!.focus(); return; }
    const root = document.getElementById('root');
    if (root === null) throw new Error('The application root is required for the task detail dialog.');
    const wasInert = root.hasAttribute('inert');
    root.setAttribute('inert', '');
    closeRef.current!.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (callbacks.current.confirmationOpen || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacks.current.onClose!();
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
  }, [projectId, modal]);

  useEffect(() => () => {
    // Restore after sibling DOM removals so a disappearing trigger cannot capture focus.
    if (modal) callbacks.current.onRestoreFocus!();
  }, []);

  useLayoutEffect(() => {
    if (modal && !confirmationOpen && !dialogRef.current!.contains(document.activeElement)) closeRef.current!.focus();
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

  const content = <>
      <Surface className={modal ? 'task-detail-dialog' : 'task-detail-page'} ref={dialogRef} role={modal ? 'dialog' : undefined} aria-modal={modal ? true : undefined} aria-labelledby={headingId} tabIndex={modal ? undefined : -1}>
        {!modal && <TaskDetailPageBar projectId={projectId} />}
        <header className="task-detail-header">
          <div className="task-detail-title-row">
            <h2 id={headingId} className="task-detail-title" ref={titleRef} tabIndex={detail === null ? -1 : 0} title={detail?.title}>{detail === null ? status === 'error' ? m.failed : m.loading : detail.title}</h2>
            {detail !== null && action !== null && <button className={`button task-detail-title-action${action === 'approve' ? ' primary' : ''}`} type="button" disabled={!canAct} onClick={() => setConfirmation({ action, detail })}>{task.mutation.phase === 'pending' && (task.mutation.operation?.action === 'approve' || task.mutation.operation?.action === 'unapprove') ? messages.inspection.approval.submitting : action === 'approve' ? messages.inspection.approval.approve : messages.inspection.approval.unapprove}</button>}
          </div>
          <div className="task-detail-header-actions">
            {modal && <a className="button task-detail-popout" href={popout} target="_blank" rel="noopener noreferrer" aria-label={m.openInNewTab} title={m.openInNewTab}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" /></svg>{m.openInNewTab}</a>}
            {modal ? <button className="button task-detail-close" type="button" ref={closeRef} aria-label={m.close} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button> : null}
          </div>
        </header>
        <div className="task-detail-body">
          {status === 'loading' && (
            <div className="task-detail-state" role="status" aria-label={m.loading}><span className="spinner" aria-hidden="true" /></div>
          )}
          {status === 'error' && (
            <div className="task-detail-state task-detail-error" role="alert" aria-labelledby={headingId}>
              <TaskDetailError error={error} />
              <button className="button primary" type="button" onClick={retry}>{m.retry}</button>
            </div>
          )}
          {detail !== null && error !== null && (
            <div className="task-detail-read-error" role="alert" tabIndex={0}>
              <h3>{m.refreshFailed}</h3>
              <TaskDetailError error={error} />
              <p>{m.retainedData}</p>
              <button className="button" type="button" onClick={retry}>{m.retry}</button>
            </div>
          )}
          {detail === null && task.mutation.phase !== 'idle' && <div className="task-detail-approval">
            <TaskApproval detail={null} approval={task.mutation} onReconcile={task.reconcile} />
            <TaskPlatformFeedback mutation={task.mutation} onReconcile={task.reconcile} />
          </div>}
          {detail !== null && (
            <>
              <div className="task-detail-heading">
                <div className="task-detail-status-row">
                  <div className="task-detail-badges">
                    <StatusBadge status={detail.status} />
                    {detail.status === 'todo' && <span className={detail.ready ? 'task-detail-ready' : 'task-detail-blocked'}>{detail.ready ? m.ready : m.blocked}</span>}
                    <TaskPlatformBadge requiredPlatform={detail.requiredPlatform} />
                  </div>
                  <TaskAgentPermissionSwitch detail={detail} disabled={!task.canSetAgentPermission} describedBy={automationFeedbackId}
                    onClick={() => setPermissionConfirmation({ detail, allowAgents: !detail.allowAgents })} />
                </div>
                <TaskAgentPermissionFeedback key={`${projectId}/${taskId}`} id={automationFeedbackId} detail={detail} mutation={task.mutation} onReconcile={task.reconcile} />
                {retainedDetail && <p className="task-detail-retained" role="status">{m.retainedDetail}</p>}
                {stale && (
                  <div className="task-detail-stale" role="status">
                    <p>{task.mutation.phase === 'confirmed' && (task.mutation.operation?.action === 'approve' || task.mutation.operation?.action === 'unapprove') ? messages.inspection.approval.confirmedSnapshot : m.stale}</p>
                    <button className="button" type="button" onClick={onRefreshGraph}>{m.refreshGraph}</button>
                  </div>
                )}
              </div>
              <TaskDetailReading key={`${projectId}/${taskId}`} projectId={projectId} taskId={taskId} description={detail.description} selection={selection} onSelectionChange={changeSelection} requireCompleteInventory={!modal} {...(onClose === undefined ? {} : { onClose })} {...(attachmentApi === undefined ? {} : { api: attachmentApi })} {...(attachmentUrls === undefined ? {} : { urls: attachmentUrls })} overview={(description) => <>
                <div className="task-detail-approval"><TaskApproval detail={detail} approval={task.mutation} onReconcile={task.reconcile} /></div>
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
      </Surface>
      {confirmation !== null && confirmationValid && <TaskApprovalConfirmation confirmation={confirmation} owner={dialogRef} fallbackFocus={titleRef}
        onCancel={() => setConfirmation(null)} onConfirm={() => {
          if (!confirmationValid) return;
          setConfirmation(null);
          task.performApproval(confirmation.action, confirmation.detail.version);
        }} />}
      {permissionConfirmation !== null && permissionConfirmationValid && <TaskAgentPermissionConfirmation confirmation={permissionConfirmation} owner={dialogRef} fallbackFocus={titleRef}
        onCancel={() => setPermissionConfirmation(null)} onConfirm={() => {
          if (!permissionConfirmationValid) return;
          setPermissionConfirmation(null);
          task.setAgentPermission(permissionConfirmation.allowAgents, permissionConfirmation.detail.version);
        }} />}
    </>;
  return modal ? <div className="task-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !confirmationOpen) onClose!(); }}>{content}</div> : content;
};
