# Agent Note: Progressive Task Graph Overview

Status: implemented

## Problem

A complete chain context can approach an entire project's tasks and dependencies.
Rendering all of it at once makes the first view difficult to read and ties
local interaction cost to the complete graph. Task browsing needs complete data
and accurate progress while letting the reader control visible detail.

## Decision

The pending [external dependency design](../architecture/2026-10-23-external-dependency-design.md)
replaces the main-set input with an ordinary-edge component and retains the
connected ancestor projection and progressive controls. This note continues to
describe the implemented root-based input until that consuming task is delivered.

`projectRoot` retains complete context P: root plus every reachable successor
form main M, every ancestor of M is included, and P−M is external context.
Unrelated successors of external tasks stay outside P. Only visible task IDs S
are progressive, for both main and external tasks. Full M still owns chain
progress/status; complete snapshots own seven project counters and unfinished
tab counts. Proposed/todo/in_progress/done keep their existing read meanings.

If P has at most fifty tasks and one hundred dependencies, initial S contains
all P. Otherwise `createGraphOverview(index, P)` starts at root and performs
stable undirected BFS, considering direct successors before prerequisites, each
direction in snapshot insertion order. Consider a candidate once, accept it only
if resulting S has at most fifty tasks and its complete induced edge set at most
one hundred dependencies, and queue only accepted tasks. These limits apply to
the initial overview of P, not the whole project or manual expansion.

`getTaskExpansion(index, P, S, taskId, direction)` chooses at most twenty hidden
direct neighbors within P in stable snapshot order, without recursion. Controls
report exact new tasks, new induced edges and remaining neighbors. Edge deltas
include links among added tasks. Manual expansion has no edge cap and may exceed
the initial fifty/one-hundred limits. Shared IDs appear once.

`projectVisibleTasks(P, S)` retains membership and every real dependency with
both endpoints in S. No shortcut edges, aggregate cards or synthetic links are
introduced. Toolbar counts distinguish visible from full context. The original
card decision reserved 220 by 136 pixels for every task: a 94px body, 40px
two-column footer and two border pixels. Uniform heights kept all controls in
consistent columns during progressive expansion, but also left an empty ruled
footer when both directions had no hidden neighbors. The
[conditional footer decision](../bug-fix/2026-10-22-task-card-expansion-footer.md)
partially supersedes that geometry: cards without controls are 220 by 96 and
omit the footer; cards with controls remain 220 by 136, retaining the empty
column when only one direction is available. The body remains the native
TaskDetailDialog trigger, and direction controls are siblings. The existing
Dagre polyline/native-arrow/local-dash renderer consumes only the visible graph.

Explicit expansion may relayout S, centers its anchor at current zoom and
focuses the anchor body. One “收起到概览” control recomputes the current overview,
frames it and retains reset-button focus. There is no branch ownership or
per-branch collapse.

Successful refresh intersects actual old visible IDs with new P, adds root and
keeps only the root-connected component of the induced undirected graph.
Disconnected nodes leave S permanently; refresh does not union a new baseline
or add newly arrived tasks. It preserves viewport. Reset or remount computes a
new baseline. Failure keeps old data, S and view. Project/root/tab changes and
unmount discard local visibility state.

The delivered TaskDetailDialog, Overview/Attachments panels, adjacent attachment
panes, one right-side scroll owner, request state and modal focus ownership
remain intact. Refresh does not steal focus from an open dialog; a vanished
trigger uses existing close-time fallback. Language changes translate controls
and counts while preserving S, detail/attachment resources and viewport.

This partially supersedes always-visible complete context in the
[UX1 decision](2026-10-22-complete-prerequisite-context.md). UX1 delivered complete
ancestors and unambiguous context; those data guarantees remain. Its original
choice rendered the closure before inspection so later selection would not
change geometry. Explicit visibility makes structure changes deliberate while
bounding the initial graph.

