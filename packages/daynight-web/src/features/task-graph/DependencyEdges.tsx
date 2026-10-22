import { memo, useId, useMemo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { DEPENDENCY_DASH_ARRAY, DEPENDENCY_DASH_PERIOD } from './dashes';
import type { TaskInspection } from './inspection';
import type { CanvasEdge, CanvasLayout } from './layout';
import { compileDependencyRoute } from './routes';

type Presentation = 'normal' | 'highlighted' | 'unrelated';
type EdgeRoute = { readonly edge: CanvasEdge; readonly route: ReturnType<typeof compileDependencyRoute> };
type Props = { readonly geometry: CanvasLayout; readonly inspection: TaskInspection };

const colors = { normal: '#abb2c7', highlighted: '#6762ce', unrelated: '#c7cddb' };
const bodyStyle = { fill: 'none', stroke: 'inherit', strokeWidth: 1.5, pointerEvents: 'none' } as const;
const dashedStyle = { ...bodyStyle, strokeDasharray: DEPENDENCY_DASH_ARRAY, strokeLinecap: 'butt', strokeLinejoin: 'miter' } as const;

const DependencyPaint = memo(({ route }: Pick<EdgeRoute, 'route'>) => <>
  {route.pieces.map((piece, position) => {
    const properties = {
      className: 'task-dependency-paint-piece', 'data-piece-kind': piece.kind,
      'aria-hidden': true as const, focusable: false as const,
      style: { ...dashedStyle, strokeDashoffset: piece.startDistance % DEPENDENCY_DASH_PERIOD },
    };
    return piece.kind === 'line'
      ? <line key={position} {...properties} x1="0" y1="0" x2={piece.length} y2="0" transform={`matrix(${piece.cos} ${piece.sin} ${-piece.sin} ${piece.cos} ${piece.from.x} ${piece.from.y})`} />
      : <path key={position} {...properties} d={piece.d} />;
  })}
</>);

const DependencyEdge = memo(({ edge, route, presentation, markerId }: EdgeRoute & { presentation: Presentation; markerId: string }) => (
  <g className="react-flow__edge task-dependency-edge"
    data-id={edge.id} data-source={edge.source} data-target={edge.target} data-external={edge.external} data-inspection={presentation}
    role="img" aria-label={`前置任务 ${edge.source} → 后续任务 ${edge.target}${presentation === 'highlighted' ? '，所选依赖路径' : ''}`}
    focusable="false" style={{ pointerEvents: 'none' }}>
    <g className="task-dependency-body" stroke={colors[presentation]} aria-hidden="true" focusable="false">
      {edge.external && <DependencyPaint route={route} />}
      <path className="react-flow__edge-path" data-source={edge.source} data-target={edge.target} data-external={edge.external}
        d={route.d} markerEnd={`url(#${markerId}-${presentation})`} aria-hidden="true" focusable="false"
        style={edge.external ? { ...bodyStyle, stroke: 'none' } : bodyStyle} />
    </g>
  </g>
));

export const DependencyEdges = memo(({ geometry, inspection }: Props) => {
  const markerId = `task-dependency-arrow-${useId()}`;
  const routes = useMemo(() => geometry.edges.map((edge) => ({ edge, route: compileDependencyRoute(edge.points, edge.external) })), [geometry]);
  return <ViewportPortal>
    <svg className="task-dependency-edges" data-testid="task-dependency-edges"
      data-paint-piece-count={routes.reduce((count, view) => count + view.route.pieces.length, 0)}
      width="100%" height="100%" role="group" aria-label="任务依赖关系" focusable="false" style={{ pointerEvents: 'none' }}>
      <defs>
        {(Object.keys(colors) as Presentation[]).map((presentation) => <marker key={presentation} id={`${markerId}-${presentation}`}
          markerWidth="16" markerHeight="16" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
          <polyline className="arrowclosed" points="-5,-4 0,0 -5,4 -5,-4" stroke={colors[presentation]} fill={colors[presentation]}
            strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </marker>)}
      </defs>
      {routes.map((view) => <DependencyEdge key={view.edge.id} {...view} markerId={markerId}
        presentation={inspection.highlighted === null ? 'normal' : inspection.highlighted.has(view.edge.target) ? 'highlighted' : 'unrelated'} />)}
    </svg>
  </ViewportPortal>;
});
