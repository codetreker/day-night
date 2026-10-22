# Agent Note: Side Ports and Obstacle-Free Dependency Routes

Status: implemented

## Problem

A task dependency route must remain outside task-card interiors and show a clear
left-to-right entry and exit. Dagre can place a route endpoint on a rectangle
side according to its nearest route point, but that endpoint span can cross a
different card. Rounding bends preserves those existing straight crossings.
Node placement and the library's routed points therefore do not by themselves
establish the product's complete node-avoidance requirement.

## Decision

`routing.ts` exports `RoutingNode` rectangles (`id`, `left`, `top`, `right`,
`bottom`) and `planDependencyRoutes(nodes, edges)`. The layout adapter builds
those rectangles from the fixed node dimensions and invokes the planner once.
Dagre remains the owner of coordinates, rank order and intermediate lane intent
for the current visible induced graph. The planner connects every dependency from its source right-center port
to target left-center port, preserving task positions/order and graph membership.
Explicit lateral ports make departure and entry horizontal across ordinary,
shared and external prerequisites.

A shared column and vertical-interval index identifies free passages. Raw Dagre
anchors inside intermediate card columns retain lane intent; free-gap-only
vertical detours are discarded. Clear interior straight spans remain intact.
Blocked spans use free rows within card columns and horizontal/vertical channels
at rank-gap midpoints. Chosen passage rows stay at least sixteen units from
cards, and twelve-unit expanded-rectangle clearance protects the bounded
quadratic corners. Routes remain forward in x; invalid or unsatisfied geometry
fails explicitly.

The planned point sequence is the input to smooth-route compilation. Bounded
quadratic corner rounding, actual curved arc length, the 5/4 dash phase,
axis-local long-line body paint remain governed by the
[inspection decision](../feature/2026-10-22-task-dependency-inspection.md). The [progressive-view decision](../feature/2026-10-22-progressive-task-graph.md)
owns the visible subset; canonical routes use the inspection renderer's three
constant direct-RGB native markers and local body stroke inheritance.
Selection still reuses immutable geometry and changes only presentation. The
existing viewport policy and all interaction, graph-membership and progress
semantics remain unchanged.

This supersedes exact raw-Dagre endpoint, tangent and waypoint retention in the
initial inspection mechanism. That original choice was reasonable because it
kept the layout's intermediate route and long spans, preserving the proven
[local-coordinate paint strategy](../bug-fix/2026-10-20-long-dashed-dependency-paint.md)
while adding small quadratic corners. Complete geometry inspection exposed
crossings in unsmoothed first or last spans, making the rectangle-intersection
endpoint an insufficient boundary. The pinned library
[assignNodeIntersects](https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/layout.ts#L584)
and [rectangle intersection](https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/util.ts#L115)
implement the endpoint calculation; that operation has no complete obstacle
index for other cards. The product planner now owns fixed ports and avoidance;
the library still owns node placement and lane intent.

The [projection/layout decision](../feature/2026-10-20-task-graph-projection.md)
continues to own complete graph semantics, deterministic insertion, the global
longest-path ranker and the pinned redundant-scan patch. Its patched/unpatched
Dagre differential checks continue comparing raw library output. Product-route
checks independently compare fixed source-right-center and target-left-center
ports with actual DOM card rectangles and require positive horizontal first and
last tangents. They verify the complete visible induced edge set and avoidance of every visible card,
then validate the smoothed canonical path and paint pieces.
`GeometryExpectation` contains only independently derived API task IDs,
`dependsOn` closure and edge/external membership; workflow and capacity build
that expectation without production planning. An optional separate
`compilerInputs` value may declare the layout point sequences supplied to the
compiler, solely to check compilation fidelity. Those points are input evidence,
not expected planner geometry. Fixed DOM ports, horizontal endpoints, all-node
avoidance, every quadratic's symmetric trim no greater than twelve units and
tangency, complete paint coverage, independently integrated real arc length,
dash phase and markers are always checked, including capacity runs and when no
compiler inputs are supplied. No cloned planner or expected compiled curve
establishes validity.

Real-service, container and complete capacity validation remain delivery gates
for this adopted routing mechanism. The four fixed complete input graphs and five repetitions remain unchanged.
The progressive view validates bounded overviews and complete visible induced
edges rather than requiring every input edge in the DOM at once. The 3,000ms
opening budget and 300ms local-feedback
budgets, original normal/highlighted interaction sequences, strict scenario
inventory and timeouts remain required. No revised performance or all-capacity
pass is inferred from the design or pure geometry tests.

The [inspection design](../../../../docs/design/daynight-task-inspection.md)
owns composition, and the [Web design](../../../../docs/design/daynight-web.md)
owns current layout and rendering responsibilities. The
[requirements](../../../../docs/spec/daynight-task-inspection.md) require stable
smooth dependency inspection and complete node avoidance.

## Alternatives

**Retain raw Dagre endpoints and only round corners.** This preserves exact
library geometry and the original implementation boundary. It also retains
straight endpoint spans that cross unrelated cards, so changing corner radius
cannot establish avoidance.

**Add short stubs and paired lanes around the original ports.** This keeps an
endpoint whose location and direction already require repair, while adding
special connector geometry solely to return to it. Fixed lateral ports remove
that dependency and give channel planning one coherent entry/exit rule.

**Change task positions or order to accommodate routes.** This could remove
some intersections but changes the graph's established layout and viewport
position while solving an edge-routing problem. Keeping node placement fixed
preserves the user's spatial context and the existing layout contract.

**Use a single endpoint-only curve helper.** A direct curve has no complete
obstacle model or rank-gap channel ownership. Explicit route planning uses the
placed cards and lane intent before local smoothing and long-line painting.

## Consequences

Layout output and product routes have distinct guarantees. Exact Dagre-output
comparisons protect the pinned optimization, while independent side-port and
node-avoidance checks protect browser geometry. Future layout or planner changes
must retain both checks rather than treating library equivalence as evidence of
route clearance.

The planner adds geometric work before route compilation; its cost belongs to
the unchanged opening budget. Smooth compilation, dash lengths and pieces still
run only for a new layout. Selection, detail opening and viewport movement reuse
the resulting route. Real capacity results remain attached to their source,
environment and corresponding PR or CI run.

Ports are a product rendering rule, not a stored task field or new graph edge.
No API, task data, dependency membership, chain status or browsing-preference
format changes are required.
