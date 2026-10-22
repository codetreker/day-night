# Agent Note: Four-State Task Readers

Status: implemented

## Problem

An approval stage requires tasks to remain visible before they become actionable.
A valid new stored state cannot be activated while CLI or Web response decoders
reject it, project summaries omit it, or chain badges misrepresent its progress.
Existing task rows, revisions and timestamps must survive the representation
change without a data rewrite.

## Decision

Task storage and read models support `proposed`, `todo`, `in_progress` and `done`.
A new migration expands the task status CHECK; applied migrations and the todo
default remain unchanged. The public create operation still creates todo tasks.
Public list status inputs and generic update candidate validation still use the
original three values. Proposed fixtures enter through the concrete store;
there is no temporary public write or status-filter exception.

The graph summary requires a `proposed` integer even when zero. Its equations are
`total = proposed + todo + inProgress + done` and `todo = ready + blocked`.
Proposed tasks retain their direct unfinished prerequisites in `blockedBy`, but
are never ready and do not contribute to todo or blocked counts. Only in-progress
and done tasks require every direct predecessor to be done. Existing project
locking, revision checks, graph limits and read snapshots keep their meanings.

CLI task get/list/graph decoders accept all four states and require the summary
counter. The default unfinished inventory retains proposed tasks. Stable list
priority is in-progress, ready todo, other todo, proposed, then done; task details
retain complete descriptions and list JSON continues to omit only description.
The [list-default decision](2026-10-22-task-list-defaults.md) retains ownership of
inventory selection and rendering, including its original three-state rationale.

Web statistics, standalone rows, root badges, graph nodes and details use the
purple 待审批 presentation. Chain state derives from distinct root/main tasks:
all done means done; otherwise any done or in-progress means in-progress;
otherwise any todo means todo; otherwise all are proposed. External prerequisite
context never changes chain counts or state. Proposed tasks contribute to the
unfinished tab counts once, including shared successors, and completion filters
hide only completed items. The [chain-status decision](../bug-fix/2026-10-22-task-chain-status.md)
and [tab-count decision](2026-10-22-unfinished-task-tab-counts.md) retain their
membership and counting rationale.

The [server baseline](../architecture/2026-10-19-daynight-server-task-design.md)
originally exposed three states. The [dashboard baseline](../architecture/2026-10-20-task-dashboard-mvp-design.md)
originally provided a read-only workflow. This decision partially supersedes their
state representation while preserving their transaction and task-field ownership.
The current [server requirements](../../../../docs/spec/daynight-server.md),
[CLI requirements](../../../../docs/spec/daynight-project-task.md) and
[Web requirements](../../../../docs/spec/daynight-web.md) own observable behavior.
The [task-view mockup](../../../../docs/design/mockups/task-views.html) shows the
four-state reading behavior; the production-component browsing fixture checks the
same presentation without a backend.

## Alternatives

**Activate new creation and lifecycle operations with the reader change.** That
would combine stored representation, all consumers and mutation policy in one
review. Preparing the final reader representation first keeps every valid new
state consumable before public creation can produce it. Approval, claim,
completion and the new creation default remain a separate lifecycle delivery.

**Expose proposed through a temporary generic status input.** The list and update
paths share status validation. Allowing that input during reader preparation
would also permit status writes before approval rules exist. Retaining the
existing validator avoids a temporary split that lifecycle activation must undo.

## Consequences

Stored proposed rows are readable across the service, installed CLI and browser
without changing existing task data. Read consumers have the final four-state
representation and strict malformed-response behavior; no old-response fallback
or missing-counter default is introduced.

The preparation does not expose approval, claim or completion commands, Web
approval, a proposed public creation default, ownership fields or backward-state
commands. Generic updates cannot retain proposed as a candidate status. Lifecycle
activation must change creation and public mutation policy together and reuse the
prepared representation, project lock and version checks. That remaining work is
additive only while readers keep the final four-state model and proposed stays
non-ready; removing either constraint would require revisiting this sequencing.
