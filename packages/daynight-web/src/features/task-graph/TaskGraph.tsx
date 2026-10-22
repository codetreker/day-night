import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, getViewportForBounds, ReactFlow, useReactFlow, useStore, type Viewport } from '@xyflow/react';
import { useI18n } from '../../i18n/LocaleProvider';
import { LanguageSelector } from '../../i18n/LanguageSelector';
import { layoutGraph, TASK_NODE_HEIGHT, TASK_NODE_WIDTH, type CanvasLayout } from './layout';
import { projectRoot, tracePrerequisites, type GraphIndex, type RootProjection } from './model';
import { TaskNode, type TaskFlowNode } from './TaskNode';
import { DependencyEdges } from './DependencyEdges';
import { TaskInspectionContext, useTaskInspection } from './inspection';
import { createGraphOverview, getTaskExpansion, projectVisibleTasks, reconcileVisibleTasks, type TaskExpansionDirection } from './visibility';
import { useGraphFullscreen } from './useGraphFullscreen';
import '@xyflow/react/dist/style.css';

type TaskGraphProps = {
  index: GraphIndex;
  rootId: string;
  onOpenTask: (id: string, trigger: HTMLElement) => void;
};

const InspectedEdges = memo(({ geometry }: { geometry: CanvasLayout }) => {
  const inspection = useTaskInspection();
  return <DependencyEdges geometry={geometry} inspection={inspection} />;
});

