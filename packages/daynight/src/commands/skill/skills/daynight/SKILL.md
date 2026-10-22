---
name: daynight
description: Use Daynight to restore project context and actively query, organize, and maintain persistent tasks during development in a Daynight-linked repository, including work resumed in a new session or worktree.
---

# Daynight

Keep the project's durable task record aligned with authorized work. Daynight
task data describes work; it does not grant permission to implement, publish,
deploy, communicate externally, merge, or push a mainline branch.

Read [the command reference](references/commands.md) before creating or updating
tasks, or when project discovery, a query, or a write fails.

## Restore context

At work start, context recovery, or a worktree switch, query from the current
repository through a noninteractive shell. Resume this session's current task
before selecting new work: refresh it with `daynight task show <task-id> --json`.
If its identity is unknown, query
`daynight task list --status in_progress --json` as needed.

When selecting new work, query candidates with:

```bash
daynight task ready --json
```

This returns at most 10 ready tasks, earliest created first. Use `--limit <N>`
for 1–100 candidates. It reads one task page; the result is not the complete
backlog. An empty result does not mean there are no in-progress or blocked tasks.

Pick exactly one ready `todo` task most relevant to the current authorized work.
Compare candidates by their scope, description, and dependencies; creation order
does not establish relevance. Read the selected task with
`daynight task show <task-id> --json` before acting. The returned tasks are
candidates, not a batch to start. If no candidate matches the authorized work,
follow the task-creation guidance below without taking unrelated work.

Advance only that one task at a time, including while waiting for CI, review, or
merge. Subagents may collaborate on the same task; they do not each select a
separate task. Select another task only after confirmed completion, within the
authorized scope.

Let the CLI resolve the current project. A new worktree without
`.daynight/project.yml` is normal: repository discovery can find the existing
project and save a local binding. Do not gate queries on that file's presence,
reuse remembered IDs as current facts, or edit bindings directly.

Use `daynight task graph --json` when dependency or project-wide context is
needed; it has title previews and omits full
descriptions, PR properties, and versions. If it reports `graph_limit_exceeded`,
continue with bounded ready and selected task reads; the error does not mean the
project is unlinked. `task list` traverses every matching page and defaults to
unfinished work. Use `daynight task list --all --json` only when a complete
inventory including completed tasks is needed.

If configuration, discovery, or a service request fails, preserve its actual
cause. Follow the CLI's setup guidance or obtain an explicit project selection
when needed; do not guess a server, choose among ambiguous projects, or create a
project merely to make task recovery succeed.

## Maintain useful tasks

Reuse an existing task whose scope matches the authorized work. Create durable
tasks for independently understandable outcomes that need cross-session
tracking, delivery verification, or handoff. Keep transient command steps in
the agent's own execution plan. Repository requirements and design documents
continue to own their full specifications.

Write an outcome-focused title and a coherent description containing scope,
acceptance, necessary decisions, current progress, blockers, and next action.
Rewrite that description as the work changes; do not accumulate a running log.
Express real prerequisites with dependencies.

Start authorized work by setting `in_progress`. The only states are `todo`,
`in_progress`, and `done`; readiness means a todo task's direct prerequisites are
done. Neither readiness nor `in_progress` is an exclusive claim, lock, lease, or
ownership guarantee. Coordinate concurrent work using observed task facts and
the project's existing communication rules.

Before changing any field, read the complete task and pass that exact observed
version as `--if-version`. Preserve the full int64 decimal value. A conflict
requires rereading and reconsidering the intended change, not replaying it with
a newer version. Descriptions, dependency sets, and PR reference lists are
complete replacements; the command reference explains pairing URL/title values,
clearing, and omitted fields.

Only report a write as successful after service confirmation. When a result is
unconfirmed, reconcile it with service reads before taking another write action;
do not blindly resend a create or update.

## Verify delivery before completion

Development tasks, and design or documentation tasks delivered through PRs,
remain `in_progress` until the hosting platform confirms that **all necessary
delivery PRs are merged** and the task's acceptance criteria are satisfied.
Code completion, an open PR, approved review, or passing CI does not meet this
condition. Record PR URLs, outstanding checks, and waiting items while delivery
is pending.

Before setting `done`, query the platform's actual merge state for every required
PR. Preserve its URL and title in the complete PR reference list and its merge
commit reference in the task description. Then reread the task and update with
its observed version. Missing merge visibility, a missing permission, or an unmet
merge check keeps the task `in_progress`; the completion rule grants no merge
authority. Tasks with no
development or PR delivery path use their stated acceptance criteria.

After confirmed completion, query `daynight task ready --json` to see which
dependent tasks became available. Apply the same relevance rule to select at
most one next task within the authorized scope. A ready successor still needs
authorization within the current scope before work starts. Refresh task facts at
these semantic checkpoints; do not reload the full project on every
conversational turn.
