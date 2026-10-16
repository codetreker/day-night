# Day Night

Daynight is a foreground GitHub PR review CLI under development in
`packages/daynight/`. The CLI entry, argument handling, fixed home paths, and
strict YAML configuration loader are implemented. The review coordinator,
SQLite scheduling, repository management, and Copilot execution are pending.

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
succeed. No live GitHub or Copilot credentials are required by these checks.

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
Duplicate repository identities, duplicate local paths, and paths overlapping
the retained state directory are rejected.

The selected retained-state location is `~/.daynight/` for SQLite, sessions,
locks, logs, cache, and temporary files. Future PR worktrees belong to each
monitored repository root's `.worktrees/` directory. `maxConcurrentWorker` is the
configured in-process review concurrency limit. Current review-mode validation
creates no state, clones, worktrees, or GitHub reviews; it reports that the review
coordinator is unavailable in this build.

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
