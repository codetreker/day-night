# Agent Note: Worker Design Boundaries

Status: implemented

## Problem

Ready tasks do not identify whether automatic execution is allowed or which
machine may execute them. A long-running worker also has to preserve task
ownership and work across process failure while using agents whose terminal
state does not prove delivery. Combining these concerns in an agent prompt or
the existing review coordinator would leave ownership, resource cleanup and
recovery dependent on unrelated execution behavior.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-worker.md) and
[architecture](../../../../docs/design/daynight-worker.md) define a foreground
worker with four responsibilities: the service owns eligibility and
exclusive claims; the worker owns scheduling, resources, recovery and completion
verification; Herdr owns agent terminals and sessions; the agent owns the task's
delivery loop. This note records the delivered design decision. The worker
runtime, platform controls and unique worker-claim integration remain
implementation work. Automatic-execution permission persistence, filtering and
service/CLI/Web controls are implemented under the permission decision below.

Eligibility combines `allowAgents=true`, ready state, optional platform
compatibility and the absence of an active claim. The service checks these
conditions and the exact task version atomically. The
[automatic-execution permission decision](2026-10-23-task-agent-automation.md)
owns that field, its defaults and confirmed Web changes. The original design
expressed this distinction as a Human/Agent processing role so manual tasks
could remain ready without being selected automatically. That role decision is
superseded by the boolean permission; the responsibility and recovery decisions
in this note remain in force. Protected task properties expose execution
ownership without allowing ordinary property updates to replace it. The
existing authentication and approval lifecycle remain prerequisites rather than
new worker-specific identity or task-state systems.

The worker retains one worktree for each unfinished task, starts a dedicated
Herdr instance and keeps only current execution state and necessary recovery
checkpoints in SQLite. New worker resources use an explicitly configured,
workspace-owned state directory; existing shared configuration paths stay with
their current owners. It reads the latest Herdr status and verifies delivery
against existing task PR properties, remote results and acceptance attachments.
Uncertain external results are reconciled before actions are repeated. Waiting
and paused tasks retain their claims, worktrees and global concurrency slots.

## Alternatives

**A worker-owned delivery engine.** Moving implementation, PR creation,
CI/review handling and merge orchestration into the coordinator would duplicate
the agent's task workflow and make every repository delivery rule a worker
integration. The agent retains that loop while the worker verifies completion
and controls ownership and resources.

**A public report command and SQLite inbox.** A structured command could accept
waiting, failure and delivery-candidate messages with deduplication identifiers.
It would introduce a public agent protocol, report lifecycle and recovery rules
when Herdr status and existing task evidence cover the required observation.
The design therefore has no report command or report event stream.

**Structured result files.** Files could bridge an agent process to an internal
report handler, but would add another result format and persistent resource to
reconcile. The worker uses existing task evidence and current Herdr state.

**A shared review and worker execution engine.** Review has its own PR revision,
publication and conversation lifecycle. Worker ownership spans implementation,
human waits and crash recovery. Reusing REST, configuration and Git utilities
keeps common mechanisms available without imposing one coordinator or SQLite
schema on these different lifecycles.

## Consequences

The design keeps exclusive ownership and crash recovery explicit without a
second agent reporting protocol. Current-state persistence still requires
checkpoints for external actions: a lost response cannot justify another agent
or a repeated delivery action. Claim transfer requires confirmed stopping and
access to original work; machine loss does not expire ownership automatically.

Completion verification is limited by the task's actual evidence. Herdr
idle/done is only an execution observation. The worker independently checks
claim, accessible task evidence, PR identity and integration facts; the agent
performs the task's acceptance work and records its observations. Conflicting
or missing evidence and explicit human acceptance requirements keep the task
pending for work or human input. This does not introduce a universal
natural-language acceptance parser or demand formal proof for ordinary tasks.

Native Herdr transport, unattended session restoration, stopping and both agent
adapters require source-bound runtime acceptance on supported platforms. Design
documentation does not establish those capabilities. A new report protocol or
shared coordinator should be reconsidered only when concrete required behavior
cannot fit these observation and responsibility boundaries.
