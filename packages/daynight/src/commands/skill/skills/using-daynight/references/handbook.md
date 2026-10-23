# Daynight handbook

Use the installed `daynight` CLI. Discover command groups with `daynight --help`
and read the relevant command's `--help` for arguments, options, and output
formats. The installed `dn` alias accepts the same commands. This reference indexes project/task commands and explains the context
needed to use them correctly.

## Command index

| Command | Purpose |
|---|---|
| `setup` | Configure access to the service origin and optional personal token. |
| `project create` | Register a repository as a project or find its existing project. |
| `project list` | Find projects on the configured service. |
| `project show` | Inspect a project's details. |
| `task create` | Register a proposed task with its metadata and dependencies. |
| `task ready` | Read a bounded candidate page of approved todo tasks with completed prerequisites. |
| `task list` | Read every matching page; defaults to unfinished tasks. |
| `task show` | Read one task's complete details and exact version. |
| `task update` | Change metadata, automatic-execution permission, dependencies, or PR references; status is not writable. |
| `task approve` | Change proposed to todo using an observed version and explicit approval authorization. |
| `task unapprove` | Withdraw approval of todo work, returning it to proposed using an observed version. |
| `task claim` | Change ready todo to in_progress using an observed version. |
| `task complete` | Change in_progress to done after acceptance and required authorized delivery. |
| `task graph` | Inspect the project's dependency graph and summary. |
| `task attachment put` | Upload or replace one attachment file. |
| `task attachment list` | Read a task's attachment inventory and metadata. |
| `task attachment read` | Retrieve an attachment's original bytes. |
| `task attachment remove` | Delete one attachment file. |

## Operational context

**Service credentials.** Read the installed `daynight setup --help` for credential
configuration. Use setup's hidden interactive token prompt or its explicit
stdin option; never put a token in command arguments, chat, task descriptions,
checkpoints or attachments. A configured token is bound to the normalized service
origin: changing the origin removes the previous token. Tokens require HTTPS
except for literal localhost or loopback HTTP addresses. Project discovery and
explicit project IDs grant no access; the service decides from current membership
when authorization is enabled. A 401 points to setup and does not permit an
anonymous retry or a blind repeat of a mutation. Reconcile an unconfirmed write
before another mutation. Setup saves configuration and performs no login or
network check.

**Project discovery.** Inside a Git worktree, task commands can omit `--project`:
the CLI matches the origin repository URL to a project on the configured
service. An explicit project overrides discovery for that invocation. Resolve
missing or ambiguous matches rather than guessing an ID or creating a project
to make a query succeed.

**Read scope.** Ready is a candidate page of approved todo tasks, ordered by
creation rather than relevance. An empty page does not rule out proposed,
in-progress or dependency-blocked work. List traverses every matching page but
excludes `done` by default; include completed tasks explicitly when checking the
full backlog or prior registrations. Its grouping is in-progress, ready todo,
blocked todo, proposed, then done when included; this does not rank relevance.
Human lists are summaries; JSON lists omit only `description` and preserve every
other task field. Use show when a description is needed; ready, details and write
results retain full tasks. Graph provides compact dependency context without
full descriptions, PR properties, or versions. Read the selected task's details
before acting. A graph-limit error still permits bounded candidate and
individual task reads.

**Lifecycle and approval.** Creation starts in `proposed`. Explicit approval
moves proposed to todo; unapprove returns only unstarted todo work to proposed;
claim moves ready todo to in_progress; complete moves in_progress to done.
Approval and withdrawal allow unfinished prerequisites. Claim and completion
require every direct prerequisite to be done. Proposed is never ready, even
with no prerequisites. Withdrawal preserves task materials, dependencies,
execution timestamps and attachments; it does not change successor states.
Repeated actions and wrong predecessor states fail. There is no reopening of
in-progress or done work, execution release, or direct todo-to-done transition.
Metadata, attachments and PR references cannot approve, withdraw approval or
claim work. Approve or unapprove only when the user explicitly authorizes that
action for the task or stated scope; creation, execution requests, `run-task`
and autopilot grant none. In the Web, the title-row entry opens a confirmation;
only deliberate confirmation is the user's approval or withdrawal instruction.
Cancel and Escape submit no action. Task approval itself grants no implementation,
publication, deployment or merge permission.

**Automatic execution permission.** Tasks expose the required boolean
`allowAgents`, independent of status approval and dependency readiness. New tasks
start false; public creation cannot set it. Existing tasks receive true through
the database migration. Use `task update <task-id> --allow-agents true|false --if-version <version>` only
for an explicitly authorized permission change.
Omission preserves the current value, including explicit false. Actual changes
are locked during in_progress; exact-version same-value requests keep the
version and timestamps, while stale versions still conflict. Approve, unapprove,
claim, complete and other metadata updates preserve the flag.

`task list` and `task ready` accept `--allow-agents true|false`. The server
combines that condition with other filters before pagination and the ready limit;
an unfiltered ready page may contain tasks without automatic-execution permission.
Automatic selection requires true and automated workflows must not enable it
themselves. An explicitly user-selected task may still use manual claim regardless
of the flag. Permission does not grant execution, publication or merge authority.
A lost permission PATCH response is an unconfirmed write: read actual task state
before reconsidering the operation, without resubmitting automatically.

**Task concurrency.** Bind each metadata update, approve, unapprove, claim and complete to
the exact version read for that decision using `--if-version`; the CLI's default
pre-submit read cannot protect an earlier decision. Preserve full int64 decimal
digits without numeric rounding. A claim is a versioned transition, not an
assignee lock, renewable lease or proof that existing work belongs to this
session. On a conflict, reread and reconsider; a new action needs a fresh
decision, not merely a newer version. Never retry a mutation automatically.

**Replacement fields.** Descriptions, dependency sets, and PR reference lists
replace the whole supplied field. Preserve every still-needed value. Omitted
fields stay unchanged; clearing and option-pairing syntax is in command help.

**Markdown descriptions.** Write self-contained task briefs in Markdown following
[create-task](create-task.md). The Web displays CommonMark/GFM, while API and CLI
reads preserve the original string, including line breaks and fenced code. There
is no format flag. Relative description links and images start at the current
task's attachment root; Markdown attachment internals start at their containing
file's directory. Keep real case-sensitive paths inside the task root, confirm
uploaded contents before linking them, and preserve Markdown and valid references
when replacing a description. Shared inputs retain their source task ID and path
or verified immutable repository URL; they are not cross-task relative links.

**Attachment independence.** Task reads contain no attachment inventory.
Attachments use case-sensitive relative paths; uploads to the same path replace
that file, so keep mock UI resources at their referenced relative locations.
Attachment changes do not change the task's version, status, or update timestamp.
Task versions therefore cannot protect attachment writes. Multiple file
operations are independent, and file bytes and metadata can change partially;
confirm actual contents as well as metadata when reconciling a write.

**Unconfirmed writes.** A timeout, cancellation or lost response may follow an
applied change. Read back current task fields or attachment contents before
another mutation; cancellation does not prove rollback. For an unconfirmed
create, establish identity from complete fields and operation context; a matching
title or an empty lookup alone is insufficient. Preserve actual errors and
resource IDs rather than reporting success or blindly resending a write.

Task registration, execution, and selection follow [create-task](create-task.md),
[run-task](run-task.md), and [autopilot](autopilot.md), respectively. For a chain
of independently tracked delivery stages, use [the Goal protocol](goal.md).
Goal scope grants no implicit approval: every stage and delivery task follows the
same proposed/approve/unapprove/claim/complete lifecycle.
