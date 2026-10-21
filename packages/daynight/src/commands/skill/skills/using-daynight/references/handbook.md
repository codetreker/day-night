# Daynight handbook

Use this reference for project discovery, task reads and writes, PR references,
attachments, exact versions, and failures. Mode-specific selection and delivery
rules belong to [autopilot](autopilot.md), [run-task](run-task.md), and
[create-task](create-task.md).

Use the installed `daynight` CLI through a noninteractive shell. Run
`daynight <group> <command> --help` when the installed version's usage is needed.
Query results are service facts; do not use private API calls or manually edit
`.daynight/project.yml`.

## Project discovery

Without `--project`, task commands resolve the current worktree's Git origin and
verify its binding against the configured service. A unique discovery may write
the ignored binding and update the root `.gitignore`. A missing binding is not a
reason to skip discovery, including in a fresh linked worktree. No match,
ambiguous matches, invalid binding, missing configuration, and network failure
are different outcomes: preserve the actual diagnostic. Do not automatically
create a project or change an existing association. The CLI's setup guidance
owns service configuration.

All task commands accept `--project <project-id>` for an explicitly established
target; it applies to that invocation and bypasses repository binding discovery.
Do not silently substitute a remembered project ID after discovery fails. Use
project list/show to inspect candidates when an explicit selection is needed.

```bash
daynight project list --json
daynight project show <project-id> --json
```

## Task reads and readiness

```bash
daynight task ready --json
daynight task ready --limit 20 --json
daynight task show <task-id> --json
daynight task list --status in_progress --json
daynight task list --ready --json
daynight task graph --json
```

The only task states are `todo`, `in_progress`, and `done`. Readiness means a
`todo` task's direct prerequisites are done. Neither readiness nor `in_progress`
provides an exclusive claim, lock, lease, ownership guarantee, or priority.

`task ready` returns the first N ready tasks in `createdAt`, then ID ascending
order. `--limit` defaults to 10 and accepts decimal integers in 1–100. It requests
one task page without following its cursor and returns a full-task array of at
most N elements. It accepts `--project` and `--json`, with no status or cursor
option. A result with N tasks can have more candidates beyond it. An empty array
does not mean the project has no tasks.

`task list`, including `task list --ready`, reads every page and returns a
complete array; reserve it for a complete inventory. List filters combine with
AND. Ready bounds task count, but full titles/descriptions and project discovery
can still produce substantial output or additional requests.

The graph is one complete snapshot containing project metadata, summary, task
IDs, title previews, status, readiness, and dependency/blocking IDs. It omits
full descriptions, PR properties, and versions. `graph_limit_exceeded` reports
the service's 1,000-node / 5,000-edge bound; no partial graph is returned.
Continue with bounded ready and selected task reads. Other graph failures retain
their own cause. Refresh task facts at selection, mutation, and delivery
checkpoints; a conversational turn alone does not require a full-project read.

## Create and update tasks

Replace IDs below with observed UUIDs and `observed-version` with the exact
decimal version from the task details used to decide the update.

```bash
daynight task create --title "Deliver sign-in" --description "Problem and attachment references"
daynight task create --title "Deliver the sign-in page" --depends-on <task-id>
daynight task update <task-id> --status in_progress --if-version <observed-version>
daynight task update <task-id> --description "Complete revised problem and attachment references" --if-version <observed-version>
daynight task update <task-id> --depends-on <task-a> --depends-on <task-b> --if-version <observed-version>
daynight task update <task-id> --clear-dependencies --if-version <observed-version>
daynight task update <task-id> --description= --if-version <observed-version>
daynight task update <task-id> --status done --if-version <observed-version>
```

Create starts in `todo`. Create and update do **not** accept `--json`; their
success output contains the confirmed resource, including its ID and version.
Read it before planning the next mutation. Ready, list, show, and graph task
queries accept `--json`.

An update must provide at least one of title, description, status, dependencies,
or PR references. Omitted fields remain unchanged. A provided description replaces
the entire description; `--description=` or `--description ""` clears it. Repeated
`--depends-on` supplies the **complete** replacement set, not additions; retain
each still-required dependency. Values are individual UUIDs, not CSV. Use
`--clear-dependencies` to empty the set; it conflicts with `--depends-on`.

Text options accept `--option=value`; use that form when a value starts with a
dash. Preserve server validation errors rather than silently altering inputs.

## PR references

```bash
daynight task create --title "Deliver sign-in" --pull-request-url "https://github.com/owner/repo/pull/123" --pull-request-title "Implement sign-in"
daynight task update <task-id> --pull-request-url "https://github.com/owner/repo/pull/123" --pull-request-title "Implement sign-in" --if-version <observed-version>
daynight task update <task-id> --clear-pull-requests --if-version <observed-version>
```

PR references are the server-defined `properties.pullRequests` array of
`{url, title}` strings. Pair repeated `--pull-request-url` and
`--pull-request-title` values by their occurrence within each option: the nth URL
belongs to the nth title, even when options are not adjacent. Counts must match.
A supplied list replaces **all** PR references; preserve each still-required
entry. `--clear-pull-requests` empties the list and conflicts with either paired
option. Omitted PR options preserve the current list. Empty strings, whitespace,
order, duplicates, and arbitrary URL/title text are retained without content or
URL validation. Use `--pull-request-url=` and `--pull-request-title=` for empty
values. Text resource output escapes terminal controls; task ready/show/list JSON
contains complete raw properties. The graph omits properties.

