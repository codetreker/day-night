import { memo, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { Background, BackgroundVariant, Controls, getViewportForBounds, ReactFlow, useReactFlow, useStore, ViewportPortal, type Viewport } from '@xyflow/react';
import { decomposeDashedRoute, DEPENDENCY_DASH_ARRAY, DEPENDENCY_DASH_PERIOD } from './dashes';
import { layoutGraph, TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasLayout, type CanvasPoint } from './layout';
import { projectRoot, type GraphIndex } from './model';
import { TaskNode, type TaskFlowNode } from './TaskNode';
import { useGraphFullscreen } from './useGraphFullscreen';
import '@xyflow/react/dist/style.css';

type TaskGraphProps = {
  index: GraphIndex;
  rootId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string, trigger: HTMLElement) => void;
};

const pathData = (points: readonly CanvasPoint[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
const dashStyle = {
  fill: 'none', stroke: '#abb2c7', strokeWidth: 1.5, strokeDasharray: DEPENDENCY_DASH_ARRAY,
  strokeLinecap: 'butt', strokeLinejoin: 'miter', pointerEvents: 'none',
} as const;

const DependencyEdges = memo(({ geometry }: { geometry: CanvasLayout }) => {
  const markerId = `task-dependency-arrow-${useId()}`;
  const routes = useMemo(() => geometry.edges.map((edge) => ({
    edge, pieces: edge.external ? decomposeDashedRoute(edge.points) : [],
  })), [geometry]);
  return (
    <ViewportPortal>
      <svg className="task-dependency-edges" data-testid="task-dependency-edges" data-paint-piece-count={routes.reduce((count, route) => count + route.pieces.length, 0)} width="100%" height="100%" role="group" aria-label="任务依赖关系" focusable="false">
        <defs>
          <marker id={markerId} markerWidth="16" markerHeight="16" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
            <polyline className="arrowclosed" points="-5,-4 0,0 -5,4 -5,-4" stroke="#abb2c7" fill="#abb2c7" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {routes.map(({ edge, pieces }) => (
          <g key={edge.id} className="react-flow__edge task-dependency-edge" data-id={edge.id} role="img" aria-label={`前置任务 ${edge.source} → 后续任务 ${edge.target}`} focusable="false">
            {pieces.map((piece, position) => {
              const properties = {
                className: 'task-dependency-paint-piece', 'data-piece-kind': piece.kind,
                'aria-hidden': true as const, focusable: false as const,
                style: { ...dashStyle, strokeDashoffset: piece.startDistance % DEPENDENCY_DASH_PERIOD },
              };
              return piece.kind === 'line'
                ? <line key={position} {...properties} x1="0" y1="0" x2={piece.length} y2="0" transform={`matrix(${piece.cosine} ${piece.sine} ${-piece.sine} ${piece.cosine} ${piece.from.x} ${piece.from.y})`} />
                : <path key={position} {...properties} d={pathData(piece.points)} />;
            })}
            <path
              className="react-flow__edge-path"
              data-source={edge.source}
              data-target={edge.target}
              d={pathData(edge.points)}
              markerEnd={`url(#${markerId})`}
              aria-hidden="true"
              style={{ fill: 'none', stroke: edge.external ? 'none' : '#abb2c7', strokeWidth: 1.5, strokeDasharray: edge.external ? DEPENDENCY_DASH_ARRAY : undefined }}
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
  const upstreamTop = Math.min(...geometry.nodes.filter((node) => node.position.x === left).map((node) => node.position.y));
  return {
    x: 32 - left * fitted.zoom,
    y: root.position.x === left
      ? height / 2 - (root.position.y + TASK_NODE_HEIGHT / 2) * fitted.zoom
      : 32 - upstreamTop * fitted.zoom,
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
  const { fullscreen, containerRef, toggleRef, onKeyDown, toggle } = useGraphFullscreen();
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
    <div className={`task-graph${fullscreen ? ' task-graph-fullscreen' : ''}`} ref={containerRef} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen ? true : undefined} aria-label={fullscreen ? '任务依赖图全屏查看' : undefined} onKeyDown={onKeyDown}>
      <div className="graph-toolbar">
        <span>横向依赖图</span>
        <div className="graph-toolbar-actions">
          <span>{geometry.nodes.filter((node) => node.kind === 'main').length} 个链内任务 · {geometry.nodes.filter((node) => node.kind === 'external').length} 个外部前置 · {geometry.edges.length} 条依赖</span>
          <button className="button graph-fullscreen-toggle" type="button" ref={toggleRef} onClick={toggle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d={fullscreen ? 'M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5' : 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'} />
            </svg>
            {fullscreen ? '退出全屏' : '全屏查看'}
          </button>
        </div>
      </div>
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
      <div className="graph-foot"><span>箭头表示前置 → 后续</span><span>虚线节点及连线：外部前置（已补齐全部上游）</span></div>
    </div>
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
