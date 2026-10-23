# Autopilot

Enter this mode only when the user explicitly requests automatic execution of
Daynight tasks. Use the confirmed Goal or work scope. Loading the skill, a ready
task, or a completed `run-task` does not activate autopilot. A bare
`using-daynight` invocation can resume it only when the conversation establishes
that the user already activated it.

Read [the handbook](handbook.md) for discovery and query semantics. For a Goal
chain, read [the Goal protocol](goal.md) for stage requirements, breakdown, and
whole-Goal acceptance. Delegate execution and completion to
[run-task](run-task.md); do not maintain a separate delivery lifecycle here.

## Restore the current target

Resume this session's current task before selecting new work. Read its ID from
the conversation or existing execution checkpoint, then refresh it with
`daynight task show <task-id> --json`. If identity is unknown, query
`daynight task list --status in_progress --json` as needed and establish which
task belongs to the current work. An arbitrary `in_progress` task is not
this session's target.

A waiting checkpoint retains its task until that task is confirmed done or the
user explicitly changes the target. Resume the required next action when
possible. Do not select another task because CI, review, or merge is pending.

## Select one related task

When there is no current task, query:

```bash
daynight task ready --allow-agents true --json
```

Pick exactly one approved ready `todo` task with `allowAgents=true` most relevant to the confirmed Goal and
authorized work. Compare concrete actions, scope, deliverables, solution,
acceptance criteria, and actual dependencies; creation order does not establish
relevance. Read full details and actual task-specific and shared inputs for
plausible candidates before choosing. Inspect complete `dependsOn` and the
`externalDependsOn` subset. External prerequisites still block readiness, and
cross-chain classification does not authorize executing them or expand the
confirmed scope. Readiness checks all prerequisites, not stage artifact
completeness or execution authorization. Pass the selected ID to
`run-task`, which claims the version observed for that decision before starting.
Autopilot never auto-approves proposed work. Goal creation, completed description
or design, and permission to execute do not authorize task approval.

Ready returns at most 10 candidates by default, or the requested bounded
`--limit`; it is not a complete backlog. If this page is empty or no candidate
matches, obtain the additional context actually needed through selected reads,
the graph, or `daynight task list --allow-agents true --json` as described in the handbook. Distinguish
completed scope, work awaiting explicit approval, prerequisite-blocked work, other
ongoing work, and insufficient
candidates. Do not take unrelated work to stay busy or report completion from an
empty or unrelated bounded page.

Autopilot permission covers execution of existing tasks, not creation of new
ones. If the confirmed Goal requires missing tracked work, use explicit creation
permission already granted for that scope or obtain it, then use
[create-task](create-task.md). Permission to create a Goal already covers both
starting tasks and its later in-scope breakdown; do not ask again for each one.
Creation leaves proposed tasks pending separate explicit approval and returns
to this mode without starting execution. The design stage must
actually register and verify the complete delivery breakdown before handing over
its required PR; successor execution waits for design completion.

Automatic selection never enables `allowAgents` on a task. If the user explicitly
selects a task for execution, its manual claim path remains available regardless
of the flag; preserve all approval, prerequisite and authorization checks.

## Advance serially and accept the scope

Run one task at a time. Subagents collaborate on it; they do not each choose a
separate task. Ordinary CI, review, and merge waits keep that target. After
`run-task` confirms `done`, refresh readiness and select at most one next related
task within the same authorized scope. Description completion permits design
selection, and design completion permits delivery selection, only when the next
task is approved ready todo, its stage inputs are complete, this mode is explicitly
active and execution is authorized. Stage completion satisfies a dependency; it
never approves a successor. Explicit scoped user approval may cover stated Goal
tasks, but the Goal-creation permission itself does not.

If `run-task` returns a wait requiring external intervention, preserve its
current-task checkpoint and report the blocker and required next action. An
explicit no-merge or user-review requirement is such a wait; it never permits
auto-merge or marking the task done. An unfinished external prerequisite outside
the authorized scope is also an external blocker: preserve its ID and reason,
without dropping or reclassifying it to manufacture readiness. Return without replacing the target.

Before reporting a Goal complete, apply the Goal protocol's whole-Goal acceptance:
verify the full registered scope, every delivery task's completion, all necessary
PR merges, and the original overall acceptance evidence. A completed description
or design is only a stage result. For other scopes, verify their confirmed
completion conditions against the actual work.

Stop when the confirmed scope is complete, the user requests a stop, or progress
needs external intervention. Report observed results, remaining blockers, and
the checkpoint. Automatic task selection does not expand permission to merge,
deploy, communicate externally, or push mainline.
