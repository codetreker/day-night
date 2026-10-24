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

When the user explicitly supplies a task or fixed Goal queue, inspect its next
unfinished task by ID and use the manual execution path regardless of
`allowAgents`. Preserve readiness, stage inputs, and the existing execution
scope; a fixed queue does not authorize unrelated discovery. Existing scoped
authorization covers its ready successors without per-task reauthorization.

Otherwise, when there is no current task, query:

```bash
daynight task ready --allow-agents true --json
```

Pick exactly one ready `todo` task with `allowAgents=true` most relevant to the confirmed Goal and
authorized work. Compare concrete actions, scope, deliverables, solution,
acceptance criteria, and actual dependencies; creation order does not establish
relevance. Read full details and actual task-specific and shared inputs for
plausible candidates before choosing. Inspect complete `dependsOn` and the
`externalDependsOn` subset. External prerequisites still block readiness, and
cross-chain classification does not authorize executing them or expand the
confirmed scope. Readiness checks all prerequisites, not stage artifact
completeness or execution authorization. Pass the selected ID to
`run-task`, which enters in_progress using the version observed for that decision before starting.
Autopilot cannot supply user confirmation of requirements or solution. An
explicit request to start a Goal discussion uses the Goal protocol's scoped
manual execution path. Existing explicit authorization for a fixed task queue
covers its ready successors without additional per-task authorization.

Ready returns at most 10 candidates by default, or the requested bounded
`--limit`; it is not a complete backlog. If this page is empty or no candidate
matches, obtain the additional context actually needed through selected reads,
the graph, or `daynight task list --allow-agents true --json` as described in the handbook. Distinguish
completed scope, work lacking execution authorization, prerequisite-blocked work, other
ongoing work, and insufficient
candidates. Do not take unrelated work to stay busy or report completion from an
empty or unrelated bounded page.

Autopilot permission alone covers execution of existing tasks, not creation of
new ones. An explicit user or applicable repository instruction requiring
Daynight tracking or review supplies standing creation permission within the
confirmed scope. If the confirmed Goal requires missing tracked work, use explicit creation
permission already granted for that scope or obtain it, then use
[create-task](create-task.md). Goal permission covers its discussion stages and
confirmed in-scope breakdown at the Goal protocol's user-confirmation gates.
Do not create architecture placeholders or delivery tasks before their gate.
Delivery registration follows explicit user solution confirmation, and leaves
todo tasks without starting execution. Complete the solution
discussion only after the accepted solution and actual breakdown are verified;
its completion does not start delivery.

Automatic selection never enables `allowAgents` on a task. If the user explicitly
selects a task or fixed Goal queue for execution, its manual execution path remains available regardless
of the flag; preserve all prerequisite and authorization checks.

## Advance serially and accept the scope

Run one task at a time. Subagents collaborate on it; they do not each choose a
separate task. Ordinary CI, review, and merge waits keep that target. After
`run-task` confirms `done`, refresh readiness and select at most one next related
task within the same authorized scope. For Goal discussions, stop at each user
confirmation gate; completing requirements and starting solution discussion
requires the user's explicit confirmation and direction under the Goal protocol.
Solution confirmation permits todo delivery registration. Later delivery selection
requires a ready todo with complete inputs, explicit autopilot activation, and
execution authorization. Discussion completion satisfies a dependency and grants
no delivery execution permission. Existing scoped execution authorization
continues to apply to its stated ready successors.

If `run-task` returns a wait requiring external intervention, preserve its
current-task checkpoint and report the blocker and required next action. An
explicit no-merge or user-review requirement on a delivery task is such a wait; it never permits
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
