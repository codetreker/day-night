# Agent Note: Task Dependency and Revision Policy

Status: implemented

## Problem

Independent clients can change a task's fields, its dependencies, or a
predecessor's state while another client starts downstream work. Validating
individual task versions alone cannot keep the graph acyclic or preserve
completed-predecessor requirements across different tasks. Refusals must also
leave fields, edges, versions and timestamps unchanged.

## Decision

The task service implements create, get, list and update over the existing
concrete store. The [requirements](../../../../docs/spec/daynight-server.md)
own the permitted states and refusals; the
[design](../../../../docs/design/daynight-server.md) owns their transaction
mechanism. HTTP exposure remains a separate task.

The write callback reads the current target after acquiring its project lock,
compares the expected version, and constructs a complete mutation plan. It
canonicalizes and sorts dependency UUIDs, checks references and candidate
reachability, and validates both predecessor and direct-dependent state rules.
Only a fully accepted plan reaches storage mutation. Errors from storage remain
operational errors; expected domain refusals remain pending until the outer
transaction has completed successfully.

The project check before writes reuses the project service. There is no deletion
API, so a valid project cannot disappear through an allowed concurrent operation.
Task reads and lists check project and task data within one read-only snapshot.
Task cursors reuse the versioned format and bind project, status and readiness.

Versions belong to actual task mutations. A stale version conflicts even when
the requested values match. A matching semantic no-op preserves version and
timestamps after full validation. Dependency order and UUID case variations
canonicalize to the same set. Changed fields and dependencies commit once with
one version increment; predecessor changes do not revise downstream tasks.
Read projections supply current readiness without persistent counters.

This implements the policy part of the
[service baseline](../architecture/2026-10-19-daynight-server-task-design.md),
using the [transactional store](../architecture/2026-10-19-server-transactional-storage.md)
and [shared project API mechanisms](2026-10-19-project-management-api.md).

## Alternatives

**Use task versions as the only concurrency control.** Two clients modifying
different tasks can both have fresh versions while adding opposite graph edges
or reopening a predecessor as a dependent starts. The project lock orders these
operations; versions independently prevent overwriting one target's revision.

**Treat expected refusals as transaction callback errors.** A rollback or
completion failure can accompany a domain fault and be hidden by cause-based
HTTP classification. Keeping the refusal pending before any write makes outer
transaction failure authoritative without partially mutating state.

**Persist readiness and update downstream revisions on predecessor changes.**
That would introduce fan-out writes and change versions for tasks the caller did
not edit. Snapshot projections reflect current dependencies while preserving
the selected per-task revision semantics.

## Consequences

Every mutating path preserves one same-project DAG and the active/done state
invariant, including metadata-only changes, retries and no-ops. Public faults
contain fixed messages and sorted task IDs rather than other projects' content.
The service retains pointer-based omission semantics without accepting JSON null
as a fallback value at the future HTTP boundary.

Real PostgreSQL tests exercise all state pairs, candidate replacement, rejected
mutations, canonical references, no-op/version behavior, snapshot reads and
filter-bound pages. Distinct sessions with exact application-name barriers prove
reverse-edge, reopen/start and same-version races. Database failure after partial
writes proves full rollback; lock/query cancellation proves no delayed mutation
and reusable resources. No storage substitute or product coverage exclusion is
needed.
