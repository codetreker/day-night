# Day Night

Day Night contains a client command toolkit and an independent Go service runtime
for project and task management. Its read-only browser workspace provides project
statistics, task dependency graphs and details from the same Go service origin.
Full production-browser and performance acceptance remains tracked implementation
work.

| Component | Location | Implementation status | Requirements and design |
|---|---|---|---|
| `daynight` | `packages/daynight/` | Implemented `review`, npm global `update`, Bash/zsh `completion`, shared configuration, server HTTP and repository binding foundations plus project create/list/show; task commands pending | [Client requirements](docs/spec/daynight.md), [client design](docs/design/daynight.md), [completion design](docs/design/daynight-completion.md), [review requirements](docs/spec/daynight-review.md), [review design](docs/design/daynight-review.md), [project/task requirements](docs/spec/daynight-project-task.md), [design](docs/design/daynight-project-task.md), [tasks](docs/design/daynight-project-task-tasks.md) |
| `daynight-server` | `packages/daynight-server/` | Project/task and complete graph HTTP APIs, PostgreSQL transactions, embedded browser assets, strict coverage gates and built-process acceptance implemented | [Requirements](docs/spec/daynight-server.md), [design](docs/design/daynight-server.md) |
| `daynight-web` | `packages/daynight-web/` | Project browsing, statistics, read-only task graphs/details, embedded delivery and strict coverage implemented; full production acceptance pending | [Requirements](docs/spec/daynight-web.md), [architecture](docs/design/daynight-web.md), [task breakdown](docs/design/daynight-web-tasks.md), [preview](docs/design/mockups/task-dashboard.html) |

The `@codetreker/daynight` package provides the `daynight` client. Its root entry
lists commands and reports the package version; each command owns its business
dependencies and lifecycle. `review` polls configured repositories, maintains
dedicated local clones and PR worktrees, and launches Copilot in a retained
session for each eligible PR using a bundled review skill. SQLite preserves initialization boundaries, review
revisions and retry budgets. The group also provides configuration-only
repository registration and a local persisted review listing. `update` manages
the current npm global installation independently of review configuration and
runtime. `completion` generates native Bash and zsh scripts from the same command
definitions used by parsing and help. Loaded scripts complete locally without
starting Node on each Tab.

The adopted [project/task CLI design](docs/design/daynight-project-task.md) adds
server-backed commands, automatic Git-origin project discovery and ignored
repository-local bindings. Its [requirements](docs/spec/daynight-project-task.md)
and [task breakdown](docs/design/daynight-project-task-tasks.md) describe the
confirmed behavior and implementation status. Shared YAML projections, the
`serverUrl` configuration field, bounded HTTP client and repository discovery
with ignored local bindings are implemented. `project create/list/show` manage
remote projects through the configured server; task command entry points and
installed real-service command acceptance remain pending. Controlled native-platform tests and live
Copilot/GitHub acceptance provide separate evidence; live acceptance remains
outstanding.

The server design covers repository-linked projects, project-scoped tasks,
acyclic dependencies and dependency-gated task states through HTTP JSON APIs.
Its data and runtime are independent of the client review module. The
[server design decision](.agents/notes/implemented/architecture/2026-10-19-daynight-server-task-design.md)
records the adopted scope and concurrency choices. The
[server task breakdown](docs/design/daynight-server-tasks.md) owns implementation
scope, dependencies, status and acceptance criteria. The development and runtime
CLI commands below apply to the client; server commands have their own module.
The dashboard architecture presents source-root dependency graphs and project
statistics from the server. The project list is implemented in the private web
workspace, including task visualization and details. Its [design decision](.agents/notes/implemented/architecture/2026-10-20-task-dashboard-mvp-design.md)
defines the read-only MVP. The Go binary embeds the production UI and serves it
alongside JSON APIs. The standalone HTML preview uses fixture data and remains
separate from the application. `deployment/localhost/` starts the complete
application; the isolated [dev-ci stack](deployment/dev-ci/README.md) uses the
same production build and gateway with disposable test data.

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
exercising the compiled CLI. `pnpm build` clears the package's `dist/` before emitting
`packages/daynight/dist/main.js` and copying the complete built-in review skill
bundle into `dist/commands/review/skills/`; the package's `daynight` bin points to
the stable JavaScript entry.
Source tests mirror `cli/`, `config/`, `api/`, `commands/` and `platform/`
ownership, with build and version-policy tests in `test/tooling/`.
The pnpm dependency store is local to `.tmp/pnpm-store`. `pnpm acceptance`
separately packs and installs the CLI in a local consumer and requires package-
registry access. The review lifecycle suite uses controlled GitHub/Copilot
executables with real Git and SQLite. The self-update suite uses real npm and an
isolated, task-local global prefix with a controlled HTTP registry. Neither suite
changes the operator's installed CLI or requires live review credentials.

