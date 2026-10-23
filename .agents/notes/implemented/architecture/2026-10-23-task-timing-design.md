# Agent Note: Task Execution Timing Architecture

Status: implemented

## Problem

Task metadata records creation and edits, but cannot establish when an execution
started or finished. Running cards cannot distinguish ordinary progress from an
execution that may need attention. A project-specific warning threshold also
needs shared persistence, authorization and concurrency semantics.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-task-timing.md) and
[architecture](../../../../docs/design/daynight-task-timing.md) define one
execution interval per task, project-owned warning settings and a server-derived
display clock. This note records the completed design decision; runtime delivery
and whole-goal acceptance remain owned by the
[implementation tasks](../../../../docs/design/daynight-task-timing-tasks.md).

Task start and completion timestamps are nullable database facts written with
status and version under the existing project transaction. The latest genuine
entry into execution replaces the start. Existing rows retain unknown timing.
Statement time after acquiring the project lock avoids counting lock waits as
execution. The existing approval lifecycle stays intact.

Project settings use two project columns and the existing project lock, with a
dedicated settings version. Members can read the saved threshold; administrator
writes recheck authorization after the lock and check version before no-op
detection. The initial threshold is 60 minutes.

Each graph supplies a database clock sample. A project-owned browser clock
advances that sample using monotonic elapsed time, while task/index/layout
identity excludes clock-only and settings-only changes. Running consumers share
one ticker; completed durations need none. Strict unrounded threshold comparison
drives an amber icon/text warning without changing task status or graph geometry.

Delivery proceeds through persistent task timing, project threshold settings,
then running-task presentation and whole-goal acceptance. Each PR preserves a
buildable resource contract and includes its own necessary validation.

## Alternatives

**Derive timing from created or updated timestamps.** These fields describe
different events and ordinary edits change the latter. This would fabricate
history and make metadata changes alter execution duration.

**Accumulate attempts or store an event history.** Historical analysis would be
an additional capability with separate storage and output costs. The agreed
result needs only the latest interval; two nullable facts satisfy that result
without committing to an event-log format.

**Use browser wall time or one timer per card.** A wrong browser clock changes
warning decisions, while independent timers duplicate lifecycle work and can
couple ticks to graph updates. One monotonic project clock isolates that work.

**Store settings in a separate table.** The bounded project-owned values have
the same serialization and lifetime as the project. Separate storage adds a
join and another creation/migration path without a second ownership model.

**Deliver one combined runtime PR.** Timing persistence, project settings and
task presentation have independently verifiable outcomes. Serial delivery keeps
their review questions separate while reader updates accompany each resource
change, avoiding incompatible intermediate readers.

## Consequences

Unknown historical executions remain visibly unknown. The clock is based on a
received server sample and therefore includes network-sample delay; existing
polling regularly reanchors it. No new server worker or background scanner is
required. Timer ticks must remain outside layout dependencies, and future
changes to the graph cache must preserve that separation.

Historical attempt reporting, automatic task recovery and a CLI settings
mutation command remain outside this delivery. They can be added independently:
the persisted interval does not claim history or control execution, and the
settings API is not tied to a browser-specific storage mechanism. Any future
attempt-history requirement needs its own durable representation and migration.
