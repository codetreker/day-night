import { useLayoutEffect, useMemo, useRef } from 'react';
import { Background, BackgroundVariant, BaseEdge, Controls, getViewportForBounds, MarkerType, Position, ReactFlow, useNodesInitialized, useReactFlow, useStore, type Edge, type EdgeProps, type NodeHandle, type Viewport } from '@xyflow/react';
import { layoutGraph, TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasLayout, type CanvasPoint } from './layout';
import { projectRoot, type GraphIndex } from './model';
import { TASK_HANDLE_SIZE, TaskNode, type TaskFlowNode } from './TaskNode';
import '@xyflow/react/dist/style.css';

type TaskGraphProps = {
  index: GraphIndex;
  rootId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string, trigger: HTMLElement) => void;
};

type DependencyEdge = Edge<{ points: readonly CanvasPoint[]; external: boolean }, 'dependency'>;

const DependencyLine = ({ id, data, markerEnd }: EdgeProps<DependencyEdge>) => {
  const path = data!.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  return <BaseEdge id={id} path={path} {...(markerEnd === undefined ? {} : { markerEnd })} interactionWidth={0} style={{ stroke: '#abb2c7', strokeWidth: 1.5, strokeDasharray: data!.external ? '5 4' : undefined }} />;
};

const nodeTypes = { task: TaskNode };
const edgeTypes = { dependency: DependencyLine };
const viewportFitOptions = { minZoom: 0.2, maxZoom: 1, padding: 0.15 };
const ariaLabels = {
  'controls.ariaLabel': '任务图视口控制',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '适应画布',
  'node.a11yDescription.default': '使用 Tab 选择任务，按 Enter 或空格查看任务详情。',
  'node.a11yDescription.keyboardDisabled': '使用 Tab 选择任务，按 Enter 或空格查看任务详情。',
  'edge.a11yDescription.default': '箭头从前置任务指向依赖它的任务。',
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
  const initialized = useNodesInitialized({ includeHiddenNodes: true });
  const { setViewport, viewportInitialized } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const applied = useRef(false);
  useLayoutEffect(() => {
    if (applied.current || !initialized || !viewportInitialized || width <= 0 || height <= 0) return;
    applied.current = true;
    void setViewport(getInitialTaskViewport(geometry, rootId, width, height), { duration: 0 });
  }, [geometry, rootId, initialized, viewportInitialized, width, height, setViewport]);
  return null;
};

const TaskCanvas = ({ index, rootId, selectedTaskId, onSelectTask, geometry }: TaskGraphProps & { geometry: CanvasLayout }) => {
  // Stable node identities restrict selection renders to the previous and next tasks.
  const nodeVariants = useMemo(() => geometry.nodes.map((node) => {
    // Fixed geometry lets edges render before the first DOM measurement completes.
    const handles: NodeHandle[] = [
      {
        type: 'target', position: Position.Left,
        x: -TASK_HANDLE_SIZE / 2, y: (TASK_NODE_HEIGHT - TASK_HANDLE_SIZE) / 2,
        width: TASK_HANDLE_SIZE, height: TASK_HANDLE_SIZE,
      },
      {
        type: 'source', position: Position.Right,
        x: TASK_NODE_WIDTH - TASK_HANDLE_SIZE / 2, y: (TASK_NODE_HEIGHT - TASK_HANDLE_SIZE) / 2,
        width: TASK_HANDLE_SIZE, height: TASK_HANDLE_SIZE,
      },
    ];
    const base: TaskFlowNode = {
      id: node.id,
      position: node.position,
      type: 'task',
      width: TASK_NODE_WIDTH,
      height: TASK_NODE_HEIGHT,
      handles,
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
  const edges = useMemo<DependencyEdge[]>(() => geometry.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: 'dependency',
    data: { points: edge.points, external: edge.external },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#abb2c7', width: 16, height: 16 },
  })), [geometry]);
  return (
    <>
      <div className="graph-toolbar"><span>横向依赖图</span><span>{nodes.length} 个节点 · {edges.length} 条依赖</span></div>
      <p className="graph-instructions" id={`graph-instructions-${rootId}`}>拖动画布平移，滚轮或按钮缩放。Tab 选择任务，Enter 或空格查看详情。</p>
      <div className="task-graph-canvas">
        <ReactFlow<TaskFlowNode, DependencyEdge>
          id={`flow-${rootId}`}
          aria-label="任务依赖画布"
          aria-describedby={`graph-instructions-${rootId}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