const nodeTypes = { task: TaskNode };
const viewportFitOptions = { minZoom: 0.2, maxZoom: 1, padding: 0.15 };
export const getInitialTaskViewport = (geometry: CanvasLayout, rootId: string, width: number, height: number, anchorRoot = false): Viewport => {
  const left = Math.min(...geometry.nodes.map((node) => node.position.x));
  const top = Math.min(...geometry.nodes.map((node) => node.position.y));
  const right = Math.max(...geometry.nodes.map((node) => node.position.x + TASK_NODE_WIDTH));
  const bottom = Math.max(...geometry.nodes.map((node) => node.position.y + TASK_NODE_HEIGHT));
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  const fitted = getViewportForBounds(bounds, width, height, 0.8, 1, 0.15);
  if (bounds.width * fitted.zoom <= width && bounds.height * fitted.zoom <= height) return fitted;
  const root = geometry.nodes.find((node) => node.id === rootId)!;
  const upstreamTop = Math.min(...geometry.nodes.filter((node) => node.position.x === left).map((node) => node.position.y));
  if (anchorRoot) return { x: 32 - root.position.x * fitted.zoom, y: height / 2 - (root.position.y + TASK_NODE_HEIGHT / 2) * fitted.zoom, zoom: fitted.zoom };
  return {
    x: 32 - left * fitted.zoom,
    y: root.position.x === left
      ? height / 2 - (root.position.y + TASK_NODE_HEIGHT / 2) * fitted.zoom
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

type CanvasProps = TaskGraphProps & { geometry: CanvasLayout; projection: RootProjection; visibleIds: ReadonlySet<string>; action: ViewportAction | null; onExpandTask: (id: string, direction: TaskExpansionDirection) => void; onResetOverview: () => void };

const TaskCanvas = ({ index, rootId, onOpenTask, geometry, projection, visibleIds, action, onExpandTask, onResetOverview }: CanvasProps) => {
  const { messages: { graph: m } } = useI18n();
  const { fullscreen, containerRef, toggleRef, onKeyDown, toggle } = useGraphFullscreen();
  const resetButton = useRef<HTMLButtonElement>(null);
  const [inspection, setInspection] = useState<{ id: string; trigger: HTMLElement } | null>(null);
  const selectedTaskId = inspection !== null && visibleIds.has(inspection.id) ? inspection.id : null;
  const highlighted = useMemo(() => selectedTaskId === null ? null : tracePrerequisites(index, selectedTaskId), [index, selectedTaskId]);
  useLayoutEffect(() => {
    const focusedNode = document.activeElement?.closest<HTMLElement>('.react-flow__node');
    if (focusedNode !== undefined && focusedNode !== null && containerRef.current?.contains(focusedNode) &&
      !geometry.nodes.some((node) => node.id === focusedNode.dataset.id)) toggleRef.current?.focus();
  }, [geometry, containerRef, toggleRef]);
  useEffect(() => {
    if (inspection === null || selectedTaskId !== null) return;
    if (document.activeElement === inspection.trigger || !inspection.trigger.isConnected && document.activeElement === document.body) toggleRef.current?.focus();
    setInspection(null);
  }, [inspection, selectedTaskId, toggleRef]);
  const onInspectTask = useCallback((id: string, trigger: HTMLElement) => {
    setInspection((current) => current?.id === id ? null : { id, trigger });
  }, []);
  const clearInspection = useCallback(() => { setInspection(null); }, []);
  const hiddenUpstreamCount = highlighted === null ? 0 : [...highlighted].filter((id) => !visibleIds.has(id)).length;
  const totalTasks = projection.mainIds.size + projection.externalIds.size;
  const folded = visibleIds.size < totalTasks;
  const nodes = useMemo<TaskFlowNode[]>(() => geometry.nodes.map((node) => ({
    id: node.id, position: node.position, type: 'task', width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT,
    style: { width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT },
    data: {
      task: index.nodes.get(node.id)!, kind: node.kind, shared: index.sharedIds.has(node.id),
      center: { x: node.position.x + TASK_NODE_WIDTH / 2, y: node.position.y + TASK_NODE_HEIGHT / 2 },
      onInspectTask, onOpenTask, onExpandTask,
      revealRequest: action?.kind === 'expand' && action.anchorId === node.id ? action.sequence : null,
      expansions: { prerequisites: getTaskExpansion(index, projection, visibleIds, node.id, 'prerequisites'), successors: getTaskExpansion(index, projection, visibleIds, node.id, 'successors') },
    },
  })), [geometry, index, projection, visibleIds, action, onInspectTask, onOpenTask, onExpandTask]);
  const presentation = useMemo(() => ({ selectedTaskId, highlighted }), [selectedTaskId, highlighted]);
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
      onPaneClick={clearInspection}
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
      <InspectedEdges geometry={geometry} />
      <Background variant={BackgroundVariant.Dots} gap={18} size={0.8} color="#d9dee9" bgColor="#fafbfe" />
      <Controls position="top-right" orientation="horizontal" showInteractive={false} fitViewOptions={viewportFitOptions} />
    </ReactFlow>
  ), [nodes, rootId, geometry, folded, action, clearInspection, m]);
  return (
    <div className={`task-graph${fullscreen ? ' task-graph-fullscreen' : ''}`} data-hidden-upstream-count={hiddenUpstreamCount} data-visible-task-count={visibleIds.size} data-total-task-count={totalTasks} ref={containerRef} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen ? true : undefined} aria-label={fullscreen ? m.fullscreenTitle : undefined} onKeyDown={onKeyDown}>
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
      <p className="graph-hidden-prerequisites" role="status">{hiddenUpstreamCount > 0 ? m.hiddenPrerequisites({ count: hiddenUpstreamCount }) : ''}</p>
      <p className="graph-instructions" id={`graph-instructions-${rootId}`}>{m.instructions}</p>
      <div className="task-graph-canvas">
        <TaskInspectionContext value={presentation}>{canvas}</TaskInspectionContext>
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
  const result = useMemo(() => {
    try {
      performance.clearMeasures('daynight:task-layout');
      const started = performance.now();
      const geometry = layoutGraph(visibleProjection);
      performance.measure('daynight:task-layout', { start: started, end: performance.now(), detail: { rootId: props.rootId } });
      return { kind: 'ready' as const, geometry };
    } catch (error) { return { kind: 'error' as const, error }; }
  }, [visibleProjection, props.rootId]);
  const onExpandTask = useCallback((id: string, direction: TaskExpansionDirection) => {
    const expansion = getTaskExpansion(props.index, projection, visibleIds, id, direction);
    if (expansion.ids.length === 0) return;
    setVisibility({ projection, ids: new Set([...visibleIds, ...expansion.ids]) });
    setAction({ kind: 'expand', sequence: ++sequence.current, anchorId: id });
  }, [props.index, projection, visibleIds]);
  const onResetOverview = useCallback(() => {
    setVisibility({ projection, ids: createGraphOverview(props.index, projection) });
    setAction({ kind: 'reset', sequence: ++sequence.current });
  }, [props.index, projection]);
  return result.kind === 'error' ? <LayoutError /> : <TaskCanvas {...props} geometry={result.geometry} projection={projection} visibleIds={visibleIds} action={action} onExpandTask={onExpandTask} onResetOverview={onResetOverview} />;
};

export const TaskGraph = (props: TaskGraphProps) => {
  const result = useMemo(() => {
    try { return { kind: 'ready' as const, projection: projectRoot(props.index, props.rootId) }; }
    catch (error) { return { kind: 'error' as const, error }; }
  }, [props.index, props.rootId]);
  return result.kind === 'error' ? <LayoutError /> : <VisibleTaskGraph key={props.rootId} {...props} projection={result.projection} />;
};
