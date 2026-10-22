# Run one task

Execute exactly one specified task ID within the user's authorized scope. Read
[the handbook](handbook.md) for CLI operations, data semantics, and failures.
This mode owns execution and completion; it returns without choosing a successor
or activating autopilot.

## Establish the task and stage

Read the complete task with `daynight task show <task-id> --json`. Its Markdown
description must make the problem, current actions, scope, deliverables,
constraints, and observable completion summary understandable. Read its own primary
Markdown's Solution and Acceptance criteria; equivalent headings in the task's
language are valid.
Resolve description-relative links and images from the current task's attachment
root; links inside a Markdown attachment use its own directory. Resolve real
shared input references using the source task ID and attachment path or a verified
immutable repository reference. Read required contents rather than assuming a
task read loads attachment inventory or bytes.

For a Goal stage or delivery task, read [the Goal protocol](goal.md) and identify
its role from the actual task content and context. Apply that stage's input and
output requirements. Goal description and design start from their stage briefs;
the completed requirements, applicable UI prototype, and architecture are outputs
of the stages that produce them. Delivery tasks require the delivered design and
applicable prototype. When a prototype is a required input, view and exercise it
with its resources. An unfinished output of the current stage is not a missing
input.

Check state, direct prerequisites, authorized scope, and required stage inputs.
A missing or unreadable primary Markdown, missing Solution or Acceptance criteria,
or absent required input leaves execution unready. Resolve it within the
existing authorization or return the concrete issue. Do not infer requirements
from a title, silently invent acceptance criteria, or move detailed plans into
the description. Do not execute prerequisites as an implicit expansion of the
requested task.

For `todo`, begin only when dependencies are done and the work is authorized,
then set `in_progress`. For `in_progress`, recover existing work and coordinate
using the project's mechanisms; status is not an ownership claim. Report `done`
as complete; reopening needs explicit intent. A readable `proposed` task is
outside these executable states: preserve its actual state and resolve the
required authorized process before execution. Do not implicitly promote it.
Preserve the requested ID through recovery and waiting.

## Execute and maintain continuity

Follow the target repository's instructions for worktrees, implementation,
review, validation, and delivery. Use the task's stage-appropriate solution and
acceptance criteria, including applicable final-style prototype interactions.
Goal description defines the problem without architecture decisions or production
implementation. Design completes architecture and actually registers and verifies
the entire delivery breakdown before design PR handover. Do not start a successor
while running either stage.

Resolve material changes to the agreed solution or acceptance within the current
authorization. Rewrite the owning artifact and affected task summaries and input
references coherently. Preserve requirements; do not silently weaken acceptance.
Descriptions remain self-contained Markdown task summaries. Preserve valid
syntax, original content, and actual resource references during full-field
updates; confirm new or replaced resources before linking them. Each primary
Markdown owns its detailed plan and evidence; shared inputs remain at their
verified source.

Advance only this task. Subagents collaborate on it, and waiting for CI, review,
approval, or merge remains part of it. Keep all required delivery PR URLs and
titles in the complete `properties.pullRequests` list, preserving existing
entries. Record acceptance results and necessary delivery evidence, including
merge commits, with the primary Markdown's corresponding acceptance criteria.
Rewrite current evidence coherently rather than accumulating an execution log.
Keep operational progress, blockers, waiting items, and next action in the
conversation or existing execution checkpoint, retaining the task ID and needed
PR and workspace references.

## Confirm completion or return waiting

Development tasks and design or documentation tasks delivered through PRs remain
`in_progress` until the hosting platform confirms **every necessary delivery PR
is merged** and all stage acceptance criteria are satisfied. Code completion,
passing CI, approved review, and an open PR do not satisfy this condition. Verify
actual merge state through the host's native client or API; do not assume a
particular host.

Completion rules grant no merge, deployment, external communication, or mainline
push permission. Follow existing authorization without asking again for actions
it covers. If the user requests an open PR for review or forbids merging, deliver
the reviewable PR, preserve `in_progress` and the waiting checkpoint, and return
its URL and required user action. Do not enable auto-merge. Missing permission,
unavailable merge visibility, or an unmet merge check likewise keeps completion
pending and successors blocked.

For tasks without a development or PR delivery path, use their stated stage
acceptance. In every case, confirm required evidence is recorded and readable,
then reread the complete task and set `done` with its exact observed version.
Only service confirmation establishes the status update; reconcile uncertain
results before reporting success. A Goal description task's completion means
problem definition is complete; design completion means architecture and actual
breakdown are delivered. Neither establishes whole-Goal completion.

Continue ordinary CI and review waits as this task. When progress requires
external intervention, preserve the target, actual state, concrete blocker,
existing work, and next action in the checkpoint, then return the waiting result.
An unstarted task stays `todo`; a started task stays `in_progress`. Do not declare
completion or select other work to bypass a wait. After completion, return
without selecting a successor. Whole-Goal acceptance follows the Goal protocol.
