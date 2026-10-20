import type { GraphIndex } from './model';
import { TaskGraph } from './TaskGraph';
import '../../styles/graph.css';

type RootListProps = {
  index: GraphIndex;
  expandedRootId: string | null;
  onExpand: (id: string | null) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string, trigger: HTMLElement) => void;
};

const labels = { todo: '待处理', in_progress: '进行中', done: '已完成' };

export const RootList = ({ index, expandedRootId, onExpand, selectedTaskId, onSelectTask }: RootListProps) => (
  <section aria-labelledby="task-roots-heading">
    <div className="graph-section-heading">
      <h2 id="task-roots-heading">任务链 <span className="graph-count-pill">{index.roots.length}</span></h2>
      <div className="graph-legend" aria-label="任务状态图例">
        <span className="graph-status graph-status-todo"><i aria-hidden="true" />待处理</span>
        <span className="graph-status graph-status-in_progress"><i aria-hidden="true" />进行中</span>
        <span className="graph-status graph-status-done"><i aria-hidden="true" />已完成</span>
      </div>
    </div>
    <p className="graph-note">从没有前置依赖的任务开始展开。共享任务可能出现在多条任务链中，各链进度不能相加作为项目总数。</p>
    <ul className="root-list">
      {index.roots.map((rootId) => {
        const task = index.nodes.get(rootId)!;
        const progress = index.rootProgress.get(rootId)!;
        const expanded = expandedRootId === rootId;
        return (
          <li className={`root-row${expanded ? ' expanded' : ''}`} key={rootId}>
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
              <span className={`root-status graph-status-${task.status}`}>{labels[task.status]}</span>
            </button>
            {expanded && (
              <div id={`task-graph-${rootId}`} role="region" aria-label={`${task.titlePreview} 的任务依赖图`}>
                <TaskGraph index={index} rootId={rootId} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  </section>
);
