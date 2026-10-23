# Agent Note: Task Chain Presentation

Status: implemented

## Problem

A project accumulates independent task chains over time. Showing the oldest
roots first pushes recent work below historical chains. Fully completed chains
also occupy the same list as unfinished work, but a completed root can still
have unfinished descendants. Ordering and visibility control the initially
expanded graph and its replacement; inconsistent choices would open a different
chain from the first visible row. Database creation timestamps can distinguish
tasks within one JavaScript millisecond. Generous row padding also limits how
much work fits in one viewport, especially with long titles.

## Decision

The [task view decision](2026-10-22-project-task-views.md) separates standalone
tasks from multi-member groups. The
[persistent group decision](2026-10-23-persistent-task-groups.md) replaces
dependency-root membership while preserving first-task ordering and identity. The original shared list remains the
historical premise of this ordering and density decision. The project view
creates newest-first category sequences from the complete index for each
snapshot. The API supplies exact `(created_at, id)` ascending
order, so the presentation is descending on both fields without decoding dates.
Updates to an older task do not change its position.

A group row is hidden by default only when its distinct main-set progress has
`status === "done"`, which is equivalent to every distinct main task being
complete. Status badges, completed counts and visibility share that model-derived
status. The [chain status decision](../bug-fix/2026-10-22-task-chain-status.md)
replaces the original root-status badge with an aggregate chain badge.
Standalone completion belongs to its own tab and individual task status. A
completed group anchor with unfinished members stays visible. The native
Show completed chains
checkbox includes the completed-chain count and reveals those rows; the compact
view toolbar reports visible and total chains alongside newest-first ordering. Standalone tasks have their own completed
visibility choice, count and direct-detail rows. Each category's all-complete
state remains distinct from an empty category or project and offers a reveal
action. That action focuses the persistent
checkbox before the empty-state button disappears.

GroupList receives explicit visible presentation IDs alongside the complete
immutable GroupIndex. List rendering and the
[preference hook](2026-10-21-task-browsing-preferences.md) consume the same visible
newest-first chain sequence. A first visit or missing/hidden saved root opens
its first multi-member group. A valid visible saved root stays open when newer
chains appear. With no
visible roots, the stored root or explicit collapse is retained for revealing
rows again; an explicitly collapsed list stays collapsed.

Graph projection, progress and API order retain the responsibilities in the
[projection decision](2026-10-20-task-graph-projection.md). Every displayed graph
keeps completed members and complete external prerequisites. Project
counters and selected details use the full snapshot. Row filtering makes no
request and does not change dependency direction or layout. A detail remains
open when its graph disappears but the task still exists; closing restores a
surviving trigger or a control in the active task view. The task view decision
owns active-category fallback when a trigger is no longer visible.

Collapsed root buttons use a 62px minimum height, compact padding and 7px list
gaps. Single-line bordered rows are about 64px; long titles grow naturally.
Titles retain 13px desktop and 12px narrow-screen text, with metadata and status
at 11px/10px. The progress area narrows with the viewport. Native row actions,
focus outlines and complete status/progress remain present. Task-node and canvas
geometry keep their existing dimensions.

## Alternatives

**Change the graph API to descending order.** The API already serves a stable
exact ascending sequence to other clients and the pure graph model. Reversing
only root presentation supplies the requested browsing order without changing
the exact sequence consumed by those clients.

**Sort roots with JavaScript dates.** Millisecond conversion merges distinct
database timestamps and can order roots by ID when their true creation times
differ. Reversal preserves the existing exact database comparison.

**Hide every root whose own status is done.** A finished prerequisite can head
an unfinished chain. Using the main-set progress preserves that work in the
list and distinguishes root state from chain completion.

**Remove done nodes from each displayed graph.** This discards prerequisites
and changes the meaning of shared and external dependencies. Hiding only whole
completed chains keeps every visible graph's complete dependency context.

**Shrink text to fit more rows.** Most excess height came from padding and
spacing. Reducing that space keeps title sizes and permits larger metadata and
status text while increasing list density.

**Use a fixed row height.** That creates a hard ceiling for long Chinese or
English titles and progress labels. A minimum height gives short rows a compact
floor while allowing content to grow without clipping.

## Consequences

Compact rows expose more work in the same viewport while retaining readable
content and a full-row click target. Recent unfinished chains appear first while
historical completed work remains one explicit control away. Presentation arrays are bounded by the project node
limit; completed-chain classification uses explicit member progress and
never duplicates graph nodes or changes project totals. Group member count
determines category before completion filtering; dependency edits retain groups. Visibility and expansion are local
per-project preferences, extended by the task view decision with independent
standalone visibility, selected tab and page browse positions. Hiding an expanded
complete row selects the
newest remaining row; hiding every row preserves its saved expansion intent for
later reveal. A task actually removed from the snapshot retains the existing
detail-close notice and focus behavior.
