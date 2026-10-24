# Agent Note: Three-State Task Status Assignment

Status: proposed

## Problem

Predecessor-constrained lifecycle actions prevent supported corrections and
reopening, while a separate proposed state adds task approval before execution.
A single status operation needs consistent dependency, timing and concurrency
rules, and removing a stored state requires a genuine data migration.

## Proposal

The [three-state requirements](../../../../docs/spec/daynight-task-status.md) and
[architecture](../../../../docs/design/daynight-task-status.md) specify todo,
in_progress and done with one versioned setter and todo creation. A new migration
converts every legacy proposed row to todo, advancing its version/update time
while preserving all other stored facts; default and CHECK switch atomically.
Existing applied migrations remain unchanged, and runtime readers do not accept
the deleted state as an alias.

Reuse project-lock transactions, complete mutation plans, CLI choices and the
shared Web status/permission owner. Compare exact versions before same-state
no-op, preserve all-edge forward/reverse dependency protection, and reset only
actual runtime execution attempts when returning to todo. Migration reclassification
preserves historical timing rather than invoking that runtime reset.

Task approval disappears from the target workflow. Existing user execution scope,
independent automatic selection permission and PR delivery rules remain; no field
recreates the approval barrier. Future worker ownership stays separate from status.

The implemented [approval lifecycle](../../implemented/feature/2026-10-22-task-approval-lifecycle.md)
and [withdrawal decision](../../implemented/feature/2026-10-23-task-unapprove.md)
remain historical rationale and current runtime facts until coordinated delivery.
Their earlier bounded transitions avoided reopening complexity while approval was
part of the supported workflow. This proposal deliberately changes that product
model and restores the dependency protection needed for arbitrary transitions.

## Alternatives

**Keep four states and rename commands.** This centralizes verbs but retains the
approval stage that the confirmed three-state goal removes.

**Decode old state as todo at runtime.** A compatibility branch leaves stored
constraints, queries, summaries and revisions describing different states. A
transactional migration establishes the single target model and rejects stale input.

**Put status back into metadata PATCH.** It can be atomic but couples execution
time and graph constraints to all combined metadata updates; a dedicated resource
owns one status-only contract and keeps existing material writes explicit.

**Switch the backend first or retain aliases.** Removing routes before updating
shipped clients breaks them; aliases would create an additional public lifetime.
All existing callers, readers and gates switch with the new migration.

**Make dependencies affect readiness only.** That permits active/done tasks with
unfinished prerequisites and requires redesigning readers. The proposal retains
all-edge checks and direct-dependent protection under the existing project lock.

## Acceptance Criteria

Migration, three-state creation/readers, all nine pairs, exact +0/+1, dependency
races, preserved materials/permissions/classification, timing, shared Web session,
workflow authority and old-state rejection are independently verified. Real
PostgreSQL upgrade/restart, installed CLI and production Web agree at an attributed
source, with existing module gates and coverage thresholds intact.

## Risks

Legacy-state conversion must invalidate old versions without deleting execution
facts. Existing history tests must pin their original migration prefix. Reader,
summary or UI leftovers can make the new protocol incoherent. Same-state responses
may carry fresh derived readiness despite unchanged revisions. Current-attempt
reset intentionally discards an abandoned interval; immutable attempt history is
a different stored model. Future worker claims must integrate their fencing into
the same transaction before exposure, because setting a state cannot stop a process.
