# Day Night

Day Night contains a foreground GitHub PR review CLI and an independent Go
service runtime for project and task management.

| Component | Location | Implementation status | Requirements and design |
|---|---|---|---|
| `daynight` | `packages/daynight/` | Implemented TypeScript CLI with SQLite review state | [Requirements](docs/spec/daynight.md), [design](docs/design/daynight.md) |
| `daynight-server` | `packages/daynight-server/` | Project/task HTTP APIs, PostgreSQL transactions and coverage gates implemented; complete process acceptance pending | [Requirements](docs/spec/daynight-server.md), [design](docs/design/daynight-server.md) |

The `@codetreker/daynight` package provides the `daynight` CLI. It polls configured
repositories, maintains dedicated local clones and PR worktrees, and launches
Copilot in a retained session for each eligible PR. SQLite preserves
initialization boundaries, review revisions and retry budgets. The CLI provides
help, version output, configuration-only repository registration, and a local
persisted review listing. Review mode loads configuration and runs until stopped.
Controlled native-platform tests and live Copilot/GitHub acceptance provide
separate evidence; live acceptance remains outstanding.

The server design covers repository-linked projects, project-scoped tasks,
acyclic dependencies and dependency-gated task states through HTTP JSON APIs.
Its data and runtime are independent of the review CLI. The
[server design decision](.agents/notes/implemented/architecture/2026-10-19-daynight-server-task-design.md)
records the adopted scope and concurrency choices. The
[server task breakdown](docs/design/daynight-server-tasks.md) owns implementation
scope, dependencies, status and acceptance criteria. The development and runtime
CLI commands below apply to the reviewer; server commands have their own module.

## CLI development

