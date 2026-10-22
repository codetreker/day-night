# Agent Note: Task Graph Projection and Layout

Status: implemented

## Problem

A dependency DAG can have multiple roots and shared descendants. Treating it as
a tree duplicates counts and hides prerequisites outside a selected root's
forward path. Layout also needs stable coordinates without coupling graph
meaning to browser components or interactions. At the declared graph limits,
layout must retain complete geometry while meeting the browser opening budget;
long-edge normalization can increase work beyond original node/edge counts.

## Decision

The web graph model validates a complete snapshot before building indexes. It
checks unique nodes and references, dependency closure, acyclicity, status,
blocked-by and readiness consistency, summary counts, and the declared size
limits. Invalid snapshots fail as a whole. Root order preserves the backend's
exact response order; JavaScript millisecond dates do not reorder database
timestamps with finer precision. The
[presentation decision](2026-10-21-task-chain-presentation.md) owns the separate
newest-first category lists; they consume reversed copies without changing this
index. The [task view decision](2026-10-22-project-task-views.md) classifies
standalone nodes from zero incoming and outgoing edges in this complete index,
then keeps non-isolated roots in the chain presentation. Status and visibility
filters do not alter topology or projection.

For one root, the main set is the root and its forward-reachable descendants.
The original projection added only their direct predecessors outside that main
set, stopping at that explicit boundary. This kept direct blockers visible
without recursively importing context. The later
[complete prerequisite context decision](2026-10-22-complete-prerequisite-context.md)
replaces that boundary with the full ancestor closure and all required edges,
while retaining main-set membership. Per-root progress counts only distinct main
nodes; project totals count all tasks once. Root progress also carries the
aggregate status
owned by the [chain status decision](../bug-fix/2026-10-22-task-chain-status.md);
its count and state derive from the same main-set traversal. Shared membership
and root progress are derived once
per snapshot without a global mutable cache.

The separate Dagre adapter uses a new flat directed graph for each calculation,
sorted node and edge insertion, left-to-right ranks, one global longest-path
ranker and 220px-wide cards. The original cards were 220 by 96; the
[progressive overview](2026-10-22-progressive-task-graph.md) introduced 136px
heights for direction controls. The [conditional footer decision](../bug-fix/2026-10-22-task-card-expansion-footer.md)
uses 96px when no expansion is available and 136px when controls are present,
with the actual dimensions shared by layout and rendering.
It converts returned node centers to top-left positions and retains the routed
edge points. Empty projections return explicit zero bounds before calling Dagre;
nonempty output must have finite coordinates and valid node bounds. No React,
DOM, network or task mutation is involved in these modules.

The dependency is pinned to Dagre 3.1.1 with bundled TypeScript declarations.
The [pinned layout implementation](https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/layout.ts#L372-L405)
owns coordinate propagation. One explicit ranker gives predictable ranking
without per-graph timing heuristics. Longest-path can lengthen edges; normalization
creates dummy vertices according to rank spans, so work depends on the sum of
those spans as well as original node/edge counts. The product keeps Dagre's
default crossing minimization, ordering and alignment behavior. Canvas components
consume the resulting data rather than recomputing dependency semantics from
visible edges.

A single pnpm runtime patch targets the pinned public ESM and CJS builds. It
removes two redundant scans while preserving their result and event order:

- A flat graph with no `borderType` vertices cannot produce type-2 border
  conflicts, so its otherwise empty scan is skipped.
- Equal truthy barycenters use ordered buckets. The global outer event order,
  reverse candidate-pair sequence and reference removals remain the same as the
  original scan, preserving equal-key tie behavior and output geometry.

The pinned [type-2 scan](https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/position/bk.ts#L92-L145)
and [barycenter scan](https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/order/sort-subgraph.ts#L59-L94)
are the semantic references. Differential checks compare complete geometry with
unpatched Dagre under the same longest-path policy in both module formats. This
patch equivalence does not mean changing the ranker preserves network-simplex
geometry. Dependency upgrades require renewing those exact-output and ordering
checks, along with all-node/all-edge left-to-right and overlap assertions. The mandatory
`web:test` native suite reconstructs pristine bundles in memory by reversing the
committed patch and verifying published SHA-256 values. Its 23 fixtures, four
directions and three rankers cover both public exports and deterministic complete
geometry; direct equal-barycenter, reversed-pair removal and `usedBias` assertions
preserve the ordering cases. License links and stale source-map declarations are
checked without storing another copy of the dependency.

The [production acceptance decision](../testing/2026-10-20-dashboard-production-acceptance.md)
owns browser measurements and source/image receipts. Pure algorithm probes do not
establish production browser timing.

The [progressive overview decision](2026-10-22-progressive-task-graph.md) derives
a visible subset after complete root projection; it does not change full main-set
progress, state aggregation or project statistics. The
[requirements](../../../../docs/spec/daynight-web.md) own visible behavior,
the [architecture](../../../../docs/design/daynight-web.md) owns module contracts,
and the [task document](../../../../docs/design/daynight-web-tasks.md) tracks UI
integration and browser performance acceptance separately.

## Alternatives

**Use only reachable nodes and omit other predecessors.** A shared task could
appear unblocked even though another root's prerequisite is unfinished. Explicit
boundary nodes preserved those direct dependencies without recursively expanding
unrelated ancestry. Complete transitive inspection later required the ancestor
closure recorded by the replacement decision.

**Compute progress from rendered nodes or sum root counters.** External context
would inflate one chain and shared descendants would inflate the project. The
model keeps project, root-main and external-context counts distinct.

**Let the canvas library own graph grouping and layout state.** This couples
domain checks to browser state and makes deterministic projection tests harder.
Pure indexes and a fresh layout graph separate those responsibilities.

**Disable crossing minimization or force an alignment to reduce work.** These
change visible node ordering or routing behavior. The selected patch removes
redundancy while retaining default crossing minimization and coordinate behavior
for the chosen global ranker.

**Replace the layout library.** A replacement would require establishing routing,
geometry and interaction behavior again. The pinned implementation provides the
required graph output after the narrowly specified redundant scans are removed.

## Consequences

Graph semantics have direct pure-function tests, and layout tests run the real
pinned dependency across branches, diamonds, shared and external predecessors.
Model and layout belong to the complete web source manifest and strict coverage
gate. Indexing and one-root reachability are linear in nodes plus edges; all-root
progress may require one traversal per root within the declared project limits.

The module owns layout data; the implemented task canvas owns rendering, focus
and viewport behavior. Fixed-topology capacity fixtures retain exact node/edge
counts and five repetitions on the same IDs. Their timings are evidence for that
matrix and environment, not an arbitrary-DAG latency guarantee. Long rank spans
can enlarge normalized graphs, and longest-path can increase edge lengths. These
trade-offs and the version-specific runtime patch require exact differential
regressions when Dagre changes. Layout policy and geometry remain unchanged as
the canvas moves immutable edges to one static SVG. Earlier local browser
capacity evidence stays historical. The current local-coordinate dashed-paint
renderer passes its own complete local capacity matrix. Production acceptance is
delivered through [PR #52](https://github.com/codetreker/daynight/pull/52), whose
PR and CI own the source-bound results.
