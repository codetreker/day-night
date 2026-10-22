import { memo } from 'react';
import { useI18n } from '../../i18n/LocaleProvider';
import { useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { GraphTask } from '../../api/types';
import type { CanvasPoint } from './layout';

export type TaskNodeData = {
  task: GraphTask;
  kind: 'main' | 'external';
  shared: boolean;
  selected: boolean;
  center: CanvasPoint;
  onSelectTask: (id: string, trigger: HTMLElement) => void;
};

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

export const TaskNode = memo(({ data }: NodeProps<TaskFlowNode>) => {
  const { messages: { graph: m, common } } = useI18n();
  const { setCenter, getViewport } = useReactFlow();
  const title = `${data.task.titlePreview}${data.task.titleTruncated ? '…' : ''}`;
  return (
    <button
      type="button"
      className={`task-node task-node-${data.task.status}${data.kind === 'external' ? ' task-node-external' : ''}${data.selected ? ' task-node-selected' : ''} nodrag nopan`}
      style={{ pointerEvents: 'auto' }}
      aria-label={m.nodeLabel({ title, status: common.status[data.task.status], blocked: data.task.blockedBy.length > 0, external: data.kind === 'external', shared: data.shared })}
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
        {data.shared && <span className="task-shared-label">{m.shared}</span>}
      </span>
      <span className="task-node-title">{title}</span>
      <span className="task-node-bottom">
        <span className={`graph-status graph-status-${data.task.status}`}><i aria-hidden="true" />{common.status[data.task.status]}</span>
        {data.task.blockedBy.length > 0 && <span className="graph-blocked-badge">{m.blocked}</span>}
      </span>
      {data.kind === 'external' && <span className="task-external-label">{m.external}</span>}
    </button>
  );
});
