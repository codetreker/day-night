# Agent Note: Design staged Goal task chains

Status: implemented

## Problem

Multi-task work needs a clear statement of the complete outcome before architecture
and delivery tasks are fixed. The earlier registration rule required finished solutions
and frontend prototypes, so applying that rule to problem-definition or design
tasks makes their outputs prerequisites to starting them. A root task's
completion also needs to remain distinct from delivery of the entire task chain.
A task whose description only names a general problem and links cannot communicate
its concrete assignment without opening a packet of attachments. Repeating common
requirements and designs on each task also creates several copies with unclear
ownership and independent update lifetimes.

## Decision

The [Goal requirements](../../../../docs/spec/daynight-goal-workflow.md) and
[design](../../../../docs/design/daynight-goal-workflow.md) own the staged task-chain
protocol implemented by the public skill. The architecture was delivered separately
from its dependent protocol implementation and independent consumer acceptance,
as recorded in the [delivery breakdown](../../../../docs/design/daynight-goal-workflow-tasks.md).
The [mode decision](../architecture/2026-10-21-using-daynight-modes.md) continues to
own the current entrypoint and authorization rules.

A Goal uses existing tasks, attachments and dependsOn. Registration establishes a
Goal description task titled `[Goal]<outcome>` and a dependent architecture-and-breakdown
placeholder. Stage briefs define the work and stage acceptance; final requirements, UI prototypes
and architecture are outputs of their producing stages. Goal description fixes the
problem, outcomes, scope, exclusions and verification without production implementation
or architecture work. Applicable UI requirements include a final-style interactive
frontend-only prototype. Architecture then fixes mechanisms and registers the actual
delivery breakdown before implementation can become ready.

Every task description is a self-contained brief for that task: its problem, concrete
scope and actions, deliverables, constraints, and observable completion summary must
be visible before following attachments. Goal descriptions state the complete Goal;
implementation and acceptance descriptions state their own assignments. Detailed
solution, complete acceptance and evidence remain with the task-specific primary
Markdown attachment. Summaries and details have distinct roles and are maintained
together within the owning task.

Attachments follow content ownership. The Goal owns goal.md; architecture owns its
phase plan, design and registered breakdown; implementation and acceptance own only
their respective plans and later evidence. Shared inputs are read from the confirmed
source task ID and attachment path, or a verified immutable repository URL. Existing
CLI reads support those references; no new link scheme or API is introduced. Copying
an entire common packet to every task is not the registration default. An independently
required snapshot must name its source version and purpose.

Four skill modes remain. A shared Goal reference supplies stage-specific guidance;
create-task registers and returns, run-task executes one task, and explicitly
activated autopilot owns subsequent selection. Scoped Goal-creation permission
covers the initial pair and its agreed breakdown. The
[approval lifecycle](../feature/2026-10-22-task-approval-lifecycle.md) makes every
new stage and delivery task proposed. Approval requires a separate explicit user
instruction for the task or stated Goal-task scope, followed by observed-version
claim from ready todo and complete after stage acceptance and required authorized
PR merges. Goal creation, stage completion and autopilot never infer approval;
completed dependencies alone do not approve successors. The later
[withdrawal decision](../feature/2026-10-23-task-unapprove.md) allows explicitly
requested todo-to-proposed withdrawal before claim; that task waits for a new
approval. Task content supplies no additional
execution, external-action or merge authority. PR-delivered planning work remains
in progress until all necessary PRs are platform-confirmed merged and acceptance
is satisfied. Completing Goal description does not complete the whole Goal.

For this Goal, the architecture stage registered two concrete delivery outcomes
before handing over the design PR. GW-T1 delivers the complete protocol, coupled current-state documents,
required version changes and every necessary premerge validation in one implementation
PR. GW-T2 independently accepts the exact merged consumer artifact and reconciles the
whole Goal against its original acceptance criteria. Its work includes isolated package
installation, complete bundle comparison, simulated-launcher installation checks and
independent instruction scenarios. Both tasks have readable plans and acceptance
criteria during design; neither is a placeholder for later decomposition.

GW-T1 depends on the design task, and GW-T2 depends on GW-T1. Finishing protocol delivery
therefore does not imply whole-Goal completion. Independent acceptance does not defer
or reduce GW-T1's own premerge checks. The separate design delivery kept architecture reviewable before protocol
implementation, and source-bound consumer evidence is assessed after implementation
is integrated.

## Alternatives

**Require the full solution and prototype before every registration.** This is
appropriate for an implementation task whose design is an input, but prevents
starting a stage whose purpose is to produce those artifacts. Stage-specific entry
requirements preserve complete implementation inputs without creating that cycle.

**Implement the skill alongside its design.** This provides one combined artifact,
but makes the design task's successor execute before its prerequisite is delivered.
Separate design and implementation PRs preserve the workflow's delivery gate.

**Introduce a separate Goal resource or CLI mode.** Existing task dependencies and
attachments already represent the required sequence. A new resource would require
runtime and persistence changes beyond the skill workflow; a fifth mode would
duplicate registration or single-task execution ownership.

**Keep whole-Goal consumer acceptance inside the implementation task.** This keeps
all verification under one task, but obscures the distinct result of independently
checking the immutable delivered artifact and reconciling the complete Goal. Separate
post-delivery acceptance makes that result explicit while retaining every required
implementation check before merge.

**Restrict descriptions to problems and distribute the common document packet.**
This keeps detailed prose in attachments, but hides each concrete assignment and
replicates documents owned by the Goal or architecture. A self-contained brief plus
owned detail and verified shared references makes the work readable while retaining
one source for common inputs.

## Consequences

Multi-task registration needs two initial tasks and recoverable attachment writes.
Architecture must complete the real successor registration and artifact verification
before design handover; a future task list or one vague implementation placeholder
cannot satisfy that obligation. Protocol delivery and independent consumer acceptance
have different completion evidence and both remain in the same Goal scope.
Definition and design can start with honest stage briefs, while implementation
retains completed requirements and design as inputs. Instruction review must cover
stage transitions, permission boundaries, partial registration and whole-Goal
completion, description-only assignment comprehension, and attachment ownership;
recursive copy and installer checks establish artifact integrity
separately from instruction behavior.

The protocol adds no server-side enforcement, lock, state, telemetry or migration.
Existing version and attachment concurrency rules still apply. The current task
chain provides a concrete registration exercise, not proof that every model
will follow the skill. Publishing, deployment and PR merging remain subject to
their own authorization and observed platform state.
