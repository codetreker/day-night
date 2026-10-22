# Create a task

Use this mode to prepare and register work that needs persistent tracking. Read
[the handbook](handbook.md) before discovery, queries, or writes. Return after
registration; creating work does not authorize execution or activate autopilot.

Create tasks only with the user's explicit permission for the relevant scope.
Loading this mode, needing durable tracking, or permission to implement or run
autopilot does not grant creation permission. Ask when it is missing; reuse
permission already granted for the scope.

## Choose the tracked outcome

One-off operations and trivial work do not need a task. Keep transient commands,
tests, and execution steps in the existing plan. With creation permission,
register an independently understandable outcome when delivery needs continued
tracking, cross-session continuity, handoff, or dependency coordination. If the
request does not merit a task, explain that conclusion and return.

For multiple independently tracked delivery stages, follow
[the Goal protocol](goal.md). Register its Goal description task and dependent
architecture-and-breakdown placeholder together. Their own stage briefs are
required at registration; the finished Goal, UI prototype, architecture, and
breakdown are outputs of the stages that produce them. Creating a Goal covers
both starting tasks and its later in-scope breakdown within the granted creation
permission. Do not execute a stage in this mode.

For a single tracked outcome, prepare its solution, acceptance criteria, and
applicable mock UI before registration, following the artifact rules below.

Look for existing work with the same problem and scope, including completed
tasks; the default list contains only unfinished work. Inspect full descriptions,
actual dependencies, primary Markdown, and acceptance criteria. For a Goal,
inspect the existing chain and its owning inputs. Titles alone do not establish
identity. Reuse suitable work and preserve valid requirements; interrupted
registration does not justify a duplicate task or chain.

## Write task-specific content

Use the target repository's document and workspace rules.

| Content | Owner |
|---|---|
| Concrete problem, current actions and scope, deliverables, constraints, completion summary, and real input references | Task `description` |
| Detailed solution, full acceptance criteria, verification methods, and completion evidence | This task's primary Markdown attachment |
| Applicable visual and interaction design | Owning task's interactive mock UI and resources, referenced by consumers |
| Prerequisite tasks | `dependsOn` only |
| Delivery PR URLs and titles | `properties.pullRequests` |

Give each task an outcome-focused title and a self-contained description: a
reader must understand what this specific task will do, deliver, and verify
without opening attachments. Summarize the approach and observable completion
conditions, then reference the real detailed sources. A generic problem sentence
and a link list are insufficient. Keep the summary consistent with its primary
Markdown without maintaining a second complete plan in the description.

The primary Markdown must contain **Solution** and **Acceptance criteria**
sections; equivalent headings in the task's language are valid. Define the
current task's approach, scope, behavioral constraints, observable completion
conditions, and how to verify them. Stage briefs describe the work that will
produce that stage's results. They do not claim unfinished outputs already exist.
Link supporting resources from the primary document.

Attach only this task's detailed plan, needed resources, and outputs. Shared
Goal requirements stay with the Goal description task; architecture and
breakdown stay with the design task. Consumers identify the source task ID and
attachment path and confirm the contents using the installed CLI's attachment
read command. For repository inputs, use verified immutable references. Do not
assume a `task://` scheme, cross-task relative links, or a fixed service host.
Do not upload the same whole packet to every task. Create a separate snapshot
only when the task needs an independent copy, recording its purpose, original
source, and source revision or content identity.

A frontend task requires an interactive mock UI that runs with frontend code
alone, matches final visual styling, and represents relevant data and interaction
states. Include applicable populated, empty, loading, failure, disabled, long
content, and narrow-screen cases. Provide required CSS, JavaScript, images, and
other resources with working relative references. A static sketch or simplified
styling does not satisfy this requirement. For a UI Goal, this prototype is
produced by the Goal description stage and referenced by later tasks.

Use established task IDs in `dependsOn` for real prerequisites. Do not add a
Dependencies section or duplicate the dependency list in the description or
Markdown. A top-level task has no dependencies. Repository specifications and
design documents retain their full contracts; the task's own primary attachment
must still provide a specific solution and verifiable acceptance criteria.

## Register and verify

Reuse the established project and suitable tasks. Create new tasks in `todo`,
retaining each confirmed ID. Set their concrete descriptions and actual
`dependsOn` prerequisites. Upload each task's own primary Markdown and required
resources; add actual attachment references to the complete description using
the observed task version. Reference already readable shared inputs at their
source. Do not present planned uploads as existing attachments.

Read back each complete task, its attachment inventory and required contents,
and its referenced shared inputs. Verify task-specific descriptions, the two
required Markdown sections, real source identities, intended dependencies, and
applicable mock UI resources and interaction. For a Goal, verify both starting
tasks and their stage briefs. Registration is complete only when required
artifacts and associations are confirmed readable.

If creation succeeds but a later operation fails, retain the confirmed IDs and
resume missing operations there. Tasks remain `todo`; there is no additional
draft state. Reconcile uncertain results through the handbook before another
mutation. Report incomplete registration with the exact missing operation or
artifact and next step. Do not move detailed plans into descriptions to bypass
an attachment failure. Return after verified registration without selecting or
executing a task.
