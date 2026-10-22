# Agent Note: Aggregate Task Chain Status

Status: implemented

## Problem

A task-chain row can show a completed label while its progress reports unfinished
work. The original dashboard placed the root task's own status beside aggregate
progress. A finished first prerequisite can still lead to many unfinished tasks,
so that badge misrepresents completion of the chain being browsed.

## Decision

`RootProgress` contains a required aggregate status alongside its total and done
counts. The existing distinct root-main traversal derives all three values:
all main tasks done means done; any done or in-progress main task with unfinished
work means in progress; otherwise every main task is pending. The main set is
the root and every reachable successor, with shared descendants counted once.
External prerequisite context, including its complete ancestor closure, is
outside that set.

The row badge, completed-chain count and visibility filter in the task-chain
tab consume the same aggregate status. The [task view decision](../feature/2026-10-22-project-task-views.md)
separates zero-incoming/zero-outgoing tasks into direct-detail standalone rows,
whose badge and completion filter use individual status. The original unified
list remains the historical context for the incorrect badge. Graph nodes, task details, project counters and the server API
retain individual task semantics. A new snapshot rebuilds the derived values;
selection, pan and zoom do not trigger domain recomputation.

This replaces the original badge semantics described by the
[presentation decision](../feature/2026-10-21-task-chain-presentation.md).
The [projection decision](../feature/2026-10-20-task-graph-projection.md) retains
ownership of reachability and distinct counts; the
[complete context decision](../feature/2026-10-22-complete-prerequisite-context.md)
expands displayed ancestors without changing that counted membership.
Requirements and current structure belong in the [specification](../../../../docs/spec/daynight-web.md)
and [design](../../../../docs/design/daynight-web.md).

## Alternatives

**Keep the root's status next to chain progress.** This preserves the original
presentation but labels a chain completed as soon as its first task finishes.
The task's own status remains available on its graph node and in details.

**Treat every unfinished chain as pending.** This avoids a premature completed
label but hides activity once a task has started or finished. Aggregate in-progress
status preserves that information without introducing another task state.

**Derive state separately in each view.** The model already traverses each main
set to compute progress. Deriving state there shares the same task membership
and completion rule across the badge and visibility consumers without adding
another graph traversal during rendering.

## Consequences

A chain can remain in progress after its root finishes and becomes completed
only when every reachable task finishes. All-pending chains remain pending even
when an external prerequisite from another chain is active. Aggregate status is
a frontend snapshot projection, not stored task data or a new API field, so no
migration is needed. Completed-chain visibility behavior is preserved for non-isolated root chains
while its badge agrees with that behavior. The task view decision changes
category presentation without changing the aggregate status computation.
