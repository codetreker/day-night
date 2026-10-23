import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/LocaleProvider';
import { LanguageSelector } from '../../i18n/LanguageSelector';
import { Background, BackgroundVariant, Controls, getViewportForBounds, ReactFlow, useReactFlow, useStore, type Viewport } from '@xyflow/react';
import { getTaskNodeHeight, layoutGraph, type CanvasLayout } from './layout';
import { projectGroup, tracePrerequisites, type GroupIndex, type GroupProjection } from './model';
import { TaskNode, type TaskFlowNode } from './TaskNode';
import { DependencyEdges } from './DependencyEdges';
import { TaskInspectionContext, useTaskInspection } from './inspection';
import { createGraphOverview, getMemberExpansion, getTaskExpansion, projectVisibleTasks, reconcileVisibleTasks, type TaskExpansionDirection, type TaskExpansions } from './visibility';
import { useGraphFullscreen } from './useGraphFullscreen';
import '@xyflow/react/dist/style.css';

type TaskGraphProps = {
  index: GroupIndex;
  groupId: string;
  onOpenTask: (id: string, trigger: HTMLElement) => void;
};

const emptyHighlight: ReadonlySet<string> = new Set();
const InspectedEdges = memo(({ geometry }: { geometry: CanvasLayout }) => {
  const inspection = useTaskInspection();
  return <DependencyEdges geometry={geometry} inspection={inspection} />;
});

const nodeTypes = { task: TaskNode };
const viewportFitOptions = { minZoom: 0.2, maxZoom: 1, padding: 0.15 };
export const getInitialTaskViewport = (geometry: CanvasLayout, groupId: string, width: number, height: number, anchorRoot = false): Viewport => {
  const left = Math.min(...geometry.nodes.map((node) => node.position.x));
  const top = Math.min(...geometry.nodes.map((node) => node.position.y));
  const right = Math.max(...geometry.nodes.map((node) => node.position.x + node.width));
  const bottom = Math.max(...geometry.nodes.map((node) => node.position.y + node.height));
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  const fitted = getViewportForBounds(bounds, width, height, 0.8, 1, 0.15);
  if (bounds.width * fitted.zoom <= width && bounds.height * fitted.zoom <= height) return fitted;
  const root = geometry.nodes.find((node) => node.id === groupId)!;
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

type ViewportAction = { readonly kind: 'expand'; readonly sequence: number; readonly anchorId: string } | { readonly kind: 'reset' | 'members'; readonly sequence: number };

const InitialViewport = ({ geometry, groupId, folded, action, resetButton }: { geometry: CanvasLayout; groupId: string; folded: boolean; action: ViewportAction | null; resetButton: { current: HTMLButtonElement | null } }) => {
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
    void setViewport(getInitialTaskViewport(geometry, groupId, width, height, folded), { duration: 0 });
    if (reset) resetButton.current?.focus({ preventScroll: true });
  }, [geometry, groupId, folded, action, resetButton, viewportInitialized, width, height, setViewport]);
  return null;
};

type CanvasProps = TaskGraphProps & { geometry: CanvasLayout; projection: GroupProjection; visibleIds: ReadonlySet<string>; expansions: ReadonlyMap<string, TaskExpansions>; action: ViewportAction | null; onExpandTask: (id: string, direction: TaskExpansionDirection) => void; onResetOverview: () => void; onExpandMembers: () => void; showMemberExpansion: boolean };

