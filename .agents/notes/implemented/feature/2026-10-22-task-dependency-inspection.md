# Agent Note: Stable Task Dependency Inspection and Smooth Routes

Status: implemented

## Problem

Opening details on every graph-card activation interrupts tracing prerequisite
paths. Marking only the activated task cannot explain shared and external
ancestry. Inspection needs readable task state, synchronized dependencies and
stable geometry, with reading available as an independent action.

## Decision

Cards use a noninteractive shell with sibling native body, Details and
prerequisite/successor expansion controls. Body toggles inspection and exposes
`aria-pressed`; Details exposes `aria-haspopup="dialog"` and opens the delivered
centered TaskDetailDialog. Pointer, Enter and Space operate the focused control. Standalone rows
still open details directly. The project page owns detail resources; the mounted
graph separately owns inspection and progressive visible IDs.

`tracePrerequisites(index, taskId)` returns the selected task plus every ancestor
from complete data, rejecting unknown IDs. Under the
[progressive-view decision](2026-10-22-progressive-task-graph.md), only visible H
and their real induced connections are highlighted, while |H−S| reports hidden
ancestors once by ID. Selection never expands, relayouts or moves the viewport.
The same card or blank canvas clears it, and another card replaces it. Selected,
prerequisite, unrelated and normal states preserve status colors, blocking,
sharing and external dashes, including the proposed reader state. The existing
four-state main-set aggregation and seven project statistics remain independent
of visible S; inspection adds no lifecycle writes. Details and relation
navigation leave it unchanged.

Graph-local `TaskInspectionContext` supplies inspection state directly to task
shells. Controlled React Flow node/data keeps task, geometry, membership and
stable callbacks, and the canvas element is memoized. `TaskNodeContent` preserves
title/status/shared/external content. The original detail-coupled selection
changed at most two tasks; complete inspection can change many shell styles,
so its actual `selectMs` remains a measured gate rather than a two-node assumption.

Keyboard visibility uses layout center, fixed 220-by-136 card dimensions and the
current viewport. Native focus can temporarily scroll the hidden-overflow
container before React Flow resets it, making task DOM bounds an unreliable
visibility input. Either focus control can pan into view at the existing zoom;
pointer and already-visible keyboard focus preserve the viewport. Explicit
expansion centers the anchor at current zoom and focuses its body; global reset
frames the overview and retains reset focus. These structural actions are
separate from selection.

Successful refresh retains valid actual visible IDs plus root and prunes to its
induced root-connected component; it adds no new baseline automatically. A still
visible selection recomputes full H; an invisible one clears. Failed refresh
keeps old data, visible IDs, selection and viewport. Project/root/tab changes or
unmount release local state. Reconciliation never steals an open dialog's focus;
a vanished trigger uses existing close-time fallback.

The [routing decision](../architecture/2026-10-22-task-dependency-routing.md)
keeps Dagre positions/order for the visible graph and plans right-center to
left-center obstacle-free connections. `compileDependencyRoute(points, dashed)`
then generates canonical M/L/Q and optional paint pieces, rounding noncollinear
corners with symmetric `min(12, incoming/2, outgoing/2)` trim. Invalid coordinates
fail. This replaced the original raw-Dagre endpoint/waypoint retention because
existing straight endpoint spans could cross other cards before rounding.

Dashed bodies keep locally horizontal rotated long lines and short native curve
paths under the [paint decision](../bug-fix/2026-10-20-long-dashed-dependency-paint.md).
Adaptive de Casteljau chord/control-polygon bounds allocate a per-route curve
length error of 0.025 CSS px at maximum 1.8 zoom. Actual cumulative arc length
preserves the 5/4 phase and gap-midpoint seams. The declarative native SVG uses
three constant direct-RGB normal/highlighted/unrelated markers on canonical
paths. `.task-dependency-body` owns local stroke, with primitive inheritance.
Geometry compiles only when the visible layout changes; selection reuses paths
and pieces while body and arrow presentation change together.

This partially supersedes the single action and role-bearing node variants in
the [dashboard decision](2026-10-20-project-task-dashboard.md). Stable framework
geometry and local context separate presentation from layout without changing
portal, inertness, scroll ownership or focus restoration.

Four complete 1,000-task capacity input matrices retain their exact 999/5,000
edges and five samples. The progressive view changes readiness to its complete
bounded overview and induced edge set, plus explicit expansion/reset and hidden
ancestor correctness. `openMs ≤ 3000` and selection/detail/zoom/pan ≤300 remain;
normal Details → close → immediate zoom/pan precedes visible-task selection and
the highlighted sequence. Per-metric worse-state values and independent network
timing remain, with no reset, Fit view or waiting between close and zoom.

Independent topology expectations use API identities, complete dependsOn and
intended visible IDs/induced edges. Optional declared compiler inputs check only
fidelity, never planner validity. Fixed DOM ports, horizontal ends, every Q's
symmetric twelve-unit trim/tangency, visible-card avoidance, complete visible
body coverage, true arc length, dash phase and native markers remain independent
and unconditional. Missing/extra edges, wrong arrows, crossings and phase/coverage
negative cases fail. Runtime and capacity evidence remain source-bound delivery
gates; neither this decision nor pure tests establish a pass.

## Alternatives

**Keep one card action coupled to details.** This preserves a simple button but
cannot leave an upstream path under inspection without a modal covering it.
Sibling native controls distinguish reading, selection and structural expansion.

**Highlight only direct or currently visible prerequisites.** This hides the
transitive dependency meaning. Full H plus visible paint and a deduplicated hidden
count retains complete semantics without automatically expanding the graph.

**Keep inspection roles in controlled node data.** Ordinary component updates
preserve coordinate values but change framework geometry objects on selection.
Local context keeps those objects stable while shells update their own state.

**Retain the complete projection always rendered.** The original decision made
all ancestors immediately available and selection purely presentational. The
progressive-view decision keeps complete data and presentation-only selection
while making expansion explicit for both main and external tasks.

**Use endpoint-only curves or retain raw endpoints.** The original local-rounding
choice preserved lane intent and efficient long spans. The routing decision
retains those benefits while making fixed ports and complete visible-card
avoidance a product responsibility.

## Consequences

Visibility, inspection, detail resources and geometry have separate owners.
Structural expansion/reset and snapshot reconciliation can change layout;
selection and reading cannot. Hidden ancestors remain observable by exact count,
and all displayed connections remain real induced dependencies.

Centered reading and Markdown stay in their own tasks. They use the existing
Details action and resource lifecycle without changing visible-set ownership,
selection semantics or route compilation. API, task fields and persisted browser
preferences retain their formats.
