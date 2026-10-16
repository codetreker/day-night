# Day Night

This repository currently contains its agent workflow. Product requirements,
application code, a technology stack, and build or test commands have not been
established.

## Working in the repository

Read [AGENTS.md](AGENTS.md) for task scope, worktree ownership, validation, and
delivery rules. The four repository skills cover decision notes, scope choices,
prose quality, and removal of authoring-session narration.

[Agent Notes](.agents/notes/README.md) preserve decisions, alternatives, and
consequences. The [workflow decision](.agents/notes/implemented/process/2026-10-16-agent-workflow.md)
records the adaptation and its costs.

`.agents/skills/` owns the skills. `CLAUDE.md`, `.claude/skills`, and
`.claude/worktrees` are relative links to the shared instructions, skills, and
worktree directory.

## Documentation conventions

Create documents when an authorized task needs them. These locations describe
ownership; they do not require empty directories or placeholder documents.

| Location | Responsibility |
|---|---|
| `README.md` | Repository purpose, supported usage, prerequisites, and documentation entry points |
| `docs/spec/` | Product requirements and observable guarantees |
| `docs/design/` | Structure, component responsibilities, mechanisms, and the rationale needed to understand them |
| `docs/research/` | Investigations, evidence, sources, and conditions of observation |
| `.agents/notes/` | Durable decisions, real alternatives, consequences, and reconsideration conditions |
| `docs/plans/` | Local execution plans, ignored by Git |

Confirmed task scope and existing requirements guide the work. Keep current
descriptions synchronized with their implementation; identify proposals as
proposals. Only explicit historical archives are frozen. Write repository
documents in English and discuss work with the user in Chinese.

## Validation

For workflow changes, check skill frontmatter, relative document links, note
paths and lifecycle sections, and the discovery links. Run `git diff --check`
and inspect newly created files as well as tracked changes.

When application tooling is introduced, document its actual build, test, and
coverage commands here and keep the validation instructions in AGENTS.md
aligned with them.