Use Node.js 24 LTS and pnpm 10.34.5 for development. Runtime review also requires
Git, authenticated GitHub CLI and Copilot CLI on PATH. From the repository root:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm acceptance
pnpm daynight --help
pnpm daynight --version
```

`pnpm check` runs type checking and tests. Tests build the package before
exercising the compiled CLI. `pnpm build` emits the executable
`packages/daynight/dist/main.js`; the package's `daynight` bin points there.
The pnpm dependency store is local to `.tmp/pnpm-store`. `pnpm acceptance`
separately packs and installs the CLI in a local consumer and requires package-
registry access. It uses controlled GitHub/Copilot executables with real Git and
SQLite, creates no global installation and requires no live review credentials.

GitHub Actions runs type checking, build, and tests on native Linux, macOS, and
Windows runners. The final `checks` job succeeds only when all platform jobs
succeed. The Linux job also enforces package version increases before ordinary
validation. A PR compares its complete source changes with its merge base and
its package version with the event's target-branch revision. Main pushes compare
the full event before/after range. The checkout includes the required history.
Native tool discovery records each command's resolved executable, launcher,
timing, status and bounded output in `.tmp/validation-probes.json`. The `gh`
version child uses isolated project-local configuration/state and disabled
telemetry. A separate diagnostic artifact uploads after validation even when
environment discovery fails; mandatory native versions, the 10-second probe
limit and 600-second platform gate remain unchanged. The
[probe isolation decision](.agents/notes/implemented/bug-fix/2026-10-19-native-environment-probe-isolation.md)
records the failure evidence and remaining limits.

macOS tests mount temporary case-sensitive and case-insensitive APFS
images to check path identity against both filesystem behaviors. No live GitHub
or Copilot credentials are required by these checks.
SQLite tests use real disk databases, including reopen, transaction rollback,
locking, and revision/retry transitions on every platform.
GitHub tests use controlled API responses and subprocess fixtures to verify
complete scans, HTTP failures, and atomic observation commits.
Git lifecycle tests use local origin/clone fixtures and real worktrees to check
captured targets, disposable review artifacts, shared refs, and isolation between
PR worktrees. Independent Git suites run in separate Vitest workers. Each suite
copies its immutable bare-origin seed into private test directories; refs,
SQLite databases, clones and worktrees remain separate for every case. Tests
within a file stay sequential so environment changes and cleanup have one owner.
The [Git test decision](.agents/notes/implemented/testing/2026-10-18-parallel-git-validation.md)
records the isolation rules, and the
[CI timing report](docs/research/windows-ci-performance.md) records native
before/after measurements. The installed acceptance suite additionally verifies the package
bin, default native command shims, singleton/stale-lock behavior and the complete
review/re-review/restart/closure lifecycle. Curated environment and scenario
receipts are uploaded by each native CI job; the
[acceptance report](docs/research/daynight-acceptance.md) distinguishes those
receipts from live-service evidence. Controlled Copilot executables exercise retained sessions, durable
launch intent, stdin prompts and streamed completion/failure handling. These
checks require no live model invocation or GitHub publication.

## Server development

Use Go 1.27.2, PostgreSQL 18.6 and Node.js 24 LTS. The
[server module](packages/daynight-server/README.md) owns configuration, startup,
the isolated database setup and complete validation commands. Its HTTP runtime
binds only loopback addresses and serves project creation/list/get and task
create/list/get/update routes. Delivery status and complete process acceptance
are tracked in the
[task breakdown](docs/design/daynight-server-tasks.md).

From `packages/daynight-server/`, set `DAYNIGHT_TEST_DATABASE_URL` to an isolated
PostgreSQL database, then run:

```bash
bash scripts/check.sh
```

This builds the binary, runs vet and race-enabled `go-cov`, and enforces total
statement coverage strictly greater than 90%, package coverage of at least 85%,
and function coverage of at least 80%, with critical-block checks enabled. The
same raw coverage profile supplies an exact strict comparison; exactly 90%
fails, independently of display rounding. No product files or functions are
excluded. The CI aggregate requires both this Go job and every existing native
CLI job to pass. PostgreSQL absence is a failure, not a skipped test.

## Package versions

Changes to `packages/daynight/src/`, either package manifest, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `.npmrc`, or either application TypeScript configuration
require a strictly greater SemVer in `packages/daynight/package.json`. Source
additions, deletions and moves all count. Unchanged versions, downgrades and
build-metadata-only changes fail. Tests, fixtures, documentation, CI workflows
and validation scripts alone do not require a version increase. An initial main
push with no previous commit validates the starting version without comparing
against a nonexistent predecessor.

Update the version in the same PR as the code. To check committed revisions
locally, run `pnpm version:check pull_request <base-sha> <head-sha>` or
`pnpm version:check push <before-sha> <after-sha>`. The command reads versions
from those commits; uncommitted files do not affect the result. Missing history,
unreadable manifests and invalid versions fail visibly. See the
[toolchain decision](.agents/notes/implemented/process/2026-10-16-typescript-cli-toolchain.md)
for the comparison and CI ownership rules.

## Configuration and startup

Register a repository before starting review mode:

```text
daynight add-repo https://github.com/OWNER/REPO.git
daynight add-repo git@github.com:OWNER/OTHER.git --path ./review-other
daynight --daemon-review
```

For a local build, prefix the command with `pnpm`. These commands select
`~/.daynight/config.yml` using the current OS user's home directory. `add-repo`
creates the configuration when absent. It reads, validates and saves configuration;
cloning, authentication checks, GitHub calls, SQLite initialization and PR boundary
selection belong to review startup. An already running reviewer keeps its loaded
configuration until its next startup.

A configuration with an explicit addition root is:

```yaml
repositoryRoot: ~/daynights
repositories:
  - remote: https://github.com/OWNER/REPO.git
    path: /home/alice/daynights/github.com/owner/repo
