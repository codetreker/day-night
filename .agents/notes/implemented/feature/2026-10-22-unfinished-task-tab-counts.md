# Agent Note: Unfinished Task Tab Counts

Status: implemented

## Problem

The project tabs use different units for their badges: standalone tasks and
root-chain entries, both including completed work. A chain entry can contain
many tasks and overlap other roots through shared successors. Those numbers do
not communicate how many unfinished tasks remain in each view.

## Decision

Both tab badges count unfinished tasks from the same complete graph snapshot.
Pending and in-progress tasks contribute one; done tasks contribute zero.
A task with no prerequisites and no successors contributes to Standalone tasks;
every other task contributes to Task chains. Each task ID is visited once, so
shared successors contribute once across roots. A finished root does not remove
its unfinished descendants from the chain badge.

The counts do not depend on active tabs, expanded roots or completed-item
filters. Categories with only finished tasks show zero even when completed rows
are visible. Snapshot replacement recomputes classification and counts together;
failed refreshes retain the last successful snapshot. There are no new API
requests or browser preference records. List toolbars still describe visible and
total standalone items or root-chain entries; per-chain progress keeps its
root-and-reachable-successor scope.

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

The two badges use the same unit and sum to the project's pending plus
in-progress total. A dependency edit may move unfinished tasks between the two
badges on refresh. A chain badge can exceed the number of chain rows because it
counts their unique tasks. The root-based list, graph contexts, aggregate chain
status, server ordering and stored preferences retain their existing meanings.
