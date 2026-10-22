import { memo, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n/LocaleProvider';
import type { GraphIndex } from './model';
import { TaskGraph } from './TaskGraph';
import '../../styles/graph.css';

type RootListProps = {
  readonly index: GraphIndex;
  readonly rootIds: readonly string[];
  readonly allRootIds: readonly string[];
  readonly expandedRootId: string | null;
  readonly onExpand: (id: string | null) => void;
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (id: string, trigger: HTMLElement) => void;
  readonly showCompleted: boolean;
  readonly onShowCompletedChange: (show: boolean) => void;
};

type RootRowProps = Pick<RootListProps, 'index' | 'onExpand' | 'selectedTaskId' | 'onSelectTask'> & {
  readonly rootId: string;
  readonly expanded: boolean;
};

const RootRow = memo(({ index, rootId, expanded, onExpand, selectedTaskId, onSelectTask }: RootRowProps) => {
  const { messages: { graph: m, common } } = useI18n();
  const task = index.nodes.get(rootId)!;
  const progress = index.rootProgress.get(rootId)!;
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
          <TaskGraph index={index} rootId={rootId} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
        </div>
      )}
    </li>
  );
});

export const RootList = ({ index, rootIds, allRootIds, expandedRootId, onExpand, selectedTaskId, onSelectTask, showCompleted, onShowCompletedChange }: RootListProps) => {
  const { messages: { graph: m } } = useI18n();
  const checkbox = useRef<HTMLInputElement>(null);
  const completedCount = useMemo(() => allRootIds.filter((id) => {
    const progress = index.rootProgress.get(id)!;
    return progress.status === 'done';
  }).length, [index, allRootIds]);
  return (
  <section aria-label={m.chainList}>
    <div className="task-view-toolbar">
      {allRootIds.length > 0 && <label className="completed-chain-control"><input ref={checkbox} type="checkbox" checked={showCompleted} onChange={(event) => { onShowCompletedChange(event.currentTarget.checked); }} />{m.showCompletedCount({ count: completedCount })}</label>}
      <span className="task-view-summary" aria-label={m.chainSummaryLabel({ shown: rootIds.length, total: allRootIds.length })}>{m.chainSummary({ shown: rootIds.length, total: allRootIds.length })}</span>
    </div>
    <p className="graph-note">{m.chainNote}</p>
    {allRootIds.length === 0 ? (
      <div className="state-box"><h3>{m.emptyTitle}</h3><p>{m.emptyDescription}</p></div>
    ) : rootIds.length === 0 ? (
      <div className="state-box completed-chains-empty"><h3>{m.completedTitle}</h3><p>{m.completedDescription({ count: completedCount })}</p>
        <button className="button" type="button" onClick={() => { checkbox.current!.focus(); onShowCompletedChange(true); }}>{m.showCompleted}</button>
      </div>
    ) : <ul className="root-list">
      {rootIds.map((rootId) => (
        <RootRow
          key={rootId}
          index={index}
          rootId={rootId}
          expanded={expandedRootId === rootId}
          onExpand={onExpand}
          selectedTaskId={expandedRootId === rootId ? selectedTaskId : null}
          onSelectTask={onSelectTask}
        />
      ))}
    </ul>}
  </section>
  );
};
