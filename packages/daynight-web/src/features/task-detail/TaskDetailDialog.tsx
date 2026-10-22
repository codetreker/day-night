import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api/client';
import { useBodyScrollLock } from '../../app/useBodyScrollLock';
import type { TaskStatus } from '../../api/types';
import type { GraphSnapshot } from '../projects/useTaskGraph';
import { isTaskStale } from './freshness';
import { dialogFocusables } from './focus';
import { useTaskDetail } from './useTaskDetail';
import { TaskPullRequests } from './TaskPullRequests';
import { TaskAttachments } from './attachments/TaskAttachments';
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

const statusLabels: Record<TaskStatus, string> = {
  proposed: '待审批', todo: '待处理', in_progress: '进行中', done: '已完成',
};

const StatusBadge = ({ status }: { readonly status: TaskStatus }) => (
  <span className={`task-detail-status task-detail-status-${status}`}>{statusLabels[status]}</span>
);

const DetailError = ({ error }: { readonly error: unknown }) => (
  <>
    <p>{error instanceof ApiError && error.kind === 'network'
      ? '无法连接服务，请检查本地服务后重试。'
      : error instanceof ApiError && error.code === 'not_found'
        ? '这个任务已无法读取，请刷新任务图。'
        : '暂时无法读取任务详情，请重试。'}</p>
    {error instanceof ApiError && error.requestId !== null && (
      <p className="request-id">请求 ID：<code>{error.requestId}</code></p>
    )}
  </>
);

export const TaskDetailDialog = ({ projectId, taskId, snapshot, onSelectTask, onClose, onRestoreFocus, onRefreshGraph }: TaskDetailDialogProps) => {
  const { detail, status, error, retry } = useTaskDetail(projectId, taskId, snapshot.revision);
  const headingId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onClose, onRestoreFocus });
  callbacks.current = { onClose, onRestoreFocus };
  useBodyScrollLock(true);

  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (root === null) throw new Error('The application root is required for the task detail dialog.');
    const wasInert = root.hasAttribute('inert');
    root.setAttribute('inert', '');
    closeRef.current!.focus();

    const onKeyDown = (event: KeyboardEvent) => {
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
    if (!dialogRef.current!.contains(document.activeElement)) closeRef.current!.focus();
  }, [taskId, status, snapshot.revision]);

  const snapshotNode = snapshot.index.nodes.get(taskId);
  const stale = detail !== null && isTaskStale(snapshotNode, detail);
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
    <div className="task-detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="task-detail-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="task-detail-header">
          <h2 id={headingId}>任务详情</h2>
          <button className="button task-detail-close" type="button" ref={closeRef} aria-label="关闭任务详情" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="task-detail-body">
          {status === 'loading' && (
            <div className="task-detail-state" role="status"><span className="spinner" aria-hidden="true" /><p>正在加载任务详情</p></div>
          )}
          {status === 'error' && (
            <div className="task-detail-state task-detail-error" role="alert">
              <h3>任务详情加载失败</h3>
              <DetailError error={error} />
              <button className="button primary" type="button" onClick={retry}>重试详情</button>
            </div>
          )}
          {detail !== null && (
            <>
              <div className="task-detail-heading">
                <p className="task-detail-id">{detail.id}</p>
                <h3 className="task-detail-title">{detail.title}</h3>
                <div className="task-detail-badges">
                  <StatusBadge status={detail.status} />
                  {detail.status === 'todo' && <span className={detail.ready ? 'task-detail-ready' : 'task-detail-blocked'}>{detail.ready ? '可开始' : '被阻塞'}</span>}
                </div>
                {stale && (
                  <div className="task-detail-stale" role="status">
                    <p>任务详情与当前任务图不同，刷新后可查看一致的进度和关系。</p>
                    <button className="button" type="button" onClick={onRefreshGraph}>刷新任务图</button>
                  </div>
                )}
              </div>
              <div className="task-detail-columns">
                <div className="task-detail-main">
                  <section className="task-detail-section" aria-label="描述">
                    <h4>描述</h4>
                    <p className="task-detail-description">{detail.description === '' ? '暂无描述' : detail.description}</p>
                  </section>
                  <TaskPullRequests pullRequests={detail.properties.pullRequests} />
                  <TaskAttachments projectId={projectId} taskId={taskId} onClose={onClose} />
                </div>
                <aside className="task-detail-aside" aria-label="任务关系与元数据">
                  <section className="task-detail-section" aria-label="前置依赖">
                    <h4>前置依赖 · {detail.dependsOn.length}</h4>
                    {detail.dependsOn.length === 0 ? <p className="task-detail-description">无前置依赖</p> : <ul className="task-detail-relations">{detail.dependsOn.map(relation)}</ul>}
                  </section>
                  <section className="task-detail-section" aria-label="当前未完成的前置">
                    <h4>当前未完成的前置 · {detail.blockedBy.length}</h4>
                    {detail.blockedBy.length === 0 ? <p className="task-detail-description">所有前置已完成</p> : <ul className="task-detail-relations">{detail.blockedBy.map(relation)}</ul>}
                  </section>
                  <section className="task-detail-section" aria-label="任务图快照中的直接后续">
                    <h4>任务图快照中的直接后续{successors === undefined ? '' : ` · ${successors.length}`}</h4>
                    {successors === undefined
                      ? <p className="task-detail-description">当前任务尚未包含在任务图中，请刷新任务图以查看后续关系。</p>
                      : successors.length === 0 ? <p className="task-detail-description">无后续任务</p> : <ul className="task-detail-relations">{successors.map(relation)}</ul>}
                  </section>
                  <dl className="task-detail-section task-detail-metadata">
                    <div><dt>创建时间</dt><dd><time dateTime={detail.createdAt}>{new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></dd></div>
                    <div><dt>更新时间</dt><dd><time dateTime={detail.updatedAt}>{new Date(detail.updatedAt).toLocaleString('zh-CN', { hour12: false })}</time></dd></div>
                    <div><dt>任务 ID</dt><dd className="task-detail-full-id">{detail.id}</dd></div>
                  </dl>
                </aside>
              </div>
            </>
          )}
        </div>
        <footer className="task-detail-footer">前置与阻塞项来自最新详情，名称与后续关系来自任务图快照。</footer>
      </section>
    </div>,
    document.body,
  );
};
