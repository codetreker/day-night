# Agent Note: Public project and task skill distribution

Status: implemented

## Problem

Agents can already operate Daynight project and task commands, but npm consumers
have no distributed guidance for recovering project context and maintaining tasks
during development. The repository's own workflow skills are not product assets.
The internal review skill is loaded by the review runtime and does not provide a
user installation flow for general-purpose agents.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-agent-skill.md) and
[design](../../../../docs/design/daynight-agent-skill.md) define one portable
`daynight` skill in the npm package and an interactive `daynight skill install`
command. The design is delivered; the public bundle and installer remain planned
implementation work, tracked as dependent tasks in the real Daynight project.

The installer detects Codex, Copilot CLI and Claude Code launchers, asks which
agents to install for, then asks for user or project scope. It replaces the whole
selected `daynight` directory with current packaged bytes on every run. It does
not preserve local edits or introduce an installation registry. Codex and Copilot
share their documented `.agents/skills` destination; Claude uses `.claude/skills`.
Existing parent-directory links are preserved, and physical targets are
deduplicated; strictly nested physical destinations are rejected before writes
to prevent one replacement from deleting another completed installation. Selected
agents can share discovery paths with unselected agents.

The public skill teaches active task management in associated repositories,
including fresh worktrees. It preserves user authority, uses observed task
versions for decisions based on read data, and treats readiness as a dependency
result without claiming ownership. Existing CLI and service contracts remain the
authority for state transitions and uncertain writes.

The [bundled review decision](2026-10-20-bundled-review-skill.md) continues to own
review snapshots and Copilot invocation. Its original narrow runtime scope does
not become a general user installation mechanism. The product skill gets its own
command owner and may share only genuinely common data-level bundle validation.

## Alternatives

**Copy the packaged bundle.** Adopted because the installed skill survives npm
path changes and temporary `npx` cleanup. Explicit reinstall updates it, and
whole-directory replacement removes obsolete references.

**Link directly into the npm installation.** Codex and Claude support linked
skills, but package removal or relocation can break the installed link. Windows
link creation adds environmental requirements. This does not satisfy independent
installed-resource lifetime as predictably as copying.

**Package a plugin for each agent.** Agent plugins are real distribution options,
and review already needs a Copilot plugin wrapper. This one portable skill needs
neither per-host manifests nor plugin registration, so those mechanisms add
installation state and do not resolve cross-root duplicate discovery by
themselves.

**Preserve edited installations.** This would require ownership metadata, edit
detection or merging. The chosen product behavior is unconditional replacement;
the same command installs and refreshes current packaged content.

**Build terminal key handling or use numbered text questions.** Custom raw-mode
handling adds terminal lifecycle code, while text-number parsing does not provide
checkbox selection. A lazy-loaded maintained checkbox/select implementation
fits the requested interaction while retaining existing setup text prompts.

**Add task ownership and other project fields with the skill.** The existing
task model already supports this workflow through dependencies and optimistic
versions. Ownership, comments, priorities and attachments change service
contracts and can be added independently; this design states the current limits
and does not infer exclusive claims from `in_progress`.

## Consequences

Installation is independent of server and review configuration. A small fixed
Agent catalog owns directories and reload guidance, with native acceptance
required for overlapping discovery roots and actual loaded content. A selection
expresses compatibility rather than exclusive visibility to that Agent.

Whole-directory replacement can discard local customization. Without backups,
a filesystem failure after removal can leave a target absent; completed earlier
targets remain installed and the command reports the partial result. Re-running
restores current packaged content. This deliberately avoids cross-target
transactions, rollback, automatic npm-to-skill synchronization and edit merging.

Daynight stores the design task and dependent implementation tasks. Repository
documents own requirements, mechanism and rationale; they do not mirror live task
status. The design exercise proves current task creation and dependency gating,
not native loading of an unimplemented public skill. Implementation readiness
does not itself grant authorization to execute that work.
