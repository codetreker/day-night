# Agent Note: Explicit Task Approval Lifecycle

Status: implemented

## Problem

Creating work should preserve a proposal until an explicit acceptance decision.
Task status is shared by the CLI, HTTP clients, browser and packaged Agent
workflow. Command aliases cannot enforce that decision while generic updates
still allow callers to start, complete or reopen a task directly. Concurrent
clients also need to bind each action to the content they actually reviewed.

## Decision

Creation and the database default produce proposed. Dedicated versioned POST
operations approve proposed to todo, claim todo to in_progress, and complete
in_progress to done. Approval accepts unfinished prerequisites; claim and
completion require all direct prerequisites done. Every action checks the
observed version before predecessor state, then dependency rules, inside the
existing project-lock transaction. Success increments version and updatedAt
once; stale versions, invalid transitions and unmet dependencies preserve all
data. Repeated actions fail rather than returning success or retrying.

Generic PATCH contains metadata, dependencies and predefined properties only;
status is rejected even beside otherwise valid fields. Proposed tasks can edit
metadata with unfinished prerequisites. With backward state writes removed,
there is no reopening policy or unreachable dependent-reopening check. The
existing same-project DAG, full-candidate validation, snapshot reads and int64
wire representation remain. A new default-only migration preserves existing
todo/in-progress/done records, versions and timestamps as already accepted work.

The CLI exposes task approve, claim and complete with an optional exact
if-version. Explicit versions skip the pre-read; omission performs one immediate
read before submission. Decisions based on earlier content must supply its
observed version. Status filtering accepts all four states; generic update has
no status option. Metadata, PR and attachment writes never advance lifecycle.

The Web detail dialog offers Approve / 批准任务 only for proposed. It uses the
reviewed full task's positive int64 version, preserving numeric digits through
lossless decoding, bigint storage and JSON-number serialization. Graph nodes
remain version-free. App-lifetime project/task sessions prevent repeat pending
submissions across close/reopen. Background reads of the same active task retain
any loaded detail and mounted attachment panels, regardless of approval phase.
Approving one task can refresh another currently displayed task without discarding
its attachment draft or upload. Requested revision and loadedRevision distinguish
new graph context from cached detail; refresh and read errors remain visible,
and approval stays disabled until a successful current read. Cold, different-task
and identity opens retain their loading/isolation boundaries. Confirmed todo
responses remain authoritative while the graph refreshes; a failed graph refresh
retains that detail and an explicit stale-snapshot refresh action. Conflicts reread current content and
require another click. Unknown outcomes retain their error and require current
state reconciliation before another submission. Old reads and late results
cannot restore proposed or populate another task. Existing language, attachment,
fullscreen, viewport and focus ownership is retained.

Packaged using-daynight creates proposed tasks and verifies real attachments
before reporting complete registration. Creation permission, execution requests,
run-task and autopilot never imply approval permission. Explicit user approval
of the task or stated scope permits a versioned approve, or the user can approve
directly through CLI/Web. Ready todo work is claimed at its reviewed version;
in-progress work can resume after checking actual work and authorization. Claim
is a transition, not an assignee lock or lease. Completion uses the observed
version only after acceptance and all required authorized delivery PR merges.
An open PR retained for user review remains in-progress. Approval grants no
implementation, publication, deployment, external communication or merge right.

The original [service baseline](../architecture/2026-10-19-daynight-server-task-design.md)
exposed three editable states through a general update operation; dependency
checks protected its arbitrary transitions. The [reader preparation](2026-10-22-proposed-task-readers.md)
made every consumer accept proposed before writes could produce it. The
[dashboard baseline](../architecture/2026-10-20-task-dashboard-mvp-design.md)
kept task fields read-only, and the [public modes decision](../architecture/2026-10-21-using-daynight-modes.md)
separated registration, execution and scheduling permissions. This lifecycle
supersedes their state-write and approval boundaries while retaining their
transaction, projection and workflow rationale. Current behavior belongs in the
[server requirements](../../../../docs/spec/daynight-server.md),
[CLI requirements](../../../../docs/spec/daynight-project-task.md),
[Web requirements](../../../../docs/spec/daynight-web.md) and
[skill requirements](../../../../docs/spec/daynight-agent-skill.md).
The [production-component browsing fixture](../../../../packages/daynight-web/tests/mockups/browsing.html)
owns the current approval visual and frontend-only interaction scenarios.

## Alternatives

**Keep generic status updates alongside lifecycle aliases.** Other clients could
continue skipping approval or claim, and a metadata update could bypass the
explicit action protocol. Removing status from both HTTP and internal update
inputs makes every caller use the same transition checks.

**Reset existing tasks to proposed.** That would revoke already accepted work and
rewrite live progress during migration. Existing states are preserved; only new
creation uses the proposed default.

**Keep approval state inside a mounted dialog.** Closing and reopening would
forget a pending request or unknown outcome and permit another submission.
Project/task sessions retain operation identity independently of dialog lifetime.

## Consequences

The lifecycle is deliberately forward-only. Rejection, reset, reopen, release,
assignee ownership, audit actors, bulk actions and Web claim/complete require
separate transition and permission decisions. They are not inferred from this
approval capability. Existing identity and membership foundations retain their
current composition and activation status; lifecycle operations preserve their
access checks when mounted and do not activate authentication.

The HTTP generic-status contract and CLI status update option are removed,
with no legacy branch or compatibility fallback. Stored task identities and
preexisting values remain unchanged. Web approval requires an exact full-detail
read and coordinated refresh; graph projections alone cannot authorize writes.
The three task-approval, task-approval-conflicts and task-approval-recovery
scenarios extend each production target to sixteen functional scenarios; native
also retains five capacity/limit scenarios, for twenty-one unique scenarios.
Only registered project/task POST approve requests and exact expected counts
are admitted, separately from fixture-scoped attachment writes. Existing browser
identity, one-worker, no-retry, performance, coverage and cleanup gates remain.

Static packaged-resource checks and independent workflow scenarios assess
instructions; installed CLI, real PostgreSQL and production browser checks
provide separate runtime evidence.