This overview is delivered by [PR #134](https://github.com/codetreker/daynight/pull/134),
merged as `53e3a0c0ff4ec821f74a2401a3bfa7de24a3f4ea`, with source-bound production
and required CI/approval evidence. The first inspection attempt,
[PR #121](https://github.com/codetreker/daynight/pull/121), was abandoned without
integration. A replacement rebuilt from current main owns independent body/
Details actions, full/hidden ancestor semantics and smooth routes. UX-T2 completes
when that replacement is verified and integrated; the abandoned PR is not a
required merge and its runtime results remain historical.

The four complete API capacity inputs retain 1,000 tasks each and their exact
999/5,000 edges, with five samples. The browser workload now requires bounded
initial S, all real induced visible edges and explicit expansion/reset, rather
than all input tasks/edges simultaneously in the DOM. `openMs ≤ 3000` and existing
detail/zoom/pan feedback ≤300ms remain. The original overview retained 31
scenarios; the [approval lifecycle](2026-10-22-task-approval-lifecycle.md) adds
three functional scenarios per target. The
[Markdown description decision](../architecture/2026-10-22-task-description-markdown.md)
adds one per target, producing 39 (22 native, 17 container).
Zero retries, timeouts, size refusals,
coverage and cleanup gates remain. Independent visible-route and paint checks
cover every edge; inspection additionally verifies selection timing and curves.
PR134 evidence remains bound to its delivered overview source; combined inspection
and Markdown evidence must come from its own source.

The [requirements](../../../../docs/spec/daynight-task-inspection.md),
[design](../../../../docs/design/daynight-task-inspection.md) and
[breakdown](../../../../docs/design/daynight-task-inspection-tasks.md) own behavior,
mechanisms and the two-part UX-T2 scope.

## Alternatives

**Keep the complete projection always visible.** This made every ancestor
immediately available, but initial density and paint cost scaled with complete
context. Keeping complete P and explicit S retains data while bounding first
rendering.

**Fold only external tasks.** Long chains, dense merges and shared main tasks
would remain fully rendered. One visibility rule for both memberships addresses
all existing capacity shapes.

**Add aggregate cards and shortcut edges.** This requires shared-task ownership,
hidden-edge accounting and rules preventing artificial cycles. Real cards and
induced edges provide progressive access without a second graph semantics.

**Add per-branch collapse.** Shared ancestors and descendants make branch
ownership ambiguous. A global reset has a deterministic root-connected result
and no persistent ownership model.

**Cap manually added edges.** Highly connected hidden tasks could become
impossible to expand. A twenty-task batch bounds added cards while retaining all
resulting real dependencies.

**Refill the baseline on refresh.** This can replace the reader's chosen region
or introduce tasks without explicit action. Actual-visible reconciliation keeps
browsing intent; reset/remount adopts a new overview deliberately.

**Combine workload policy and dependency inspection in one PR.** That couples a
material change in rendered workload with new selection, curve geometry and
acceptance mechanisms. Separate focused PRs establish progressive behavior and
its original-primitive budgets before adding inspection; the Daynight task still
requires both deliveries.

## Consequences

Complete data and visible geometry have separate owners. Only explicit
expansion/reset, successful snapshot reconciliation and lifecycle changes alter
S. Opening details does not. Repeated manual expansion can reach complete P, but
arbitrary full-project rendering does not inherit the initial overview budget.

Per-branch folding and aggregates are deferred additive interactions. Branch
folding needs shared-task/collapse ownership; aggregates need independent group
and group-edge semantics. Keeping real IDs, complete P and induced S separate
preserves their extension points without implying those capabilities.

Acceptance independently derives initial membership, induced edges, batch deltas
and root-connected refresh retention. It covers 50/100 boundaries, stable order,
shared neighbors, proposed/completed states, dense manual expansion, unrelated
external successors, failure retention and dialog focus. PR134 retained body-open
details and polylines as its delivered baseline. The later
[inspection decision](2026-10-22-task-dependency-inspection.md) now owns sibling
selection/Details, complete H/hidden counts and smooth routes; its current-source
runtime proof is separate from that original baseline.
