# Agent Instructions

Instructions for agents working in this repository. Read applicable nested
`AGENTS.md` files before editing their directories. Explicit session instructions
take precedence.

## Scope and communication

- Discuss work with the user in Chinese. Write documents, skills, code,
  comments, and commit messages in English.
- Use the user's confirmed task and existing requirements to establish scope.
  A request to investigate or discuss remains read-only unless edits are
  authorized. Skills describe workflows and grant no additional permission.
- Complete authorized work and its verification. Report observed results and
  material limitations; keep unverified assumptions distinct from evidence.
- Mainline pushes and PR merges require explicit user authorization. Follow the
  session's authorization for commits, branch pushes, and external comments.

## Repository and document ownership

The [README](README.md) owns repository status, documentation conventions, and
available validation commands. There is currently no application runtime or
configured build, test, coverage, or CI command. Select technology and add
tooling only as part of an authorized task.

| Location | Owner |
|---|---|
| `.agents/skills/` | Repository workflow skills |
| `.agents/notes/` | Decision history, alternatives, and consequences |
| `.agents/notes/README.md` | Note paths, format, lifecycle, and retention |

Requirements describe required outcomes. Design documents explain mechanisms
and the rationale needed to understand them. Notes hold detailed alternatives
and decision history; local plans hold execution steps. Create these documents
when needed and link to their owners without duplicating explanations.

Rewrite edited documents as coherent wholes and synchronize related active
documents in the same change. Preserve historical statements about a decision's
original circumstances. Explicit archives remain immutable.

## Worktrees and collaboration

- Perform code, configuration, and documentation changes in one dedicated
  worktree under the repository's `.worktrees/` directory. Keep the primary
  checkout clean. One task shares one worktree and branch across its agents.
- Inspect existing work before changing files; preserve unrelated modifications.
  Define file ownership for workers and coordinate concurrent edits. Install
  dependencies once per task.
- Use research subagents for investigations and an independent subagent for
  code review. Delegate context-heavy implementation and validation with the
  task scope, permitted worktree, and required evidence.
- Use the task worktree's `.tmp/` for probes, clones, and generated evidence.
  Local execution plans belong in `docs/plans/`. Keep task files inside the
  project and remove task-owned temporary resources after verification.
- Clean up task-owned services and probes, including resources left by failed
  subagents. Retain an unfinished worktree until its changes are delivered;
  remove it after authorized integration into the mainline.

## Decision workflow

A nontrivial change alters behavior, architecture, a shared contract, tooling,
verification strategy, a stored or exchanged format, or a decision worth
reconsidering. Purely mechanical or local changes are exempt from note creation.

1. Inspect existing mechanisms and relevant documents before choosing a design.
   Reassess the structure when repeated edge cases expose the same weakness.
2. For scope choices, use [scope-cut](.agents/skills/scope-cut/SKILL.md) to record
   deferral costs and constraints while preserving the confirmed delivery goal.
3. Use [agent-notes](.agents/skills/agent-notes/SKILL.md) to find an existing
   decision owner. Deliver nontrivial work with its implemented note, affected
   documents, and appropriate validation in the same change. Work being delivered
   goes directly into `implemented/`; substantive deferred work uses `proposed/`.
4. Preserve the original rationale when a decision changes. Write a new note
   and cross-link active records. Link from the replacement to an archived
   predecessor without editing that archive. Keep active statements of current
   facts synchronized with the implementation.

The [notes instructions](.agents/notes/AGENTS.md) govern that directory. Read-only
investigations stay read-only unless recording a proposal is authorized.

## Writing and review

- Use [prose-standard](.agents/skills/prose-standard/SKILL.md) to preserve
  obligations, conditions, ownership, failures, and essential rationale.
- Use [trim-cot-leakage](.agents/skills/trim-cot-leakage/SKILL.md) to remove
  session-only references and authoring narration while preserving durable facts.
- Comments explain non-obvious decisions and invariants in the system author's
  voice. Cite durable references, using commit-pinned links for GitHub sources.
- Review within the declared task or PR scope. Prove that Critical or Major
  findings are introduced by the change and show their caller-visible effect.
  Defer smaller or unrelated improvements. When publishing PR findings, identify
  the agent and place English comments on the relevant changed lines.
- Keep fixes within the original delivery goal. A PR's review cycle must not
  accumulate unrelated cleanup.

## Validation and delivery

Choose checks from the actual files and tooling involved. For skill and document
changes, validate frontmatter, local links, lifecycle/path agreement, mandatory
note sections, and skill discovery. Check newly created files as well as
`git diff --check`; Git does not include untracked files in an ordinary diff.

For code changes, verify observable behavior and relevant failure paths using
the repository's documented commands. Preserve acceptance criteria and expose
errors. Run meaningful coverage checks when coverage tooling exists; a green
check alone does not prove backend, lifecycle, concurrency, or browser behavior.

Diagnose a failing check before retrying. Repeat an unchanged failure only after
confirming a transient infrastructure cause. Add time bounds to commands that
may hang and keep output streaming. Summarize actual checks and their limits.

Preserve task scope when staging and committing; use the repository's commit
conventions and default Git identity. Omit AI tool co-author attribution. Keep
work-branch history and integrate mainline updates by merge when needed. For an
authorized PR merge, require real successful checks and a linear mainline.

## Discovery

`.agents/skills/` is canonical. `CLAUDE.md` links to this file;
`.claude/skills` and `.claude/worktrees` link to the shared skill and worktree
directories. Keep these relative links intact so tools use the same workflow.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
