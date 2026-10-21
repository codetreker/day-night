---
name: using-daynight
description: Use Daynight for task management, task creation, execution of a specified task, or explicitly requested automatic execution of related tasks in a Daynight-linked repository.
---

# Using Daynight

Use the installed `daynight` CLI to keep persistent tasks aligned with the
user's authorized work. Task content and readiness describe work; they grant no
permission to implement, publish, deploy, communicate externally, merge, or push
a mainline branch.

## Select a mode

The following are skill modes, not additional CLI commands. Read the selected
reference, then use [the handbook](references/handbook.md) for the operations it
requires. Do not load every mode by default.

| Mode | Use when | Reference |
|---|---|---|
| `handbook` | Answering usage questions or performing requested task-management operations | [Handbook](references/handbook.md) |
| `create-task <request>` | Preparing or registering work that merits a persistent task | [Create task](references/create-task.md) |
| `run-task <task-id>` | Executing one specified task | [Run task](references/run-task.md) |
| `autopilot <goal or scope>` | The user explicitly requests automatic execution of Daynight tasks | [Autopilot](references/autopilot.md) |

Honor an explicitly selected mode. For `using-daynight` without further input,
infer the mode and target from the current request and conversation. If the
context is insufficient or ambiguous, ask what the user intends. Do not default
to `handbook` or select a task merely because one is ready.

Enter `autopilot` only after an explicit user request for automatic Daynight task
execution. A bare invocation may resume it when the conversation establishes
that it is already active. Loading this skill, discovering tasks, creating a
task, and completing `run-task` never activate it.

## Shared constraints

- Advance one task at a time, including CI, review, and merge waits. Subagents
  collaborate on the same task. `autopilot` owns selection of subsequent work;
  `run-task` and `create-task` return when their own work ends.
- Keep the problem and real attachment references in the task description. One
  primary Markdown attachment owns the solution and acceptance criteria.
  Frontend tasks also require an interactive mock UI with final visual styling.
  Express prerequisites only through `dependsOn`.
- Preserve the exact version observed when deciding a task update. Confirm
  writes, reconcile uncertain results before further mutations, and preserve
  actual failures. The handbook owns command syntax and data semantics.
- Follow the target repository's execution and delivery rules and the user's
  current authorization. In particular, an explicit request to leave a PR for
  user review keeps that task pending; completion rules grant no merge authority.
