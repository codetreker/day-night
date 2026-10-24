# Agent Note: Withdraw Task Approval Before Execution

Status: implemented

## Problem

An accepted task may need further review before execution begins. The original
approval lifecycle provided no supported way to withdraw that acceptance, so a
premature approval could only remain actionable or be corrected outside the
normal versioned API. Concurrent task selection also requires a withdrawal to
compete with claim without cancelling work that has already started.

## Decision

The dedicated `unapprove` action changes only todo to proposed. Both ready and
dependency-blocked todo tasks qualify; proposed, in-progress and done tasks do
not. It uses the same project-lock transaction, current membership check and
positive int64 expected version as approve. Version is checked before predecessor
state. A successful action increments version and updatedAt once, preserves
metadata, properties, dependency edges, execution timestamps and attachments,
and makes readiness false through the existing read model. No migration or new
stored state is required.

The HTTP route is `POST /api/v1/projects/{projectId}/tasks/{taskId}/unapprove`.
Its request contains only version and its successful response is the complete
task. Authentication, Cookie Origin validation, method refusal, no-store,
resource visibility and structured request diagnostics share the existing
lifecycle owners. Member and administrator permissions are identical to
approve. The CLI exposes `task unapprove` with the same project and exact-version
options, output, completion and no-retry behavior as the other lifecycle actions.

The project lock serializes withdrawal and claim. For the same ready todo and
observed version, one action commits and the other receives version_conflict.
Two withdrawals at that version also have one winner. A blocked todo can still
be withdrawn when claim is refused for unfinished prerequisites. A rejected or
uncertain response is not permission to submit the action again with a newer
version. Clients reconcile the actual task before a new decision.

Task details place the applicable action at the far right of the task-title row:
Approve task for proposed, Unapprove task for todo, and no approval action for
in-progress or done. The entry remains available on overview and attachment
tabs. The body reserves a reading area for the resource panels. Its shrinkable,
natively scrolling heading context retains the complete title, status and
retained/stale notices; focusing the title provides keyboard scrolling through
that parent. Retained read errors have a separately bounded, keyboard-focusable
native scrolling area. This allocation keeps tabs, materials and actions
reachable when errors and long valid names coexist. Both actions open a task-specific
confirmation before sending any mutation. Approval explains that todo becomes
claimable only after prerequisites finish; withdrawal explains the return to
proposal review and retention of task materials. Cancel and Escape send no
request. The confirmation retains its bounded modal geometry and places the
complete task name in a keyboard-scrollable body, keeping its header and action
footer accessible. The topmost confirmation owns focus, initially focuses Cancel,
makes the underlying detail inert and restores the originating title action on cancel.

One confirmation/session mechanism owns both actions. Confirmation retains the
reviewed action, project/task identity, source status and exact version. A known
change invalidates that decision rather than silently switching action or
version. Pending, unknown and reconciling operations prevent another submission,
including across detail closure. The existing detail session retains
action-specific feedback, GET-only reconciliation, identity isolation, confirmed
version protection and mounted attachment state. Success verifies the matching
resource, target status and exactly one version increase; graph-refresh failure
does not replace the confirmed detail with an older snapshot.

This limited transition partially supersedes the original
[approval lifecycle](2026-10-22-task-approval-lifecycle.md), whose removal of
generic status writes and separation of approval from execution remain intact.
The [unified status assignment proposal](../../proposed/architecture/2026-10-24-task-status-assignment.md)
specifies three-state assignment and migration of the legacy proposed state. It
retains this policy as historical rationale; the runtime remains action-based
until the proposed coordinated implementation is delivered.
The current [server requirements](../../../../docs/spec/daynight-server.md),
[CLI requirements](../../../../docs/spec/daynight-project-task.md),
[Web requirements](../../../../docs/spec/daynight-web.md) and
[handbook](../../../../packages/daynight/src/commands/skill/skills/using-daynight/references/handbook.md)
own their complete observable contracts.

## Alternatives

**Restore generic status editing.** Arbitrary updates would again allow callers
to bypass approval or claim and would require a reopening policy for active and
completed tasks. A single predecessor-constrained action provides withdrawal
without restoring those paths.

**Correct individual approvals directly in the database.** A one-off correction
would not provide a supported operation for future mistakes and would bypass
the normal membership, version, transaction and client error handling. The same
public action serves both deliberate corrections and ordinary future use.

**Cap the title using viewport subtraction.** Limiting only the heading text
cannot reserve reading space when retained-error and stale notices also consume
the fixed dialog. Allocating the actual body between panels, shrinkable context
and bounded errors covers their combined height while preserving full text.

## Consequences

Withdrawing approval changes the task's own proposal/ready eligibility. It does
not satisfy prerequisites, cascade state changes to successors, release an
executing task or reopen completed work. Existing status, dependency and timing
rules therefore remain valid. Proposed work requires a new explicit approval;
withdrawal supplies no execution or delivery authority.

The original forward-only policy remains the historical reason generic status
writes disappeared. Further backward transitions, bulk mutations, execution
cancellation and ownership transfer need their own state and permission
decisions. They cannot be inferred from unapprove. Runtime verification stays
with source-bound CLI, PostgreSQL and production-browser receipts, including
refusals, exact-version races, confirmation interaction and uncertain outcomes;
the frontend-only fixture demonstrates appearance and interaction without
proving persistence or concurrent service behavior.
