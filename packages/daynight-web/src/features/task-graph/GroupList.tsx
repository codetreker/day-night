import { memo, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n/LocaleProvider';
import type { GroupIndex } from './model';
import { TaskGraph } from './TaskGraph';
import '../../styles/graph.css';

type GroupListProps = {
  readonly index: GroupIndex;
  readonly groupIds: readonly string[];
  readonly allGroupIds: readonly string[];
  readonly expandedGroupId: string | null;
  readonly onExpand: (id: string | null) => void;
  readonly onOpenTask: (id: string, trigger: HTMLElement) => void;
  readonly showCompleted: boolean;
  readonly onShowCompletedChange: (show: boolean) => void;
};

type GroupRowProps = Pick<GroupListProps, 'index' | 'onExpand' | 'onOpenTask'> & {
  readonly groupId: string;
  readonly expanded: boolean;
};

const GroupRow = memo(({ index, groupId, expanded, onExpand, onOpenTask }: GroupRowProps) => {
  const { messages: { graph: m, common } } = useI18n();
  const task = index.nodes.get(groupId)!;
  const progress = index.groupProgress.get(groupId)!;
  return (
    <li className={`root-row${expanded ? ' expanded' : ''}`}>
      <button
        className="root-toggle"
        type="button"
        id={`task-root-${groupId}`}
        aria-expanded={expanded}
        aria-controls={`task-graph-${groupId}`}
        onClick={() => { onExpand(expanded ? null : groupId); }}
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
        <div id={`task-graph-${groupId}`} role="region" aria-label={m.rootRegion({ title: task.titlePreview })}>
          <TaskGraph index={index} groupId={groupId} onOpenTask={onOpenTask} />
        </div>
      )}
    </li>
  );
});

export const GroupList = ({ index, groupIds, allGroupIds, expandedGroupId, onExpand, onOpenTask, showCompleted, onShowCompletedChange }: GroupListProps) => {
  const { messages: { graph: m } } = useI18n();
  const checkbox = useRef<HTMLInputElement>(null);
  const completedCount = useMemo(() => allGroupIds.filter((id) => {
    const progress = index.groupProgress.get(id)!;
    return progress.status === 'done';
  }).length, [index, allGroupIds]);
  return (
  <section aria-label={m.chainList}>
    <div className="task-view-toolbar">
      {allGroupIds.length > 0 && <label className="completed-chain-control"><input ref={checkbox} type="checkbox" checked={showCompleted} onChange={(event) => { onShowCompletedChange(event.currentTarget.checked); }} />{m.showCompletedCount({ count: completedCount })}</label>}
      <span className="task-view-summary" aria-label={m.chainSummaryLabel({ shown: groupIds.length, total: allGroupIds.length })}>{m.chainSummary({ shown: groupIds.length, total: allGroupIds.length })}</span>
    </div>
    <p className="graph-note">{m.chainNote}</p>
    {allGroupIds.length === 0 ? (
      <div className="state-box"><h3>{m.emptyTitle}</h3><p>{m.emptyDescription}</p></div>
    ) : groupIds.length === 0 ? (
      <div className="state-box completed-chains-empty"><h3>{m.completedTitle}</h3><p>{m.completedDescription({ count: completedCount })}</p>
        <button className="button" type="button" onClick={() => { checkbox.current!.focus(); onShowCompletedChange(true); }}>{m.showCompleted}</button>
      </div>
    ) : <ul className="root-list">
      {groupIds.map((groupId) => (
        <GroupRow
          key={groupId}
          index={index}
          groupId={groupId}
          expanded={expandedGroupId === groupId}
          onExpand={onExpand}
          onOpenTask={onOpenTask}
        />
      ))}
    </ul>}
  </section>
  );
};
