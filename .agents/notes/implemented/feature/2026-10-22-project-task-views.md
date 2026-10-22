# Agent Note: In-project Task Views

Status: implemented

## Problem

Disconnected tasks and dependency workflows require different browsing actions.
A disconnected task gains no context from expanding a one-node graph before
opening its details. A shared list also makes its singleton progress compete
with meaningful chain progress. Separating those workflows must retain one
project snapshot and avoid reclassifying a task when its prerequisites finish.

## Decision

The project has Standalone tasks and Task chains tabs within its existing URL.
Both share project statistics, refresh, the complete graph index and the detail
drawer. First visits open Task chains; the selected tab is retained per project.
A standalone task has zero incoming and outgoing dependency edges in the full
snapshot. All remaining roots enter the chain view. Membership ignores task
status and completed-item filters. A new snapshot reclassifies dependency edits
as one replacement with the project statistics.

Standalone rows are compact native buttons showing title, status, ID and
creation time, and open details directly. Chain rows keep root-based progress,
aggregate status, complete DAG projection, external prerequisites, fullscreen and
details. For `A → C ← B`, A and B remain two chains, each including C once;
project statistics count C once. The original tab counts represented total
standalone tasks and non-isolated roots to describe the available entries. The
[unfinished task count decision](2026-10-22-unfinished-task-tab-counts.md)
replaces those badge semantics: both count unfinished tasks, with shared chain
tasks counted once across roots. List toolbars retain visible/total entry counts.

Each tab has its own completed-item filter and page scroll position. The chain
view retains its expanded-root or explicit-collapse choice when tabs change.
Both lists use the exact newest-first presentation order. Existing expansion
and completed-chain storage records retain their shapes; tab, standalone
visibility and scroll positions use independent records. Storage failure leaves
in-memory interaction available with a visible persistence notice. Page scroll
positions do not persist graph geometry, pan, zoom, details or fullscreen.
Both tabpanel wrappers keep stable IDs and hide the inactive category. Only
active contents mount, so a returning chain initializes its canvas viewport.

This partially supersedes the unified list in the [presentation decision](2026-10-21-task-chain-presentation.md)
and extends the [browsing preference decision](2026-10-21-task-browsing-preferences.md).
The [projection decision](2026-10-20-task-graph-projection.md) retains ownership of
complete dependency semantics; the [chain status decision](../bug-fix/2026-10-22-task-chain-status.md)
continues to own aggregate status. Required behavior and current mechanisms
belong in the [specification](../../../../docs/spec/daynight-web.md) and
[design](../../../../docs/design/daynight-web.md). The [interactive mockup](../../../../docs/design/mockups/task-views.html)
provides final visual styling without a backend.

## Alternatives

**Separate navigation pages.** Independent routes would give each category a
navigation destination but repeat project context and separate two views of the
same snapshot. In-project tabs keep statistics, refresh and detail behavior in
one project workspace.

**Store a backend task kind.** A standalone/chain field would duplicate the
existing dependency topology and require every dependency write to maintain its
classification. Complete graph indexes already provide both incoming and
outgoing relationships, so classification remains a frontend projection.

**Regroup chains by connected component.** This can present shared workflows as
one entry, but changes the meaning of root-based chain counts, projections and
progress. That presentation capability is deferred. Its later cost stays
additive only while category derivation and tab state remain independent of root
projection; this split preserves those responsibilities. Shared successors
therefore remain visible in multiple root chains. Reconsider grouping when a
confirmed workflow needs one entry for a multi-root dependency component.

## Consequences

Standalone tasks reach details in one action. Dependency workflows retain the
complete graph context and existing progress rules. Completion and readiness do
not move work between categories. Root-chain entry counts cannot be added as
project task totals, because a chain entry can contain many tasks and share
successors with other chains. The two tab badges instead sum to the project
unfinished-task total. Filters and tab choices make no API requests or server
changes.

Per-project browser records preserve browsing intent across visits while the
server remains authoritative for a freshly read snapshot. New dependency edits
can move a task between views and invalidate an expanded chain root; existing
visible-root reconciliation handles that case. Inactive canvases consume no
mounted graph resources, at the cost of initializing pan and zoom after tab
return. Keyboard tabs, native row actions and active-view focus restoration are
part of the delivered interaction, including empty and all-completed views.
The actual-backend `project-view-tabs` scenario runs on native and production
container targets; the [acceptance pipeline](../testing/2026-10-21-web-acceptance-pipeline.md)
retains strict inventory validation and the original capacity/limit scenarios.
The [complete context decision](2026-10-22-complete-prerequisite-context.md) adds
dense external ancestry without changing tab classification or chain membership.
