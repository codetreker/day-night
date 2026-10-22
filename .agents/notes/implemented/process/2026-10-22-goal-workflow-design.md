# Agent Note: Design staged Goal task chains

Status: implemented

## Problem

Multi-task work needs a clear statement of the complete outcome before architecture
and delivery tasks are fixed. The current skill requires finished solutions and
frontend prototypes before registration, so applying that rule to problem-definition
or design tasks makes their outputs prerequisites to starting them. A root task's
completion also needs to remain distinct from delivery of the entire task chain.

## Decision

The [Goal requirements](../../../../docs/spec/daynight-goal-workflow.md) and
[design](../../../../docs/design/daynight-goal-workflow.md) adopt a staged task-chain
protocol for subsequent skill implementation. This record marks the design decision
as implemented; the published skill remains unchanged until its separate
[delivery task](../../../../docs/design/daynight-goal-workflow-tasks.md) is delivered.
The [mode decision](../architecture/2026-10-21-using-daynight-modes.md) continues to
own the current entrypoint and authorization rules.

A Goal uses existing tasks, attachments and dependsOn. Registration establishes a
Goal description task titled `[Goal]<outcome>` and a dependent architecture-and-breakdown
placeholder.
Stage briefs define the work and stage acceptance; final requirements, UI prototypes
and architecture are outputs of their producing stages. Goal description fixes the
problem, outcomes, scope, exclusions and verification without production implementation
or architecture work. Applicable UI requirements include a final-style interactive
frontend-only prototype. Architecture then fixes mechanisms and registers the actual
delivery breakdown before implementation can become ready.

Four skill modes remain. A shared Goal reference supplies stage-specific guidance;
create-task registers and returns, run-task executes one task, and explicitly
activated autopilot owns subsequent selection. Scoped Goal-creation permission
covers the initial pair and its agreed breakdown. Task content supplies no additional
execution, external-action or merge authority. PR-delivered planning work remains
in progress until all necessary PRs are platform-confirmed merged and acceptance
is satisfied. Completing Goal description does not complete the whole Goal.

The current delivery separates a design PR from one subsequent implementation PR.
The latter owns source guidance, synchronized current-state documentation, required
package version changes, instruction scenarios and packaging validation. It remains
blocked by the design task, so the design can be reviewed without changing the
published skill protocol.

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

## Consequences

Multi-task registration needs two initial tasks and recoverable attachment writes.
Definition and design can start with honest stage briefs, while implementation
retains completed requirements and design as inputs. Instruction review must cover
stage transitions, permission boundaries, partial registration and whole-Goal
completion; recursive copy and installer checks establish artifact integrity
separately from instruction behavior.

This design adds no server-side enforcement, lock, state, telemetry or migration.
Existing version and attachment concurrency rules still apply. The current task
chain provides a concrete registration exercise, not proof that the future skill
will always be followed. Publishing, deployment and PR merging remain subject to
their own authorization and observed platform state.
