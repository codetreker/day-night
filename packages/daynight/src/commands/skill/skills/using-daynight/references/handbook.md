# Daynight handbook

Use the installed `daynight` CLI. Discover command groups with `daynight --help`
and read the relevant command's `--help` for arguments, options, and output
formats. This reference indexes project/task commands and explains the context
needed to use them correctly.

## Command index

| Command | Purpose |
|---|---|
| `setup` | Configure access to the Daynight service. |
| `project create` | Register a repository as a project or find its existing project. |
| `project list` | Find projects on the configured service. |
| `project show` | Inspect a project's details. |
| `task create` | Register a todo task. |
| `task ready` | Get a bounded set of tasks whose prerequisites are complete. |
| `task list` | Read the complete matching task inventory. |
| `task show` | Read one task's complete details and version. |
| `task update` | Change a task's fields, dependencies, or PR references. |
| `task graph` | Inspect the project's dependency graph and summary. |
| `task attachment put` | Upload or replace one attachment file. |
| `task attachment list` | Read a task's attachment inventory and metadata. |
| `task attachment read` | Retrieve an attachment's original bytes. |
| `task attachment remove` | Delete one attachment file. |

## Operational context

**Project discovery.** Inside a Git worktree, task commands can omit `--project`:
the CLI matches the origin repository URL to a project on the configured
service. A new worktree without `.daynight/project.yml` can still discover the
project; discovery may save the ignored binding and update `.gitignore`.
An explicit project overrides discovery for that invocation. Keep binding files
CLI-managed, and resolve missing or ambiguous matches rather than guessing an
ID or creating a project to make a query succeed.

**Read scope.** Ready is a candidate page, ordered by creation rather than
relevance. An empty page does not rule out in-progress or dependency-blocked
work. List provides a complete matching inventory; graph provides compact
dependency context without full descriptions, PR properties, or versions. Read
the selected task's details before acting. A graph-limit error still permits
bounded candidate and individual task reads.

**Task concurrency.** The states are `todo`, `in_progress`, and `done`; ready
means todo with completed direct prerequisites. These facts grant no ownership
or lock. Bind each update to the exact version read for that decision using
`--if-version`; the CLI's default pre-submit read cannot protect an earlier
decision. Preserve full int64 decimal digits without numeric rounding. On a
conflict, reread and reconsider rather than merely swapping in a newer version.

**Replacement fields.** Descriptions, dependency sets, and PR reference lists
replace the whole supplied field. Preserve every still-needed value. Omitted
fields stay unchanged; clearing and option-pairing syntax is in command help.

**Attachment independence.** Task reads contain no attachment inventory.
Attachments use case-sensitive relative paths; uploads to the same path replace
that file, so keep mock UI resources at their referenced relative locations.
Attachment changes do not change the task's version, status, or update timestamp.
Task versions therefore cannot protect attachment writes. Multiple file
operations are independent, and file bytes and metadata can change partially;
confirm actual contents as well as metadata when reconciling a write.

**Unconfirmed writes.** A timeout or lost response may follow an applied change.
Read back task fields or attachment contents before another mutation. For an
unconfirmed create, establish identity from complete fields and operation
context; a matching title or an empty lookup alone is insufficient. Preserve
actual errors and resource IDs rather than reporting success or blindly
resending a write.

Task registration, execution, and selection follow [create-task](create-task.md),
[run-task](run-task.md), and [autopilot](autopilot.md), respectively.
