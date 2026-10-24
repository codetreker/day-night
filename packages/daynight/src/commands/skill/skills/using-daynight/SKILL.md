---
name: using-daynight
description: Manage concrete work (features, bug fixes, architecture, and their breakdown) and design reviews in Daynight; create or execute tasks, and automatically execute related tasks only when explicitly requested.
---

# Using Daynight

Use the installed `daynight` CLI to keep persistent tasks aligned with the
user's authorized work. Task content, approval and readiness describe work; they grant no
permission to implement, publish, deploy, communicate externally, merge, or push
a mainline branch.

## Required tracking and review

When this skill and Daynight are available, use Daynight to manage concrete work
with a defined objective and completion conditions: features, bug fixes,
architecture/design work, and actual work items produced by their breakdown.
An agent's transient execution steps, such as reading files, running commands,
and routine checks, belong in its execution plan; their presence in a plan does
not make them Daynight tasks. Use the owning Daynight task for every solution,
architecture, and design review.

Before asking the user to review any solution, architecture, design, or related
discussion, save the complete current review material in the owning task's
description or attachments. Read it back to confirm it is accessible, then
provide the task ID or verified URL and any attachment paths. Keep revisions and
review decisions synchronized with that task. Chat summaries and repository or
PR links may supplement the material; they do not replace it. A short review
proposal may live in the description; detailed task plans retain their primary
Markdown ownership under the shared constraints.

Confirm the CLI, configured service, and intended project are accessible using
the handbook's discovery rules. Preserve actual availability or upload failures;
do not claim materials are ready for review until the saved contents are verified.

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
  alone do not grant creation permission. An explicit user or applicable
  repository instruction requiring Daynight tracking or review is standing
  creation permission for the necessary tasks within the user's confirmed scope;
  reuse suitable existing tasks and do not ask for that permission again.
  Permission to create a Goal covers its two
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
  source. Express all prerequisites through `dependsOn` and their explicit external
  subset through `externalDependsOn`. Ordinary edges connect confirmed work in
  the same chain; mark a verified prerequisite from another chain as external.
  Both kinds block execution. CLI dependency options replace the full relationship
  set; preserve needed ordinary and external edges as the handbook requires.
- Automatic task selection requires `allowAgents=true` as well as readiness.
  Automated workers and agent workflows must not enable this permission themselves.
  An explicitly user-selected task may follow the manual claim path regardless
  of the flag; approval, dependency and execution authorization still apply.
- Preserve the exact version observed when deciding a metadata update or
  approve/unapprove/claim/complete action. Generic updates cannot change status. Confirm writes,
  reconcile uncertain results before further mutations, and preserve actual
  failures. The handbook explains operational context; installed CLI help owns
  command usage.
- Follow the target repository's delivery rules and the user's authorization.
  A request to leave a PR for user review keeps that task `in_progress`; completion
  rules grant no merge authority.
