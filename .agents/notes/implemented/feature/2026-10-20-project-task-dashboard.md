# Agent Note: Read-only Project Task Dashboard

Status: implemented

## Problem

The complete graph API and pure projection model need a browser workflow that
preserves snapshot meaning during navigation, refresh and detail reads. A live
task detail can differ from a previously loaded graph even when the task's own
timestamp is unchanged, because prerequisite completion changes readiness.
Keyboard users also need one reliable node action and a modal lifecycle that
does not leave background content interactive.

## Decision

The project page owns one validated graph/index snapshot, its client receipt time
and revision. Requests are scoped by project identity and generation; a different
resource cannot render an earlier resource's data. Same-project refresh retains
the last successful snapshot with an explicit loading/error notice, and replaces
statistics, indexes and root rows together after success.

Only one root canvas is mounted. React Flow renders immutable layout data while
editing, connecting, deletion, wrapper focus and interactive-lock controls remain
disabled. Each node has one native button for pointer, Enter and Space activation.
Keyboard focus pans offscreen nodes without changing zoom. Routed edges retain
Dagre's actual points, including noncentral rectangle intersections on branching
edges. Invisible handles are framework bookkeeping/readiness anchors, not the
rendered line endpoints. Fixed public node dimensions and `Node.handles` declare
220-by-96 cards and centered 6-by-6 ports before first measurement. The physical
DOM handles share the size constant and retain native ResizeObserver measurement.
Edges can use that known geometry on their first pass. Declared dimensions and
handle bounds satisfy node readiness with `includeHiddenNodes: true`, while
initial viewport placement still requires the framework viewport and positive
measured canvas dimensions. Line paths continue
to use the exact Dagre points. Changing physical geometry
requires updating declarations and a real-browser bounds regression together.

Initial viewport policy keeps readable zoom. When the graph cannot fit at that
zoom, the chosen root is placed near the left edge and vertically centered;
centering the entire bounding box would open a long chain in its middle. The
policy runs once after initialization, while explicit overview controls may
zoom out further. Selection and viewport movement do not rerun layout.

A layout/callback pair owns immutable ordinary and selected variants for each
node. Selection reuses all unaffected references and swaps only the previous and
next selected variants; closing swaps only the previous selection. React Flow
can therefore update selection styling without rendering every task again. Full
node/edge DOM and geometry remain present, which preserves focus, graph inspection
and complete-capacity assertions. Component tests check the changed-node rendering
counts for open, switch and close transitions. This structure keeps detail-opening
work proportional to changed styling while retaining the full graph.

Each root row is memoized. Collapsed rows receive a stable null selection, so
opening or switching task details does not rerender every unrelated root. Expanded
state, callback and index changes still invalidate the relevant rows; a new
snapshot index refreshes every row and its statistics.

The detail drawer uses a portal outside the application root, background inertness,
body scroll ownership and a dynamic focus trap. Its lifetime is independent of
relation selection. Closing restores the original node or the current root/page
heading when that node is gone. Latest detail data never patches graph statistics.
Readiness, blocking, dependency, status, preview and timestamp differences produce
a refresh notice; a new graph revision rereads the selected detail.

The pinned React Flow dependency needs a declaration-only mapped-type correction
under exact optional property checking. Two system declarations explicitly
intersect their known NodeBase constraint before the generic omission. Runtime
bundles are unchanged; product strictness and library typechecks remain enabled.
Compile-time assertions preserve custom fields and reject explicit undefined
source/target positions. The
[pinned source](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/system/src/types/nodes.ts)
and [runtime conversion](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/system/src/utils/store.ts#L146-L170)
define that relationship. The locked pnpm patch is a build input for local, CI
and container builds.

The [requirements](../../../../docs/spec/daynight-web.md) own behavior and the
[architecture](../../../../docs/design/daynight-web.md) owns module contracts.
[Embedded delivery and isolated deployment](../architecture/2026-10-20-embedded-dashboard-deployment.md)
are implemented. The [production acceptance harness](../testing/2026-10-20-dashboard-production-acceptance.md)
verifies both targets and fixed capacity without changing page runtime policy.

## Alternatives

**Update graph nodes from detail responses.** That mixes independent reads and
can leave global counts or related nodes inconsistent. Explicit stale detection
and complete snapshot replacement retain the single-snapshot meaning.

**Keep the default interactive canvas controls.** The lock control can re-enable
editing, and wrapper keyboard selection does not open task details. A single
native button plus explicit read-only props implements the intended actions.

**Recreate every node data object on selection.** The selection becomes visible,
but all task props change and a detail action can rerender the complete
1,000-node graph. Canonical ordinary/selected variants preserve the immutable
layout and limit updates to the styling that actually changed.

**Always center the complete graph at a clamped readable zoom.** In a thousand-node
chain, its root falls far outside the viewport. Root anchoring preserves the
starting point while retaining pan and overview controls.

**Disable library type checking or widen all optional positions.** That hides the
generic constraint defect or weakens the declared input contract. The scoped
declaration patch and negative type assertions keep those checks meaningful.

## Consequences

Project browsing now reaches real statistics, dependency diagrams and task
details. Controlled component tests cover state/focus transitions, while a local
production-bundle browser check also uses the real Go API and PostgreSQL. The
[acceptance report](../../../../docs/research/daynight-web-acceptance.md) distinguishes
the earlier preview observations from passing local production-browser results
and pending clean hosted performance/source verification. Dependency upgrades must revisit the declaration patch and type tests.
