# Goal protocol

Read this reference when creating a multi-stage Goal, running one of its tasks,
or advancing its authorized scope. Use [create-task](create-task.md) for content
and registration rules, [run-task](run-task.md) for one task's lifecycle, and
[the handbook](handbook.md) for CLI semantics. A Goal uses existing tasks,
attachments, persisted `groupId`, `dependsOn`, and PR properties; it adds no Goal
command, task type, status, or execution authority. Shared group membership never
substitutes for actual prerequisite relationships.

## Identify and register a Goal

Use a Goal when completing the request requires multiple independently tracked
delivery stages. One independently tracked outcome remains a normal task;
commands, tests, and temporary execution steps do not each need persistent tasks.
The user need not use the word Goal.

Explicit permission to create a Goal covers its two starting tasks and the later
breakdown within that Goal. It covers no unrelated tasks and grants no execution,
publication, deployment, external communication, merge, or mainline push
permission. Existing explicit authorization continues to apply within its scope.
Implementation or autopilot permission alone does not grant creation permission.
Goal-creation permission does not authorize approval. Approve only tasks or a
Goal-task scope explicitly approved by the user, using each reviewed task's exact
version; CLI and Web approval are available. Goal creation, requirements/prototype
completion, design completion and autopilot never imply that instruction. Approval
itself grants no execution or delivery permission.

During registration, create or reuse both starting tasks:

| Task | Title | Initial content |
|---|---|---|
| Goal description | `[Goal]<outcome>` | The known overall problem, intended results, scope, constraints, UI applicability, exclusions, and observable acceptance summary; a stage brief for resolving open requirements and producing the complete Goal. |
| Architecture design and task breakdown | `Architecture design and task breakdown: <outcome>` | Its concrete work: consume the completed Goal, design the architecture, register the complete delivery breakdown, verify its artifacts and dependencies, and deliver any required design PR. Its own stage brief defines the approach and acceptance. |

The `[Goal]` marker is followed directly by the outcome. Goal description names
the stage; it is not the title prefix. Titles communicate purpose but do not
establish stable identity. Preserve confirmed IDs and inspect full content when
reusing an existing chain.

Create the Goal description without a group ID and retain its confirmed task ID
and `groupId`, which are equal. Pass that `groupId` explicitly through
`task create --group-id` when creating the design task and every later Goal
member. Reuse an existing chain only after confirming its stored group IDs;
titles and dependency paths do not establish membership. Set the design task's
`dependsOn` to the Goal description task. Each task starts
in `proposed` with its own self-contained Markdown description and primary Markdown
containing Solution and Acceptance criteria. State unanswered questions honestly.
Complete requirements, prototypes, architecture, and breakdown are produced by their
respective stages; they are not prerequisites for registering the chain or
starting the stage that produces them. Confirm both tasks, stage briefs,
references, and dependency through real reads, then return from `create-task`.
Registration completeness leaves approval pending unless the user separately
authorized approval for those tasks. Metadata and attachment writes do not approve.

## Execute the appropriate stage

Every stage uses the same explicit task lifecycle. Proposed work waits for the
user's scoped approval; an authorized `task approve` moves it to todo even with
unfinished prerequisites. Begin only from approved ready todo with complete
stage inputs and execution authorization: use `task claim` with the exact version
observed for that decision and confirm in_progress. Resume existing in-progress
work after checking its actual checkpoint. After the stage acceptance and every
required authorized PR merge, reread and use `task complete` with the observed
version. Completion satisfies dependencies but never approves the next stage.

| Stage | Required inputs to start | Outputs and completion |
|---|---|---|
| Goal description | Its stage brief, current problem and scope, and available background. | Complete overall requirements, applicable final-style interactive UI prototype, verified stage acceptance, and repository-required delivery. Finishing this task completes problem definition. |
| Architecture design and task breakdown | Completed Goal description, its full requirements and applicable prototype, and the design stage brief. | Complete architecture and the actual registered delivery tasks, verified task-specific artifacts and dependencies, satisfied stage acceptance, and platform-confirmed merge of every required design PR. |
| Delivery task | Completed design prerequisite, delivered architecture, its own solution and acceptance criteria, and applicable prototype and resources. | This task's deliverable, verification, required review and PR merges, and readable acceptance evidence under the normal run-task rules. |

### Goal description

Explain the whole problem and why it matters, the final observable results,
required behavior and constraints, scope, explicit exclusions, and how the whole
Goal will be accepted. The task description itself must communicate this complete
overall brief and a concise acceptance summary. Its primary Markdown owns the
full requirements, verification methods, and stage evidence. Resolve blocking
ambiguities without making architecture decisions or changing production
implementation code.

