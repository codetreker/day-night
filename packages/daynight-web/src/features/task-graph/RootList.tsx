import { memo, useMemo, useRef } from 'react';
import type { GraphIndex } from './model';
import { TaskGraph } from './TaskGraph';
import '../../styles/graph.css';

type RootListProps = {
  readonly index: GraphIndex;
  readonly rootIds: readonly string[];
  readonly expandedRootId: string | null;
  readonly onExpand: (id: string | null) => void;
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (id: string, trigger: HTMLElement) => void;
  readonly showCompleted: boolean;
  readonly onShowCompletedChange: (show: boolean) => void;
};

const labels = { todo: '待处理', in_progress: '进行中', done: '已完成' };

type RootRowProps = Pick<RootListProps, 'index' | 'onExpand' | 'selectedTaskId' | 'onSelectTask'> & {
  readonly rootId: string;
  readonly expanded: boolean;
};

const RootRow = memo(({ index, rootId, expanded, onExpand, selectedTaskId, onSelectTask }: RootRowProps) => {
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
          <span className="root-meta">{progress.total === 1 ? '独立任务' : `${progress.total} 个任务 · ${progress.total - progress.done} 个未完成`}</span>
        </span>
        <span className="root-progress">
          <span className="root-progress-label">{progress.done}/{progress.total} 已完成</span>
          <span className="root-progress-track" aria-hidden="true"><i style={{ width: `${progress.done / progress.total * 100}%` }} /></span>
        </span>
        <span className={`root-status graph-status-${progress.status}`}>{labels[progress.status]}</span>
      </button>
      {expanded && (
        <div id={`task-graph-${rootId}`} role="region" aria-label={`${task.titlePreview} 的任务依赖图`}>
          <TaskGraph index={index} rootId={rootId} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
        </div>
      )}
    </li>
  );
});

export const RootList = ({ index, rootIds, expandedRootId, onExpand, selectedTaskId, onSelectTask, showCompleted, onShowCompletedChange }: RootListProps) => {
  const checkbox = useRef<HTMLInputElement>(null);
  const completedCount = useMemo(() => index.roots.filter((id) => {
    const progress = index.rootProgress.get(id)!;
    return progress.status === 'done';
  }).length, [index]);
  return (
  <section aria-labelledby="task-roots-heading">
    <div className="graph-section-heading">
      <h2 id="task-roots-heading">任务链 <span className="graph-count-pill" aria-label={`显示 ${rootIds.length} 条，共 ${index.roots.length} 条任务链`}>{rootIds.length} / {index.roots.length}</span></h2>
      <div className="graph-legend" aria-label="任务链状态图例">
        <span className="graph-status graph-status-todo"><i aria-hidden="true" />待处理</span>
        <span className="graph-status graph-status-in_progress"><i aria-hidden="true" />进行中</span>
        <span className="graph-status graph-status-done"><i aria-hidden="true" />已完成</span>
      </div>
    </div>
    <label className="completed-chain-control"><input ref={checkbox} type="checkbox" checked={showCompleted} onChange={(event) => { onShowCompletedChange(event.currentTarget.checked); }} />显示已完成任务链（{completedCount}）</label>
    <p className="graph-note">按根任务创建时间倒序排列，从没有前置依赖的任务开始展开。共享任务可能出现在多条任务链中，各链进度不能相加作为项目总数。</p>
    {rootIds.length === 0 ? (
      <div className="state-box completed-chains-empty"><h3>所有任务链已完成</h3><p>已隐藏 {completedCount} 条已完成任务链，项目统计仍包含全部任务。</p>
        <button className="button" type="button" onClick={() => { checkbox.current!.focus(); onShowCompletedChange(true); }}>显示已完成任务链</button>
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
