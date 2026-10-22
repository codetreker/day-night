# Run one task

Execute exactly one specified task ID within the user's authorized scope. Read
[the handbook](handbook.md) for CLI operations, data semantics, and failures.
This mode owns execution and completion; it returns without choosing a successor
or activating autopilot.

## Establish the task

Read the complete task with `daynight task show <task-id> --json`. Resolve its
actual attachment references and read the primary Markdown's solution and
acceptance criteria. Equivalent headings in the task's language are valid.
Frontend tasks also require viewing the interactive mock UI and the resources
needed to render it. Filenames are not fixed, and a task read alone does not
load its attachments.

Check the task's state, direct prerequisites, authorized scope, and required
artifacts before starting. A missing or unreadable primary Markdown, missing
solution or acceptance criteria, or absent required mock UI leaves execution
unready. Resolve the missing requirement within the authorized scope or return
the concrete issue; do not silently invent acceptance criteria or move the plan
into the description. Do not execute prerequisites as an implicit expansion of
the requested task.

For `todo`, begin only when dependencies are done and the work is authorized,
then set `in_progress`. For `in_progress`, recover existing work and coordinate
using the project's established mechanisms; the status is not an ownership
claim. A task already `done` is reported as such; reopening needs explicit
intent. Preserve the requested task ID through recovery and waiting.

## Execute and maintain continuity

Follow the target repository's instructions for worktrees, implementation,
review, validation, and delivery. Use the attachment solution and acceptance
criteria to guide the work, including the frontend mock UI's final styling and
interactions. Material changes to the agreed solution or acceptance require
resolution within the current authorization and coherent updates to the owning
attachment; do not silently weaken requirements to obtain completion.

Advance only this task. Subagents collaborate on it, and waiting for CI, review,
approval, or merge remains part of it. Keep all required delivery PR URLs and
titles in the complete `properties.pullRequests` list. Preserve existing entries
when updating that list.

Keep the problem and actual attachment references in the description. Record
acceptance results and necessary delivery evidence, including merge commit
references, with the Markdown attachment's corresponding acceptance criteria.
Rewrite the current evidence coherently rather than accumulating an execution
log. Keep operational progress, blockers, waiting items, and the next action in
the conversation or the project's existing execution checkpoint, retaining the
task ID and any necessary PR and workspace references.

## Confirm completion or return waiting

Development tasks and design or documentation tasks delivered through PRs remain
`in_progress` until the hosting platform confirms **every necessary delivery PR
is merged** and all acceptance criteria are satisfied. Code completion, passing
CI, approved review, and an open PR do not satisfy this condition. Verify actual
merge state through the hosting platform's native client or API; do not assume
a particular host.

Completion rules grant no merge, deployment, external communication, or mainline
push permission. Follow the user's existing authorization without asking again
for actions it already covers. If the user requests an open PR for their review
or forbids merging, deliver the reviewable PR, keep the task `in_progress`, save
the waiting checkpoint, and return with its URL and the required user action.
Do not enable auto-merge. Missing permission, unavailable merge visibility, or
an unmet merge check likewise keeps completion pending.

For tasks with no development or PR delivery path, use their stated acceptance
criteria. In all cases, confirm the required evidence is recorded and readable,
then reread the complete task and set `done` with the exact observed version.
Only service confirmation establishes the status update; reconcile an uncertain
result before reporting it.

Continue ordinary CI and review waits as the current task. If progress requires
external intervention, preserve the current target, actual task state, concrete
blocker, existing work, and next action in the checkpoint, then return that
waiting result. An unstarted task stays `todo`; a started task stays
`in_progress`. Do not declare completion or select other work to bypass a wait.
