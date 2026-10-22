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
to include every ancestor; additional tasks are stored in `externalIds`. The
visible set is their union. Every dependency ending at a visible task is included,
and ancestor closure guarantees that its source is visible. An edge is external
when its source belongs to `externalIds`, including external-to-external edges.
Stable task and dependency ordering follows the complete graph index.

External context does not import unrelated successors. For `A → D`, `B → C → D`
and `C → X`, expanding A displays main tasks A/D and external B/C, with A→D,
B→C and C→D. X remains outside that projection. Completed tasks are retained,
each task appears once per canvas, and status, blocking and shared membership
continue to come from the full snapshot. Root progress and aggregate status count
only distinct main tasks; project totals count each project task once.

External nodes retain dashed borders and the “外部前置” label. Connections from
external nodes remain dashed, and the legend states that all upstream context is
included. The toolbar reports main-task, external-task and dependency counts
separately. Initial placement fits the complete layout at 0.8–1 zoom when it can;
otherwise it anchors the leftmost rank at 0.8 zoom. A root already in that rank
keeps the existing vertical centering. If upstream context extends left of the
root, the topmost task in that upstream rank starts at a 32px canvas inset.
Pan, zoom, Fit view and keyboard task navigation keep the remaining graph
accessible. Initialization runs once per layout and does not rerun on selection.

This partially supersedes the direct-boundary projection in the
[projection and layout decision](2026-10-20-task-graph-projection.md). That earlier
decision kept direct blockers visible without recursively expanding ancestry;
it remains the owner of complete-snapshot validation, main-set counting and the
pinned Dagre layout choices. The
[inspection design](../architecture/2026-10-22-task-inspection-design.md) owns the
overall task-card, routing, centered-detail and Markdown goals. The later
[dependency inspection decision](2026-10-22-task-dependency-inspection.md) adds
card selection, a separate Details action and smooth highlighted routes on this
complete projection. Details continue to use the drawer and plain descriptions
until the remaining reading tasks deliver their changes.

The production capacity matrix preserves its chain, merge and shared-root graphs
and adds `capacity-external`: 1,000 nodes and 5,000 edges, with two main tasks and
998 external ancestors. It uses the same five expansions, 3,000ms opening budget,
300ms local-feedback budgets, complete geometry checks and independent size
refusals. The new initial upstream task replaces only that dataset's readable
root condition; existing datasets retain their root-visibility checks. Strict
inventory validation requires ten native functional scenarios plus five native
capacity/limit scenarios and ten container functional scenarios.

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

A single expanded chain can approach the complete-project limit of 1,000 tasks
and 5,000 dependencies. Closure and projection use visited sets and iterative
traversal, remain linear in project nodes plus edges, and avoid deep recursive
call stacks. Only the expanded chain is laid out; the existing all-root progress
calculation remains based on main sets.

Independent counts prevent external ancestors from changing chain completion,
filtering or status. Existing per-project browsing preferences and standalone
classification retain their formats and topology rules. Readable initial
placement can leave later tasks outside the viewport, with navigation controls
and keyboard focus providing access; Fit view remains explicit.

The added capacity case exercises dense ancestry under the unchanged production
budgets. It extends the fixed matrix rather than promising equal latency for
every DAG. Smooth line geometry, dependency-selection highlighting, the centered
detail shell and Markdown authoring remain separate focused deliveries; their
future work consumes the complete immutable projection.
