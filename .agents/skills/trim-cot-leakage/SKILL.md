---
name: trim-cot-leakage
description: Audit or revise prose containing session-only references, review choreography, change narration on current-state documents, or planning residue while preserving durable facts and decision history.
---

# Trimming Reasoning-Transcript Leakage

Session leakage speaks from an authoring session: it cites private drafts,
narrates an edit, or argues with a reviewer. Apply the complete-proposition rule
in [prose-standard](../prose-standard/SKILL.md): preserve each factual clause and
its force, then remove the transcript around it.

## The test

Could a reader of the repository, without the session transcript, review thread,
or uncommitted draft, resolve each reference and assess each claim?

If not, restate the surviving facts from the repository's perspective. A passage
with no useful fact can be removed. A resolvable reference clears this test but
still needs to fit its document's purpose: READMEs, current design documents, and
code comments describe the system; decision notes and commit messages may explain
how it changed.

## Recognize the forms

| Form | Treatment |
|---|---|
| Session-only labels such as "audit C2", "decision 7", or an uncommitted "plan section 4" | Link the committed owner or state the fact independently |
| "This change adds", "the previous version", or "this round" on a current-state surface | Describe the existing behavior or mechanism |
| "The reviewer confirmed", "rejected in review", or draft ordinals | Preserve the decision and reason without the review choreography |
| "This is safe because it simply" or "note that this is correct" | State the invariant that makes it safe, if it is not already clear |
| Obvious control-flow walkthroughs or branch proofs | Remove the narration; retain non-obvious ordering or ownership rules |
| "Probably enough", "for now", or untracked future promises | State the actual limit or retain a precise, authorized follow-up |
| A whole clause in a language inconsistent with its document | Follow the repository language convention; technical terms may remain as terms |

A current defect explanation can use a present-tense counterfactual: "Without
the version check, two concurrent commits both succeed." Deferred decisions belong
in an authorized proposal or other established tracking mechanism. Do not turn
proposed behavior into a shipped fact or create follow-up artifacts without scope.

## Preserve durable context

These are not session leakage:

- Useful issue and PR references, citations between committed documents, and
  external standards with resolvable references.
- Source permalinks and evidence provenance, including the method and conditions
  behind a measured number.
- Runtime transitions such as "the previous connection drains before the new
  connection accepts work".
- A decision note's historical circumstances, real alternatives, and reasons for
  a choice. Preserve them even when a later decision differs.
- "We" as the authors of the system.

Section references to committed documents are durable when their targets resolve;
they are not equivalent to labels from a private draft. A historical citation
does not make an archived document authority for current behavior.

## Audit and revise

Use the task's confirmed scope and permissions. Audit read-only first, searching
with `rg --hidden` so `.agents/` is included. Pattern hits are probes, not findings:
read each in context and inspect dense prose that searches miss. Useful probes
include `audit [A-Z][0-9]`, `decision [0-9]`, `this round`, `used to`, `reviewer`,
`probably`, and `first we`.

Before changing a passage, identify its propositions and document purpose.
Preserve obligations and prohibitions, conditions, timing, exceptions, genuine
history, and measurement provenance. Rewrite the affected document coherently
within authorized edits; archives stay immutable. Report material changes and
remaining decisions without presenting a reasoning transcript.
