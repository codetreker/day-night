# Agent Note: Stable Task Dependency Inspection and Smooth Routes

Status: implemented

## Problem

Opening task details on every graph-card activation interrupts tracing a task's
prerequisite path. A shared or externally blocked task can have many ancestors,
so marking only the activated card does not explain that path. Routed polyline
corners also make long dependencies harder to follow. Inspection must retain
all tasks and edges, readable state, stable geometry and a responsive viewport
at the existing project capacity limits.

## Decision

Each graph card has a noninteractive shell with sibling native controls. The
body toggles graph-local dependency inspection and exposes `aria-pressed`; the
Details action exposes `aria-haspopup="dialog"` and opens the existing drawer.
Mouse, Enter and Space activate the focused control. Both controls retain
keyboard offscreen-node positioning. Visibility is computed from the task
layout center, fixed dimensions and current React Flow viewport against the
canvas size. Native focus can temporarily scroll the hidden-overflow container
before React Flow resets that scroll; task DOM bounds during focus can therefore
appear visible and then move offscreen. Layout coordinates retain the intended
view and let either control pan into view at the current readable zoom without
timers or native-scroll mutations. Pointer focus and keyboard focus on an already
visible card leave the viewport unchanged. Standalone rows continue to open
details directly. The project page owns detail resource selection, while the mounted
graph owns inspection; detail opening, closing and relation navigation do not
change inspection, graph coordinates or viewport.

`tracePrerequisites(index, taskId)` returns the selected task and every ancestor
through iterative `dependsOn` traversal. It rejects unknown tasks. The complete
projection already contains those ancestors under the
[context decision](2026-10-22-complete-prerequisite-context.md). A card's state is
normal, selected, prerequisite or unrelated; selection and prerequisites use
distinct borders/backgrounds, unrelated tasks are dimmed, and task status colors,
blocking and shared markers remain readable. Every edge whose target is in the
closure is highlighted, including external-to-external links; arrows and all
paint pieces share the same state. Highlighted external routes remain dashed.
The same card or blank canvas clears inspection, while another card replaces it.

Inspection is not persisted. Project, root, tab and graph unmounts clear it.
Successful snapshots recompute a surviving selection against the new index and
projection; a task removed from that projection clears it. A removed focused
control returns focus to an available graph toolbar control. Failed refreshes
retain the last snapshot and its inspection. No selection changes projection,
layout or initial placement.

`routes.ts` compiles each Dagre route through
`compileDependencyRoute(points, dashed)`, returning canonical `d` and paint
`pieces`. Consecutive duplicates and forward-collinear redundant points are
removed. Every noncollinear corner trims each adjoining span by
`min(12, incomingLength/2, outgoingLength/2)` and uses the original corner as a
quadratic Bézier control point. Canonical `M/L/Q` geometry preserves route
endpoints and initial/final tangent direction; nonfinite input fails explicitly.
It continues consuming Dagre waypoints rather than introducing endpoint-only
routing.

Solid routes use native body paint. Dashed routes retain locally horizontal
rotated long lines and short curve paths, while the canonical route retains
semantics and marker ownership. `dashes.ts` owns `DashPiece` and the 5/4 pattern
with nine-unit period. Adaptive de Casteljau subdivision brackets each quadratic
length between chord and control-polygon bounds. Curves share a per-route length
error budget of 0.025 CSS px at maximum supported zoom 1.8, below the required
0.1 CSS px. Cumulative actual curved length determines the positive dash offset;
long-line cuts remain at gap midpoint phase seven with twelve units of join
room. Solid routes skip arc-length work used only for dashed bodies.

Routes, lengths and pieces compile with layout changes, not inspection. Three
bounded normal/highlighted/unrelated marker variants and matching body styles
provide synchronized edge/arrow presentation. Immutable node presentation
variants retain references whose state does not change, but complete inspection
can restyle many ancestors and unrelated tasks. Its measured cost replaces the
original two-node selection assumption.

