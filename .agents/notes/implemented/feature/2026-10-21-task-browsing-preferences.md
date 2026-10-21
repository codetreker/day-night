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
`{ expandedRootId: string | null }` shape; null represents a collapsed list. Completed-chain visibility uses a separate localStorage JSON-boolean
record and defaults to hidden. Each mounted project reads its choices once;
there is no server preference or task-data change.

The [presentation decision](2026-10-21-task-chain-presentation.md) supplies visible
roots in newest-first order. An absent expansion preference selects the first
visible root. A successful nonempty visible sequence validates the saved choice
and replaces a missing or hidden root with its current first root. A successful
empty snapshot, zero visible roots, loading and an initial graph failure do not
turn an automatic absence into an explicit collapsed preference. Revealing rows
after a zero-visible list can therefore restore its stored root or explicit null.

Preference errors are displayed separately from graph request errors. Invalid
stored data and denied storage access leave browsing usable with in-memory
choices. Write failure preserves the current interaction and reports that it
cannot be retained after reload. The checkbox, reveal action and graph controls
remain operable. Only these presentation choices are saved; selected details,
graph layouts, zoom and pan belong to their mounted components. The
[dashboard decision](2026-10-20-project-task-dashboard.md) retains the single-canvas
and snapshot lifecycle rationale.

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

Reload and project navigation preserve presentation choices while graph data
still comes from a fresh complete snapshot. Storage access is synchronous and
bounded to small project records. Privacy settings or invalid stored values can
prevent persistence; visible notices distinguish that condition from a save.
Preferences are local to one browser origin with no cross-browser synchronization.
Current tabs keep their own in-memory choices. A nonempty list may replace a
hidden saved root with its visible fallback; a zero-visible list retains intent
until rows are available again.
