# Day Night

Day Night contains a client command toolkit and an independent Go service runtime
for project and task management. Its read-only browser workspace provides project
statistics, task dependency graphs and details from the same Go service origin.
The read-only dashboard is delivered, including production-browser acceptance,
embedded deployment and the subsequent focus-restoration repair. The
[dashboard tasks](docs/design/daynight-web-tasks.md) record completion and link
the corresponding PR and CI evidence.

| Component | Location | Implementation status | Requirements and design |
|---|---|---|---|
| `daynight` | `packages/daynight/` | Implemented `review`, npm global `update`, guided `setup`, Bash/zsh `completion` generation and setup, the public task-management skill bundle and interactive Agent installation, shared configuration, server HTTP and repository binding foundations plus project and task commands; native installed service and resource-budget acceptance implemented | [Client requirements](docs/spec/daynight.md), [client design](docs/design/daynight.md), [completion design](docs/design/daynight-completion.md), [review requirements](docs/spec/daynight-review.md), [review design](docs/design/daynight-review.md), [project/task requirements](docs/spec/daynight-project-task.md), [design](docs/design/daynight-project-task.md), [tasks](docs/design/daynight-project-task-tasks.md) |
| `daynight-server` | `packages/daynight-server/` | Project/task and complete graph HTTP APIs, PostgreSQL transactions, embedded browser assets, strict coverage gates and built-process acceptance implemented | [Requirements](docs/spec/daynight-server.md), [design](docs/design/daynight-server.md) |
| `daynight-web` | `packages/daynight-web/` | Project browsing, statistics, read-only task graphs/details, embedded delivery, production acceptance and strict coverage delivered | [Requirements](docs/spec/daynight-web.md), [architecture](docs/design/daynight-web.md), [task breakdown](docs/design/daynight-web-tasks.md), [preview](docs/design/mockups/task-dashboard.html) |

The `@codetreker/daynight` package provides the `daynight` client. Its root entry
lists commands and reports the package version; each command owns its business
dependencies and lifecycle. `review` polls configured repositories, maintains
dedicated local clones and PR worktrees, and launches Copilot in a retained
session for each eligible PR using a bundled review skill. SQLite preserves initialization boundaries, review
revisions and retry budgets. The group also provides configuration-only
repository registration and a local persisted review listing. `setup` configures
server access, review repositories or both; valid business commands guide missing
configuration for their own capability before continuing. `update` manages
the current npm global installation independently of review configuration and
runtime. `completion` generates native Bash and zsh scripts from the same command
definitions used by parsing and help, and `completion setup` installs their
startup configuration. Loaded scripts complete locally without starting Node on
each Tab.