For a UI Goal, specify final layout, visual styling, interactions, representative
data, and relevant states. Produce an interactive prototype that runs with
frontend code alone, with final styling and all necessary resources. Cover
applicable populated, empty, loading, failure, disabled, long-content, and
narrow-screen states; explain exclusions when a relevant-looking state does not
apply. Prototype code is an allowed problem-definition artifact. View and
exercise the result when verifying this stage.

Confirm the full requirements are clear, the applicable prototype is usable,
and this stage's acceptance and repository delivery rules are satisfied. If
repository rules require a PR for these artifacts, use the existing PR completion
rules. Otherwise use the stated stage acceptance. Complete only this in-progress
task through `task complete` with its observed version after verification. This
satisfies design's dependency; design still needs its own approval and claim, and
whole-Goal delivery remains unverified.

### Architecture design and actual task breakdown

Consume the completed Goal and prototype. Design the responsibilities, boundaries,
data and control flow, contracts, error behavior, key decisions, and validation
approach required by the target repository and Goal.

During this task, register the complete set of persistent delivery tasks needed
to satisfy the Goal. Explicitly pass the confirmed Goal `groupId` for every
member, including tasks without a dependency path to another delivery task. Each represents a concrete outcome with its own actions,
scope, deliverables, constraints, solution, acceptance criteria, verification
methods, and real input references. Their combined scope must cover the complete
Goal. A future registration list or a vague implementation placeholder does not
satisfy task breakdown.

Use `dependsOn` for actual prerequisites. Every delivery root with no other
implementation prerequisite depends directly on the design task; all delivery
paths must therefore pass through design completion. Keep delivery tasks blocked
while design is unfinished. This stage registers and verifies them; it does not
execute them. New successors are proposed; approval requires a separate explicit
user instruction covering them, even when Goal creation already permits their
registration. Approved successors still wait for completed design prerequisites.

Upload each successor's own primary Markdown and needed resources, referencing
shared Goal and design inputs at their verified source. The design task owns its
architecture and breakdown outputs. Read back every registered task, required
attachment, source reference, and dependency. Verify the full breakdown before
handing over the design PR. When review changes the design, update its owning
artifacts and affected task summaries, plans, and references coherently, then
reread them before completion.

Follow repository document and independent review requirements. When a design
PR is required, create it and maintain the full `properties.pullRequests` list.
Keep this task `in_progress` until every necessary PR is platform-confirmed merged
and stage acceptance is satisfied. An open PR, successful CI, or approval does
not complete design. A user-review or no-merge instruction preserves this task
and its blocking dependency while waiting; it grants no merge authority.

## Preserve ownership and recover partial registration

Every stage and delivery task needs its own self-contained Markdown description
and detailed primary Markdown. Follow create-task's Markdown and verified-resource
rules without claiming unfinished stage outputs are already available. Keep shared
requirements on the Goal description task and shared architecture and breakdown on the design task. Later tasks reference
verified source task IDs and attachment paths, read through the installed CLI,
or verified immutable repository references. Do not distribute a duplicate whole
packet to all tasks. Only copy a snapshot when the consuming task needs it,
recording the purpose, original source, and source revision or content identity.

Registration comprises independent writes, not a transaction. Reuse confirmed
IDs and the confirmed group ID if creating the second starting task, uploading an artifact, updating a
reference, or registering part of the breakdown fails. Before retrying an
uncertain write, read the complete actual resource and operation context as the
handbook requires. A similar title does not prove success, and a lost response
does not prove failure. If identity cannot be established uniquely, preserve the
specific error and request the information needed to reconcile it; do not create
another chain.

Apply the handbook's exact-version rules to metadata updates, approval, claim
and completion, and preserve complete-field replacement semantics for updates. Attachments are independent of task versions, status, and timestamps;
verify actual file contents and metadata separately. Do not unlock delivery by
marking incomplete registration or unfinished design complete. Readiness and
`in_progress` provide no ownership lock; claim is a versioned transition, not an
assignee lease. Generic updates cannot write status or bypass stages.

## Advance and accept the whole Goal

`run-task` returns after its specified task completes or requires external
intervention. Completing registration, Goal description, or design never activates
autopilot. Only explicitly active `autopilot` may select the next related task
after confirming the current task `done`, within the user's authorized scope.
CI, review, and merge waits remain with the current task.

To report the whole Goal complete, inspect the full registered delivery scope,
confirm their stored `groupId`, every delivery task completed and every necessary PR actually merged,
and verify the original Goal's overall acceptance criteria with recorded
evidence. Description completion, design completion, one delivery PR, or an empty
ready page is insufficient. Distinguish verified partial results and remaining
blockers from whole-Goal completion. This check does not create a new Goal status
or reopen the completed problem-definition task.
