# Agent Note: Task Graph Projection and Layout

Status: implemented

## Problem

A dependency DAG can have multiple roots and shared descendants. Treating it as
a tree duplicates counts and hides prerequisites outside a selected root's
forward path. Layout also needs stable coordinates without coupling graph
meaning to browser components or interactions.

## Decision

The web graph model validates a complete snapshot before building indexes. It
checks unique nodes and references, dependency closure, acyclicity, status,
blocked-by and readiness consistency, summary counts, and the declared size
limits. Invalid snapshots fail as a whole. Root order preserves the backend's
exact response order; JavaScript millisecond dates do not reorder database
timestamps with finer precision.

For one root, the main set is the root and its forward-reachable descendants.
The boundary set contains the main set's direct predecessors that are outside
that main set. Boundary ancestors stop expanding. Every edge ending in the main
set remains visible. Per-root progress counts only distinct main nodes; project
totals count all tasks once. Shared membership and root progress are derived once
per snapshot without a global mutable cache.

The separate Dagre adapter uses a new flat directed graph for each calculation,
sorted node and edge insertion, left-to-right ranks and fixed 220-by-96 cards.
It converts returned node centers to top-left positions and retains the routed
edge points. Empty projections return explicit zero bounds before calling Dagre;
nonempty output must have finite coordinates and valid node bounds. No React,
DOM, network or task mutation is involved in these modules.

The dependency is pinned to Dagre 3.1.1 with bundled TypeScript declarations.
The [pinned layout implementation](https://github.com/dagrejs/dagre/blob/c3ed0802cd98de74c21cff1f754689ebbb0f8dae/lib/layout.ts#L372-L405)
owns coordinate propagation. Canvas components consume the resulting data rather
than recomputing dependency semantics from visible edges.

The [requirements](../../../../docs/spec/daynight-web.md) own visible behavior,
the [architecture](../../../../docs/design/daynight-web.md) owns module contracts,
and the [task document](../../../../docs/design/daynight-web-tasks.md) tracks UI
integration and browser performance acceptance separately.

## Alternatives

**Use only reachable nodes and omit other predecessors.** A shared task could
appear unblocked even though another root's prerequisite is unfinished. Explicit
boundary nodes preserve those direct dependencies without recursively expanding
unrelated ancestry.

**Compute progress from rendered nodes or sum root counters.** Boundary context
would inflate one chain and shared descendants would inflate the project. The
model keeps project, root-main and boundary counts distinct.

**Let the canvas library own graph grouping and layout state.** This couples
domain checks to browser state and makes deterministic projection tests harder.
Pure indexes and a fresh layout graph separate those responsibilities.

## Consequences

Graph semantics have direct pure-function tests, and layout tests run the real
pinned dependency across branches, diamonds, shared and external predecessors.
Model and layout belong to the complete web source manifest and strict coverage
gate. Indexing and one-root reachability are linear in nodes plus edges; all-root
progress may require one traversal per root within the declared project limits.

The module provides layout data, not an implemented task canvas. Actual browser
rendering, focus, viewport behavior and maximum-size timing remain subsequent
dashboard tasks and must be verified against the production application.
