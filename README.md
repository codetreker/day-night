# Day Night

The `@codetreker/daynight` package provides the `daynight` foreground GitHub PR
review CLI in `packages/daynight/`. It polls configured repositories, maintains
dedicated local clones and PR worktrees, and
launches Copilot in a retained session for each eligible PR. SQLite preserves
initialization boundaries, review revisions and retry budgets.

The [Chinese requirements](docs/spec/daynight.md) define the complete product;
the [architecture](docs/design/daynight.md) describes the selected design. The
CLI provides help and version output. Review mode loads configuration and runs
until stopped. Controlled native-platform tests and live Copilot/GitHub acceptance
provide separate evidence; live acceptance remains outstanding.

## Development

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
macOS tests mount temporary case-sensitive and case-insensitive APFS
images to check path identity against both filesystem behaviors. No live GitHub
or Copilot credentials are required by these checks.
SQLite tests use real disk databases, including reopen, transaction rollback,
locking, and revision/retry transitions on every platform.
GitHub tests use controlled API responses and subprocess fixtures to verify
complete scans, HTTP failures, and atomic observation commits.
Git lifecycle tests use local origin/clone fixtures and real worktrees to check
captured targets, disposable review artifacts, shared refs, and isolation between
PR worktrees. The installed acceptance suite additionally verifies the package
bin, default native command shims, singleton/stale-lock behavior and the complete
review/re-review/restart/closure lifecycle. Curated environment and scenario
receipts are uploaded by each native CI job; the
[acceptance report](docs/research/daynight-acceptance.md) distinguishes those
receipts from live-service evidence. Controlled Copilot executables exercise retained sessions, durable
launch intent, stdin prompts and streamed completion/failure handling. These
checks require no live model invocation or GitHub publication.

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

The selected review-mode entry is:

```text
daynight --daemon-review
```

For a local build, invoke it with `pnpm daynight --daemon-review`. The CLI reads
`~/.daynight/config.yml`, where the program resolves the current OS user's home
directory. A minimal configuration is:

```yaml
repositories:
  - remote: https://github.com/OWNER/REPO.git
    path: ../code/REPO
```

Numeric options use the documented [configuration defaults](docs/design/daynight.md)
when omitted. Explicit invalid values, unsupported fields, duplicate YAML keys,
malformed documents, and missing configuration files produce nonzero exits with
useful errors. Repository paths are absolute or relative to the configuration
directory; use an absolute path rather than shell-style tilde expansion.
Duplicate repository identities, duplicate local paths, paths overlapping the
retained state directory, and paths with an existing nondirectory component are
rejected. Missing clone directories remain valid for later repository creation.
Existing paths are compared by filesystem identity. Missing destinations with
the same existing ancestor and component count are compared by temporarily
creating one candidate's directory names inside a unique probe directory there
and looking up the other spelling. This observes actual case and Unicode rules.
Validation removes only the directories it created, using nonrecursive removal.
Probe permission, inspection, or cleanup failures stop validation with an error.

The selected retained-state location is `~/.daynight/` for SQLite, sessions,
locks, logs, cache, and temporary files. PR worktrees belong to each monitored
repository root's `.worktrees/` directory. `maxConcurrentWorker` limits concurrent
review preparation and execution. Startup acquires an exclusive instance lock,
opens SQLite and prepares the configured clones. Each repository is polled
independently; access failures retain its last complete observation and remain
visible in diagnostics.

## Durable review state

The SQLite module keeps repository identity, the permanent startup PR boundary,
observed PRs, captured review targets, completion revisions, sessions, worktree
registration, and retry state. Repository identity includes the GitHub host and
stable repository ID. Completing a captured revision leaves later observations
pending; retries retain their original review identity and consumed budget.

Database opening applies explicit schema migrations and enables WAL with FULL
synchronization and a bounded busy timeout. It does not infer whether an old
process has stopped or make interrupted reviews executable. The caller must
confirm process exclusion before resolving uncertain execution. Database state
does not replace physical Git/worktree or session-history verification.

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
spans preparation, execution and cleanup for each PR. Cleanup does not consume a
review worker slot, but cannot overlap another operation on the same worktree.
Draft/closure observations cancel active work; head changes wait for the current
attempt and remain pending. Failed revisions retain their exhausted budget.

Ctrl+C stops new work and polling, terminates current managed execution, waits
for operations and closes SQLite before releasing the instance lock. Agents must
run tools in the foreground and stop their services before returning. Normal
unforced exit and drained streams are evidence under that contract. POSIX uses
current process groups; Windows cancels live trees with `taskkill /T /F`.
Uncertain termination retains the lock and interrupted state.

An existing `~/.daynight/instance.lock` always blocks a second startup. After an
abnormal exit, confirm the previous CLI and all its agents/tools have stopped
before manually removing that lock and restarting. Keep SQLite, sessions and
logs. The next startup reconciles interrupted work with the same captured target
and session; it never declares a saved running attempt complete. No PID-age
heuristic removes locks or kills saved process IDs.

The [coordination decision](.agents/notes/implemented/architecture/2026-10-17-foreground-review-coordination.md)
explains scheduling, recovery and the foreground execution boundary.

## Working in the repository

Read [AGENTS.md](AGENTS.md) for task scope, shared task worktrees, collaboration,
verification, and delivery. Use Beads for task tracking and the
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
| `docs/design/` | Selected structure, mechanisms, rationale, and explicit implementation boundaries |
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
