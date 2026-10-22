import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/LocaleProvider';
import { LanguageSelector } from '../../i18n/LanguageSelector';
import { Background, BackgroundVariant, Controls, getViewportForBounds, ReactFlow, useReactFlow, useStore, ViewportPortal, type Viewport } from '@xyflow/react';
import { decomposeDashedRoute, DEPENDENCY_DASH_ARRAY, DEPENDENCY_DASH_PERIOD } from './dashes';
import { getTaskNodeHeight, layoutGraph, type CanvasLayout, type CanvasPoint } from './layout';
import { projectRoot, type GraphIndex, type RootProjection } from './model';
import { TaskNode, type TaskFlowNode } from './TaskNode';
import { createGraphOverview, getTaskExpansion, projectVisibleTasks, reconcileVisibleTasks, type TaskExpansionDirection, type TaskExpansions } from './visibility';
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
  const { messages: { graph: m } } = useI18n();
  const markerId = `task-dependency-arrow-${useId()}`;
  const routes = useMemo(() => geometry.edges.map((edge) => ({
    edge, pieces: edge.external ? decomposeDashedRoute(edge.points) : [],
  })), [geometry]);
  return (
    <ViewportPortal>
      <svg className="task-dependency-edges" data-testid="task-dependency-edges" data-paint-piece-count={routes.reduce((count, route) => count + route.pieces.length, 0)} width="100%" height="100%" role="group" aria-label={m.dependencyGroup} focusable="false">
        <defs>
          <marker id={markerId} markerWidth="16" markerHeight="16" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
            <polyline className="arrowclosed" points="-5,-4 0,0 -5,4 -5,-4" stroke="#abb2c7" fill="#abb2c7" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {routes.map(({ edge, pieces }) => (
          <g key={edge.id} className="react-flow__edge task-dependency-edge" data-id={edge.id} role="img" aria-label={m.dependencyLabel({ source: edge.source, target: edge.target })} focusable="false">
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
export const getInitialTaskViewport = (geometry: CanvasLayout, rootId: string, width: number, height: number, anchorRoot = false): Viewport => {
  const left = Math.min(...geometry.nodes.map((node) => node.position.x));
  const top = Math.min(...geometry.nodes.map((node) => node.position.y));
  const right = Math.max(...geometry.nodes.map((node) => node.position.x + node.width));
  const bottom = Math.max(...geometry.nodes.map((node) => node.position.y + node.height));
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  const fitted = getViewportForBounds(bounds, width, height, 0.8, 1, 0.15);
  if (bounds.width * fitted.zoom <= width && bounds.height * fitted.zoom <= height) return fitted;
  const root = geometry.nodes.find((node) => node.id === rootId)!;
  const upstreamTop = Math.min(...geometry.nodes.filter((node) => node.position.x === left).map((node) => node.position.y));
  if (anchorRoot) return { x: 32 - root.position.x * fitted.zoom, y: height / 2 - (root.position.y + root.height / 2) * fitted.zoom, zoom: fitted.zoom };
  return {
    x: 32 - left * fitted.zoom,
    y: root.position.x === left
      ? height / 2 - (root.position.y + root.height / 2) * fitted.zoom
      : 32 - upstreamTop * fitted.zoom,
    zoom: fitted.zoom,
  };
};

type ViewportAction = { readonly kind: 'expand'; readonly sequence: number; readonly anchorId: string } | { readonly kind: 'reset'; readonly sequence: number };

const InitialViewport = ({ geometry, rootId, folded, action, resetButton }: { geometry: CanvasLayout; rootId: string; folded: boolean; action: ViewportAction | null; resetButton: { current: HTMLButtonElement | null } }) => {
  const { setViewport, viewportInitialized } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const applied = useRef(false);
  const resetSequence = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!viewportInitialized || width <= 0 || height <= 0) return;
    const reset = action?.kind === 'reset' && action.sequence !== resetSequence.current;
    if (applied.current && !reset) return;
    applied.current = true;
    if (reset) resetSequence.current = action.sequence;
    void setViewport(getInitialTaskViewport(geometry, rootId, width, height, folded), { duration: 0 });
    if (reset) resetButton.current?.focus({ preventScroll: true });
  }, [geometry, rootId, folded, action, resetButton, viewportInitialized, width, height, setViewport]);
  return null;
};

type CanvasProps = TaskGraphProps & { geometry: CanvasLayout; projection: RootProjection; visibleIds: ReadonlySet<string>; expansions: ReadonlyMap<string, TaskExpansions>; action: ViewportAction | null; onExpandTask: (id: string, direction: TaskExpansionDirection) => void; onResetOverview: () => void };

const TaskCanvas = ({ index, rootId, selectedTaskId, onSelectTask, geometry, projection, visibleIds, expansions, action, onExpandTask, onResetOverview }: CanvasProps) => {
  const { messages: { graph: m } } = useI18n();
  const { fullscreen, containerRef, toggleRef, onKeyDown, toggle } = useGraphFullscreen();
  const resetButton = useRef<HTMLButtonElement>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const focusedNode = document.activeElement?.closest<HTMLElement>('.react-flow__node');
    const removedNode = focusedNode != null && containerRef.current?.contains(focusedNode) &&
      !geometry.nodes.some((node) => node.id === focusedNode.dataset.id);
    const detachedControl = focusedControl.current !== null && !focusedControl.current.isConnected && document.activeElement === document.body;
    if (removedNode || detachedControl) toggleRef.current?.focus();
  }, [geometry, containerRef, toggleRef]);
  const totalTasks = projection.mainIds.size + projection.externalIds.size;
  const folded = visibleIds.size < totalTasks;
  // Stable node identities restrict detail-selection renders to affected tasks.
  const nodeVariants = useMemo(() => geometry.nodes.map((node) => {
    const base: TaskFlowNode = {
      id: node.id, position: node.position, type: 'task', width: node.width, height: node.height,
      style: { width: node.width, height: node.height },
      data: {
        task: index.nodes.get(node.id)!, kind: node.kind, shared: index.sharedIds.has(node.id), selected: false,
        center: { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 },
        size: { width: node.width, height: node.height },
        onSelectTask, onExpandTask,
        revealRequest: action?.kind === 'expand' && action.anchorId === node.id ? action.sequence : null,
        expansions: expansions.get(node.id)!,
      },
    };
    return { base, selected: { ...base, data: { ...base.data, selected: true } } };
  }), [geometry, index, expansions, action, onSelectTask, onExpandTask]);
  const nodes = useMemo<TaskFlowNode[]>(() => nodeVariants.map(({ base, selected }) => base.id === selectedTaskId ? selected : base), [nodeVariants, selectedTaskId]);
  const canvas = useMemo(() => (
    <ReactFlow<TaskFlowNode>
      id={`flow-${rootId}`}
      aria-label={m.canvas}
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
      ariaLabelConfig={m.flowAriaLabels}
      attributionPosition="bottom-right"
    >
      <InitialViewport geometry={geometry} rootId={rootId} folded={folded} action={action} resetButton={resetButton} />
      <DependencyEdges geometry={geometry} />
      <Background variant={BackgroundVariant.Dots} gap={18} size={0.8} color="#d9dee9" bgColor="#fafbfe" />
      <Controls position="top-right" orientation="horizontal" showInteractive={false} fitViewOptions={viewportFitOptions} />
    </ReactFlow>
  ), [nodes, rootId, geometry, folded, action, m]);
  return (
    <div className={`task-graph${fullscreen ? ' task-graph-fullscreen' : ''}`} data-visible-task-count={visibleIds.size} data-total-task-count={totalTasks} ref={containerRef} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen ? true : undefined} aria-label={fullscreen ? m.fullscreenTitle : undefined} onKeyDown={onKeyDown} onFocusCapture={(event) => { focusedControl.current = event.target as HTMLElement; }}>
      <div className="graph-toolbar">
        <span>{m.title}</span>
        <div className="graph-toolbar-actions">
          <span>{m.counts({ main: projection.mainIds.size, external: projection.externalIds.size, dependencies: projection.edges.length })}</span>
          <button className="button graph-fullscreen-toggle" type="button" ref={toggleRef} onClick={toggle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d={fullscreen ? 'M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5' : 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'} />
            </svg>
            {fullscreen ? m.exitFullscreen : m.enterFullscreen}
          </button>
          {fullscreen && <LanguageSelector />}
          <button className="button graph-reset-overview" type="button" ref={resetButton} onClick={onResetOverview}>{m.resetOverview}</button>
        </div>
      </div>
      <p className="graph-visibility-summary">{m.visibilitySummary({ visible: visibleIds.size, total: totalTasks, edges: geometry.edges.length, totalEdges: projection.edges.length })}</p>
      <p className="graph-instructions" id={`graph-instructions-${rootId}`}>{m.instructions}</p>
      <div className="task-graph-canvas">
        {canvas}
      </div>
      <div className="graph-foot"><span>{m.directionLegend}</span><span>{m.externalLegend}</span></div>
    </div>
  );
};

