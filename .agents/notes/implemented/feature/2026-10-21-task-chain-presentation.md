# Agent Note: Task Chain Presentation

Status: implemented

## Problem

A project accumulates independent task chains over time. Showing the oldest
roots first pushes recent work below historical chains. Fully completed chains
also occupy the same list as unfinished work, but a completed root can still
have unfinished descendants. Ordering and visibility control the initially
expanded graph and its replacement; inconsistent choices would open a different
chain from the first visible row. Database creation timestamps can distinguish
tasks within one JavaScript millisecond.

## Decision

The project view creates one reversed copy of the complete index's root ID
sequence for each snapshot. The API supplies exact `(created_at, id)` ascending
order, so the presentation is descending on both fields without decoding dates.
Updates to an older task do not change its position.

A root row is hidden by default only when its distinct main-set progress has
`done === total`. This includes completed standalone tasks. A completed root
with unfinished descendants stays visible. The native Show completed chains
checkbox includes the completed-chain count and reveals those rows; the heading
reports visible and total chains. The all-complete state remains distinct from
an empty project and offers a reveal action. That action focuses the persistent
checkbox before the empty-state button disappears.

RootList receives explicit visible presentation IDs alongside the complete
immutable GraphIndex. List rendering and the
[preference hook](2026-10-21-task-browsing-preferences.md) consume the same visible
newest-first sequence. A first visit or missing/hidden saved root opens its first
root. A valid visible saved root stays open when newer chains appear. With no
visible roots, the stored root or explicit collapse is retained for revealing
rows again; an explicitly collapsed list stays collapsed.

Graph projection, progress and API order retain the responsibilities in the
[projection decision](2026-10-20-task-graph-projection.md). Every displayed graph
keeps completed nodes, shared descendants and external prerequisites. Project
counters and selected details use the full snapshot. Row filtering makes no
request and does not change dependency direction or layout. A detail remains
open when its graph disappears but the task still exists; closing restores a
surviving trigger, current visible expanded root or page heading.

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

## Consequences

Recent unfinished chains appear first while historical completed work remains
one explicit control away. Presentation arrays are bounded by the project node
limit; completed-chain classification uses the existing per-root progress and
never duplicates graph nodes or changes project totals. Visibility and expansion
are local per-project preferences. Hiding an expanded complete row selects the
newest remaining row; hiding every row preserves its saved expansion intent for
later reveal. A task actually removed from the snapshot retains the existing
detail-close notice and focus behavior.
