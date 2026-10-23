# Agent Note: Daynight Owns Task Management

Status: implemented

## Problem

Repository task breakdowns create a second place to maintain task identities,
dependencies, delivery status and acceptance plans alongside Daynight. Readers
can encounter conflicting states, while unrelated delivery branches must update
the same Markdown lists. Product and architecture documents also become coupled
to task files whose lifecycle differs from the system they describe.

## Decision

Daynight is the source of truth for task breakdowns, dependencies, status,
task plans, task-specific acceptance criteria and evidence references. Task
records provide self-contained assignments; detailed plans and task-owned
acceptance material belong to their attachments. Shared inputs retain their
owning task and verified attachment path.

Repository specifications retain required product behavior. Designs retain
mechanisms, boundaries and essential rationale; decision notes retain alternatives
and consequences. These documents may explain validation requirements and link
to task sources, but committed task lists and execution plans, including
`*-tasks.md`, are prohibited. The tracked `docs/design/*-tasks.md` files are
removed and active inbound references use the appropriate product document or
Daynight ownership. Ignored `docs/plans/` remains available for local execution
scratch work without becoming another persistent task registry.

This extends the document ownership in the
[shared workflow decision](2026-10-16-agent-workflow.md). The
[Goal protocol decision](2026-10-22-goal-workflow-design.md) continues to own
stage registration and attachment ownership. The
[source-bound validation decision](2026-10-20-source-bound-validation-evidence.md)
continues to keep run results with their tested source, artifacts and PR or CI
run; a task references that evidence without turning it into proof for another
revision.

## Alternatives

**Retain repository task breakdowns alongside Daynight.** The files provide
versioned task lists, but duplicate task state and dependencies already managed
by Daynight. Keeping them requires synchronized updates across two independent
stores and leaves task execution coupled to shared documentation edits.

## Consequences

Product documentation can remain accurate independently of task progress, and
Daynight provides the assignment, dependency and completion context. Task
management requires access to Daynight; a Git checkout alone does not provide
the current backlog or task plans. Removing repository files does not create or
update Daynight records, migrate their contents, or establish any task's
completion. Existing repository history retains the deleted files.
