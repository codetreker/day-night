# Agent Note: Project Task Browsing Preferences

Status: implemented

## Problem

A project can contain several task chains. Reloading or returning from another
project loses the chosen chain, explicit collapse and completed-work visibility.
Restoring those choices must respect the current visible list: a saved root can
disappear or be hidden, and a project can temporarily have no visible chains.

## Decision

Browser preferences are isolated by origin and project ID. The existing
expanded-root JSON record keeps its original
`{ expandedRootId: string | null }` shape; null represents a collapsed list.
Completed-chain visibility uses its existing separate localStorage JSON-boolean
record and defaults to hidden. The [task view decision](2026-10-22-project-task-views.md)
extends this ownership with independent records for the selected tab, standalone
completion visibility and the two page scroll positions. First visits default
to chains, both completion filters default to hidden, and page positions default
to the start. There is no server preference or task-data change.

The [presentation decision](2026-10-21-task-chain-presentation.md) supplies visible
non-isolated roots in newest-first order. An absent expansion preference selects
the first visible chain root. A successful nonempty visible sequence validates
the saved choice and replaces a missing, hidden or newly isolated root with its
current first root. A successful empty snapshot, zero visible chain roots,
loading and an initial graph failure do not turn an automatic absence into an
explicit collapsed preference. Revealing rows after a zero-visible list can
therefore restore its stored root or explicit null. Switching to standalone
retains expansion intent without rendering a graph.

Preference errors are displayed separately from graph request errors. Invalid
stored data and denied storage access leave browsing usable with in-memory
choices. Write failure preserves the current interaction and reports that it
cannot be retained after reload. The tabs, checkboxes, reveal actions and graph
controls remain operable. Selected details, graph layouts, zoom, pan and
fullscreen are not persisted. Page scroll restoration is independent per tab;
inactive panel contents unmount, so returning to chains initializes the canvas
viewport. Stable hidden wrappers preserve each tab's associated panel ID.
The [dashboard decision](2026-10-20-project-task-dashboard.md) retains the
single-canvas and snapshot lifecycle rationale.

## Alternatives

**Keep preferences only in the project component.** This was sufficient for a
single visit and avoided a storage boundary. It loses a chosen root, explicitly
collapsed list and visibility choice on reload or project navigation.

**Use sessionStorage.** It retains reloads within one tab but loses preferences
when that tab closes. localStorage fits project viewing preferences across
visits without introducing an account or a server preference record.

**Add visibility to the delivered expansion record.** That changes an existing
stored shape solely to add an independent choice. A separate record preserves
the expansion format and lets either preference be reported and restored
without requiring a record migration or compatibility branch.

## Consequences

Reload and project navigation preserve the selected category, each category's
completed visibility and page scroll position, and chain expansion while graph data
still comes from a fresh complete snapshot. Storage access is synchronous and
bounded to small project records. Privacy settings or invalid stored values can
prevent persistence; visible notices distinguish that condition from a save.
Preferences are local to one browser origin with no cross-browser synchronization.
Current tabs keep their own in-memory choices. A nonempty list may replace a
hidden saved root with its visible fallback; a zero-visible list retains intent
until rows are available again.