Shell completion has a separate real-shell acceptance command. It requires
Python 3 on a POSIX host, Bash 4.2, a modern Bash, and zsh. Linux hosts can prepare
isolated shell executables from the repository root:

```bash
bash packages/daynight/scripts/prepare-completion-shells.sh
source .tmp/shell-completion/environment.sh
pnpm completion:acceptance
```

The preparation helper downloads a SHA-256-pinned GNU Bash 4.2 release and builds
its executable in `.tmp/shell-completion/`. It requires standard build tools,
`curl`, `sha256sum`, `tar` and `timeout`. It uses an existing zsh when available;
otherwise it downloads Debian packages with `apt-get download` and extracts them
locally with `dpkg-deb`. It installs no global packages. First-time preparation
requires network access; subsequent runs reuse the local toolchains.

On other POSIX hosts, or to select existing executables, set `DAYNIGHT_TEST_BASH42`
to the Bash 4.2 executable before running `pnpm completion:acceptance`.
`DAYNIGHT_TEST_BASH` and `DAYNIGHT_TEST_ZSH` select the other executables and default
to `bash` and `zsh`. `DAYNIGHT_TEST_ZSH_ROOT` optionally selects an extracted zsh
toolchain root. `DAYNIGHT_COMPLETION_EVIDENCE` optionally selects the JSON receipt
path. The command builds the client and runs a Python PTY harness against actual
Tab insertion in all three shells. It uses isolated startup files and task-local
fixtures, with no user configuration, review credentials or installed CLI changes.
A dedicated Ubuntu 24.04 CI job runs this suite separately from the native CLI
matrix; its result belongs to the tested revision. The
[completion design](docs/design/daynight-completion.md) owns its coverage and
loading guarantees.

GitHub Actions runs type checking, build, and tests on native Linux, macOS, and
Windows runners. Each native job resolves the latest available Node.js 24 patch.
The final `checks` job also requires the dedicated Linux shell
completion job and the server and web jobs; all required jobs must succeed. The
Linux job also enforces package version increases before ordinary validation. A
PR compares its complete source changes with its merge base and its package
version with the event's target-branch revision. Main pushes compare
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
review/re-review/restart/closure lifecycle. Separate npm global-prefix acceptance
checks self-update and installation ownership. Curated environment and scenario
receipts are uploaded by each native CI job; the
[acceptance report](docs/research/daynight-acceptance.md) distinguishes those
receipts from live-service evidence. Controlled Copilot executables exercise retained sessions, durable
launch intent, stdin prompts and streamed completion/failure handling. These
checks require no live model invocation or GitHub publication.

## Local server deployment

Run the dashboard, project/task API and PostgreSQL with Docker Engine 28+ and Docker
Compose 2.20+ using Linux containers:

```bash
bash deployment/localhost/up.sh
```

The command builds the UI and server inside Docker, applies embedded migrations
and waits for healthy services. Open `http://127.0.0.1:8787/` for the dashboard;
the API is available at `http://127.0.0.1:8787/api/v1` on that same origin.
PostgreSQL data persists across container recreation. The
[localhost deployment guide](deployment/localhost/README.md) owns port selection,
API examples, logs, updates and volume removal.

## Server development

Use Go 1.27.2, PostgreSQL 18.6, Node.js 24 LTS and pnpm 10.34.5. Run
`pnpm install --frozen-lockfile` from the repository root before source builds. The
[server module](packages/daynight-server/README.md) owns configuration, startup,
the isolated database setup and complete validation commands. Its HTTP runtime
binds only loopback addresses and serves project creation/list/get, task
create/list/get/update, complete task-graph routes and embedded UI assets. Delivery
status and complete process acceptance
are recorded in the
[task breakdown](docs/design/daynight-server-tasks.md).

From `packages/daynight-server/`, set `DAYNIGHT_TEST_DATABASE_URL` to an isolated
PostgreSQL database, then run:

```bash
bash scripts/check.sh
```

