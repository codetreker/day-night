# Daynight commands

Use the installed `daynight` CLI. Run `daynight <group> <command> --help` when the
installed version's usage is needed. Query results are service facts; do not use
private API calls or manually edit `.daynight/project.yml`.

## Project discovery and reads

```bash
daynight task ready --json
daynight task ready --limit 20 --json
daynight task show <task-id> --json
daynight task list --status in_progress --json
daynight task graph --json
daynight task list --ready --json
daynight task list --all --json
daynight project list --json
daynight project show <project-id> --json
```

Without `--project`, task commands resolve the current worktree's Git origin and
verify its binding against the configured service. A unique discovery may write
the ignored binding and update the root `.gitignore`. A missing binding is not a
reason to skip discovery, including in a fresh linked worktree. No match,
ambiguous matches, invalid binding, missing configuration, and network failure
are different outcomes: report the actual diagnostic. Do not automatically
create a project or change an existing association. The CLI's setup guidance
owns service configuration.

All task commands accept `--project <project-id>` for an explicitly established
target; it applies to that invocation and bypasses repository binding discovery.
Do not silently substitute a remembered project ID after discovery fails. Use
project list/show to inspect candidates when an explicit selection is needed.

`task ready` returns the first N ready tasks in `createdAt`, then ID ascending
order. `--limit` defaults to 10 and accepts decimal integers in 1–100. It requests
one task page without following its cursor and returns a full-task array of at
most N elements. It accepts `--project` and `--json`, with no status or cursor
option. A result with N tasks can have more candidates beyond it. An empty array
means no ready work was found, not that the project has no tasks. `ready` means
`todo` with every direct dependency done; it provides no ownership or priority.

Resume this session's current task with show before selecting new work. When its
identity is unknown, query in-progress work as needed. For new work, pick exactly
one ready `todo` candidate most relevant to the current authorized work, comparing
scope, description, and dependencies. Creation order is not relevance. Read the
selected task with show before acting, and advance only that task through CI,
review, and merge waits. Subagents collaborate on the same task. Multiple
candidates do not authorize starting a batch or unrelated work.

`task list`, including `task list --ready`, reads every matching page and returns
one array. It excludes `done` by default. Use `--all` for all statuses, including
completed work, or `--status <status>` for one status; these options conflict.
`--ready` intersects the selected statuses and supports `--all --ready`. Human
and JSON lists group `in_progress` first, then ready tasks, other `todo` tasks,
and `done`, preserving service order within each group across pages. Human lists
omit description, version and timestamps; JSON keeps every task field. Reserve
`task list --all --json` for a complete inventory. Task counts are bounded by
ready, but full titles/descriptions and project discovery can still produce
substantial output or additional requests.

Use the graph when an overall dependency view is needed. It is one complete
snapshot containing project metadata, summary, task IDs, title previews, status,
readiness, and dependency/blocking IDs. It omits full descriptions, PR
properties, and versions.
`graph_limit_exceeded` reports the service's 1,000-node / 5,000-edge bound; no
partial graph is returned. Continue with bounded ready and selected task reads.
Other graph failures retain their own cause.

## Create and update

In these examples, replace IDs with observed UUIDs and `observed-version` with
the exact decimal version from the task details used to decide the update.

```bash
daynight task create --title "Deliver sign-in" --description "Scope, acceptance, and handoff context"
daynight task create --title "Deliver the sign-in page" --depends-on <task-id>
daynight task update <task-id> --status in_progress --if-version <observed-version>
daynight task update <task-id> --description "Complete revised task description" --if-version <observed-version>
daynight task update <task-id> --depends-on <task-a> --depends-on <task-b> --if-version <observed-version>
daynight task update <task-id> --clear-dependencies --if-version <observed-version>
daynight task update <task-id> --description= --if-version <observed-version>
daynight task create --title "Deliver sign-in" --pull-request-url "https://github.com/owner/repo/pull/123" --pull-request-title "Implement sign-in"
daynight task update <task-id> --pull-request-url "https://github.com/owner/repo/pull/123" --pull-request-title "Implement sign-in" --if-version <observed-version>
daynight task update <task-id> --clear-pull-requests --if-version <observed-version>
```

Create starts in `todo`. Create and update do **not** accept `--json`; their
success output contains the confirmed resource, including its ID and version.
Read it before planning the next mutation. Only ready, list, show, and graph task
queries accept `--json`.

An update must provide at least one of title, description, status, dependencies,
or PR references. Omitted fields remain unchanged. A provided description replaces
the entire description; `--description=` or `--description ""` clears it. Repeated
`--depends-on` supplies the **complete** replacement set, not additions; retain
each still-required dependency. Values are individual UUIDs, not CSV. Use
`--clear-dependencies` to empty the set; it conflicts with `--depends-on`.

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

Text options accept `--option=value`; use that form when a value starts with a
dash. Preserve server validation errors rather than silently altering inputs.

## Preserve the version read with the task

Every update based on task content must use that read's `--if-version`. Omitting
it makes the CLI read a newer version immediately before submission, which does
not protect a decision based on older content. Read once, decide from those
details, and submit that version. After another mutation, obtain or use the
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
request IDs, task IDs, and actual service diagnostics. A confirmed service
refusal is a failed operation. A lost response, timeout, cancellation, or other
unconfirmed result may have left a write applied: do not report success or
blindly resend it.

For an unconfirmed update, show the known task and compare its complete current
fields with the intended change. If the intended state is present, report the
observed state without claiming proof of which writer produced it. If it is
absent or has changed, reconcile the facts and decide what remains necessary;
any later update needs the exact version read for that decision.

For an unconfirmed create, list tasks in the established project and inspect
plausible matches with show. Match the intended title, full description,
dependencies, PR references, and operation context; title alone is not a unique
identity. A unique matching candidate must have its identity established before treating it
as the created task. With zero candidates, multiple candidates, or unresolved
identity, keep the create unconfirmed and explain the minimum needed
reconciliation. Do not create again merely because a read returned no match.

## Completion and dependencies

For development and PR-delivered design/documentation tasks, inspect the hosting
platform for every necessary delivery PR. Each must be confirmed merged and all
acceptance criteria satisfied before this update is valid:

```bash
daynight task update <task-id> --status done --description "Complete task description, acceptance evidence, PR URLs, and merge commit references" --if-version <observed-version>
```

Use a fresh task read for this decision. Keep the complete relevant description
when adding delivery references. If a PR remains open, even with passing CI and
approved review, retain `in_progress` and record the PR plus remaining checks or
waiting items. If merge visibility is unavailable, keep completion unconfirmed
and retain `in_progress`. Use the repository host's native client or API to
verify merge facts; do not assume a particular hosting service. Do not merge
without the applicable authorization. Nondevelopment tasks with no PR delivery
path use their explicit acceptance criteria.

After the service confirms `done`, query `daynight task ready --json` to inspect
newly available successors. Select at most one next task using the same relevance
rule and only within the authorized scope. Query the graph when overall
dependency context is needed. Pending or unconfirmed completion must not be presented as having
unblocked a dependent task.
