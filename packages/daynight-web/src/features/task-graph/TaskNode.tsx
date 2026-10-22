import { memo, type FocusEvent } from 'react';
import { useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { GraphTask } from '../../api/types';
import { TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasPoint } from './layout';

export type InspectionState = 'normal' | 'selected' | 'prerequisite' | 'unrelated';

export type TaskNodeData = {
  task: GraphTask;
  kind: 'main' | 'external';
  shared: boolean;
  inspection: InspectionState;
  center: CanvasPoint;
  onInspectTask: (id: string, trigger: HTMLElement) => void;
  onOpenTask: (id: string, trigger: HTMLElement) => void;
};

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

const labels = { todo: '待处理', in_progress: '进行中', done: '已完成' };
const inspectionLabels = { normal: '', selected: '，已选中', prerequisite: '，所选任务的前置', unrelated: '，不在所选依赖路径中' };

export const TaskNode = memo(({ data }: NodeProps<TaskFlowNode>) => {
  const { setCenter, getViewport } = useReactFlow();
  const title = `${data.task.titlePreview}${data.task.titleTruncated ? '…' : ''}`;
  const revealOnFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.matches(':focus-visible')) return;
    const bounds = event.currentTarget.closest('.task-graph-canvas')!.getBoundingClientRect();
    const { x, y, zoom } = getViewport();
    // Native focus can temporarily scroll React Flow's overflow container before
    // its scroll handler resets it. Layout coordinates retain the intended view.
    const left = x + (data.center.x - TASK_NODE_WIDTH / 2) * zoom;
    const top = y + (data.center.y - TASK_NODE_HEIGHT / 2) * zoom;
    if (left < 0 || top < 0 || left + TASK_NODE_WIDTH * zoom > bounds.width || top + TASK_NODE_HEIGHT * zoom > bounds.height) {
      void setCenter(data.center.x, data.center.y, { zoom, duration: 0 });
    }
  };
  return (
    <div className={`task-node task-node-${data.task.status} task-node-${data.inspection}${data.kind === 'external' ? ' task-node-external' : ''} nodrag nopan`} data-inspection={data.inspection} style={{ pointerEvents: 'auto' }}>
      <button
        type="button"
        className="task-node-body nodrag nopan"
        aria-label={`${title}，${labels[data.task.status]}${data.task.blockedBy.length > 0 ? '，被阻塞' : ''}${data.kind === 'external' ? '，外部前置' : ''}${data.shared ? '，共享任务' : ''}${inspectionLabels[data.inspection]}`}
        aria-pressed={data.inspection === 'selected'}
        onClick={(event) => { data.onInspectTask(data.task.id, event.currentTarget); }}
        onFocus={revealOnFocus}
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
        {data.kind === 'external' && <span className="task-external-label">外部前置</span>}
      </button>
      <button type="button" className="task-node-details nodrag nopan" aria-label={`${title}，详情`} aria-haspopup="dialog"
        onClick={(event) => { data.onOpenTask(data.task.id, event.currentTarget); }} onFocus={revealOnFocus}>详情</button>
    </div>
  );
});
