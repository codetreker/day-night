# Create a task

Use this mode to prepare and register work that needs persistent tracking. Read
[the handbook](handbook.md) before discovery, queries, or writes. Return after
registration; creating a task does not authorize implementation or activate
autopilot.

## Decide whether to register

One-off operations and trivial work do not need a task. Keep transient command
steps in the existing execution plan. Register an independently understandable
outcome when its delivery needs continued tracking, cross-session continuity,
handoff, or dependency coordination. If the request does not merit a task,
explain that conclusion without creating one or starting unrequested work.

Look for an existing task that solves the same problem within the same scope.
Inspect its full description, dependencies, primary Markdown, and acceptance
criteria; matching titles alone do not establish equivalence. Reuse a suitable
task and preserve its valid requirements. Do not create another task because
registration of a known task was interrupted.

## Prepare the required artifacts

Prepare the solution, acceptance criteria, and required mock UI before creating
the task. Use the target repository's document and workspace rules.

| Content | Owner |
|---|---|
| Problem and actual attachment references | Task `description` |
| Solution and acceptance criteria | One primary Markdown attachment |
| Frontend visual and interaction design | Interactive mock UI attachment and its resources |
| Prerequisite tasks | `dependsOn` only |
| Delivery PR URLs and titles | `properties.pullRequests` |

Give the task an outcome-focused title. Its description explains what problem
the task solves and why, then references the actual primary Markdown and, for
frontend work, the mock UI. The primary Markdown must contain sections for
**Solution** and **Acceptance criteria**, with equivalent headings in the task's
language allowed. The solution defines the approach, scope, and necessary
behavioral constraints. Acceptance criteria state observable completion
conditions and how to verify them. Link any supporting resources from this
primary document.

For example, the Markdown may contain:

```markdown
## Solution

Provide state filters in the task list. The interactive design is the
mock UI attachment at `../mockui/index.html`.

## Acceptance criteria

- Selecting a state shows only matching tasks.
- Clearing the filter restores the complete list.
- Verify filtering, empty results, and narrow-screen interaction against the mock UI.
```

A frontend task requires a mock UI that runs interactively with frontend code
alone, matches final visual styling, and represents relevant data and interaction
states. Include applicable populated, empty, loading, failure, disabled, long
content, and narrow-screen cases. Upload required CSS, JavaScript, images, and
other resources with working relative references. A static sketch or simplified
styling does not satisfy this requirement.

Express real prerequisites through `dependsOn`, using established task IDs. Do
not add a Dependencies section or duplicate the dependency list in the
description or Markdown. A top-level task simply has no dependencies. Repository
specifications and design documents retain ownership of their full contracts;
the primary attachment must still give the executor a clear solution and
verifiable acceptance criteria.

## Register and verify

Reuse the established project and task when applicable. For a new task, create
it in `todo` with its problem and actual dependencies, retaining the confirmed
task ID. Upload the primary Markdown, frontend mock UI, and all required
resources under that same ID. Add their actual paths to the complete task
description using the observed task version. Do not present planned paths as
confirmed uploads.

Read back the complete task, attachment metadata, and required contents. Confirm
that references resolve, the two required Markdown sections are present,
dependencies match the intended prerequisites, and the frontend mock UI and its
resources are available and work together. Registration is complete only after
all required artifacts and their associations are confirmed readable.

If creation succeeds but an upload or description update fails, preserve the
task ID and resume registration on that task. It remains `todo`; there is no
additional draft state. If a write result is uncertain, follow the handbook's
reconciliation rules before another mutation. Report incomplete registration
with the exact missing artifact or operation and next step. Do not inline the
solution or acceptance criteria into the description to bypass an attachment
failure.