```

`repositoryRoot` defaults to `~/daynights`. It is used only when `add-repo` has no
`--path`: the command derives filesystem-safe components from the normalized
host/owner/name and saves the resulting absolute repository path. A configured
root may be absolute, config-directory-relative, or begin with `~` for the current
OS user's home. Other users' tilde forms are rejected. Changing the root affects
future additions only. An explicit `--path` resolves against the command's working
directory and is also saved as an absolute path. Manually written repository paths
remain absolute or config-directory-relative and do not expand `~`; every repository
entry requires its own `path`.

Adding an existing normalized repository without `--path` reuses its saved path
and succeeds without rewriting configuration, even after the root changes.
An explicit path to the same actual location is also idempotent; an explicit
different path for that repository is an error.
Existing YAML settings and comments survive additions. The command validates the
complete resulting configuration before replacing the file atomically. Validation
and pre-replacement write failures preserve the original configuration; cleanup
errors after replacement remain visible. A separate
`~/.daynight/config.yml.lock` excludes another configuration writer and fails
clearly when occupied; it is independent of the review instance lock. After an
abnormal exit, confirm no configuration writer remains before removing this lock.
Configuration mutation rejects symlinks and nonregular files and preserves an
existing file's permission mode.

Numeric options use the documented [configuration defaults](docs/design/daynight.md)
when omitted. Explicit invalid values, unsupported fields, duplicate YAML keys and
malformed documents produce nonzero exits with useful errors. Review startup also
fails when the configuration is missing. Duplicate repository identities,
duplicate local paths, paths overlapping the retained state directory, and paths
with an existing nondirectory component are rejected. Missing clone directories
remain valid for later repository creation. Existing paths are compared by
filesystem identity. Missing destinations with the same existing ancestor and
component count are compared by temporarily creating one candidate's directory
names inside a unique probe directory there and looking up the other spelling.
This observes actual case and Unicode rules. Validation removes only the
directories it created, using nonrecursive removal. Probe permission, inspection,
or cleanup failures stop validation with an error.

The selected retained-state location is `~/.daynight/` for SQLite, sessions,
locks, logs, cache, and temporary files. PR worktrees belong to each monitored
repository root's `.worktrees/` directory. `maxConcurrentWorker` limits concurrent
review preparation and execution. Startup acquires an exclusive instance lock,
opens SQLite and prepares the configured clones. Each repository is polled
independently; access failures retain its last complete observation and remain
visible in diagnostics. The
[repository registration decision](.agents/notes/implemented/feature/2026-10-18-add-repo-configuration.md)
records the fixed-path and configuration-only choices.

## Review status listing

Print the configured repositories' locally tracked open PRs, including Draft PRs:

```text
daynight review list
daynight review ls
```

Both forms use the same persisted-snapshot operation and print repositories in
configuration order, with PRs ordered numerically. The columns are `PR`,
`PR STATE`, `REVIEW` and `ATTEMPTS`. Completed or failed reviews remain listed while their PR is open;
closed PRs and history belonging to removed configuration entries are omitted.

The output identifies its local snapshot source and each repository's
`Last observed` successful complete poll, saved poll error when present, and
permanent tracking boundary. PRs at or below that boundary are not stored individually and
cannot appear in the listing. `No tracked ongoing PRs.` describes an initialized
repository with no saved open PRs above the boundary; `Not initialized.` describes
a missing database, an unregistered repository or an incomplete initialization.
The listing makes no claim about GitHub changes since the saved observation.

Review states are `Preparing`, `Running`, `Pending`, `Retry waiting`, `Completed`,
`Failed`, `Interrupted` and `Paused` for Draft PRs. `Running` is a saved state,
not proof that a process remains alive. Retry deadlines and saved errors appear
under the corresponding row. A newer desired revision remains `Pending` while an
older revision is active; the older revision's recorded state, attempt budget,
retry deadline and error are printed separately. The current row's attempt count
always belongs to its own desired revision, head and target branch. A base-tip
change alone does not invalidate a completed review.

Pending worktree cleanup is a separate saved resource barrier, including after a
PR reopens. Such rows show `Worktree cleanup: Pending` and any saved cleanup error.
With no current review, an open non-Draft row shows `Pending (cleanup blocked)`;
Draft remains `Paused`. Older active reviews retain their separate details. The
listing reports the barrier without attempting cleanup or recovery.

The command loads the current configuration and opens an existing SQLite database
read-only for one consistent transaction. It needs no Git, GitHub CLI or Copilot
execution, instance lock, clone or review startup. It does not create an absent
database, migrate a schema, recover interrupted work or update application state.
SQLite may create or update its WAL coordination sidecar files while reading an
existing database. Missing or invalid configuration, unreadable or corrupt state,
and unsupported schema versions fail visibly. The
[listing decision](.agents/notes/implemented/feature/2026-10-18-review-status-listing.md)
records status attribution and snapshot limits.

## Durable review state

The SQLite module keeps repository identity, the permanent startup PR boundary,
observed PRs, captured review targets, completion revisions, sessions, worktree
registration, and retry state. Repository identity includes the GitHub host and
stable repository ID. Completing a captured revision leaves later observations
pending; retries retain their original review identity and consumed budget.

Runtime database opening applies explicit schema migrations and enables WAL with
FULL synchronization and a bounded busy timeout. The listing reader checks the
existing schema without applying migrations. The instance lock checks whether its
recorded CLI owner still exists; that check does not establish whether its agents
or tools have stopped. Interrupted reviews and pending cleanup remain blocked
after automatic lock recovery until process exclusion is explicitly confirmed.
Database state does not replace physical Git/worktree or session-history
verification.

See the [architecture](docs/design/daynight.md) for transitions and the
[state decision](.agents/notes/implemented/architecture/2026-10-17-durable-review-state.md)
for persistence choices. The coordinator opens this state before scheduling work
and advances only the revision captured by each completed attempt.

## GitHub observations

The GitHub module reads one repository pass through authenticated `gh api` GET
requests. Initialization scans every page and PR state before committing the
permanent cutoff. Later passes track open PRs, including Draft, and confirm
missing tracked PRs individually before recording closure.

Failed pages, malformed responses, and failed closure confirmations preserve
the previous repository observation. A completed pass commits its observations
and success time atomically. Rate-limit failures expose the server's retry
deadline and block later same-host calls in that client; the coordinator schedules
the next pass after the applicable deadline.
The [observation decision](.agents/notes/implemented/architecture/2026-10-17-github-observation.md)
records pagination and failure handling.

CI admission uses a read-only GraphQL query for the current PR head and
available test-merge commit. It combines GitHub's check/status rollups with
registered workflow suites, including approval-blocked workflows without jobs.
All reported CI must finish successfully; GitHub's `success`, `skipped` and
`neutral` outcomes pass. No CI allows immediate review. API errors and partial
results keep the PR waiting. Latest workflow runs replace historical attempts;
waiting or failing workflows do not consume review capacity.

## Repository clones and worktrees

The Git module creates missing clones and validates existing repository identity.
Prepared GitHub CLI authentication supplies command-scoped HTTPS credentials,
including repositories configured with SSH addresses or API ports. Existing
checkout files, origin configuration, branches, remote-tracking refs, and
FETCH_HEAD remain untouched by review preparation.

Configured clones and their PR worktrees are dedicated to this system. Each PR
uses its fixed repository-local `.worktrees/pr-<number>/` directory. Physical
root/common-directory checks, validated linked administration and backpointers,
and a session-labelled Git lock establish the target before destructive reuse
or removal. Initial preparation and new revisions provide a complete checkout
even when the base checkout uses sparse settings. Confirmation retries retain
local context. Files, nested clones and administration inside the owned PR
worktree are disposable; cleanup does not inventory their external consumers.
Other PR worktrees and retained sessions remain separate. Cleanup rechecks remote
closure before removal. The [exclusive-environment decision](.agents/notes/implemented/architecture/2026-10-17-exclusive-review-environment.md)
defines this ownership boundary.

See the [worktree ownership decision](.agents/notes/implemented/architecture/2026-10-17-owned-review-worktrees.md)
for target validation and recovery boundaries.

## Copilot execution

The Copilot adapter launches a direct child in the prepared PR worktree. It
selects the persisted per-PR UUID on first launch and explicitly resumes that
same session thereafter. An interrupted first launch also resumes existing
history; missing established history is an error. Only opaque session-directory
presence is inspected. Copilot history and agent JSONL are not parsed.

Prompts travel through stdin in noninteractive mode. `cross-spawn` handles native
commands and Windows command shims; prompt text is not embedded in shell code or
command arguments. Runtime paths contain Copilot state, cache, temporary files
and per-attempt diagnostics. Existing GitHub CLI authentication remains available
through Copilot's supported fallback.

The agent publishes inline Critical/Major comments or approval itself and
reconciles prior publication when continuing an incomplete review. The adapter
streams separate stdout/stderr logs and accepts only normal zero exit, complete
capture and the exact final nonempty stdout line `PR N Review Completed`.
Incomplete output, timeout, cancellation and logging errors cannot complete a
review. The coordinator owns scheduling and final state transitions; runtime
process supervision supplies evidence under the foreground execution contract.

The [execution decision](.agents/notes/implemented/architecture/2026-10-17-copilot-session-execution.md)
records these boundaries. Live Copilot/GitHub acceptance remains separate from
controlled subprocess tests.

## Coordination and shutdown

A FIFO pending queue coalesces observations for each PR while preventing a
frequently updated PR from starving other repositories or PRs. One reservation
spans preparation, execution and cleanup for each PR. CI admission precedes
that reservation and is refreshed at `pollIntervalMs`; waiting candidates retain
their queue position without blocking ready PRs. CI evidence is kept in memory
for the exact revision, head and base branch and is refreshed after restart.
Every agent launch rechecks PR state and CI after worktree preparation, including
retries. A regression defers preparation without consuming an attempt or losing
the retained session. CI changes alone do not retrigger completed revisions.
Readiness is a launch-time observation; later CI registration or reruns do not
automatically cancel an active agent.

Cleanup does not consume a review worker slot, but cannot overlap another
operation on the same worktree. Draft/closure observations cancel active work; head changes wait for the current
attempt and remain pending. Failed revisions retain their exhausted budget.

Ctrl+C stops new work and polling, terminates current managed execution, waits
for operations and closes SQLite before releasing the instance lock. Agents must
run tools in the foreground and stop their services before returning. Normal
unforced exit and drained streams are evidence under that contract. POSIX uses
current process groups; Windows cancels live trees with `taskkill /T /F`.
Uncertain termination retains the lock and interrupted state.

Startup checks the PID in an existing `~/.daynight/instance.lock` with a
signal-zero probe. A live owner, permission denial, invalid lock metadata or an
unclassified probe error preserves the lock and stops startup. Only an explicit
no-such-process result permits automatic replacement of a dead owner's lock.
Competing starts and releases serialize through `instance.lock.sqlite`; this
guard database remains in place and must not be deleted while a CLI can use it.
Lock age never establishes that an owner has stopped. PID reuse conservatively
blocks startup until the recorded owner can be inspected.

A crash with no unresolved review or cleanup can therefore restart directly.
When interrupted reviews exist, automatic lock recovery blocks their PRs.
Pending cleanup remains recorded with its error even if the PR reopens; only
conclusively stopped cleanup operations and excluded agents allow that state to
clear. Automatic recovery blocks only each affected PR's cleanup and reuse;
polling and other PRs in the same repository continue normally, as do other
repositories. Uncertain
resources retain the lock on shutdown. After stopping the daemon, confirm that
the previous CLI and all its agents/tools have stopped, then remove only
`instance.lock` and restart. Keep `instance.lock.sqlite`, SQLite state, sessions
and logs. That explicitly confirmed restart reconciles interrupted work with
the same captured target and session; it never declares a saved running attempt
complete or kills a saved process ID.

The [coordination decision](.agents/notes/implemented/architecture/2026-10-17-foreground-review-coordination.md)
explains scheduling and the foreground execution boundary. The
[stale-lock recovery decision](.agents/notes/implemented/bug-fix/2026-10-18-stale-instance-lock-recovery.md)
records owner-liveness checks and the separate process-exclusion requirement.

## Working in the repository

Read [AGENTS.md](AGENTS.md) for task scope, shared task worktrees, collaboration,
verification, and delivery. Keep task breakdowns with their design documents,
including task status, dependencies, scope and acceptance criteria. Use the
[repository skills](.agents/skills/) for decision notes, scope choices, and prose.

[Agent Notes](.agents/notes/README.md) preserve decisions and alternatives. The
[CLI decision](.agents/notes/implemented/architecture/2026-10-16-foreground-review-cli.md),
[configuration decision](.agents/notes/implemented/architecture/2026-10-16-user-home-review-configuration.md),
and [toolchain decision](.agents/notes/implemented/process/2026-10-16-typescript-cli-toolchain.md)
record the relevant rationale. `.agents/skills/` is canonical; `CLAUDE.md`,
`.claude/skills`, and `.claude/worktrees` remain relative discovery links.

## Documentation conventions

| Location | Responsibility |
|---|---|
| `README.md` | Purpose, implementation status, prerequisites, commands, and documentation entry points |
| `docs/spec/` | Required product behavior and observable guarantees |
| `docs/design/` | Selected structure, mechanisms, rationale, implementation boundaries, and associated task breakdowns |
| `docs/research/` | Investigations, evidence, sources, and observation conditions |
| `.agents/notes/` | Decisions, alternatives, consequences, and reconsideration conditions |
| `docs/plans/` | Local execution plans, ignored by Git |

Create documents for authorized work. Keep active facts synchronized and preserve
historical decision premises; explicit archives remain immutable. New or revised
specifications and designs use Chinese headings and prose. Preserve technical
literals. Other documents, skills, code, comments, and commit messages use
English unless explicitly instructed otherwise. Discuss work in Chinese.

## Validation

Use the development commands above for application changes. `pnpm check` covers
ordinary type/build/test validation; `pnpm acceptance` exercises the installed
package. The suite uses Git 2.48+ for its relative-worktree fixture. Refer to the
[acceptance report](docs/research/daynight-acceptance.md) for actual toolchain
receipts and SQLite platform constraints. Live GitHub/Copilot acceptance remains
separate delivery evidence with designated repository and reviewer authorization.

For document changes, check relative links, requirement references, status, and
note lifecycle sections. For workflow changes, also check skill frontmatter and
discovery links. Run `git diff --check` and inspect newly created files explicitly.
