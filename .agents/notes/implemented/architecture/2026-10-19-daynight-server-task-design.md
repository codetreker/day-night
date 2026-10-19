# Agent Note: Task-management Service Design Baseline

Status: implemented

## Problem

Repository-linked work needs durable projects, editable tasks and dependencies
that remain valid when clients update different tasks concurrently. The existing
foreground PR reviewer stores review execution state, which does not describe
task ownership, task dependencies or task completion. Reusing that state as a
task database would conflate independent lifecycles.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-server.md) and
[design](../../../../docs/design/daynight-server.md) define an independent Go
service backed by PostgreSQL, located at `packages/daynight-server/`. This note
records the delivered design baseline. The executable, schema and HTTP endpoints
are delivered incrementally. The
[runtime foundation](2026-10-19-server-runtime-foundation.md) implements startup,
HTTP lifecycle and strict coverage gates. The
[transactional storage](2026-10-19-server-transactional-storage.md) provides
migrations, scoped writes and snapshot reads. The
[project API](../feature/2026-10-19-project-management-api.md) implements repository
registration and project queries. The
[task policy](../feature/2026-10-19-task-dependency-policy.md) implements dependency,
state and versioned use cases. The
[task HTTP boundary](../feature/2026-10-19-task-management-http.md) exposes these
operations with strict request semantics; complete process acceptance remains
tracked separately. The
[task breakdown](../../../../docs/design/daynight-server-tasks.md) owns their
implementation scope, dependencies, status and acceptance criteria.

The selected layers are API definitions, HTTP server, application service and
core models, with concrete PostgreSQL storage inside `core/store`. Application
use cases own domain policy and transactions; storage supplies queries, locking,
migrations and atomic persistence. A second storage interface or implementation
is unnecessary for the selected PostgreSQL deployment.

Projects register a repository address without checking access or starting Git
operations. They do not change the existing review CLI configuration or SQLite
state. The [foreground CLI decision](2026-10-16-foreground-review-cli.md) retains
ownership of that execution model; this design does not supersede it.

Task dependencies stay inside a project. Every `in_progress` or `done` task
requires completed direct predecessors; reopening a predecessor is refused when
an active or completed direct dependent would violate that rule. Each task write
locks its project row before fresh `READ COMMITTED` queries, validates the
candidate graph and status, and commits fields and edges together. Task versions
add client conflict detection without replacing cross-task exclusion.

Real PostgreSQL tests provide evidence for transaction, migration, cancellation
and concurrent graph/state behavior. Race-enabled `go-cov --ci` gates total,
package and function coverage at strictly greater than 90%, at least 85% and at
least 80%, respectively, with critical block checks retained. The overall gate
uses statement counts from the same raw coverage profile so equality and rounded
display values cannot weaken the requirement. The runtime foundation records
this stricter replacement of the original inclusive total threshold. The design pins a tool revision containing the exclusion
denominator fix and keeps tests with the packages whose coverage they must prove.
The CI aggregate gate must require both the Go service checks and the existing
native CLI checks.

## Alternatives

**Combine task management with the TypeScript reviewer.** The reviewer owns a
foreground process, local clone paths and SQLite review revisions. Task
management has a separate PostgreSQL lifecycle and caller-facing resource
contract. An independent module preserves those existing ownership boundaries.

**Allow dependencies across projects.** This expands graph validation, locking,
resource lookup and future authorization beyond one project. The adopted scope
keeps one project as the transaction and dependency boundary. Supporting
cross-project dependencies later would require a deliberate redesign of those
rules, not just relaxing an input check.

**Display dependencies without gating status writes.** That would allow a task
to be started or completed while a predecessor is unfinished. The selected
semantics require enforcement on every relevant state or dependency mutation,
including concurrent changes and reopening.

**Use serializable transactions instead of a project row lock.** Serializable
isolation would require bounded whole-operation retries and an explicit policy
for exhausted serialization failures. A project already bounds every edge, so
locking that row provides a visible order for task mutations and fresh reads.
This choice should be reconsidered if measured contention inside one project
becomes a delivery constraint.

## Consequences

The design and implementation tasks share a stable definition of completion.
Each implementation task includes its own behavior tests; the final acceptance
task verifies the built binary and the full cross-layer lifecycle. Documentation
and the breakdown are delivered without claiming that future service behavior
has been tested or shipped.

Project-level locking serializes task writes within a project. Different
projects can proceed independently. The database intentionally has no foreign
keys: the locked service write path validates references, local constraints
guard individual rows, and there is no deletion API. Introducing another writer
or deletion requires a corresponding reference-maintenance design.

The selected deployment is loopback-only for local CLI and internal program
callers. Authenticated remote access can be added at the HTTP boundary, but
authorization must also reach resource lookups before broader exposure; the
current project ID is never an authorization credential. Remote deployment is
not delivered by changing the listener alone.

UI, task execution and PR/review integration are additive capabilities outside
the task-management contract. Their affordable addition depends on keeping
resource mutation separate from external execution and on retaining opaque task
identities. Current requests only persist and read task-management state. Delete
operations require dependency and reference rules; cross-project edges require
reconsidering the transaction boundary. Neither is an implicit future promise.
