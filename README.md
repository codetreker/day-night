# Day Night

Daynight is a planned foreground CLI for automatic GitHub PR review. It stays
running, polls configured repositories, manages per-PR worktrees, and starts
Copilot CLI child processes with a persistent session for each PR. The agent
publishes its own inline comments or approval and emits a plain-text completion
marker.

The repository contains [product requirements](docs/spec/daynight.md) and a
[proposed architecture](docs/design/daynight.md). Code belongs in
`packages/daynight/`. Application code, package manifests, build, tests, and CI
are not implemented yet. Linux, macOS, and Windows are required platforms.

## Planned usage

```text
daynight --deamon-review
```

The CLI reads YAML configuration from `~/.daynight/config.yml` and keeps its
SQLite database, sessions, lock, logs, cache, temporary files, and PR worktrees
under `~/.daynight/`. The home directory is resolved for the current OS user;
repository clone paths come from configuration, with relative paths resolved
against the configuration directory. This entry point is specified but not yet
implemented.

## Working in the repository

Read [AGENTS.md](AGENTS.md) for task scope, shared task worktrees, collaboration,
verification, and delivery rules. Use Beads for task tracking and the
[repository skills](.agents/skills/) for decision notes, scope choices, and prose
quality.

[Agent Notes](.agents/notes/README.md) preserve decisions, alternatives, and
consequences. The [workflow decision](.agents/notes/implemented/process/2026-10-16-agent-workflow.md)
records workflow rationale. The [CLI decision](.agents/notes/implemented/architecture/2026-10-16-foreground-review-cli.md)
records the application execution model.

`.agents/skills/` is canonical. `CLAUDE.md`, `.claude/skills`, and
`.claude/worktrees` remain relative links to shared instructions, skills, and
worktrees.

## Documentation conventions

| Location | Responsibility |
|---|---|
| `README.md` | Repository purpose, implementation status, prerequisites, and documentation entry points |
| `docs/spec/` | Required product behavior and observable guarantees |
| `docs/design/` | Proposed or implemented structure, mechanisms, and essential rationale, with explicit status |
| `docs/research/` | Investigations, evidence, sources, and observation conditions |
| `.agents/notes/` | Decisions, real alternatives, consequences, and reconsideration conditions |
| `docs/plans/` | Local execution plans, ignored by Git |

Create documents for authorized work. Keep active facts synchronized, distinguish
proposals from implementation, and preserve historical decision premises.
Explicit archives remain immutable. Write new or revised specifications in
`docs/spec/` and design documents in `docs/design/` in Chinese, including headings
and explanatory prose. Preserve the required spelling of code, commands,
identifiers, paths, and API names. Other repository documents, skills, code,
comments, and commit messages use English unless explicitly instructed otherwise.
Discuss work with the user in Chinese.

## Validation

There are no application validation commands yet. Add actual pnpm typecheck,
test, and build commands when application tooling is implemented.

For document changes, validate relative links, requirement references, stated
implementation status, and note lifecycle sections. For workflow changes, also
check skill frontmatter and discovery links. Run `git diff --check` and inspect
new files explicitly because ordinary diffs omit untracked files. Runtime and
live GitHub/Copilot acceptance belong to implementation verification.