const LayoutError = () => {
  const { messages: { graph: m } } = useI18n();
  return <div className="graph-error" role="alert"><h3>{m.layoutErrorTitle}</h3><p>{m.layoutErrorDescription}</p></div>;
};

const VisibleTaskGraph = ({ projection, ...props }: TaskGraphProps & { projection: RootProjection }) => {
  const [visibility, setVisibility] = useState(() => ({ projection, ids: createGraphOverview(props.index, projection) }));
  const sequence = useRef(0);
  const [action, setAction] = useState<ViewportAction | null>(null);
  const visibleIds = useMemo(() => visibility.projection === projection ? visibility.ids : reconcileVisibleTasks(projection, visibility.ids), [projection, visibility]);
  useEffect(() => {
    if (visibility.projection !== projection) setVisibility({ projection, ids: visibleIds });
  }, [projection, visibility.projection, visibleIds]);
  const visibleProjection = useMemo(() => projectVisibleTasks(projection, visibleIds), [projection, visibleIds]);
  const expansions = useMemo(() => new Map([...visibleIds].map((id) => [id, {
    prerequisites: getTaskExpansion(props.index, projection, visibleIds, id, 'prerequisites'),
    successors: getTaskExpansion(props.index, projection, visibleIds, id, 'successors'),
  }])), [props.index, projection, visibleIds]);
  const result = useMemo(() => {
    try {
      performance.clearMeasures('daynight:task-layout');
      const started = performance.now();
      const geometry = layoutGraph(visibleProjection, new Map([...expansions].map(([id, directions]) => [id, getTaskNodeHeight(directions)])));
      performance.measure('daynight:task-layout', { start: started, end: performance.now(), detail: { rootId: props.rootId } });
      return { kind: 'ready' as const, geometry };
    } catch (error) { return { kind: 'error' as const, error }; }
  }, [visibleProjection, expansions, props.rootId]);
  const onExpandTask = useCallback((id: string, direction: TaskExpansionDirection) => {
    const expansion = expansions.get(id)![direction];
    if (expansion.ids.length === 0) return;
    setVisibility({ projection, ids: new Set([...visibleIds, ...expansion.ids]) });
    setAction({ kind: 'expand', sequence: ++sequence.current, anchorId: id });
  }, [expansions, projection, visibleIds]);
  const onResetOverview = useCallback(() => {
    setVisibility({ projection, ids: createGraphOverview(props.index, projection) });
    setAction({ kind: 'reset', sequence: ++sequence.current });
  }, [props.index, projection]);
  return result.kind === 'error' ? <LayoutError /> : <TaskCanvas {...props} geometry={result.geometry} projection={projection} visibleIds={visibleIds} expansions={expansions} action={action} onExpandTask={onExpandTask} onResetOverview={onResetOverview} />;
};

export const TaskGraph = (props: TaskGraphProps) => {
  const result = useMemo(() => {
    try { return { kind: 'ready' as const, projection: projectRoot(props.index, props.rootId) }; }
    catch (error) { return { kind: 'error' as const, error }; }
  }, [props.index, props.rootId]);
  return result.kind === 'error' ? <LayoutError /> : <VisibleTaskGraph key={props.rootId} {...props} projection={result.projection} />;
};
