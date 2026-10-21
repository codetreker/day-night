# Agent Note: Task Chain Presentation

Status: implemented

## Problem

A project accumulates independent task chains over time. Showing the oldest
roots first pushes recent work below historical chains. Root ordering also
controls the initially expanded graph and the replacement when a saved root
disappears; inconsistent choices would open a different chain from the first
visible row. Database creation timestamps can distinguish tasks within one
JavaScript millisecond.

## Decision

The project view creates one reversed copy of the complete index's root ID
sequence for each snapshot. The API supplies exact `(created_at, id)` ascending
order, so the presentation is descending on both fields without decoding dates.
Updates to an older task do not change its position. RootList receives explicit
presentation IDs alongside the complete immutable GraphIndex; graph projection,
progress and API order retain their existing responsibilities in the
[projection decision](2026-10-20-task-graph-projection.md).

List rendering and the [preference hook](2026-10-21-task-browsing-preferences.md)
consume the same presented sequence. A first visit or missing saved root opens
its first root. A valid saved root stays open when newer chains appear, and an
explicitly collapsed list stays collapsed. Timestamp order does not change
left-to-right dependency direction or graph layout.

## Alternatives

**Change the graph API to descending order.** The API already serves a stable
exact ascending sequence to other clients and the pure graph model. Reversing
only root presentation supplies the requested browsing order without changing
the exact sequence consumed by those clients.

**Sort roots with JavaScript dates.** Millisecond conversion merges distinct
database timestamps and can order roots by ID when their true creation times
differ. Reversal preserves the existing exact database comparison.

## Consequences

Recent chains appear first while remembered browsing choices remain stable.
The extra presentation array is bounded by the project node limit and does not
duplicate graph nodes or alter cached progress. Keeping row IDs separate from
the full index lets row presentation evolve without deleting prerequisites,
changing project counters or rebuilding dependency meaning from visible rows.
