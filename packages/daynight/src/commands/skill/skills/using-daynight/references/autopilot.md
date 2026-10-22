# Autopilot

Enter this mode only when the user explicitly requests automatic execution of
Daynight tasks. Use the confirmed goal and work scope. Loading the skill, a
ready task, or a completed `run-task` does not activate autopilot. A bare
`using-daynight` invocation can resume it only when the conversation establishes
that the user already activated it.

Read [the handbook](handbook.md) for discovery and query semantics. Delegate
execution and completion to [run-task](run-task.md); do not maintain a separate
delivery lifecycle here.

## Restore the current target

Resume this session's current task before selecting new work. Read the task ID
from the conversation or the project's existing execution checkpoint, then
refresh it with `daynight task show <task-id> --json`. If identity is unknown,
query `daynight task list --status in_progress --json` as needed and establish
which task belongs to the current work. An arbitrary `in_progress` task is not
automatically this session's target.

A waiting checkpoint retains its task until that task is confirmed done or the
user explicitly changes the target. Resume the required next action when
possible. Do not select another task because CI, review, or merge is pending.

## Select one related task

When there is no current task, query:

```bash
daynight task ready --json
```

Pick exactly one ready `todo` task most relevant to the confirmed goal and
authorized work. Compare problem, scope, solution, acceptance criteria, and
dependencies; creation order does not establish relevance. Read full details
and actual referenced attachments for plausible candidates before committing to
a target. Readiness checks prerequisites, not required artifact completeness or
execution authorization. Pass the selected task ID to `run-task`.

Ready returns at most 10 candidates by default, or the requested bounded
`--limit`; it is not a complete backlog. If this page is empty or no candidate
matches, obtain the additional context actually needed through selected reads,
the graph, or a complete filtered list as described in the handbook. Distinguish
completed scope, remaining work blocked by prerequisites, other ongoing work,
and insufficient candidates. Do not report the scope complete from an empty or
unrelated bounded page, or take unrelated work to stay busy.

Autopilot permission covers execution of existing tasks, not creation of new
ones. If the confirmed goal requires missing tracked work, obtain explicit task
creation permission unless the user already granted it for that scope, then use
[create-task](create-task.md). Its return does not itself start execution;
selection and execution still follow this mode's rules.

## Advance serially

Run one task at a time. Subagents collaborate on the same task; they do not each
choose a separate task. Ordinary CI, review, and merge waits keep that target.
After `run-task` confirms `done`, refresh readiness and select at most one next
related task within the same authorized scope.

If `run-task` returns a wait requiring external intervention, preserve its
current-task checkpoint and report the blocker and required next action. An
explicit no-merge or user-review requirement is such a wait; it never permits
auto-merge or marking the task done. Return without replacing the target.

Stop when the confirmed scope is complete, the user requests a stop, or progress
needs external intervention. Report the observed state and checkpoint; do not
equate an absence of selectable tasks with complete delivery. Automatic task
selection does not expand permission to merge, deploy, communicate externally,
or push mainline.
