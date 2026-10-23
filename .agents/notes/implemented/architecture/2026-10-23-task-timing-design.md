# Agent Note: Task Execution Timing Architecture

Status: implemented

## Problem

Creation and edit timestamps describe metadata events rather than an execution
interval. Execution duration needs trustworthy start and completion facts, while
running cards need a way to distinguish ordinary progress from work that may
need attention. A project-specific warning threshold also needs shared
persistence, authorization and concurrency semantics.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-task-timing.md) and
[architecture](../../../../docs/design/daynight-task-timing.md) define one
execution interval per task, project-owned warning settings and a server-derived
display clock. Persistent task timing and its reader contracts are implemented;
project settings, running-task presentation and whole-goal acceptance remain
owned by the succeeding Daynight implementation tasks and their attachments.

Task start and completion timestamps are nullable database facts written with
status and version under the existing project transaction. The latest genuine
entry into execution replaces the start. Migration leaves existing rows with
unknown timing. Completing a historical running task records its real end while
preserving its unknown start. Ordinary edits and same-state writes preserve the
interval. Statement time after acquiring the project lock avoids counting lock
waits as execution. The existing approval lifecycle stays intact.

Full tasks and graph nodes expose required nullable timestamps. CLI and Web
readers reject missing or malformed known fields without fabricating defaults;
JSON preserves explicit nulls and original timestamps. Human CLI output retains
its existing field choices.

Each graph supplies a database clock sample taken after its data reads. Web
polling stores the latest sample separately as `GraphSnapshot.observedAt`, while
content equality excludes the graph's sample. This preserves graph and index
identity on clock-only responses without freezing the sample consumed by future
clock clients. The existing local-wall-clock `receivedAt` label keeps its role.

The adopted ET-T2 design stores settings in two project columns under the existing
project lock and a dedicated settings version. It requires member reads,
administrator writes with authorization rechecked after the lock, and a version
check before no-op detection. The initial threshold is 60 minutes. ET-T2 also
owns separation of settings metadata from the task index.

ET-T3 uses one project-owned browser ticker to advance the latest server sample
with monotonic elapsed time. Completed durations need no subscription. Strict
unrounded threshold comparison drives an amber icon/text warning without
changing task status or graph geometry. These consumers remain later delivery
work, rather than an existing runtime capability of the timing data contract.

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

Historical starts remain unknown and cannot yield an inferred duration. The
graph's database sample and its separate Web receipt expose a clock basis without
adding per-card requests or a server worker. The planned display clock includes
network-sample delay and reanchors through existing polling. Its timer ticks must
remain outside layout dependencies; future graph-cache changes must preserve the
separation between the latest sample and stable graph/index content.

Historical attempt reporting, automatic task recovery and a CLI settings
mutation command remain outside this delivery. They can be added independently:
the persisted interval does not claim history or control execution, and the
settings API is not tied to a browser-specific storage mechanism. Any future
attempt-history requirement needs its own durable representation and migration.
