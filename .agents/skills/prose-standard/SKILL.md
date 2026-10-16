---
name: prose-standard
description: Write or review repository documents, comments, commit messages, and diagnostics while preserving complete contracts, essential rationale, and document ownership.
---

# Prose Standard

Preserve what a reader needs to understand and use the system: obligations,
invariants, conditions, failures, ownership, and the reasons behind non-obvious
choices. Remove repetition and authoring-session narration. Use
[trim-cot-leakage](../trim-cot-leakage/SKILL.md) for the latter in detail.

## Preserve the complete proposition

Before editing a passage, identify its actor, action, conditions, timing,
ordering, modality, negative guarantees, exceptions, side effects, failure modes,
and consequences. A rewrite is an improvement only when relevant facts survive
and the result is clearer. Word count alone is not a quality measure.

Keep the complete local contract where it is used. Link to the owning document
for extended explanations, architecture, algorithms, history, and examples. One
explanation has one home; essential local contract facts may repeat.

Keep non-obvious rationale when removing it could cause misuse or an incorrect
simplification. Add missing prose when code, types, and structure cannot express
a required contract. Do not add comments for facts already clear locally.

## Match the document's purpose

The [repository README](../../../README.md) owns documentation conventions; the
paths below describe documents when present, not required scaffolding.

| Surface | Required coverage |
|---|---|
| `docs/spec/` | Required behavior, its consumers and purpose, guarantees, refusals, and externally visible outcomes |
| `docs/design/` | Current structure, responsibilities, data flow, boundary contracts, essential why and how, and structural costs |
| `.agents/notes/` | Decisions, real alternatives, unique rationale, consequences, named gaps, and conditions for reconsideration |
| `docs/research/` | Evidence, methods needed to assess it, resolvable citations, and conclusions kept current while active |
| Exported identifiers | Caller-visible results, errors, side effects, ownership, timing, cancellation, and persistence promises |
| Internal comments | Non-local invariants, ordering hazards, ownership, security rules, and surprising failures |
| Module or package documentation | Role, dependencies, responsibilities, and non-obvious structural choices |
| Tests | Non-obvious fixture choices, indirect observations, or platform accommodations |
| Diagnostics | Failing subject, violated rule, and a correction when it is not obvious |

Design documents need enough rationale and mechanism to explain their structure;
the detailed history of choosing among alternatives belongs in decision notes.
Keep active research accurate. Only explicitly archived documents are frozen.

## Use precise terms and durable comments

Words such as "contract", "boundary", "shape", "surface", and "invariant" are
useful when they name the exact technical subject. Otherwise state the operation,
rule, field, failure, timing, or component relationship directly.

Comments speak as the system's authors, using "we" or passive voice. They explain
non-obvious contracts and decisions, without mentioning agents, sessions, or
review choreography. Cite committed documents or durable external references;
do not cite uncommitted drafts. Use source permalinks for GitHub code references.

## Review within the authorized scope

Use the scope established by the task and conversation; do not infer a repository
audit from a local request. Read governing instructions and the relevant document
owners when present, then inspect the whole requested scope semantically.

Classify candidates as keep, add, trim, restore, restructure, or defer. Apply
edits only when authorized. Fix the owning explanation before its derivatives,
and check analogous passages affected by the same rule. Rewrite affected
documents coherently without appended corrections. Preserve immutable archives.

Report the inspected scope, material changes, and unresolved or deferred choices.
For a genuinely borderline case, offer two or three viable versions, recommend
one, and explain the factual or structural difference. Do not weaken a fact to
manufacture options or edits to meet a deletion target.
