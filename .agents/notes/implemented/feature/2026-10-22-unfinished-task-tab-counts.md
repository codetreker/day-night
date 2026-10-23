# Agent Note: Unfinished Task Tab Counts

Status: implemented

## Problem

The project tabs use different units for their badges: standalone tasks and
root-chain entries, both including completed work. A chain entry can contain
many tasks and overlap other roots through shared successors. Those numbers do
not communicate how many unfinished tasks remain in each view.

## Decision

Both tab badges count unfinished tasks from the same complete graph snapshot.
Proposed, pending and in-progress tasks contribute one; done tasks contribute
zero. The [four-state reader decision](2026-10-22-proposed-task-readers.md)
extends the original pending/in-progress inventory without changing its unit.
The [persistent group decision](2026-10-23-persistent-task-groups.md) replaces the original
dependency-isolation categories: members of singleton groups contribute to
Standalone tasks; members of larger groups contribute to Task chains. Each task
ID is visited once. A finished anchor does not remove unfinished group members.

The counts do not depend on active tabs, expanded roots or completed-item
filters. Categories with only finished tasks show zero even when completed rows
are visible. Snapshot replacement recomputes classification and counts together;
failed refreshes retain the last successful snapshot. There are no new API
requests or browser preference records. List toolbars still describe visible and
total standalone items or root-chain entries; per-chain progress keeps its
explicit group-member scope.

This partially supersedes badge semantics in the [task view decision](2026-10-22-project-task-views.md).
Required behavior belongs in the [specification](../../../../docs/spec/daynight-web.md),
and the [design](../../../../docs/design/daynight-web.md) explains the projection.

## Alternatives

**Count unfinished root chains.** This reports the number of workflows that
remain open, but does not show their unfinished task volume. It retains mixed
units between the tabs.

**Sum unfinished tasks from each root's progress.** Existing progress values
already describe each chain, but shared successors would inflate the badge.
Classifying unique tasks from the complete index makes the badge independent of
which roots are rendered and avoids repeated reachability traversals.

## Consequences

The two badges use the same unit and sum to the project's proposed plus pending plus
in-progress total. An explicit membership reassignment may move tasks between
the badges on refresh; dependency edits cannot. A chain badge can exceed the number of chain rows because it
counts their unique tasks. The group-based list, graph contexts, aggregate chain
status, server ordering and stored preferences retain their existing meanings.
