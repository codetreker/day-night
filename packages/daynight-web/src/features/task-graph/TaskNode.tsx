import { memo } from 'react';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { GraphTask } from '../../api/types';
import type { CanvasPoint } from './layout';

export type TaskNodeData = {
  task: GraphTask;
  kind: 'main' | 'boundary';
  shared: boolean;
  selected: boolean;
  center: CanvasPoint;
  onSelectTask: (id: string, trigger: HTMLElement) => void;
};

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

export const TASK_HANDLE_SIZE = 6;
const handleStyle = { width: TASK_HANDLE_SIZE, height: TASK_HANDLE_SIZE };
const labels = { todo: '待处理', in_progress: '进行中', done: '已完成' };

export const TaskNode = memo(({ data }: NodeProps<TaskFlowNode>) => {
  const { setCenter, getViewport } = useReactFlow();
  const title = `${data.task.titlePreview}${data.task.titleTruncated ? '…' : ''}`;
  return (
    <div className="task-node-wrapper">
      <Handle className="task-node-handle" type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
      <button
        type="button"
        className={`task-node task-node-${data.task.status}${data.kind === 'boundary' ? ' task-node-boundary' : ''}${data.selected ? ' task-node-selected' : ''} nodrag nopan`}
        style={{ pointerEvents: 'auto' }}
        aria-label={`${title}，${labels[data.task.status]}${data.task.blockedBy.length > 0 ? '，被阻塞' : ''}${data.kind === 'boundary' ? '，外部前置，上游已省略' : ''}${data.shared ? '，共享任务' : ''}`}
        aria-haspopup="dialog"
        onClick={(event) => { data.onSelectTask(data.task.id, event.currentTarget); }}
        onFocus={(event) => {
          if (!event.currentTarget.matches(':focus-visible')) return;
          const nodeBounds = event.currentTarget.getBoundingClientRect();
          const viewportBounds = event.currentTarget.closest('.task-graph-canvas')!.getBoundingClientRect();
          if (nodeBounds.left < viewportBounds.left || nodeBounds.top < viewportBounds.top ||
            nodeBounds.right > viewportBounds.right || nodeBounds.bottom > viewportBounds.bottom) {
            void setCenter(data.center.x, data.center.y, { zoom: getViewport().zoom, duration: 0 });
          }
        }}
      >
        <span className="task-node-meta">
          <span className="task-node-id">{data.task.id.slice(0, 8)}</span>
          {data.shared && <span className="task-shared-label">共享</span>}
        </span>
        <span className="task-node-title">{title}</span>
        <span className="task-node-bottom">
          <span className={`graph-status graph-status-${data.task.status}`}><i aria-hidden="true" />{labels[data.task.status]}</span>
          {data.task.blockedBy.length > 0 && <span className="graph-blocked-badge">被阻塞</span>}
        </span>
        {data.kind === 'boundary' && <span className="task-boundary-label">外部前置，上游已省略</span>}
      </button>
      <Handle className="task-node-handle" type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
    </div>
  );
});
