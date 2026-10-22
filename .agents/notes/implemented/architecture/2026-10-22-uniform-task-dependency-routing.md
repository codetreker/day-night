# Agent Note: Uniform Channels for Dependency Inspection Routes

Status: implemented

## Problem

Smooth dependency inspection needs stable geometry, clear edge direction and
routes outside visible task-card interiors. Node placement and routed edge
points are different guarantees. Preserving a layout library's raw endpoint
spans does not itself establish the product's card-clearance requirement, while
multiple per-edge repair strategies make that requirement difficult to verify.

## Decision

The adopted replacement design keeps current visible-node placement and order,
and gives every visible dependency the same horizontal/vertical column-channel
planning rule. Source ports are right-center and target ports left-center.
Shared placed-card geometry uses each CanvasNode's actual width and height:
220 by 96 without expansion controls, or 220 by 136 with the footer. It owns
the available column gaps and free passages;
route planning retains sixteen units of clearance for bounded quadratic corner
rounding of at most twelve units. Every visible real induced edge is retained,
with forward horizontal endpoint direction and no card-interior crossing.
The planner implements this mechanism and builds columns and sixteen-unit
expanded occupied-row intervals once, interpolates intended height at each
intermediate column center, picks the nearest free row and transitions only at
gap midpoints, coalescing equal rows. There is no conditional collision-repair
path or raw-port compatibility branch.

This replaces the raw-Dagre-point retention target in the
[inspection design decision](2026-10-22-task-inspection-design.md). That initial
choice preserved lane intent and long straight spans so local-axis dash painting
could be reused. The replacement assigns ports and avoidance to one uniform
planner instead of keeping invalid endpoint shapes through special repairs.
Dagre continues to own node placement; product routing owns all edge geometry.

The smooth compiler rounds the planned channels, and its geometry remains tied
to visible layout changes. Graph-local inspection Context updates only node,
body and arrow presentation while controlled geometry remains stable. True curve
arc length preserves the existing 5/4 dash phase and maximum-zoom tolerance;
long straight spans retain the existing local-axis paint mechanism. Independent
checks must validate actual rendered routes rather than treating planner output
as their expected valid geometry.

The [progressive overview](../feature/2026-10-22-progressive-task-graph.md) remains
the delivered PR134 baseline: fifty tasks/one hundred induced edges initially,
explicit twenty-neighbor batches, global reset, full P and actual visible S.
Highlighting does not expand, relayout or move the viewport. Details continues
through the current centered dialog, attachment panels/reader, locale and
resource owners.

The abandoned [PR #121](https://github.com/codetreker/daynight/pull/121) is history,
not a required integration or current verification artifact. Its runtime results
do not establish this replacement's geometry or performance. The
[requirements](../../../../docs/spec/daynight-task-inspection.md) and
[design](../../../../docs/design/daynight-task-inspection.md) own the new observable
acceptance and mechanism; [PR #143](https://github.com/codetreker/daynight/pull/143) owns fresh production evidence.

## Alternatives

**Round raw library edge points.** This retains the existing waypoint sequence
and was the original target because it preserves long paint spans. It leaves
endpoint choice and clearance dependent on raw routes instead of one explicit
product rule.

**Repair only blocked spans or preserve old ports with special stubs.** This
creates multiple path-construction cases around an endpoint rule that does not
match the intended lateral entry/exit. Uniform channels make the same port,
clearance and rounding guarantees apply to every edge.

**Move task cards to accommodate edges.** That changes the established visible
layout while solving a routing problem. Keeping node geometry and inspection
state separate preserves spatial context and makes selection stability testable.

## Consequences

Node placement, route planning, smooth compilation and inspection paint have
explicit owners. The channel planner adds geometry work only when visible
structure changes; selecting a task must not repeat it. Actual opening and local
feedback remain subject to the existing production budgets.

Independent geometry and negative controls must cover all visible dependencies,
ports, tangency, card avoidance, real body coverage, dash phase and arrows.
Recorded runs are evidence only for their exact source; neither the adopted
design nor the abandoned attempt supplies a replacement pass.
