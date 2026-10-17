# Day Night

Daynight is a foreground GitHub PR review CLI under development in
`packages/daynight/`. The CLI entry, argument handling, fixed home paths, and
strict YAML configuration loader, durable SQLite state, GitHub observations,
and clone/worktree management are implemented. The review coordinator, periodic
polling, and Copilot execution are pending. These modules are not yet connected
to the CLI.

The [Chinese requirements](docs/spec/daynight.md) define the complete product;
the [architecture](docs/design/daynight.md) describes the selected design. The
current CLI provides help and version output. Review mode validates configuration
and exits with an explicit unavailable-coordinator error until that runtime is
integrated.

## Development

Use Node.js 24 LTS and pnpm 10.34.5. From the repository root:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm daynight --help
pnpm daynight --version
```

`pnpm check` runs type checking and tests. Tests build the package before
exercising the compiled CLI. `pnpm build` emits the executable
`packages/daynight/dist/main.js`; the package's `daynight` bin points there.
The pnpm dependency store is local to `.tmp/pnpm-store`.

GitHub Actions runs type checking, build, and tests on native Linux, macOS, and
Windows runners. The final `checks` job succeeds only when all platform jobs
succeed. macOS tests mount temporary case-sensitive and case-insensitive APFS
images to check path identity against both filesystem behaviors. No live GitHub
or Copilot credentials are required by these checks.
SQLite tests use real disk databases, including reopen, transaction rollback,
locking, and revision/retry transitions on every platform.
GitHub tests use controlled API responses and subprocess fixtures to verify
complete scans, HTTP failures, and atomic observation commits.
Git lifecycle tests use local origin/clone fixtures and real worktrees to check
captured targets and preservation of user files, refs, and unrelated worktrees.

## Configuration and current CLI behavior

The selected review-mode entry is:

```text
daynight --deamon-review
```

For a local build, invoke it with `pnpm daynight --deamon-review`. The CLI reads
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
locks, logs, cache, and temporary files. Future PR worktrees belong to each
monitored repository root's `.worktrees/` directory. `maxConcurrentWorker` is the
configured in-process review concurrency limit. Current review-mode validation
creates no state, clones, worktrees, or GitHub reviews; it reports that the review
coordinator is unavailable in this build.

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
for persistence choices. Opening the module is an internal operation; current
review-mode CLI validation still does not create a database or start monitoring.

## GitHub observations

The GitHub module reads one repository pass through authenticated `gh api` GET
requests. Initialization scans every page and PR state before committing the
permanent cutoff. Later passes track open PRs, including Draft, and confirm
missing tracked PRs individually before recording closure.

Failed pages, malformed responses, and failed closure confirmations preserve
the previous repository observation. A completed pass commits its observations
and success time atomically. Rate-limit failures expose the server's retry
deadline and block later same-host calls in that client; scheduling another pass
belongs to the pending coordinator.
The [observation decision](.agents/notes/implemented/architecture/2026-10-17-github-observation.md)
records pagination and failure handling. The current CLI still performs only
configuration validation.

## Repository clones and worktrees

The Git module creates missing clones and validates existing repository identity.
Prepared GitHub CLI authentication supplies command-scoped HTTPS credentials,
including repositories configured with SSH addresses or API ports. Existing
checkout files, origin configuration, branches, remote-tracking refs, and
FETCH_HEAD remain untouched by review preparation.

Each PR uses its fixed repository-local `.worktrees/pr-<number>/` directory.
Physical root/common-directory checks and a session-labelled Git lock establish
ownership before destructive reuse or removal. New revisions detach and refresh
owned content; confirmation retries retain local context. Unrecognized paths and
linked worktrees are preserved. Cleanup checks remote closure again and retains
the session/history after removing the worktree.

See the [worktree ownership decision](.agents/notes/implemented/architecture/2026-10-17-owned-review-worktrees.md)
for safety and recovery boundaries. The current CLI still does not create clones
or worktrees until coordination is integrated.

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

Use the development commands above for application changes. Add targeted tests
for observable behavior and failure paths. Native-platform and live GitHub/Copilot
acceptance remain separate delivery evidence, as defined by the architecture.

For document changes, check relative links, requirement references, status, and
note lifecycle sections. For workflow changes, also check skill frontmatter and
discovery links. Run `git diff --check` and inspect newly created files explicitly.
