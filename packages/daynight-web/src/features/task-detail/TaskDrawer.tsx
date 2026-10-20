import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api/client';
import type { TaskStatus } from '../../api/types';
import type { GraphSnapshot } from '../projects/useTaskGraph';
import { isTaskStale } from './freshness';
import { useTaskDetail } from './useTaskDetail';
import '../../styles/drawer.css';

export type TaskDrawerProps = {
  readonly projectId: string;
  readonly taskId: string;
  readonly snapshot: GraphSnapshot;
  readonly onSelectTask: (id: string) => void;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
  readonly onRefreshGraph: () => void;
};

const statusLabels: Record<TaskStatus, string> = {
  todo: '待处理', in_progress: '进行中', done: '已完成',
};

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const StatusBadge = ({ status }: { readonly status: TaskStatus }) => (
  <span className={`drawer-status drawer-status-${status}`}>{statusLabels[status]}</span>
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

export const TaskDrawer = ({ projectId, taskId, snapshot, onSelectTask, onClose, onRestoreFocus, onRefreshGraph }: TaskDrawerProps) => {
  const { detail, status, error, retry } = useTaskDetail(projectId, taskId, snapshot.revision);
  const headingId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onClose, onRestoreFocus });
  callbacks.current = { onClose, onRestoreFocus };

  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (root === null) throw new Error('The application root is required for the task drawer.');
    const wasInert = root.hasAttribute('inert');
    const previousOverflow = document.body.style.overflow;
    root.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    closeRef.current!.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacks.current.onClose();
      } else if (event.key === 'Tab') {
        const dialog = dialogRef.current!;
        const buttons = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
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
      document.body.style.overflow = previousOverflow;
      callbacks.current.onRestoreFocus();
    };
  }, [projectId]);

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
        <button className="drawer-relation" type="button" onClick={() => onSelectTask(id)}>
          <span className={`drawer-relation-dot${node === undefined ? '' : ` drawer-dot-${node.status}`}`} aria-hidden="true" />
          <span>{node === undefined ? id : `${node.titlePreview}${node.titleTruncated ? '…' : ''}`}</span>
          <span className="drawer-relation-arrow" aria-hidden="true">↗</span>
        </button>
      </li>
    );
  };

  return createPortal(
    <div className="drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drawer" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="drawer-header">
          <h2 id={headingId}>任务详情</h2>
          <button className="button drawer-close" type="button" ref={closeRef} aria-label="关闭任务详情" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="drawer-body">
          {status === 'loading' && (
            <div className="drawer-state" role="status"><span className="spinner" aria-hidden="true" /><p>正在加载任务详情</p></div>
          )}
          {status === 'error' && (
            <div className="drawer-state drawer-error" role="alert">
              <h3>任务详情加载失败</h3>
              <DetailError error={error} />
              <button className="button primary" type="button" onClick={retry}>重试详情</button>
            </div>
          )}
          {detail !== null && (
            <>
              <p className="drawer-id">{detail.id}</p>
              <h3 className="drawer-title">{detail.title}</h3>
              <div className="drawer-badges">
                <StatusBadge status={detail.status} />
                {detail.status === 'todo' && <span className={detail.ready ? 'drawer-ready' : 'drawer-blocked'}>{detail.ready ? '可开始' : '被阻塞'}</span>}
              </div>
              {stale && (
                <div className="drawer-stale" role="status">
                  <p>任务详情与当前任务图不同，刷新后可查看一致的进度和关系。</p>
                  <button className="button" type="button" onClick={onRefreshGraph}>刷新任务图</button>
                </div>
              )}
              <section className="drawer-section" aria-label="描述">
                <h4>描述</h4>
                <p className="drawer-description">{detail.description === '' ? '暂无描述' : detail.description}</p>
              </section>
              <section className="drawer-section" aria-label="前置依赖">
                <h4>前置依赖 · {detail.dependsOn.length}</h4>
                {detail.dependsOn.length === 0 ? <p className="drawer-description">无前置依赖</p> : <ul className="drawer-relations">{detail.dependsOn.map(relation)}</ul>}
              </section>
              <section className="drawer-section" aria-label="当前未完成的前置">
                <h4>当前未完成的前置 · {detail.blockedBy.length}</h4>
                {detail.blockedBy.length === 0 ? <p className="drawer-description">所有前置已完成</p> : <ul className="drawer-relations">{detail.blockedBy.map(relation)}</ul>}
              </section>
              <section className="drawer-section" aria-label="任务图快照中的直接后续">
                <h4>任务图快照中的直接后续{successors === undefined ? '' : ` · ${successors.length}`}</h4>
                {successors === undefined
                  ? <p className="drawer-description">当前任务尚未包含在任务图中，请刷新任务图以查看后续关系。</p>
                  : successors.length === 0 ? <p className="drawer-description">无后续任务</p> : <ul className="drawer-relations">{successors.map(relation)}</ul>}
              </section>
              <dl className="drawer-section drawer-metadata">
                <div><dt>创建时间</dt><dd><time dateTime={detail.createdAt}>{new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></dd></div>
                <div><dt>更新时间</dt><dd><time dateTime={detail.updatedAt}>{new Date(detail.updatedAt).toLocaleString('zh-CN', { hour12: false })}</time></dd></div>
                <div><dt>任务 ID</dt><dd className="drawer-full-id">{detail.id}</dd></div>
              </dl>
            </>
          )}
        </div>
        <footer className="drawer-footer">前置与阻塞项来自最新详情，名称与后续关系来自任务图快照。</footer>
      </section>
    </div>,
    document.body,
  );
};
