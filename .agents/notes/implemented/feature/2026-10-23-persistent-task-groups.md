# Agent Note: Persistent Task Groups

Status: implemented

## Problem

Dependency edits can change the identity and membership of a displayed task
chain. Shared successors appear under several roots, while a workflow with
independent tasks cannot keep one stable membership without inventing execution
prerequisites. A task group therefore needs an identity that survives changes
to the dependency DAG.

## Decision

Every task persists a required UUID `groupId`. The first task anchors its group
with `id == groupId`; members explicitly store that ID. Creating without a group
starts a new group. Creating with a group joins an existing anchor in the same
project. Dependencies express prerequisites independently of membership.

A versioned task update can move a member to another anchor or make that task a
new anchor by supplying its own ID. An anchor with other members cannot move:
otherwise those members would retain an invalid anchor reference. The existing
project lock serializes reference validation and persistence, including that
check. No foreign key, separate group resource, lifecycle or permission is added.

Migration assigns each existing task to its newest ancestor root by exact
`(created_at, id)` order. A root or isolated task uses its own ID. Shared nodes
receive one group; the migration preserves all other task data and dependencies.
Explicit updates can correct intent that the old graph did not record. Runtime
reads require the migrated field and never infer a fallback group.

Web membership is equality of group IDs. A singleton group is a standalone task;
a larger group is a task chain. The anchor supplies the title and ordering, even
when it has prerequisites. Progress counts members only. The full projection
adds every member's complete prerequisite closure as external context. It adds
no unrelated external successors. Disconnected members remain available through
bounded overviews and explicit member expansion, without synthetic edges.

This replaces dependency-derived membership in the
[projection decision](2026-10-20-task-graph-projection.md),
[task views](2026-10-22-project-task-views.md),
[chain presentation](2026-10-21-task-chain-presentation.md),
[chain status](../bug-fix/2026-10-22-task-chain-status.md), and
[unfinished tab counts](2026-10-22-unfinished-task-tab-counts.md).
The [complete context](2026-10-22-complete-prerequisite-context.md) and
[progressive graph](2026-10-22-progressive-task-graph.md) retain their ancestor,
real-edge and interaction guarantees with explicit members as their input.
The [Goal workflow](../process/2026-10-22-goal-workflow-design.md) keeps stages,
artifact ownership and authorization; every stage explicitly joins the first
task's persisted group.

The [requirements](../../../../docs/spec/daynight-task-groups.md) own observable
behavior; the [design](../../../../docs/design/daynight-task-groups.md) owns
storage and projection details.

## Alternatives

**Keep using the first dependency root as a derived identity.** This reused the
complete DAG without a schema field and was reasonable for the original graph
reader. It cannot preserve membership through dependency edits or represent
independent members. Using a root ID as the stored value keeps the useful first
task identity while removing that topology dependency.

**Store groups as separate resources.** A group table and commands could support
independent names, deletion and bulk operations. The confirmed outcome needs
stable membership using the first task ID; a required task field provides that
identity without another lifecycle or permission model. Adding separate group
operations later requires preserving existing group IDs and explicit membership.

**Choose the earliest ancestor root during migration.** Shared descendants may
serve a newer delivery goal that also consumes older prerequisites. The oldest
root absorbs that newer goal's work. Choosing the newest reachable root preserves
that newer grouping in this case; neither ordering can recover unrecorded human
intent or dependency-disconnected membership. Explicit reassignment remains
necessary for those cases.

**Keep member changes immutable after creation.** This would simplify reference
rules but leave ambiguously migrated memberships uncorrectable. Versioned task
updates provide an existing atomic operation, with occupied-anchor moves refused.

## Consequences

Each task has one authoritative membership. Dependency edits cannot regroup it,
and shared prerequisites are external context rather than duplicate ownership.
Creation callers must explicitly pass groupId when registering members, including
Goal stages and real-service test fixtures. All full and graph task readers
require the field.

Historical shared-root or dependency-disconnected intent cannot be reconstructed
uniquely. Newest-root
migration is deterministic and documented; corrections are explicit writes.
Moving an occupied anchor as a whole is outside the existing task update: callers
must first move its members. There is no group-specific filter or bulk operation;
those capabilities remain additive while task membership and dependency topology
stay independent. Graph overview and refresh must retain disconnected members,
which is a structural requirement of stored membership.