This first runs the shared `pnpm web:build` to publish real embedded assets, then
builds the binary, runs vet and race-enabled `go-cov`, and enforces total
statement coverage strictly greater than 90%, package coverage of at least 85%,
and function coverage of at least 80%, with critical-block checks enabled. The
same raw coverage profile supplies an exact strict comparison; exactly 90%
fails, independently of display rounding. No product files or functions are
excluded. The CI aggregate requires this Go job, web, every native CLI platform
and the Linux shell completion job to pass. PostgreSQL absence is a failure, not
a skipped test. The
[server acceptance report](docs/research/daynight-server-acceptance.md) maps
requirements to tests and describes the CI receipt containing tested source and
binary identity, scenario results and resource cleanup.

## Web development

The private [web workspace](packages/daynight-web/README.md) implements the project
list, cursor paging, safe API decoding, cancellation, project statistics, task
graphs and detail drawers. With the
Go API running on loopback, use:

```text
pnpm web:dev
pnpm web:typecheck
pnpm web:build
pnpm web:test
```

The frontend build emits `packages/daynight-web/dist/`, validates its HTML and
assets, and publishes a complete replacement into the Go embed directory. A
clean Go build without generated assets fails; no placeholder UI is committed.
The web job runs typecheck, production build, controlled-fetch UI tests, isolated
deployment lifecycle fixtures and an exact statement gate strictly
above 90%. It independently enumerates all product TypeScript/TSX files and
publishes raw counters plus a relative source manifest. `checks` requires web,
Go, every native CLI platform and the Linux shell completion job; existing root
CLI commands retain their scope.

For a disposable full-stack HTTP target, run a command through
`bash deployment/dev-ci/run.sh <command> [args...]`; it receives
`DAYNIGHT_BASE_URL` and owns only its unique test project. The runner removes its
containers, volume, network and image tag after completion, failure or cancellation,
and records cleanup failures. The [dashboard tasks](docs/design/daynight-web-tasks.md)
track the remaining real-browser and fixed-dataset performance acceptance.

## Package versions

Changes to `packages/daynight/src/`, either package manifest, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `.npmrc`, either application TypeScript configuration, or
the package's build-cleanup script require a strictly greater SemVer in `packages/daynight/package.json`. Source
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

## npm publication

The manual [`publish` workflow](.github/workflows/publish.yml) publishes
`@codetreker/daynight` to npmjs using OIDC trusted publishing. Configure the
package's npmjs **Settings → Trusted Publisher** before running it:

| GitHub Actions setting | Value |
|---|---|
| Organization or user | `codetreker` |
| Repository | `daynight` |
| Workflow filename | `publish.yml` |
| Environment name | Leave blank |
| Allowed actions | Allow direct `npm publish` |

Staged publishing permission alone does not allow this workflow's direct
publication. A newly configured trusted publisher must complete its first
successful publication within two days; npm requires an expired configuration
to be recreated. These settings belong to npmjs and are not configured by the
repository. See npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers).

After merging a stable package version to `main`, run:

```bash
gh workflow run publish.yml --ref main
```

The workflow accepts only `main` and freezes that run's source commit. It waits
for the latest main-push `checks.yml` run at that exact commit to succeed; a
missing or failed run stops publication. It then installs frozen dependencies,
runs type checking, tests and installed acceptance, and smoke-installs the packed
release tarball. A separate GitHub-hosted job uses
Node.js 24 and pinned npm 12.2.0 to publish that same artifact publicly with
provenance and the `latest` dist-tag. No npm token is required. Stable releases
are supported; prerelease versions are rejected, and a new version must advance
the public registry's current `latest` version.

Only after the public registry's source commit, SHA-512 integrity and downloaded
tarball bytes match the artifact does the workflow create
`daynight-v<package-version>` at the frozen source commit. Existing tags are
immutable: a tag at another commit or an existing package version with different
source or contents fails the release.

After `npm publish` returns success, public visibility polling shares a
ten-minute deadline and logs each attempt. Each registry request remains bounded
to 20 seconds; the publishing job has a 15-minute limit. A visibility timeout
leaves the tag uncreated and reports failure even if npm has accepted the
package.

If npm accepts the package but registry verification or tag creation fails,
re-run the failed jobs of the same Actions run while its validated artifact
remains available for 30 days.
An existing version with the same source and bytes is verified before the
missing tag is created. A new dispatch at another commit cannot claim that
version. The workflow serializes releases, keeps in-progress releases running,
and reports conflicting or unverified state as failure. The
[publishing decision](.agents/notes/implemented/process/2026-10-20-npm-trusted-publishing.md)
owns artifact identity and recovery rationale.

## Install and update

Install the CLI with npm:

```bash
npm install --global @codetreker/daynight
daynight --version
```

Update that npm global installation with:

```bash
daynight update
```

