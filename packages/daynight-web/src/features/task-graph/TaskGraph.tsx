import { memo, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { Background, BackgroundVariant, Controls, getViewportForBounds, ReactFlow, useReactFlow, useStore, ViewportPortal, type Viewport } from '@xyflow/react';
import { layoutGraph, TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasLayout } from './layout';
import { projectRoot, type GraphIndex } from './model';
import { TaskNode, type TaskFlowNode } from './TaskNode';
import '@xyflow/react/dist/style.css';

type TaskGraphProps = {
  index: GraphIndex;
  rootId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string, trigger: HTMLElement) => void;
};

const DependencyEdges = memo(({ geometry }: { geometry: CanvasLayout }) => {
  const markerId = `task-dependency-arrow-${useId()}`;
  return (
    <ViewportPortal>
      <svg className="task-dependency-edges" data-testid="task-dependency-edges" width="100%" height="100%" role="group" aria-label="任务依赖关系" focusable="false">
        <defs>
          <marker id={markerId} markerWidth="16" markerHeight="16" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
            <polyline className="arrowclosed" points="-5,-4 0,0 -5,4 -5,-4" stroke="#abb2c7" fill="#abb2c7" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {geometry.edges.map((edge) => (
          <g key={edge.id} className="react-flow__edge task-dependency-edge" data-id={edge.id} role="img" aria-label={`前置任务 ${edge.source} → 后续任务 ${edge.target}`} focusable="false">
            <path
              className="react-flow__edge-path"
              data-source={edge.source}
              data-target={edge.target}
              d={edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')}
              markerEnd={`url(#${markerId})`}
              aria-hidden="true"
              style={{ fill: 'none', stroke: '#abb2c7', strokeWidth: 1.5, strokeDasharray: edge.external ? '5 4' : undefined }}
            />
          </g>
        ))}
      </svg>
    </ViewportPortal>
  );
});

const nodeTypes = { task: TaskNode };
const viewportFitOptions = { minZoom: 0.2, maxZoom: 1, padding: 0.15 };
const ariaLabels = {
  'controls.ariaLabel': '任务图视口控制',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '适应画布',
  'node.a11yDescription.default': '使用 Tab 选择任务，按 Enter 或空格查看任务详情。',
  'node.a11yDescription.keyboardDisabled': '使用 Tab 选择任务，按 Enter 或空格查看任务详情。',
};

export const getInitialTaskViewport = (geometry: CanvasLayout, rootId: string, width: number, height: number): Viewport => {
  const left = Math.min(...geometry.nodes.map((node) => node.position.x));
  const top = Math.min(...geometry.nodes.map((node) => node.position.y));
  const right = Math.max(...geometry.nodes.map((node) => node.position.x + TASK_NODE_WIDTH));
  const bottom = Math.max(...geometry.nodes.map((node) => node.position.y + TASK_NODE_HEIGHT));
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  const fitted = getViewportForBounds(bounds, width, height, 0.8, 1, 0.15);
  if (bounds.width * fitted.zoom <= width && bounds.height * fitted.zoom <= height) return fitted;
  const root = geometry.nodes.find((node) => node.id === rootId)!;
  return {
    x: 32 - root.position.x * fitted.zoom,
    y: height / 2 - (root.position.y + TASK_NODE_HEIGHT / 2) * fitted.zoom,
    zoom: fitted.zoom,
  };
};

const InitialViewport = ({ geometry, rootId }: { geometry: CanvasLayout; rootId: string }) => {
  const { setViewport, viewportInitialized } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const applied = useRef(false);
  useLayoutEffect(() => {
    if (applied.current || !viewportInitialized || width <= 0 || height <= 0) return;
    applied.current = true;
    void setViewport(getInitialTaskViewport(geometry, rootId, width, height), { duration: 0 });
  }, [geometry, rootId, viewportInitialized, width, height, setViewport]);
  return null;
};

const TaskCanvas = ({ index, rootId, selectedTaskId, onSelectTask, geometry }: TaskGraphProps & { geometry: CanvasLayout }) => {
  // Stable node identities restrict selection renders to the previous and next tasks.
  const nodeVariants = useMemo(() => geometry.nodes.map((node) => {
    const base: TaskFlowNode = {
      id: node.id,
      position: node.position,
      type: 'task',
      width: TASK_NODE_WIDTH,
      height: TASK_NODE_HEIGHT,
      style: { width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT },
      data: {
        task: index.nodes.get(node.id)!, kind: node.kind, shared: index.sharedIds.has(node.id),
        selected: false,
        center: { x: node.position.x + TASK_NODE_WIDTH / 2, y: node.position.y + TASK_NODE_HEIGHT / 2 },
        onSelectTask,
      },
    };
    return { base, selected: { ...base, data: { ...base.data, selected: true } } };
  }), [geometry, index, onSelectTask]);
  const nodes = useMemo<TaskFlowNode[]>(() => nodeVariants.map(({ base, selected }) =>
    base.id === selectedTaskId ? selected : base), [nodeVariants, selectedTaskId]);
  return (
    <>
      <div className="graph-toolbar"><span>横向依赖图</span><span>{nodes.length} 个节点 · {geometry.edges.length} 条依赖</span></div>
      <p className="graph-instructions" id={`graph-instructions-${rootId}`}>拖动画布平移，滚轮或按钮缩放。Tab 选择任务，Enter 或空格查看详情。</p>
      <div className="task-graph-canvas">
        <ReactFlow<TaskFlowNode>
          id={`flow-${rootId}`}
          aria-label="任务依赖画布"
          aria-describedby={`graph-instructions-${rootId}`}
          nodes={nodes}
          nodeTypes={nodeTypes}
          minZoom={0.2}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          connectOnClick={false}
          deleteKeyCode={null}
          panActivationKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          autoPanOnNodeFocus={false}
          onlyRenderVisibleElements={false}
          ariaLabelConfig={ariaLabels}
          attributionPosition="bottom-right"
        >
          <InitialViewport geometry={geometry} rootId={rootId} />
          <DependencyEdges geometry={geometry} />
          <Background variant={BackgroundVariant.Dots} gap={18} size={0.8} color="#d9dee9" bgColor="#fafbfe" />
          <Controls position="top-right" orientation="horizontal" showInteractive={false} fitViewOptions={viewportFitOptions} />
        </ReactFlow>
      </div>
      <div className="graph-foot"><span>箭头表示前置 → 后续</span><span>虚线节点：外部前置，上游已省略</span></div>
    </>
  );
};

export const TaskGraph = (props: TaskGraphProps) => {
  const result = useMemo(() => {
    try {
      performance.clearMeasures('daynight:task-layout');
      const started = performance.now();
      const geometry = layoutGraph(projectRoot(props.index, props.rootId));
      performance.measure('daynight:task-layout', {
        start: started, end: performance.now(), detail: { rootId: props.rootId },
      });
      return { kind: 'ready' as const, geometry };
    } catch (error) {
      return { kind: 'error' as const, error };
    }
  }, [props.index, props.rootId]);
  if (result.kind === 'error') {
    return <div className="graph-error" role="alert"><h3>任务图布局失败</h3><p>无法绘制此任务链，请刷新项目后重试。</p></div>;
  }
  return <TaskCanvas {...props} geometry={result.geometry} />;
};