The adopted [project/task CLI design](docs/design/daynight-project-task.md) adds
server-backed commands, automatic Git-origin project discovery and ignored
repository-local bindings. Its [requirements](docs/spec/daynight-project-task.md)
and [task breakdown](docs/design/daynight-project-task-tasks.md) describe the
confirmed behavior and implementation status. Shared YAML projections, the
`serverUrl` configuration field, bounded HTTP client and repository discovery
with ignored local bindings are implemented. `project create/list/show` manage
remote projects through the configured server. Task create/list/ready/show/update/graph
commands use explicit project selection or the current repository binding;
installed real-service and resource-budget acceptance are implemented.
[PR #55](https://github.com/codetreker/daynight/pull/55) records the original
integration and real-default-budget validation. Current deadline tests use short
test-side budgets under the
[CI efficiency decision](.agents/notes/implemented/testing/2026-10-21-ci-validation-efficiency.md).
Controlled native-platform tests and live Copilot/GitHub acceptance provide separate evidence; live acceptance remains
outstanding.

The adopted [public Agent skill design](docs/design/daynight-agent-skill.md)
defines an npm-bundled `daynight` skill and interactive installation for Codex,
Copilot CLI and Claude Code. Its [requirements](docs/spec/daynight-agent-skill.md)
cover active task management in associated projects, agent and scope selection,
and complete replacement on reinstall. The public skill and its command reference
are included in the npm package build under
`dist/commands/skill/skills/daynight/`. Interactive
[`daynight skill install`](#agent-skill-installation) detects supported Agent
launchers and installs that bundle at the selected scope. The skill guides task recovery, dependency and observed-version updates, and
completion only after required PRs are confirmed merged and acceptance passes.
The design links implementation tasks tracked in the real Daynight project;
their live status belongs to Daynight. Native Agent loading and automatic
activation remain separate acceptance work.

The [task property requirements](docs/spec/daynight-task-properties.md),
[design](docs/design/daynight-task-properties.md),
[implementation breakdown](docs/design/daynight-task-properties-tasks.md) and
[interactive preview](docs/design/mockups/task-properties.html) define
server-predefined task properties, starting with ordered PR references containing
caller-provided URLs and titles. Server persistence, migration and HTTP operations
are implemented; CLI editing/output and web presentation remain planned.

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
Git, authenticated GitHub CLI and Copilot CLI on PATH. The inspected
`better-sqlite3` 13.0.3 Linux x64 prebuild requires `GLIBC_2.34` and
`GLIBCXX_3.4.29`; these observed symbol requirements constrain older distributions
and do not establish compatibility for other distributions, architectures or
musl. Native validation must identify its actual operating system and architecture.
From the repository root:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm acceptance
pnpm daynight --help
pnpm daynight --version
```

`pnpm check` runs type checking and tests. Standalone `pnpm test` and
`pnpm acceptance` build the package before exercising the compiled CLI. Native CI
typechecks and builds once, then invokes both Vitest configurations against that
same compiled output. `pnpm build` clears the package's `dist/` before emitting
`packages/daynight/dist/main.js` and copying the explicit review and public skill
bundles into `dist/commands/review/skills/daynight-review/` and
`dist/commands/skill/skills/daynight/`. Complete relative resources are included;
repository workflow skills are not scanned for publication. The package's
`daynight` bin points to the stable JavaScript entry.
Source tests mirror `cli/`, `config/`, `api/`, `commands/` and `platform/`
ownership, with build and version-policy tests in `test/tooling/`.
The pnpm dependency store is local to `.tmp/pnpm-store`. Native skill terminal
acceptance uses the development-only `node-pty` dependency, including Windows
ConPTY. The workspace build policy permits only the pinned node-pty hook and
keeps the existing SQLite build-hook suppression. Linux builds its native
terminal addon with the available compiler/Python toolchain; macOS and Windows
use the packaged prebuild when available. A version-pinned pnpm patch restores
missing Darwin helper executable bits in the stable terminal dependency. The
[native terminal decision](.agents/notes/implemented/testing/2026-10-21-native-skill-terminal-acceptance.md)
records the test isolation and stream separation. `pnpm acceptance`
separately packs and installs the CLI in a local consumer and requires package-
registry access. The review lifecycle suite uses controlled GitHub/Copilot
executables with real Git and SQLite. The self-update suite uses real npm and an
isolated, task-local global prefix with a controlled HTTP registry. Neither suite
changes the operator's installed CLI or requires live review credentials.
Project/task acceptance is a third native installed suite using a reusable
pack/install fixture, real Git and controlled HTTP. Its actual results
belong to the [task record](docs/design/daynight-project-task-tasks.md#pt-t5).

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
Tab insertion in all three shells. It also installs setup into isolated startup
files and checks real login and interactive shell loading, repeated installation
and completion registration. It uses task-local fixtures, with no user
configuration, review credentials or installed CLI changes.
A dedicated Ubuntu 24.04 CI job runs this suite separately from the native CLI
matrix; its result belongs to the tested revision. The
[completion design](docs/design/daynight-completion.md) owns its coverage and
loading guarantees.

GitHub Actions runs type checking, build, and tests on native Linux, macOS, and
Windows runners. Each native job resolves the latest available Node.js 24 patch.
PRs select complete module jobs from their changed paths; the
[CI selection rules](#ci-selection) define shared inputs and documentation-only
changes. A selected CLI runs every native platform and the dedicated Linux shell
completion job. On PRs, the Linux job also enforces package version increases
before ordinary validation. It compares the PR's complete source changes with
its merge base and its package version with the event's target-branch revision.
Main pushes run every module. The checkout includes the required history.
Native tool discovery records command resolution, launcher, PID, timing, status
and bounded output in `.tmp/validation-probes.json`. Before executing `gh`, it
reads the selected file sequentially and records its byte count, SHA-256 and
preparation duration. Resolution, preparation and native execution share one
10-second gh budget; expired preparation or an over-budget native result fails
the probe. The version child uses isolated project-local configuration/state and
disabled telemetry. A separate diagnostic artifact uploads after validation even
when environment discovery fails. Every native version, the complete validation
workload and the 600-second platform gate remain required whenever CLI validation
is selected. The
[cold-start decision](.agents/notes/implemented/bug-fix/2026-10-20-gh-cold-start-preparation.md)
records the measurements, deadline semantics and remaining limits.

macOS tests mount temporary case-sensitive and case-insensitive APFS images to
check path identity against both filesystem behaviors. Setup positively verifies
whole-image ownership before the eight original filesystem cases. One additional
same-user read-only file-holder case requires actual Busy, known-PID diagnostics,
acknowledged release after at least six seconds and exact image absence. That
controlled case restricts its volume `lsof` query to the acknowledged child PID
AND the mounted filesystem; generic fixture diagnostics retain their existing
filesystem query. Every diagnostic keeps its two-second limit. All finalization
shares one 30-second budget and at most three ordinary detach calls; unresolved
cleanup fails the job. The
[finalization decision](.agents/notes/implemented/bug-fix/2026-10-20-apfs-finalization-window.md)
records the ownership and observation guarantees, and the
[controlled-holder decision](.agents/notes/implemented/bug-fix/2026-10-21-apfs-controlled-holder-observation.md)
records the limited process selection and required native evidence. No live GitHub or Copilot
credentials are required by these checks.
SQLite tests use real disk databases, including reopen, transaction rollback,
locking, and revision/retry transitions on every platform.
GitHub tests use controlled API responses and subprocess fixtures to verify
complete scans, HTTP failures, and atomic observation commits.
Git lifecycle tests use local origin/clone fixtures and real worktrees to check
captured targets, disposable review artifacts, shared refs, and isolation between
PR worktrees. Independent Git suites run in separate Vitest workers. Each suite
copies its immutable bare-origin seed into private test directories; refs,
SQLite databases, clones and worktrees remain separate for every case. Sparse
suites prepare their shared source graph before copying, and version-gate tests
reuse only immutable default-base objects; scenario observations and mutations
remain private. Source snapshots are prepared through batched native Git imports,
while real clone/fetch/worktree operations remain the test subjects. Tests within
a file stay sequential so environment changes and cleanup have one owner.
The [Git test decision](.agents/notes/implemented/testing/2026-10-18-parallel-git-validation.md)
records the isolation rules, and the
[CI timing report](docs/research/windows-ci-performance.md) records native
before/after measurements. The installed acceptance suite additionally verifies the package
bin, default native command shims, singleton/stale-lock behavior and the complete
review/re-review/restart/closure lifecycle. Separate npm global-prefix acceptance
checks self-update and installation ownership. Curated environment and scenario
receipts are uploaded by each native CI job; [validation](#validation) describes
their scope and interpretation. Controlled Copilot executables exercise retained sessions, durable
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
excluded. When [CI selection](#ci-selection) selects the server, the complete
Go job contributes its result to the final `checks` job. PostgreSQL absence is a
failure, not a skipped test. PT-T5 adds an installed-CLI service path and resource-budget
probes to this same gate. A Node orchestrator shares one real installation across
the Go command scenarios and, after the unchanged go-cov/strict-profile checks,
public-command probes outside Go's default ten-minute timer. Test-only deadline
mocks use a 1-second request and 3-second operation budget while separately
asserting the installed production defaults of 30 seconds and five minutes.
The 128 MiB single-response and 256 MiB cumulative decoded-byte probes keep
real exact-limit and +1-byte tests. Each receipt identifies actual deadlines and
mock status. The Go job retains its 20-minute bound and complete validation
workload. The [acceptance design](docs/design/daynight-project-task.md#验证与交付证据)
owns the mechanism and source-bound evidence. The
[server validation guide](packages/daynight-server/README.md#built-process-acceptance-and-ci-evidence) maps
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
publishes raw counters plus a relative source manifest. When
[CI selection](#ci-selection) selects web, the complete job contributes its result
to the final `checks` job; existing root CLI commands retain their scope.

For a disposable full-stack HTTP target, run a command through
`bash deployment/dev-ci/run.sh <command> [args...]`; it receives
`DAYNIGHT_BASE_URL` and owns only its unique test project. The runner removes its
containers, volume, network and image tag after completion, failure or cancellation,
and records cleanup failures. The [dashboard tasks](docs/design/daynight-web-tasks.md)
record historical production/deployment results, the earlier hosted zoom failure,
the dashed-paint fix's complete local pass and pending hosted delivery.

`pnpm web:acceptance` builds production UI and a native Go executable, creates an
owned PostgreSQL instance and starts the normal dev-ci production build in
parallel. It runs native functional workflows, then the container workflows and
complete container cleanup, and finally the fixed native capacity cases. It
requires Go 1.27.2, Docker, Node 24, pnpm 10.34.5 and Playwright Chromium. The
[web README](packages/daynight-web/README.md#production-browser-acceptance) owns
browser setup, required gates and receipt interpretation. The
[dashboard task record](docs/design/daynight-web-tasks.md#w-t6) identifies the
source-bound production/performance results and remaining delivery requirements.

## Package versions

Changes to `packages/daynight/src/`, either package manifest, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `.npmrc`, either application TypeScript configuration, or
the package's build-cleanup script require a strictly greater SemVer in `packages/daynight/package.json`. Source
additions, deletions and moves all count. Unchanged versions, downgrades and
build-metadata-only changes fail. Tests, fixtures, documentation, CI workflows
and validation scripts alone do not require a version increase. CI enforces this
policy in the PR's Linux CLI job using the event's explicit base and head commits.

Update the version in the same PR as the code. To check committed revisions
locally, run `pnpm version:check pull_request <base-sha> <head-sha>` or
`pnpm version:check push <before-sha> <after-sha>`. The command reads versions
from those commits; uncommitted files do not affect the result. The local push
mode compares the complete before/after range; an all-zero before SHA validates
the starting version without a predecessor comparison. Missing history,
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

The workflow accepts only `main` and freezes that run's source commit. Before
waiting for CI or installing dependencies, a read-only preflight reads the
package version and checks the exact `daynight-v<package-version>` tag and the
exact `@codetreker/daynight` version on npmjs. Either existing marker makes the
new dispatch succeed with an explicit skip message, even when it belongs to an
earlier commit. A skip does not publish, download or verify the existing package,
or create a missing tag. A tag alone is sufficient to skip. Only HTTP 404 means
absence; lookup failures and malformed responses fail the run.

When both markers are absent, preparation waits for the latest main-push
`checks.yml` run at the frozen commit to succeed; a missing or failed run stops
publication. It then installs frozen dependencies, runs type checking, tests and
installed acceptance, and smoke-installs the packed release tarball. The
publishing job is titled `Publish daynight v<version>`, using the version from the
prepared artifact's release receipt. Before its first publication attempt with
that artifact, it repeats the preflight so a version that appeared during
preparation also skips successfully. That separate GitHub-hosted job uses
Node.js 24 and pinned npm 12.2.0 to publish the same artifact publicly with
provenance and the `latest` dist-tag. No npm token is required. Stable releases
are supported; prerelease versions are rejected, and a new version must advance
the public registry's current `latest` version.

Only after the public registry's source commit, SHA-512 integrity and downloaded
tarball bytes match the artifact does publication create
`daynight-v<package-version>` at the frozen source commit. Existing versions and
tags are never overwritten. Public metadata and tarball visibility share one
ten-minute verification deadline after npm accepts publication, or from
verification start when recovering an existing version. HTTP 404 responses for
either resource are polled within that deadline, with each attempt logged. Other
HTTP errors and source or integrity mismatches fail immediately. Individual
requests, including response bodies, have a 20-second limit and share the
remaining verification deadline; the publishing job has a 15-minute limit. A
visibility timeout leaves the tag uncreated and reports failure even if npm has
accepted the package.

If npm accepts the package but registry verification or tag creation fails,
re-run the failed jobs of the same Actions run while its validated artifact
remains available for 30 days. A publishing-job retry with that retained artifact
bypasses the fresh-publication preflight, verifies an existing version against
the same source and bytes, and creates the missing tag. Conflicting source,
contents or tag targets fail recovery. If preparation itself is retried, the
first publication attempt with its newly prepared artifact still runs the second
preflight. Re-running all jobs or creating a new dispatch repeats the initial
preflight and skips any existing marker; these operations do not complete an
interrupted release. The workflow serializes releases and keeps in-progress
releases running. The
[preflight decision](.agents/notes/implemented/process/2026-10-21-publication-version-preflight.md)
owns skip and retry behavior; the
[trusted-publishing decision](.agents/notes/implemented/process/2026-10-20-npm-trusted-publishing.md)
owns artifact identity, OIDC and public verification.

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
daynight setup                       # Choose server access, review or both
daynight setup --server-url <url>
daynight setup --review-repo <remote> [--review-path <path>]
daynight review                     # Show review help
daynight review run
daynight review list                 # Also review ls
daynight review add-repo <remote> [--path <path>]
daynight completion                 # Show completion help
daynight completion bash
daynight completion zsh
daynight completion setup [--shell bash|zsh] [--rc-file <path>]
daynight skill                      # Show skill help
daynight skill install              # Select Agents, then User or Project scope
daynight project
daynight project create <name> [--repo <repo>]
daynight project list [--json]
daynight project show <project-id> [--json]
daynight task
daynight task create --title <title> [options]
daynight task list [--status <status>] [--ready] [--json] [--project <project-id>]
daynight task ready [--limit <N>] [--json] [--project <project-id>]
daynight task show <task-id> [--json] [--project <project-id>]
daynight task update <task-id> [options]
daynight task graph [--json] [--project <project-id>]
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

## Agent skill installation

Install the public project/task skill through an interactive terminal:

```bash
daynight skill install
```

The command detects available `codex`, `copilot` and `claude` launchers without
starting them or checking login. Select one or more detected Agents with Space,
then Enter; the initial selection is empty. Next select `User` or `Project`,
with User initially selected. Installation starts after the scope is submitted.
Repeating the same command refreshes installed content from the running package.

| Agent | User destination | Project destination |
|---|---|---|
| Codex | `~/.agents/skills/daynight/` | `<worktree>/.agents/skills/daynight/` |
| Copilot CLI | `~/.agents/skills/daynight/` | `<worktree>/.agents/skills/daynight/` |
| Claude Code | `~/.claude/skills/daynight/` | `<worktree>/.claude/skills/daynight/` |

User scope works outside Git. Project scope uses the current Git worktree root,
including calls from subdirectories or linked worktrees, and does not require
an origin, server configuration or Daynight project association. Installing the
skill and associating a project remain separate operations. Terminal stdin and
stderr are required; prompts use stderr and installation results use stdout.
Help and installation do not depend on review configuration or credentials.

Every installation replaces the complete destination `daynight` entry, including
local edits and obsolete files. Other skills and existing parent-directory links
are preserved. Several Agent paths that resolve to the same physical directory
share one write; strictly nested targets are rejected before writing. A selected
Agent's discovery directory can also be visible to another Agent. Installing at
one scope does not change a same-named skill at another scope; host precedence
still applies.

The command reports per-Agent destinations and results. A failure stops later
targets, retains earlier successful installations and exits nonzero. A failure
after removing the old directory can leave that target absent; the diagnostic
states the result and rerunning installs the packaged content again. Ctrl+C
before publication cleans the operation's stage and newly created empty parents.

Codex normally discovers changed skills automatically; restart its session if
needed. For Copilot CLI run `/skills reload` and inspect `/skills info daynight`.
Claude Code watches existing roots; use `/reload-skills` when a top-level skills
directory was created during the session. The
[skill design](docs/design/daynight-agent-skill.md) owns installation mechanisms
and the separate native Agent loading and automatic-trigger acceptance gates.

## Shell completion

Bash 4.2 or newer and zsh have native completion scripts. Install startup
configuration with:

```bash
daynight completion setup
```

Setup detects the calling shell from its direct parent process. If it cannot
identify Bash or zsh reliably, select one explicitly:

```bash
daynight completion setup --shell bash
daynight completion setup --shell zsh
```

The login-shell preference in `SHELL` does not establish which shell is running.
For a custom startup file, use `--rc-file`; only that file is managed:

```bash
daynight completion setup --shell bash --rc-file /path/to/bashrc
```

Bash setup manages `.bashrc` and the first readable existing login file in the
order `.bash_profile`, `.bash_login`, `.profile`. It creates `.bash_profile` only
when none of those files exists; if existing profiles are all unreadable, it
reports an error. The login block runs only in interactive Bash and can safely
appear in a `.profile` shared with other POSIX shells. It does not
make the login shell load the rest of `.bashrc`.

zsh setup uses `$ZDOTDIR/.zshrc`, or `$HOME/.zshrc` when `ZDOTDIR` is unset.
An exported empty `ZDOTDIR` selects `/.zshrc`; setup resolves a relative value
from its current working directory. A later zsh started in another directory
resolves that relative value from its own startup directory. A value set only
inside zsh is not visible to the installer; use `--rc-file` in that case.
The managed block reuses an initialized completion system or runs `compinit`
with its normal security checks before loading daynight.

Setup recognizes its managed block and the documented standalone manual loading
statement. Repeating it leaves an installed file unchanged. A managed block
checks the shell's actual daynight completion registration before loading.
Managed blocks skip an existing registration, including when startup files load
each other. Preserved manual loading statements keep their unconditional
behavior: if one runs after a managed block, it generates and loads the script
again. Existing content, line endings, permissions and startup-file symbolic
links are retained. Added blocks use LF line endings because a carriage return
is shell token data. Malformed managed blocks, invalid targets and file access failures produce
explicit errors.

Setup reports the startup files it handled. It installs persistent configuration;
an ordinary CLI child process cannot inspect or change its parent shell's loaded
completion functions. Use the existing loading command to enable completion in
the current session:

```bash
source <(daynight completion bash)
```

For zsh, initialize its completion system first if the session has not already
done so:

```zsh
autoload -Uz compinit
compinit
source <(daynight completion zsh)
```

The `bash` and `zsh` generation operations write only scripts to stdout and do
not change startup files. Loading the zsh script without initialized `compinit`
fails with a diagnostic. The outputs are designed for `source`; using the same
output directly as an `fpath` autoload file is outside the loading contract.
Setup checks file contents without executing them. Custom early returns or later
commands that remove registrations can prevent a startup file from enabling
completion; verify such configuration by starting the shell.

Completion suggests commands, nested operations, aliases, options, shell names
and local directories for `review add-repo --path` and `setup --review-path`.
zsh also displays descriptions.
The scripts run in the shell on each Tab without starting Node or reading review
configuration, SQLite or the network. Directory suggestions preserve quoted and
special-character paths; an uncreated target directory remains valid input.

New shells generate definitions from the currently installed package. After an
update, run the applicable `source` command again to refresh an existing shell.
A saved generated script must be regenerated after updating. The
[completion design](docs/design/daynight-completion.md) explains the shared grammar
and shell integration. The
[completion decision](.agents/notes/implemented/feature/2026-10-20-shell-completion.md)
records compatibility and execution trade-offs; the
[setup decision](.agents/notes/implemented/feature/2026-10-21-completion-setup.md)
records startup-file ownership and installation limits.

## Configuration setup

The first valid project or task command asks for a server origin when the
configuration file or `serverUrl` is absent. The first `review run`, `review list`
or `review ls` asks for a repository when the file or `repositories` field is
absent. Each command asks only for its own capability. Machines that do not run
review can keep only `serverUrl`. After saving, the original command runs once
with its original arguments.

Run `daynight setup` to choose server access, review or both in advance. For scripts,
use explicit options, which never prompt:

```bash
daynight setup --server-url http://127.0.0.1:8787
daynight setup --review-repo https://github.com/OWNER/REPO.git
daynight setup --review-repo git@github.com:OWNER/OTHER.git --review-path ./review-other
```

The two capabilities can be configured in one invocation by combining
`--server-url` and `--review-repo`; `--review-path` requires `--review-repo`.
The server origin has no implicit default. Review registration uses the same
remote and path rules as `review add-repo`.

Interactive setup requires terminal stdin and stderr. Prompts and save messages
go to stderr, so redirected stdout keeps its normal text or JSON results. Missing
configuration in a noninteractive command fails with the corresponding scriptable
setup command. Shared YAML/schema errors, invalid values for the selected
capability and read errors retain their specific errors; an explicit empty review
repository list is invalid. Business values belonging only to the other capability
remain outside the current command's validation.
Help, version, completion, update and invalid arguments do not prompt.

Setup collects all selected values before one atomic save under the configuration
write lock, preserving comments, other settings and concurrent completed changes
to unrelated fields. If a selected field changed while input was collected, setup
fails with a conflict and asks for setup to be run again.
Ctrl+C, termination signals or EOF cancel input without saving partial values or
running the original command. Input time does not consume the business command's
timeout. Setup saves configuration only; network access, authentication, cloning
and review state initialization belong to the subsequent business command. A
connection failure after setup keeps the saved configuration. The
[setup decision](.agents/notes/implemented/feature/2026-10-21-guided-configuration-setup.md)
records the independent capabilities and persistence guarantees.

## Project management

Configure the server origin with setup or in `~/.daynight/config.yml`:

```yaml
serverUrl: http://127.0.0.1:8787
```

The origin includes its protocol, host and optional port; the client adds
`/api/v1`. Then create, list or inspect projects:

```bash
daynight project create "Example"
daynight project create "Example" --repo https://github.com/OWNER/REPO.git
daynight project list
daynight project list --json
daynight project show <project-id> --json
```

Creation requires one positional name; quote names containing spaces. Omit
`--repo` to use the current Git worktree's effective `origin`, including Git
`insteadOf` expansion. Supply `--repo` to use that address without inspecting Git;
this form, listing and details work outside Git repositories. For a name beginning
with `-`, use `daynight project create -- -name` or put an explicit repository
option before the terminator: `daynight project create --repo <repo> -- -name`.
The name is sent unchanged.

Creation first scans every project page and compares canonical repository
identities. With no match it registers the original name and repository address.
With one match it reports `Project already exists.` and the existing project,
leaving that project's name and address unchanged. Multiple matches fail with
their IDs; lookup failures and exhausted command budgets stop before creation.
This client preflight does not provide atomic uniqueness against concurrent
creators, and the service continues to allow duplicate repository registrations.
Project commands do not write repository bindings or ignore rules. Lists traverse
all pages. Human output uses complete labeled project blocks with visible
terminal-control escapes. JSON preserves resource fields and nanosecond timestamp
strings; a later-page failure produces an error with empty stdout. The
[project/task requirements](docs/spec/daynight-project-task.md) own the complete
behavior and remaining task-command scope.

## Task management

Task commands use the same `serverUrl` configuration as project commands:

```bash
daynight task create --title "Implement sign-in" --description "Support OAuth"
daynight task create --title "Build the sign-in page" --depends-on <task-id>
daynight task ready
daynight task ready --limit 5 --json
daynight task list --ready
daynight task list --status in_progress --json
daynight task show <task-id> --json
daynight task update <task-id> --description=
daynight task update <task-id> --status done
daynight task update <task-id> --depends-on <task-a> --depends-on <task-b>
daynight task update <task-id> --clear-dependencies
daynight task graph --json
```

Every operation accepts `--project <project-id>`, which selects a project for one
invocation without reading Git or local bindings. Otherwise, the CLI reads the
current worktree's effective `origin`, normalizes equivalent HTTPS/SSH/SCP
addresses, and matches the configured server's projects. A missing match fails
with `Project does not exist`; multiple matches require explicit selection.
A unique discovery is saved in the worktree's `.daynight/project.yml` with the
server origin and repository identity, after ensuring `/.daynight/` is effective
in the root `.gitignore`. A cached binding is verified against the server on each
use and remains stable if another project later shares that repository.

Creation starts in `todo`. `task ready` selects up to 10 actionable tasks by
default; `--limit <N>` accepts decimal integers from 1 through 100. It makes one
task-list request with `ready=true` and the chosen limit, without fetching later
pages. The service orders results by creation time and then task ID, both
ascending. A ready task is `todo` with all direct dependencies `done`. This
bounded selection supports choosing the next work without retrieving the whole
project; `task graph` provides a dependency overview when needed. `task list`
continues to read every matching page, including with `--ready`; its status and
ready filters combine with AND. `task ready` accepts neither `--status` nor
`--cursor`.

Updates preserve omitted fields; an empty description clears it. Repeated
`--depends-on` values replace the complete dependency set and retain input order
and duplicates for server validation. `--clear-dependencies` clears that set and
cannot be combined with `--depends-on`. An update needs at least one mutable
field. By default the CLI reads the task version before PATCH; `--if-version <n>`
uses that exact positive int64 version. Conflicts and failed writes are reported
without automatic retries.

Text options accept both separated values and `--option=value`. Inline assignment
splits at the first equals sign and supports leading dashes, such as
`--title=-example`; `--description=` is the explicit empty form. Separated values
starting with a dash are rejected. Directory options, switches and help reject
inline assignment; `--path=value` and `--` remain invalid.

Human results use complete labeled task blocks and graph nodes, including task
state, dependencies, blocking and title-preview truncation flags. Queries support
`--json`: `list` returns every matching resource in one array, `ready` returns
only its selected tasks as an array, details return one resource, and graphs
return the complete API object. A ready result retains every task field; an
empty human result is `No ready tasks.` and empty JSON is `[]`. Versions remain
JSON numbers with full int64 precision.
Local preparation fails before any task mutation; a lost write response is
reported as unconfirmed. The [task record](docs/design/daynight-project-task-tasks.md)
owns validation status. Installed CLI integration uses the real Go/PostgreSQL
service; deadline behavior uses short test-only budgets and byte probes retain
the full production limits. [PR #55](https://github.com/codetreker/daynight/pull/55)
records the original integration and real-default-budget validation, with its
historical source identity.

## Review configuration and startup

Register a repository explicitly, or let the first review operation guide registration:

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
malformed documents produce nonzero exits with useful errors. Missing configuration
triggers the [configuration setup](#configuration-setup) rules before review
startup. Duplicate repository identities,
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

The agent reads the current PR title, description and linked scope requirements,
then checks the complete captured diff against one concrete problem and outcome.
A clear description and changes within the original scope are independent
approval gates. Independent objectives, an unreviewable combined PR or unrelated
changes block approval even without a Critical/Major code defect. Necessary
implementation, structural changes, tests and documentation for the same outcome
remain in scope; fixed line or file counts do not decide reviewability. Expanding
the description alone cannot justify unrelated work.

Before publishing or confirming prior publication, the agent rereads the current
PR information and reevaluates those gates. It publishes `COMMENT` reviews for
blockers, with description or other PR-level problems in the review body and
suitable code findings inline; it does not use `REQUEST_CHANGES`. It approves
only when both quality gates pass and no Critical/Major code issues remain.
Retry confirmation requires prior publication to match the current gate result
and captured target. These are agent instructions, not a machine-enforced
quality judgment; title or description edits alone do not trigger another review.

The adapter streams separate stdout/stderr logs and accepts only normal zero
exit, complete capture and the exact final nonempty stdout line
`PR N Review Completed`. Incomplete output, timeout, cancellation and logging
errors cannot complete a review. The coordinator owns scheduling and final state
transitions; runtime process supervision supplies evidence under the foreground
execution contract.

The [execution decision](.agents/notes/implemented/architecture/2026-10-17-copilot-session-execution.md)
records process and publication boundaries; the
[PR-quality decision](.agents/notes/implemented/process/2026-10-21-review-pr-quality-gates.md)
records the approval policy. The
[skill design](docs/design/daynight-review-skill.md) owns packaging, snapshots and
loading, with rationale in the
[bundled-skill decision](.agents/notes/implemented/architecture/2026-10-20-bundled-review-skill.md).
Native probes with Copilot CLI 1.0.100 verify actual bundled-skill activation and
changed-bundle resume with the same UUID, including comma, space and Unicode
paths. The bundled-skill decision records the probe's conditions and limits.
Live Copilot/GitHub publication acceptance
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
verification, and delivery. Keep delivery boundaries, dependencies, scope and
acceptance criteria with their design documents. When tasks are managed in
Daynight, link their IDs from the design and query Daynight for live status;
local execution plans remain temporary checklists. Existing document-owned task
records retain their ownership until explicitly migrated. Use the
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

Validation commands, required gates and receipt interpretation belong to the
owning README or design. Keep run-specific counts, hashes, timing tables and
delivery updates with the corresponding PR and CI run. Preserve lasting research
findings with their methods, source identity and limitations in the existing
research or decision owner. CI artifacts expire after 30 days; a durable conclusion
must remain understandable without downloading them. This separation avoids
rolling acceptance reports that unrelated delivery branches must update. The
[validation evidence decision](.agents/notes/implemented/process/2026-10-20-source-bound-validation-evidence.md)
records this ownership and retention trade-off.

Create documents for authorized work. Keep active facts synchronized and preserve
historical decision premises; explicit archives remain immutable. New or revised
specifications and designs use Chinese headings and prose. Preserve technical
literals. Other documents, skills, code, comments, and commit messages use
English unless explicitly instructed otherwise. Discuss work in Chinese.

## CI selection

The [`checks` workflow](.github/workflows/checks.yml) runs a lightweight routing
job for every PR. It compares the event's explicit head with its merge base,
using the complete Git history and NUL-delimited paths. Deletions count; a rename
counts at both its old and new paths. Application jobs test the PR merge result.
Multiple affected modules select the union of their jobs.

| Changed paths | PR application jobs |
|---|---|
| `packages/daynight/` | Linux, macOS and Windows CLI validation, plus shell completion |
| `packages/daynight-server/` | Go server |
| `packages/daynight-web/`, runtime files under `deployment/`, the current Dagre and XYFlow patches | Web |
| Root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` | Every module |
| `docs/`, `.agents/`, `.claude/`, files named `README.md`, `AGENTS.md` or `CLAUDE.md`, or the manual `publish.yml` workflow | No application jobs |
| CI routing/workflow changes and other unclassified paths | Every module |

Every path under `packages/daynight/src/` selects CLI validation, including
runtime Markdown such as the bundled review skill's `SKILL.md` or `README.md`.
Other documentation exclusions apply before module selection. New modules and
unclassified patches select all jobs until their consumers are explicitly assigned.

Selected jobs keep their complete checks, coverage thresholds, acceptance suites,
timeouts and cleanup requirements. The Go job still builds real web assets and
exercises the installed CLI; the web job still builds and exercises the Go
service and production deployment. Selecting one module does not split these
existing integration suites. Native CLI jobs typecheck and build once before
running ordinary and installed tests against the same output. After deployment
fixture checks, the web job uses one acceptance pipeline. Pinned Chromium,
unit/coverage checks, native UI/Go/PostgreSQL preparation and the normal dev-ci
source build can overlap. Only the coverage subprocess uses two Vitest workers,
retaining its `forks` pool and file isolation. Native functional checks and their
browser cleanup precede the container browser checks; full container cleanup
and all preparation/check commands finish before the native capacity phase.
Both Go-consuming jobs restore module and compiler caches keyed by the server
`go.sum`, while the server check expires test results before database/race/
coverage validation. The web pipeline retains the full production build and
unique image identity check. The
[acceptance pipeline decision](.agents/notes/implemented/testing/2026-10-21-web-acceptance-pipeline.md)
owns scheduling and phase evidence; the
[CI efficiency decision](.agents/notes/implemented/testing/2026-10-21-ci-validation-efficiency.md)
retains the other workload optimizations and their limits.

The final `checks` job always runs after routing and application jobs. It accepts
only `success` or `skipped` from every preceding job; failures, cancellations and
other results fail the gate. It uses those job results without comparing module
selection flags. Documentation-only PRs run routing tests and this final gate
without installing application dependencies or running application tests. Every
`main` push retains full application validation, including the exact-commit workflow run required for npm
publication. Package-version enforcement belongs to PR validation. The
[selection decision](.agents/notes/implemented/process/2026-10-21-module-scoped-pr-ci.md)
records the routing alternatives and maintenance costs; the
[CI simplification decision](.agents/notes/implemented/simplification/2026-10-21-ci-gate-simplification.md)
owns version-check timing and the final job-result gate.

To validate the routing rules locally without application dependencies, run:

```bash
node --test .github/scripts/*.test.mts
```

## Validation

Use the development commands above for application changes. `pnpm check` covers
ordinary type/build/test validation; `pnpm acceptance` exercises the installed
package. The suite uses Git 2.48+ for its relative-worktree fixture. Each native CI
job uploads `.tmp/validation-environment.json`, `.tmp/e2e-evidence.json`,
`.tmp/update-evidence.json` and `.tmp/project-task-evidence.json`, recording the
tested source and platform, scenario outcomes and owned-resource cleanup. Shell
completion has a separate `.tmp/completion-evidence.json` receipt. Match each
receipt to its tested revision and execution scope; local or controlled receipts
do not establish a successful current-source hosted run. A failed scenario or
cleanup remains a failure even when other results pass.

The review lifecycle uses controlled GitHub and Copilot processes. Native Copilot
loading probes establish skill activation under their recorded conditions.
Live model reasoning and GitHub publication require separate acceptance with a
designated repository, non-author reviewer identity and authorization. That
acceptance observes reviewed heads, retained session UUIDs, remote inline reviews
and approvals, restart continuity and closure cleanup. Missing-marker recovery
must reconcile confirmed publication while retaining the same session; controlled
publication receipts do not establish live model behavior. The
[installed CLI decision](.agents/notes/implemented/testing/2026-10-17-installed-cli-acceptance.md)
owns the lifecycle rationale; the [bundled-skill decision](.agents/notes/implemented/architecture/2026-10-20-bundled-review-skill.md)
owns native loading evidence.

For document changes, check relative links, requirement references, status, and
note lifecycle sections. For workflow changes, also check skill frontmatter and
discovery links. Run `git diff --check` and inspect newly created files explicitly.