The command checks `@codetreker/daynight`'s `latest` version in the configured npm
registry and installs that exact version only when it is newer. It updates the
installation that is running, even if npm's current default global prefix has
changed. An equal or newer installed version succeeds without installation or
downgrade. User and global npm registry/authentication settings apply; the current
working directory's project `.npmrc` does not select the update source.

`daynight update --help` explains the command. Self-update requires an npm-owned
global package and launcher. Source checkouts, local dependencies, `npx`, pnpm and
`npm link` installations receive guidance to use their original package manager.
If an update is needed, run the command from outside its installation directory.
The installer streams its output, enforces the target's Node.js engine requirement
and reports permission, network and installation errors. It does not request
administrator privileges automatically. npm owns replacement and recovery; a
failed installation is not a promise that every original file remains unchanged.

The command verifies the installed manifest, launcher and a fresh invocation's
version before reporting success. It requires no review configuration and does
not open SQLite, modify sessions or restart a running reviewer. The next CLI
invocation uses the installed version. Restart any running reviewer to use it;
on Windows, a reviewer holding a native addon open can prevent npm from replacing
that file and cause the update to fail. The
[self-update decision](.agents/notes/implemented/feature/2026-10-20-cli-self-update.md)
records installation ownership and verification requirements.

## Client commands

```text
daynight                            # Show root help
daynight --help                      # Also -h
daynight --version                   # Also -v
daynight update
daynight review                     # Show review help
daynight review run
daynight review list                 # Also review ls
daynight review add-repo <remote> [--path <path>]
daynight completion                 # Show completion help
daynight completion bash
daynight completion zsh
daynight project
daynight project create --name <name> --repo <repo>
daynight project list [--json]
daynight project show <project-id> [--json]
```

Groups and operations show help when `--help` or `-h` is their sole argument.
Help, version and completion generation do not resolve the user home, load review
configuration, open SQLite or require review tools. `review add-repo` accepts one
`--path <path>` before or after its remote; `--path=value` and `--` are invalid.
Unknown commands and invalid arguments exit with status 2; operation failures
exit with status 1 and retain their cause. The old `--daemon-review` and root
`add-repo` forms are invalid. The
[client design](docs/design/daynight.md) owns command composition and lazy loading;
the [composition decision](.agents/notes/implemented/architecture/2026-10-20-client-command-composition.md)
records module ownership and the preserved data layout.

## Shell completion

Bash 4.2 or newer and zsh have native completion scripts. Add this to `.bashrc`:

```bash
source <(daynight completion bash)
```

For zsh, load the script after the completion system is initialized in `.zshrc`:

```zsh
autoload -Uz compinit
compinit
source <(daynight completion zsh)
```

If the file already initializes `compinit`, add only the final line. Loading
without `compinit` fails with a diagnostic. The client prints scripts to stdout
and leaves startup-file changes to the operator. These outputs are designed for
`source`; using the same output directly as an `fpath` autoload file is outside
the loading contract.

Completion suggests commands, nested operations, aliases, options, shell names
and local directories for `review add-repo --path`. zsh also displays descriptions.
The scripts run in the shell on each Tab without starting Node or reading review
configuration, SQLite or the network. Directory suggestions preserve quoted and
special-character paths; an uncreated target directory remains valid input.

New shells generate definitions from the currently installed package. After an
update, run the applicable `source` command again to refresh an existing shell.
A saved generated script must be regenerated after updating. The
[completion design](docs/design/daynight-completion.md) explains the shared grammar
and shell integration; the
[completion decision](.agents/notes/implemented/feature/2026-10-20-shell-completion.md)
records compatibility and execution trade-offs.

## Project management

Set the server origin in `~/.daynight/config.yml`:

```yaml
serverUrl: http://127.0.0.1:8787
```

The origin includes its protocol, host and optional port; the client adds
`/api/v1`. Then create, list or inspect projects:

```bash
daynight project create --name "Example" --repo https://github.com/OWNER/REPO.git
daynight project list
daynight project list --json
daynight project show <project-id> --json
```

These commands work outside Git repositories and use only the configured server.
Creation sends the supplied repository address for registration; lists traverse
all pages. Human output uses complete labeled project blocks with visible
terminal-control escapes. JSON preserves resource fields and nanosecond timestamp
strings; a later-page failure produces an error with empty stdout. The
[project/task requirements](docs/spec/daynight-project-task.md) own the complete
behavior and remaining task-command scope.

## Review configuration and startup

Register a repository before starting review mode:

```text
daynight review add-repo https://github.com/OWNER/REPO.git
daynight review add-repo git@github.com:OWNER/OTHER.git --path ./review-other
daynight review run
```