## Attachments

Attachments are addressed by task ID and a case-sensitive relative path. Use
the actual paths referenced by the task; filenames such as `proposal.md` and
`mockui.html` are examples, not required names.

```bash
daynight task attachment put <task-id> ./proposal.md --path docs/proposal.md
daynight task attachment put <task-id> ./mockui.html --path mockui/index.html
daynight task attachment list <task-id> --tree
daynight task attachment list <task-id> --json
daynight task attachment read <task-id> docs/proposal.md
daynight task attachment read <task-id> images/mockup.png > ./mockup.png
daynight task attachment remove <task-id> docs/proposal.md
```

Attachment operations accept `--project` and otherwise use repository discovery.
`put` uploads one file; without `--path`, it uses the source basename. The same
complete path overwrites the existing file. There is no directory upload or
directory-wide replacement. Upload mock UI resources individually, retaining the
relative paths used by its HTML, CSS, JavaScript, and images. Use `--path=value`
for a destination beginning with a dash, and `--` before dash-leading positional
paths after any options.

Paths use `/` separators and preserve valid Unicode spelling. Absolute paths,
empty segments, `.`, `..`, backslashes, control characters, and invalid UTF-8 are
refused; do not normalize rejected input into a different write or deletion
target. A file and a directory cannot occupy the same path.

`list` shows metadata by default, `--tree` groups it by path, and `--json` emits
the complete metadata array. Tree and JSON are mutually exclusive. Complete CLI
lists are output only after every page succeeds; pagination is not a multi-read
snapshot. `put`, `read`, and `remove` do not accept `--json`. `read` streams
original bytes to stdout without labels, escaping, JSON, or an extra newline. A
failed read can leave partial stdout and must exit nonzero; check success before
consuming a redirected file. Errors use stderr. Exit codes are 0 for success,
2 for invalid arguments, and 1 for operation failure.

Attachments can be modified in every task state. They do not change task status,
dependencies, version, or `updatedAt`; attachment operations have no
`--if-version`. Task show has no attachment inventory, so list attachments
separately. Do not use a task version as an attachment revision. Multiple file
operations are independent. File bytes and metadata are not atomically updated
together, so an error or unconfirmed result can follow a partial change. Read
back affected files and metadata before deciding what to do next; task reads
alone do not confirm attachment contents.

Markdown previews resolve relative links from the Markdown file's directory.
HTML previews run trusted project code with relative resources and ordinary
script interaction. Inspect frontend mock UI through an appropriate supported
preview or local rendering, following the user's and repository's tool rules.
Keep downloaded artifacts and preview resources in the task's permitted workspace.

## Preserve the observed version

Every update based on task content must use that read's `--if-version`. Omitting
it makes the CLI read a newer version immediately before submission, which does
not protect a decision based on older content. Read once, decide from those
details, and submit that version. After another task mutation, obtain or use the
confirmed resulting resource before deciding the next update.

Versions are JSON numbers in `1..9223372036854775807`. Preserve the original
decimal digits; ordinary JavaScript numeric decoding can round them. Copy the
raw decimal token or use a lossless JSON decoder. Node.js 24 can retain the raw
token through the reviver's `context.source`, for example:

```js
const task = JSON.parse(rawTaskJson, (key, value, context) =>
  key === "version" && typeof value === "number" ? context.source : value,
);
const observedVersion = task.version; // Decimal string for --if-version.
```

On `version_conflict`, show the task again, understand the concurrent change,
and reconsider the proposed fields against the new facts. Do not merely replace
the version and replay the old update. A dependency refusal likewise needs its
reported prerequisite, cross-project reference, or cycle addressed within the
authorized scope. Setting `in_progress` never atomically claims the task.

## Unconfirmed writes and failures

The CLI does not retry failed writes automatically. Preserve error codes,
request IDs, task IDs, attachment paths, and actual service diagnostics. A
confirmed service refusal is a failed operation. A lost response, timeout,
cancellation, or other unconfirmed result may have left a write applied: do not
report success or blindly resend it.

For an unconfirmed task update, show the known task and compare its complete
current fields with the intended change. If the intended state is present,
report the observed state without claiming proof of which writer produced it.
If absent or changed, reconcile the facts and decide what remains necessary;
any later update needs the exact version read for that decision.

For an unconfirmed task create, list tasks in the established project and inspect
plausible matches with show. Match the intended title, full description,
dependencies, PR references, and operation context; title alone is not a unique
identity. Establish the identity of a unique matching candidate before treating
it as the created task. With zero candidates, multiple candidates, or unresolved
identity, keep the create unconfirmed and explain the minimum reconciliation
needed. Do not create again merely because a read returned no match.

For an unconfirmed attachment put or removal, list and read the known task/path
to reconcile actual bytes and metadata. Preserve a missing resource, path
conflict, or storage failure as its actual cause. Metadata alone cannot prove
that intended bytes were saved. Incomplete registration and interrupted
execution retain their task identity; their mode reference owns the next action.
