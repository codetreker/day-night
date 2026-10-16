---
name: agent-notes
description: Create, revise, move, or prune decision notes under .agents/notes while preserving rationale, genuine alternatives, and lifecycle history.
---

# Working with Agent Notes

Read the [notes README](../../notes/README.md) first; it owns paths, format,
lifecycle, and the distinction between current facts and decision history. This
skill guides the decisions around those rules within the task's authorized scope.

## Find the owning decision

Every new note requires a supersession check. Search existing notes for the
decision or mechanism, including hidden paths:

```bash
rg --hidden -n '<mechanism>' .agents/notes/
```

- If an existing note owns the same decision, update it.
- If the decision replaces an earlier one, create a new note. Cross-link active
  notes; for an archived predecessor, link to it from the new note without
  editing the archive. Preserve why the earlier position was reasonable.
- If it partially supersedes a decision, keep both and apply the same link rule.
  Update current facts only in active notes. Archives remain immutable.

## Record the decision

Follow the README's skeleton. `## Problem` must stand independently of the
solution. A reader should be able to agree with the problem while rejecting the
proposal.

`## Alternatives` records what was genuinely considered and why it lost. Use a
bold-led paragraph per alternative and concrete costs or failures. If none was
considered, say so; do not manufacture a comparison. For an option still open,
state what would decide it.

Current authorized work goes directly into `implemented/` and describes the
delivered result. Deferred work belongs in `proposed/`. A read-only investigation
does not authorize writing either kind of note.

## Maintain the record

Moving a file also requires the destination's status and structure. Implementing
a proposal replaces intended behavior with shipped behavior and folds actual
outcomes into Consequences. Rejecting one adds the reason to Status and retains
the proposal body. Archiving an implemented note retains its implemented status
and freezes it permanently.

Update active current facts with implementation changes. Preserve the historical
premises, comparisons, and trade-offs of a decision. Rewrite affected sections
coherently; do not append correction logs. A reversal needs a new decision note.

Prune a rejected note only when its rationale no longer prevents a meaningful
mistake. Delete an implemented note only when its fully superseding owner has
absorbed every unique rationale, alternative, consequence, and named gap. Repair
active inbound links; historical links inside archives are exempt.

## Check the result

Inspect notes recursively because lifecycle and class both appear in the path:

```bash
rg --hidden -n '^Status: |^## (Problem|Proposal|Decision|Alternatives|Acceptance Criteria|Risks|Consequences)$' .agents/notes/
```

Check each edited note against its lifecycle skeleton and resolve its relative
links. When moving or deleting a note, search for its former filename throughout
active documentation. Exclude archives from edits and current-path repair.