For a local build, prefix the command with `pnpm`. These commands select
`~/.daynight/config.yml` using the current OS user's home directory. `review add-repo`
creates the configuration when absent. It reads, validates and saves configuration;
cloning, authentication checks, GitHub calls, SQLite initialization and PR boundary
selection belong to review startup. An already running reviewer keeps its loaded
configuration until its next startup.

The same YAML also accepts the server client's `serverUrl` field. Review validates
its own fields independently of that value, while the server configuration
projection requires only a valid HTTP(S) origin. The shared parser still rejects
invalid YAML, duplicate keys and unknown root fields. Registration can add the
first review repository to a server-only file while preserving its server
settings and comments.

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

Numeric options use the documented [configuration defaults](docs/design/daynight-review.md#使用方式与配置)
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
`Last observed` successful complete poll and saved poll error when present.
PRs at or below the permanent tracking boundary are not stored individually and
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

The command and source layout preserve existing YAML fields, version 1 SQLite
schema, retained-state locations and resource identities. No data migration or
command-specific disk partition is required. The review module owns its domain
types independently of its SQLite implementation.

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

See the [review architecture](docs/design/daynight-review.md) for transitions and the
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

The review module ships `daynight-review` under its own `skills/` directory.
After taking the instance lock, the daemon captures the installed bundle once
and prepares an immutable content-addressed snapshot under
`~/.daynight/cache/review-skills/`. Package updates cannot replace the content
used by that running daemon. Snapshots remain available for retained sessions
and uncertain executions; automatic collection is not provided.

Each attempt first runs native Copilot skill discovery in the prepared PR
worktree. A single `--plugin-dir=<snapshot root>` argument supplies a generated
local plugin wrapper containing `plugin.json` and `skills/daynight-review/`.
This preserves paths containing commas, spaces and Unicode; inherited
`COPILOT_SKILLS_DIRS` variables are removed from the child environment.
Exactly one enabled `daynight-review` must resolve to that snapshot's directory;
a disabled skill, project override or malformed response fails the attempt.
The review prompt explicitly invokes the skill and identifies its current
absolute entrypoint and digest on both new sessions and resume. The bundled
skill owns review methodology; the prompt owns the immutable target, publication
eligibility, retry reconciliation and completion protocol.

The Copilot adapter then launches the review child in that same worktree and
environment. It selects the persisted per-PR UUID on first launch and explicitly resumes that
same session thereafter. An interrupted first launch also resumes existing
history; missing established history is an error. Only opaque session-directory
presence is inspected. Copilot history and agent JSONL are not parsed.

Prompts travel through stdin in noninteractive mode. `cross-spawn` handles native
commands and Windows command shims; prompt text is not embedded in shell code or
command arguments. Runtime paths contain Copilot state, cache, temporary files
and per-attempt diagnostics. Existing GitHub CLI authentication remains available
through Copilot's supported fallback. Discovery and review are sequential phases
of one persisted attempt, sharing one retry budget and timeout deadline. The
discovery child must be excluded before its exact persisted PID and identity are
cleared and a review child can start. Cancellation, timeout or uncertain process
exclusion prevents that next launch. Discovery stdout and stderr stream to
separate `skill-list` logs and never enter completion-marker parsing.

The agent publishes inline Critical/Major comments or approval itself and
reconciles prior publication when continuing an incomplete review. The adapter
streams separate stdout/stderr logs and accepts only normal zero exit, complete
capture and the exact final nonempty stdout line `PR N Review Completed`.
Incomplete output, timeout, cancellation and logging errors cannot complete a
review. The coordinator owns scheduling and final state transitions; runtime
process supervision supplies evidence under the foreground execution contract.

The [execution decision](.agents/notes/implemented/architecture/2026-10-17-copilot-session-execution.md)
records process and publication boundaries. The
[skill design](docs/design/daynight-review-skill.md) owns packaging, snapshots and
loading, with rationale in the
[bundled-skill decision](.agents/notes/implemented/architecture/2026-10-20-bundled-review-skill.md).
Native probes with Copilot CLI 1.0.100 verify actual bundled-skill activation and
changed-bundle resume with the same UUID, including comma, space and Unicode
paths. The [acceptance report](docs/research/daynight-acceptance.md#native-skill-activation)
records the probe's conditions and limits. Live Copilot/GitHub publication acceptance
remains separate from those probes and controlled subprocess tests.

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
[client composition decision](.agents/notes/implemented/architecture/2026-10-20-client-command-composition.md),
[foreground review decision](.agents/notes/implemented/architecture/2026-10-16-foreground-review-cli.md),
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
