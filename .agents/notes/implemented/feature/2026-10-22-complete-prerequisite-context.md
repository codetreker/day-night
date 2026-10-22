# Agent Note: Complete Prerequisite Context

Status: implemented

## Problem

An expanded root chain can show a shared task and its direct external blocker
while hiding earlier prerequisites of that blocker. A reader cannot trace the
complete upstream path from the canvas. Adding ancestors also changes the left
edge of the layout and can place the chain's root to the right of the earliest
prerequisites, so a root-anchored viewport can conceal the new context.

## Decision

For a selected root, `projectRoot` keeps the root and all forward-reachable
successors in `mainIds`. It iteratively traverses `dependsOn` from that main set
to include every ancestor; additional tasks are stored in `externalIds`. Their union is the complete context P. Every dependency ending in P is included,
and ancestor closure guarantees that its source is in P. UX1 originally rendered
all P before inspection. The later
[progressive-view decision](2026-10-22-progressive-task-graph.md) keeps this full
data and adds an explicit visible subset for both main and external tasks. An edge is external
when its source belongs to `externalIds`, including external-to-external edges.
Stable task and dependency ordering follows the complete graph index.

External context does not import unrelated successors. For `A → D`, `B → C → D`
and `C → X`, expanding A displays main tasks A/D and external B/C, with A→D,
B→C and C→D. X remains outside that projection. Completed tasks are retained,
each task appears once per canvas, and status, blocking and shared membership
continue to come from the full snapshot. Root progress and aggregate status count
only distinct main tasks; project totals count each project task once.

Visible external nodes retain dashed borders and the “外部前置” label. Visible
connections from external nodes remain dashed. Complete data, current visible
counts and hidden-ancestor counts keep omitted display distinct from missing
dependency data. The original toolbar reported complete main-task, external-task and dependency
counts separately. The progressive view distinguishes visible from full counts.
UX1 initial placement fit the complete layout at 0.8–1 zoom when it could;
otherwise it anchored the leftmost rank at 0.8 zoom. A root in that rank stayed
vertically centered; an upstream rank to its left started at a 32px canvas inset.
Pan, zoom, Fit view and keyboard task navigation keep the remaining graph
accessible. That initial policy established readable upstream access. Progressive visibility
applies framing to its visible overview and reset; selection remains purely
presentational.

This partially supersedes the direct-boundary projection in the
[projection and layout decision](2026-10-20-task-graph-projection.md). That earlier
decision kept direct blockers visible without recursively expanding ancestry;
it remains the owner of complete-snapshot validation, main-set counting and the
pinned Dagre layout choices. The
[inspection design](../architecture/2026-10-22-task-inspection-design.md) owns the
overall task-card, routing, centered-detail and Markdown goals. The later
[dependency inspection decision](2026-10-22-task-dependency-inspection.md) adds
card selection, a separate Details action and smooth highlighted routes on this
complete projection. The
[centered detail decision](2026-10-22-centered-task-detail-dialog.md) implements
TaskDetailDialog reading; descriptions remain plain until UX-T4.

The production capacity matrix preserves its chain, merge and shared-root graphs
and adds `capacity-external`: 1,000 nodes and 5,000 edges, with two main tasks and
998 external ancestors. Its original acceptance used five full expansions with 3,000ms/300ms budgets.
The progressive-view decision retains the complete input, five samples and
budgets while checking bounded visible overviews, complete induced edges and
explicit expansion/reset. Independent size refusals remain unchanged. The original full-context initial upstream task and its root-visibility
conditions belong to that source-bound delivery; progressive overviews start
from their root-connected visible set. Strict
inventory retains five native capacity/limit scenarios. The
[bilingual interface decision](2026-10-22-web-bilingual-interface.md) adds three
functional scenarios per target, giving thirteen functional checks on each target,
eighteen native scenarios and thirteen container scenarios.

The [requirements](../../../../docs/spec/daynight-web.md) own visible behavior,
the [web design](../../../../docs/design/daynight-web.md) owns model and viewport
contracts, and the [acceptance decision](../testing/2026-10-20-dashboard-production-acceptance.md)
owns the production verification mechanism. Source-bound measurements remain
with the corresponding PR and CI run.

## Alternatives

**Retain only direct external predecessors.** This limited displayed context and
made direct blocking visible, but omitted the transitive path required for
complete prerequisite inspection. The earlier decision's rationale remains
preserved in its own note.

**Add missing ancestors when a card is selected.** This reduces initial content,
but selecting a task would change the visible set, layout and viewport while the
reader traces a dependency. Computing closure at expansion keeps later selection
purely presentational.

**Include all descendants of external tasks.** This would show entire connected
workflows, including branches such as X that do not contribute a prerequisite to
the selected chain. Ancestor closure supplies complete required context without
changing root-chain membership.

**Continue anchoring every large graph at its root.** This preserves the earlier
viewport but can put all newly included upstream tasks off the left edge. The
leftmost-rank policy exposes context at a readable scale while preserving the
existing root placement when the root is already leftmost.

## Consequences

Complete context for a chain can approach the complete-project limit of 1,000 tasks
and 5,000 dependencies. Closure and projection use visited sets and iterative
traversal, remain linear in project nodes plus edges, and avoid deep recursive
call stacks. The progressive view lays out only its current induced subset; the existing all-root progress
calculation remains based on main sets.

Independent counts prevent external ancestors from changing chain completion,
filtering or status. Existing per-project browsing preferences and standalone
classification retain their formats and topology rules. Progressive visibility adds explicit direction controls and a global reset;
counts and hidden-ancestor indications distinguish data from visible geometry.

The added capacity case exercises dense ancestry under the unchanged production
budgets. It extends the fixed matrix rather than promising equal latency for
every DAG. Smooth line geometry, dependency-selection highlighting, the centered
detail shell and Markdown authoring remain separate focused deliveries; their
future work consumes the complete immutable projection.
