# Agent Note: Project Task Browsing Preferences

Status: implemented

## Problem

A project can contain several task chains. Reloading the page or returning from
another project loses the chosen chain and reopens the default root. Explicitly
collapsing every chain is also lost. Restoring a choice must respect the current
complete graph, because a saved root can disappear while the page is closed.

## Decision

The project view owns an independent browser preference hook. It reads the
current origin's localStorage once for each mounted project and saves an expanded
root ID or an explicit null for a collapsed list. Project IDs isolate choices;
there is no server preference or task-data change. An absent preference selects
the first presented root. The [presentation decision](2026-10-21-task-chain-presentation.md)
orders that list newest-first while retaining an existing valid choice. A
successful nonempty snapshot validates the saved choice and replaces a missing
root with its current first presented root. A successful empty snapshot,
loading and an initial read failure do not turn an automatic absence into an
explicit collapsed preference.

A preference error is displayed separately from graph request errors. Invalid
stored data and denied storage access leave browsing usable with in-memory
choices. Write failure preserves the current interaction and reports that it
cannot be retained after reload. Only this local presentation state is saved;
selected details, graph layouts, zoom and pan continue to belong to their mounted
components. The [dashboard decision](2026-10-20-project-task-dashboard.md) retains
the single-canvas and snapshot lifecycle rationale.

## Alternatives

**Keep expansion only in the project component.** This was sufficient for a
single visit and avoided a storage boundary. It loses the chosen root and an
explicitly collapsed list on every reload or project navigation.

**Use sessionStorage.** It retains reloads within one tab but loses preferences
when that tab is closed. localStorage fits a project viewing preference across
visits without introducing an account or a server preference record.

## Consequences

Reload and project navigation preserve the selected chain while graph data still
comes from a fresh complete snapshot. Storage access is synchronous and bounded
to one small project record. Browser privacy settings or invalid stored values
can prevent persistence; a visible notice distinguishes that condition from a
successful save. Preferences are local to one browser origin and have no
cross-browser synchronization. Current tabs keep their own in-memory choices.
