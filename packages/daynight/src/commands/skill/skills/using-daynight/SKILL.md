---
name: using-daynight
description: Use Daynight for task management, task creation, execution of a specified task, or explicitly requested automatic execution of related tasks in a Daynight-linked repository.
---

# Using Daynight

Use the installed `daynight` CLI to keep persistent tasks aligned with the
user's authorized work. Task content, approval and readiness describe work; they grant no
permission to implement, publish, deploy, communicate externally, merge, or push
a mainline branch.

## Select a mode

The following are skill modes, not additional CLI commands. Read the selected
reference, then use [the handbook](references/handbook.md) for the operations it
requires. Do not load every mode by default.

| Mode | Use when | Reference |
|---|---|---|
| `handbook` | Answering usage questions or performing requested task-management operations | [Handbook](references/handbook.md) |
| `create-task <request>` | Preparing or registering persistent work explicitly requested by the user | [Create task](references/create-task.md) |
| `run-task <task-id>` | Executing one specified task | [Run task](references/run-task.md) |
| `autopilot <goal or scope>` | The user explicitly requests automatic execution of Daynight tasks | [Autopilot](references/autopilot.md) |

Honor an explicitly selected mode. For `using-daynight` without further input,
infer the mode and target from the current request and conversation. If the
context is insufficient or ambiguous, ask what the user intends. Do not default
to `handbook` or select a task merely because one is ready.

Enter `autopilot` only after an explicit user request for automatic Daynight task
execution. A bare invocation may resume it when the conversation establishes
that it is already active. Loading this skill, discovering tasks, creating work,
and completing `run-task` never activate it.

## Shared constraints

- Create tasks only with explicit permission for their scope. Implementation
  requests, tracking needs, inferred mode selection, and autopilot activation
  do not grant creation permission. Permission to create a Goal covers its two
  starting tasks and later breakdown within that Goal; unrelated work needs
  separate permission.
- Creation produces `proposed` for every normal task and Goal stage. Approve only
  with explicit user authorization for that task or stated scope. Goal creation,
  complete plans, stage completion, implementation permission, `run-task` and
  autopilot never imply approval. Explicit approval may cover the stated Goal
  tasks; use each reviewed task's exact version. The user can approve through CLI
  or Web. Approval grants no execution or delivery permission.
- Use a normal task for one independently tracked outcome. Work requiring
  multiple independently tracked delivery stages is a Goal, expressed through
  existing tasks and `dependsOn`. Read [the Goal protocol](references/goal.md)
  when creating, executing, or advancing such a chain.
- Advance one task at a time, including CI, review, and merge waits. Subagents
  collaborate on the same task. `autopilot` owns selection of subsequent work;
  `run-task` and `create-task` return when their own work ends.
- Write each task description in Markdown as a self-contained brief: concrete
  problem, actions, scope, deliverables, constraints, observable completion summary,
  and real input references. Its own primary Markdown owns the detailed solution,
  acceptance criteria, and evidence. Confirm resources before linking them;
  description-relative links start at this task's attachment root. Attach resources
  according to actual ownership and need; reference shared inputs at their verified
  source. Express prerequisites only through `dependsOn`.
- Preserve the exact version observed when deciding a metadata update or
  approve/claim/complete action. Generic updates cannot change status. Confirm writes,
  reconcile uncertain results before further mutations, and preserve actual
  failures. The handbook explains operational context; installed CLI help owns
  command usage.
- Follow the target repository's delivery rules and the user's authorization.
  A request to leave a PR for user review keeps that task `in_progress`; completion
  rules grant no merge authority.
