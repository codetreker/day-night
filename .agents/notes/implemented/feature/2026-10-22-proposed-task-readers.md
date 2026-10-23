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
The reader preparation expanded the status CHECK without changing the todo
default or public three-state validator. Proposed fixtures entered through the
concrete store, keeping all public lifecycle writes closed until every reader
could consume them. The later [approval lifecycle](2026-10-22-task-approval-lifecycle.md)
sets creation/default to proposed, enables four-state list filtering and exposes
versioned approve, claim and complete. The later
[withdrawal decision](2026-10-23-task-unapprove.md) also exposes todo-only unapprove.
Generic metadata updates no longer accept status. Applied migration files and preexisting task rows remain unchanged.

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
purple status presentation with the current catalog label, Proposed or 待审批.
Both catalogs use the [bilingual interface mechanism](2026-10-22-web-bilingual-interface.md);
changing language preserves the existing task, graph and detail identities.
Chain state derives from distinct root/main tasks:
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
state representation while preserving their transaction and projection ownership.
The lifecycle decision separately replaces their task-state mutation boundary.
The current [server requirements](../../../../docs/spec/daynight-server.md),
[CLI requirements](../../../../docs/spec/daynight-project-task.md) and
[Web requirements](../../../../docs/spec/daynight-web.md) own observable behavior.
The [task-view mockup](../../../../docs/design/mockups/task-views.html) shows the
four-state Chinese visual baseline; the production-component browsing fixture
checks the bilingual presentation without a backend.

## Alternatives

**Activate new creation and lifecycle operations with the reader change.** That
would combine stored representation, all consumers and mutation policy in one
review. Preparing the final reader representation first keeps every valid new
state consumable before public creation can produce it. Approval, claim,
completion and the new creation default were kept in the separately delivered
lifecycle so that valid new rows could not reach unprepared consumers.

**Expose proposed through a temporary generic status input.** The list and update
paths share status validation. Allowing that input during reader preparation
would also permit status writes before approval rules exist. Retaining the
existing validator avoids a temporary split that lifecycle activation must undo.

## Consequences

Stored proposed rows are readable across the service, installed CLI and browser
without changing existing task data. Read consumers have the final four-state
representation and strict malformed-response behavior; no old-response fallback
or missing-counter default is introduced.

The preparation introduced no public lifecycle operation or proposed creation
default. That sequencing depended on retaining the final four-state model and
proposed staying non-ready. The later approval lifecycle reuses those guarantees,
project locks and version checks while activating creation and dedicated writes
together. Web approval now uses reviewed full-detail versions; general metadata
and dependency editing remain outside the browser UI. Ownership fields and
general backward-state commands remain separate. The todo-only withdrawal reuses
these readers without changing their stored representation or non-ready rule.