const TaskCanvas = ({ index, groupId, onOpenTask, geometry, projection, visibleIds, expansions, action, onExpandTask, onResetOverview, onExpandMembers, showMemberExpansion }: CanvasProps) => {
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
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const selectedTaskId = inspectionId !== null && visibleIds.has(inspectionId) ? inspectionId : null;
  const highlightedIds = useMemo(() => selectedTaskId === null ? emptyHighlight : tracePrerequisites(index, selectedTaskId), [index, selectedTaskId]);
  const inspection = useMemo(() => ({ selectedTaskId, highlightedIds }), [selectedTaskId, highlightedIds]);
  const hiddenUpstreamCount = useMemo(() => [...highlightedIds].filter((id) => !visibleIds.has(id)).length, [highlightedIds, visibleIds]);
  useEffect(() => {
    setInspectionId((current) => current !== null && !visibleIds.has(current) ? null : current);
  }, [visibleIds]);
  const onInspectTask = useCallback((id: string) => { setInspectionId((current) => current === id ? null : id); }, []);
  const clearInspection = useCallback(() => { setInspectionId(null); }, []);
  const memberExpansion = getMemberExpansion(index, projection, visibleIds);
  const totalTasks = projection.mainIds.size + projection.externalIds.size;
  const folded = visibleIds.size < totalTasks;
  const nodes = useMemo<TaskFlowNode[]>(() => geometry.nodes.map((node) => ({
    id: node.id, position: node.position, type: 'task', width: node.width, height: node.height,
    style: { width: node.width, height: node.height },
    data: {
      task: index.nodes.get(node.id)!, kind: node.kind,
      center: { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 },
      size: { width: node.width, height: node.height },
      onInspectTask, onOpenTask, onExpandTask,
      revealRequest: action?.kind === 'expand' && action.anchorId === node.id ? action.sequence : null,
      expansions: expansions.get(node.id)!,
    },
  })), [geometry, index, expansions, action, onInspectTask, onOpenTask, onExpandTask]);
  const canvas = useMemo(() => (
    <ReactFlow<TaskFlowNode>
      id={`flow-${groupId}`}
      aria-label={m.canvas}
      aria-describedby={`graph-instructions-${groupId}`}
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
      <InitialViewport geometry={geometry} groupId={groupId} folded={folded} action={action} resetButton={resetButton} />
      <InspectedEdges geometry={geometry} />
      <Background variant={BackgroundVariant.Dots} gap={18} size={0.8} color="#d9dee9" bgColor="#fafbfe" />
      <Controls position="top-right" orientation="horizontal" showInteractive={false} fitViewOptions={viewportFitOptions} />
    </ReactFlow>
  ), [nodes, groupId, geometry, folded, action, clearInspection, m]);
  return (
    <div className={`task-graph${fullscreen ? ' task-graph-fullscreen' : ''}`} data-hidden-upstream-count={hiddenUpstreamCount} data-visible-task-count={visibleIds.size} data-total-task-count={totalTasks} ref={containerRef} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen ? true : undefined} aria-label={fullscreen ? m.fullscreenTitle : undefined} onKeyDown={onKeyDown} onFocusCapture={(event) => { focusedControl.current = event.target as HTMLElement; }}>
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
          {showMemberExpansion && <button className="button graph-expand-members" type="button" aria-disabled={memberExpansion.ids.length === 0}
            data-added-tasks={memberExpansion.ids.length} data-added-edges={memberExpansion.addedEdges} onClick={onExpandMembers}>{m.expandMembers({ count: memberExpansion.totalHidden })}</button>}
          <button className="button graph-reset-overview" type="button" ref={resetButton} onClick={onResetOverview}>{m.resetOverview}</button>
        </div>
      </div>
      <p className="graph-visibility-summary">{m.visibilitySummary({ visible: visibleIds.size, total: totalTasks, edges: geometry.edges.length, totalEdges: projection.edges.length })}</p>
      <p className="graph-hidden-prerequisites" role="status">{hiddenUpstreamCount === 0 ? '' : m.hiddenPrerequisites({ count: hiddenUpstreamCount })}</p>
      <p className="graph-instructions" id={`graph-instructions-${groupId}`}>{m.instructions}</p>
      <div className="task-graph-canvas">
        <TaskInspectionContext value={inspection}>{canvas}</TaskInspectionContext>
      </div>
      <div className="graph-foot"><span>{m.directionLegend}</span><span>{m.externalLegend}</span></div>
    </div>
  );
};

const LayoutError = () => {
  const { messages: { graph: m } } = useI18n();
  return <div className="graph-error" role="alert"><h3>{m.layoutErrorTitle}</h3><p>{m.layoutErrorDescription}</p></div>;
};

const VisibleTaskGraph = ({ projection, ...props }: TaskGraphProps & { projection: GroupProjection }) => {
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
      performance.measure('daynight:task-layout', { start: started, end: performance.now(), detail: { groupId: props.groupId } });
      return { kind: 'ready' as const, geometry };
    } catch (error) { return { kind: 'error' as const, error }; }
  }, [visibleProjection, expansions, props.groupId]);
  const onExpandTask = useCallback((id: string, direction: TaskExpansionDirection) => {
    const expansion = expansions.get(id)![direction];
    if (expansion.ids.length === 0) return;
    setVisibility({ projection, ids: new Set([...visibleIds, ...expansion.ids]) });
    setAction({ kind: 'expand', sequence: ++sequence.current, anchorId: id });
  }, [expansions, projection, visibleIds]);
  const memberExpansion = useMemo(() => getMemberExpansion(props.index, projection, visibleIds), [props.index, projection, visibleIds]);
  const onExpandMembers = useCallback(() => {
    if (memberExpansion.ids.length === 0) return;
    setVisibility({ projection, ids: new Set([...visibleIds, ...memberExpansion.ids]) });
    setAction({ kind: 'members', sequence: ++sequence.current });
  }, [memberExpansion, projection, visibleIds]);
  const onResetOverview = useCallback(() => {
    setVisibility({ projection, ids: createGraphOverview(props.index, projection) });
    setAction({ kind: 'reset', sequence: ++sequence.current });
  }, [props.index, projection]);
  return result.kind === 'error' ? <LayoutError /> : <TaskCanvas {...props} geometry={result.geometry} projection={projection} visibleIds={visibleIds} expansions={expansions} action={action} onExpandTask={onExpandTask} onResetOverview={onResetOverview} onExpandMembers={onExpandMembers} showMemberExpansion={memberExpansion.totalHidden > 0 || action?.kind === 'members'} />;
};

export const TaskGraph = (props: TaskGraphProps) => {
  const result = useMemo(() => {
    try { return { kind: 'ready' as const, projection: projectGroup(props.index, props.groupId) }; }
    catch (error) { return { kind: 'error' as const, error }; }
  }, [props.index, props.groupId]);
  return result.kind === 'error' ? <LayoutError /> : <VisibleTaskGraph key={props.groupId} {...props} projection={result.projection} />;
};