This partially supersedes the single-card action and selection assumptions in
the [dashboard decision](2026-10-20-project-task-dashboard.md), and the polyline
compilation in the
[local-coordinate paint decision](../bug-fix/2026-10-20-long-dashed-dependency-paint.md).
The latter retains its pinned Chromium/Skia evidence: full native dashing of long
oblique paths can create raster backpressure, while local-axis long lines permit
culling. Smooth routes preserve that strategy and its 5/4 phase semantics.

The existing four 1,000-node capacity datasets and five expansions per dataset
remain intact. Each adds five `selectMs` observations, each no greater than
300ms, alongside the existing 3,000ms opening and 300ms detail/zoom/pan gates.
Each sample first preserves the original initial-viewport Details → close →
immediate zoom/pan sequence, then focuses a deep sink before trusted selection
timing, and repeats Details → close → immediate zoom/pan while highlighted.
`detailMs`, `zoomMs` and `panMs` retain the worse normal/highlighted value;
`detailNetworkMs` retains the larger observed network duration. Neither
close-to-zoom sequence inserts Fit view, a viewport reset or an extra wait.
The strict inventory stays fifteen native and ten container scenarios. Independent
geometry validation parses `M/L/Q` without importing the production compiler or
graph model as its expected result. Exact quadratic/rectangle intersections and
independent analytic speed integration with near-straight geometric bounds check
endpoints, tangent/marker direction, node avoidance, complete coverage, transformed
pieces and real curved dash phase. `dependency-geometry.test.ts` contains failing
negative cases for missing edges, wrong arrows, node crossings, dash phase and
paint coverage.
Selection checks compare node positions, canonical paths and viewport before and
after highlighting.

The [requirements](../../../../docs/spec/daynight-task-inspection.md) own visible
behavior, the [web design](../../../../docs/design/daynight-web.md) owns current
composition, and the
[acceptance decision](../testing/2026-10-20-dashboard-production-acceptance.md)
owns production execution and receipt interpretation. Centered details and
Markdown descriptions remain separate tasks; the existing drawer and plain
strings continue to serve those paths.

## Alternatives

**Keep card activation coupled to opening details.** This preserves a single
control but prevents persistent upstream inspection without a modal covering
the graph. Sibling controls give inspection and reading independent keyboard
and pointer actions without nested interactive elements.

**Highlight direct predecessors or load ancestors on demand.** Direct-only
highlighting omits the requested transitive path. Adding missing nodes after
selection changes layout while it is being inspected. Pre-expanded ancestor
closure makes selection a presentation update.

**Use endpoint-only cubic Bézier or smoothstep routes.** These helpers replace
Dagre's intermediate route with a new route. Local quadratic rounding retains
its waypoint intent, endpoints and long spans needed for efficient dash paint.

**Draw one full native dashed curved path.** This removes paint-piece handling,
but reintroduces the long oblique native dash-generation cost established by
the earlier raster investigation. Axis-local lines preserve culling while short
paths handle the bounded corners.

**Give every edge a separate marker or recompile routes on selection.** Marker
copies scale with edge count and recomputation repeats immutable geometry work.
Three shared variants provide the needed states while compilation remains tied
to layout.

## Consequences

Inspection and detail resource state now have separate owners and lifecycle
rules. Selection can update a large fraction of the graph; five measurements
per fixed dataset verify the actual local response without weakening the
complete project workload or timing gates. Clearing or changing selection keeps
the same compiled paths, nodes and viewport.

Quadratic length bounds and independent curve oracles add algorithm and
verification obligations. Dependency and rendering changes must retain complete
coverage, tangent arrows, node avoidance, dash continuity and the maximum-zoom
length tolerance. The original polyline raster measurements remain historical
evidence for axis-local paint, not new-source production results; runtime and
hosted conclusions remain attached to their corresponding PR and CI.

Centered reading and Markdown can be added through the existing Details action
and independent drawer resource lifecycle. They do not need to change graph
selection, route compilation or the complete context model.
