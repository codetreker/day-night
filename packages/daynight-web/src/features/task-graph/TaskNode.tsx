import { memo, useCallback, useLayoutEffect, useRef, type FocusEvent, type MouseEvent } from 'react';
import { useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { GraphTask } from '../../api/types';
import { useTaskInspectionState } from './inspection';
import type { TaskExpansion, TaskExpansionDirection } from './visibility';
import { TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasPoint } from './layout';

export type TaskNodeData = {
  task: GraphTask;
  kind: 'main' | 'external';
  shared: boolean;
  center: CanvasPoint;
  onInspectTask: (id: string, trigger: HTMLElement) => void;
  onOpenTask: (id: string, trigger: HTMLElement) => void;
  onExpandTask: (id: string, direction: TaskExpansionDirection) => void;
  expansions: Readonly<Record<TaskExpansionDirection, TaskExpansion>>;
  revealRequest: number | null;
};

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

const labels = { todo: '待处理', in_progress: '进行中', done: '已完成' };
const inspectionLabels = { normal: '', selected: '，已选中', prerequisite: '，所选任务的前置', unrelated: '，不在所选依赖路径中' };

const TaskNodeContent = memo(({ task, kind, shared }: Pick<TaskNodeData, 'task' | 'kind' | 'shared'>) => {
  const title = `${task.titlePreview}${task.titleTruncated ? '…' : ''}`;
  return <>
    <span className="task-node-meta">
      <span className="task-node-id">{task.id.slice(0, 8)}</span>
      {shared && <span className="task-shared-label">共享</span>}
    </span>
    <span className="task-node-title">{title}</span>
    <span className="task-node-bottom">
      <span className={`graph-status graph-status-${task.status}`}><i aria-hidden="true" />{labels[task.status]}</span>
      {task.blockedBy.length > 0 && <span className="graph-blocked-badge">被阻塞</span>}
    </span>
    {kind === 'external' && <span className="task-external-label">外部前置</span>}
  </>;
});

const ExpansionControl = ({ direction, expansion, onExpand, onFocus }: { direction: TaskExpansionDirection; expansion: TaskExpansion; onExpand: () => void; onFocus: (event: FocusEvent<HTMLButtonElement>) => void }) => {
  if (expansion.ids.length === 0) return <span aria-hidden="true" />;
  const label = direction === 'prerequisites' ? '前置' : '后续';
  const remaining = expansion.totalHidden - expansion.ids.length;
  return <button type="button" className="task-node-expand nodrag nopan" data-direction={direction}
    data-added-tasks={expansion.ids.length} data-added-edges={expansion.addedEdges} data-remaining={remaining}
    aria-label={`展开${label} ${expansion.ids.length} 个任务、${expansion.addedEdges} 条依赖${remaining > 0 ? `，剩余 ${remaining} 个${label}未展开` : ''}`} onClick={onExpand} onFocus={onFocus}>
    <span>展开{label} {expansion.ids.length}</span>
    <small>+{expansion.addedEdges} 条依赖{remaining > 0 ? ` · 余 ${remaining}` : ''}</small>
  </button>;
};

export const TaskNode = memo(({ data }: NodeProps<TaskFlowNode>) => {
  const { setCenter, getViewport } = useReactFlow();
  const inspection = useTaskInspectionState(data.task.id);
  const body = useRef<HTMLButtonElement>(null);
  const revealed = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (data.revealRequest === null || data.revealRequest === revealed.current) return;
    revealed.current = data.revealRequest;
    void setCenter(data.center.x, data.center.y, { zoom: getViewport().zoom, duration: 0 });
    body.current!.focus({ preventScroll: true });
  }, [data.revealRequest, data.center, getViewport, setCenter]);
  const title = `${data.task.titlePreview}${data.task.titleTruncated ? '…' : ''}`;
  const revealOnFocus = useCallback((event: FocusEvent<HTMLButtonElement>) => {
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
  }, [data.center, getViewport, setCenter]);
  const inspect = useCallback((event: MouseEvent<HTMLButtonElement>) => { data.onInspectTask(data.task.id, event.currentTarget); }, [data.onInspectTask, data.task.id]);
  const open = useCallback((event: MouseEvent<HTMLButtonElement>) => { data.onOpenTask(data.task.id, event.currentTarget); }, [data.onOpenTask, data.task.id]);
  return (
    <div className={`task-node task-node-${data.task.status} task-node-${inspection}${data.kind === 'external' ? ' task-node-external' : ''} nodrag nopan`} data-inspection={inspection} style={{ pointerEvents: 'auto' }}>
      <button type="button" ref={body} className="task-node-body nodrag nopan"
        aria-label={`${title}，${labels[data.task.status]}${data.task.blockedBy.length > 0 ? '，被阻塞' : ''}${data.kind === 'external' ? '，外部前置' : ''}${data.shared ? '，共享任务' : ''}${inspectionLabels[inspection]}`}
        aria-pressed={inspection === 'selected'} onClick={inspect} onFocus={revealOnFocus}>
        <TaskNodeContent task={data.task} kind={data.kind} shared={data.shared} />
      </button>
      <button type="button" className="task-node-details nodrag nopan" aria-label={`${title}，详情`} aria-haspopup="dialog" onClick={open} onFocus={revealOnFocus}>详情</button>
      <div className="task-node-expansions">
        <ExpansionControl direction="prerequisites" expansion={data.expansions.prerequisites} onFocus={revealOnFocus} onExpand={() => { data.onExpandTask(data.task.id, 'prerequisites'); }} />
        <ExpansionControl direction="successors" expansion={data.expansions.successors} onFocus={revealOnFocus} onExpand={() => { data.onExpandTask(data.task.id, 'successors'); }} />
      </div>
    </div>
  );
});
