# Agent Note: Progressive Task Graph Overview

Status: implemented

## Problem

A complete chain context can contain nearly every task and dependency in a
project. Rendering all of it at once makes the initial view difficult to read
and makes a local selection repaint the entire graph. A useful task inspection
view must keep complete dependency data and accurate progress while letting the
reader control how much graph is visible.

## Decision

`projectRoot` continues to compute complete context P: the root and all reachable
successors form main set M; every ancestor of M is included, and P−M is external
context. Unrelated successors of external tasks remain outside P. Project
statistics and root progress/status retain their full-data meanings. Only the
visible set S is progressive, for both main and external tasks.

If P has at most fifty tasks and one hundred dependencies, S initially contains
all P. Otherwise the overview starts at the root and runs stable undirected BFS:
for each accepted task, consider direct successors first and prerequisites
second, each in snapshot order and restricted to P. Accept a candidate only if
S remains at most fifty tasks and its complete induced edge set remains at most
one hundred dependencies. Queue only accepted tasks. Consider each candidate
once. These are initial overview limits, not task-data or manual expansion limits.

Each visible card has explicit prerequisite and successor expansion controls.
One activation adds at most twenty currently hidden direct neighbors in the
chosen direction, within P and in stable snapshot order. It does not recurse.
The control states the exact number of new tasks and new real dependencies for
that batch, including edges among added tasks. There is no manual edge cap, so a
dense neighbor remains reachable and explicit expansion can exceed the initial
fifty/one-hundred overview. Shared tasks are added once by ID.

The graph always draws every real dependency with both endpoints in S. It draws
no shortcut edges, aggregate nodes or invented dependency links. Cards are 220 by 136 pixels: a 94px body, a constant 40px two-column expansion
footer and two border pixels; an unused direction column stays blank. Toolbar
counts distinguish visible tasks/dependencies from complete P; full M progress and
project totals remain independent of S. Completed tasks follow the same topology
rules and may be expanded like any other task.

Selection computes H, the selected task plus all its ancestors, from complete
data. Visible members of H and their real induced edges receive the established
node/body/arrow highlight. The view also reports |H−S|, counting hidden ancestors
once by task ID. Selection never adds tasks, changes layout or moves the viewport.
Details and relation navigation remain independent.

A single “收起到概览” control recomputes the initial overview and frames its
viewport. It retains selection only if that task remains visible, otherwise
clears it; focus remains on the stable reset control. Per-card expansion may
relayout S, centers its anchor at the current zoom and focuses the anchor body. There is no per-branch fold.

Successful refresh intersects the actual old visible IDs with new P, adds the
root, and keeps only the root-connected component through real undirected
induced edges. Removed or disconnected tasks leave S permanently. It does not
union a newly computed baseline or silently introduce newly arrived tasks.
Reset or remount computes a new baseline. A surviving visible selection is
recomputed against the full new context; an invisible selection clears. Failed
refresh retains prior data, S, selection and viewport. Project, root, tab and
canvas unmounts discard local visibility state.

Refresh and visibility changes do not steal focus from an open detail dialog.
Existing close-time fallback handles a vanished detail trigger. Keyboard focus
on visible card controls keeps the existing readable-zoom behavior; selection
itself does not focus or reveal hidden tasks.

This partially supersedes always-visible complete context in the
[UX1 context decision](2026-10-22-complete-prerequisite-context.md). UX1 supplied
complete, deduplicated ancestors and removed ambiguous omitted-upstream labels;
those data guarantees remain. The original choice rendered that closure before
inspection so selection could be purely presentational. Progressive visibility
retains that property with explicit expansion and hidden-ancestor counts, while
making the initial diagram bounded. The
[inspection decision](2026-10-22-task-dependency-inspection.md) owns selection and
smooth highlighting, and the [routing decision](../architecture/2026-10-22-task-dependency-routing.md)
owns geometry for the current visible induced graph.

Production inputs remain the four existing 1,000-task capacity datasets, their
exact 999/5,000 dependency counts, five samples, 3,000ms opening and 300ms local
feedback budgets. Browser checks now establish the bounded visible overview,
complete induced edges, explicit expansion/reset and accurate hidden upstream
counts, rather than requiring all input tasks and dependencies in the DOM at
once. The API still rejects projects exceeding 1,000 tasks or 5,000 dependencies.
Every visible route, body piece and arrow retains independent geometry checks.
Source-bound production evidence remains a delivery requirement.

The [requirements](../../../../docs/spec/daynight-task-inspection.md) own visible
behavior; the [design](../../../../docs/design/daynight-task-inspection.md)
explains the model and the [task breakdown](../../../../docs/design/daynight-task-inspection-tasks.md)
keeps UX1's historical delivery separate from the revised UX2 scope.

## Alternatives

**Keep the complete projection always visible.** This made ancestry immediately
available and preserved a single graph geometry, but initial density and full
selection paint scaled with the complete context. Progressive visibility keeps
all data while making expansion an explicit operation.

**Fold only external context.** This leaves long chains, dense merges and shared
main tasks fully rendered. Applying one visibility rule to M and external
context addresses all four capacity shapes without changing their data.

**Use aggregate nodes and shortcut edges.** Aggregates can summarize density,
but require a task-to-group partition, shared ownership, hidden-edge accounting
and rules preventing artificial cycles. Real cards and induced edges provide
progressive access without introducing a second graph semantics.

**Add per-branch collapse.** Shared descendants and ancestors make branch
ownership ambiguous. A global reset has a deterministic root-connected result
and avoids a persistent branch ownership model.

**Cap manually added edges at one hundred.** A highly connected hidden task
could never be expanded. The twenty-task manual batch limits additions while
retaining every resulting real edge.

**Rebuild the baseline automatically on refresh.** This can replace a reader's
chosen visible region and introduce tasks without an explicit action. Retaining
actual visible IDs and pruning disconnections preserves browsing intent; reset
or remount deliberately adopts a new overview.

## Consequences

Complete context and visible geometry have separate owners. Only explicit
expansion, reset, successful snapshot reconciliation and lifecycle changes can
change S; inspection and details cannot. Initial limits bound first rendering,
while repeated manual expansion can intentionally reach the complete context.
That state is observable and carries no promise that arbitrary full-project
rendering fits the initial interaction budgets.

Per-branch folding and aggregates are deferred additive interactions. Adding
branch folding would require defining shared-task ownership and collapse effects;
adding aggregates would require independent group/edge semantics. Their cost
remains bounded by keeping real task IDs, full P and induced edges separate from
visibility, and by avoiding hidden shortcut or group state in the current model.
Neither capability is implied by the reset control.

Acceptance must independently derive initial BFS membership, full induced edges,
exact batch deltas, root-connected refresh retention and hidden ancestor counts.
It must cover 50/100 boundaries, shared neighbors, dense manual expansion,
completed tasks, external unrelated successors, failed refresh and dialog focus.
Performance and runtime conclusions remain attached to their tested source and
corresponding PR or CI run.
