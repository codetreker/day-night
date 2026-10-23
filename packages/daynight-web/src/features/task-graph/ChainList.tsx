import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n/LocaleProvider';
import type { GraphIndex } from './model';
import { TaskGraph } from './TaskGraph';
import '../../styles/graph.css';

type ChainListProps = {
  readonly index: GraphIndex;
  readonly representativeIds: readonly string[];
  readonly allRepresentativeIds: readonly string[];
  readonly expandedRootId: string | null;
  readonly onExpand: (id: string | null) => void;
  readonly onOpenTask: (id: string, trigger: HTMLElement) => void;
  readonly showCompleted: boolean;
  readonly onShowCompletedChange: (show: boolean) => void;
};

type ChainRowProps = Pick<ChainListProps, 'index' | 'onExpand' | 'onOpenTask'> & {
  readonly rootId: string;
  readonly expanded: boolean;
};

const ChainRow = memo(({ index, rootId, expanded, onExpand, onOpenTask }: ChainRowProps) => {
  const { messages: { graph: m, common } } = useI18n();
  const task = index.nodes.get(rootId)!;
  const progress = index.components.get(rootId)!.progress;
  return (
    <li className={`root-row${expanded ? ' expanded' : ''}`}>
      <button
        className="root-toggle"
        type="button"
        id={`task-root-${rootId}`}
        aria-expanded={expanded}
        aria-controls={`task-graph-${rootId}`}
        onClick={() => { onExpand(expanded ? null : rootId); }}
      >
        <svg className="root-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        <span className="root-heading">
          <span className="root-title">{task.titlePreview}{task.titleTruncated ? '…' : ''}</span>
          <span className="root-meta">{progress.total === 1 ? m.standaloneTask : m.rootSummary({ total: progress.total, remaining: progress.total - progress.done })}</span>
        </span>
        <span className="root-progress">
          <span className="root-progress-label">{m.progress({ done: progress.done, total: progress.total })}</span>
          <span className="root-progress-track" aria-hidden="true"><i style={{ width: `${progress.done / progress.total * 100}%` }} /></span>
        </span>
        <span className={`root-status graph-status-${progress.status}`}>{common.status[progress.status]}</span>
      </button>
      {expanded && (
        <div id={`task-graph-${rootId}`} role="region" aria-label={m.rootRegion({ title: task.titlePreview })}>
          <TaskGraph index={index} rootId={rootId} onOpenTask={onOpenTask} />
        </div>
      )}
    </li>
  );
});

export const ChainList = ({ index, representativeIds, allRepresentativeIds, expandedRootId, onExpand, onOpenTask, showCompleted, onShowCompletedChange }: ChainListProps) => {
  const { messages: { graph: m } } = useI18n();
  const checkbox = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLElement>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (focusedControl.current === null || focusedControl.current.isConnected || document.activeElement !== document.body) return;
    const representative = expandedRootId ?? representativeIds[0];
    const heading = representative === undefined ? null : container.current!.querySelector<HTMLButtonElement>(`#task-root-${representative}`);
    (heading ?? checkbox.current ?? container.current)!.focus({ preventScroll: true });
  }, [index, expandedRootId, representativeIds]);
  const completedCount = useMemo(() => allRepresentativeIds.filter((id) => {
    const progress = index.components.get(id)!.progress;
    return progress.status === 'done';
  }).length, [index, allRepresentativeIds]);
  return (
  <section aria-label={m.chainList} ref={container} tabIndex={-1} onFocusCapture={(event) => {
    if (event.currentTarget.contains(event.target)) focusedControl.current = event.target;
  }}>
    <div className="task-view-toolbar">
      {allRepresentativeIds.length > 0 && <label className="completed-chain-control"><input ref={checkbox} type="checkbox" checked={showCompleted} onChange={(event) => { onShowCompletedChange(event.currentTarget.checked); }} />{m.showCompletedCount({ count: completedCount })}</label>}
      <span className="task-view-summary" aria-label={m.chainSummaryLabel({ shown: representativeIds.length, total: allRepresentativeIds.length })}>{m.chainSummary({ shown: representativeIds.length, total: allRepresentativeIds.length })}</span>
    </div>
    <p className="graph-note">{m.chainNote}</p>
    {allRepresentativeIds.length === 0 ? (
      <div className="state-box"><h3>{m.emptyTitle}</h3><p>{m.emptyDescription}</p></div>
    ) : representativeIds.length === 0 ? (
      <div className="state-box completed-chains-empty"><h3>{m.completedTitle}</h3><p>{m.completedDescription({ count: completedCount })}</p>
        <button className="button" type="button" onClick={() => { checkbox.current!.focus(); onShowCompletedChange(true); }}>{m.showCompleted}</button>
      </div>
    ) : <ul className="root-list">
      {representativeIds.map((rootId) => (
        <ChainRow
          key={rootId}
          index={index}
          rootId={rootId}
          expanded={expandedRootId === rootId}
          onExpand={onExpand}
          onOpenTask={onOpenTask}
        />
      ))}
    </ul>}
  </section>
  );
};
