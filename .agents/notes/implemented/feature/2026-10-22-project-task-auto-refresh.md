# Agent Note: Automatic Project Task Refresh

Status: implemented

## Problem

Task status, readiness and dependency changes made through the service can leave
an open project page stale. Requiring a manual refresh interrupts monitoring.
Repeated reads also risk cancelling useful work, replacing a graph with a mixed
snapshot, moving keyboard focus or resetting a task's attachment form and
preview while it is being used.

## Decision

An open project reads its complete task graph every five seconds while the
document is visible. Hiding the document pauses new periodic reads without
cancelling an active read. Returning to a visible document starts a read
immediately unless one is already active, and restarts the five-second interval.
Automatic ticks skip an active graph request. Manual refresh cancels the current
graph read and starts immediately. Navigation and unmount release the timer and
owned requests; resource identity and request generation continue to reject late
responses.

The [original dashboard design](../architecture/2026-10-20-task-dashboard-mvp-design.md)
adopted manual refresh to keep graph projection independent of request triggers
and mutations. This decision partially supersedes that trigger policy while
retaining the [dashboard's](2026-10-20-project-task-dashboard.md) complete-snapshot
ownership. Changed graph data replaces statistics, indexes and both task-category
lists together. Equivalent graph data reuses the graph and index, preserving
projection and layout references. Every successful read advances the receipt
revision and time, including equivalent responses, so the selected task is read
again and can recover from a failed detail read.

Same-task detail reads serialize and coalesce pending refreshes into one
follow-up. Refresh and recoverable failure retain the successful detail body;
background reads leave its tabs, focus, attachment selection, file/path inputs,
pending writes and preview frame mounted. Equivalent ordered PR values retain
their array reference and local page; a changed collection uses the existing
page-reset behavior. Task and project changes immediately isolate the new
resource and release old task state.

Recoverable failures retain old data, its successful receipt time and a visible
error. Automatic attempts keep that error until success clears it. A 404 clears
the unavailable graph or detail rather than retaining previously accessible
content. A 401 follows the authentication owner's session-loss lifecycle and
releases user-owned content. Project listing and attachment metadata/content
retain their existing independent refresh and mutation rules.

The [requirements](../../../../docs/spec/daynight-web.md) own observable behavior;
the [design](../../../../docs/design/daynight-web.md#请求刷新与故障) owns request and
component responsibilities. Hook and component validation cover scheduling,
visibility, request priority, late responses, recovery and retained state. The
existing production `refresh-staleness` journey covers task changes from the
real service without manual refresh, retaining the native/container inventory
and its existing performance and cleanup gates.

## Alternatives

**Keep only manual refresh.** It retains the original read trigger and avoids
periodic network reads, but an unattended project page remains stale until an
explicit action. It does not meet automatic task-status monitoring.

**Use SSE or WebSocket notifications.** Push could reduce unchanged reads and
propagate changes sooner, but requires a server notification transport and
connection lifecycle beyond task-page refresh. It remains an additive capability:
a future notification can trigger the same complete graph read. Keeping graph
projection, detail ownership and resource isolation independent of the trigger
preserves that extension without replacing their consistency rules.

## Consequences

Open project pages observe task changes without navigation or manual input.
Reads are bounded to visible project pages, serialized and scoped to current
resources; a slow read can make a successful refresh arrive later than one
five-second interval. Hidden pages may apply an already active read and obtain
fresh data again on return. Automatic cycles update successful receipt time
without repeatedly showing the manual-refresh busy state.

Polling adds complete graph and selected-detail reads even when data has not
changed. Reference reuse avoids unnecessary layout work but does not remove
transport or database cost. Push transport should be reconsidered if this load
or the five-second visibility delay becomes material. A live detail and graph
remain independent reads; stale-data detection still offers a full graph refresh.
Task editing, project-list polling, attachment polling and server push are outside
this decision's scope. Their separate owners and refresh actions remain visible
rather than being coupled to the graph timer.
