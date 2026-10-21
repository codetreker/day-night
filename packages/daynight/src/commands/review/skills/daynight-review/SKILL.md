---
name: daynight-review
description: Enforce a clear, focused pull-request scope and verify introduced Critical or Major defects.
---

# Daynight Review

Use the task-supplied target, publication identity, eligibility checks,
reconciliation rules and completion protocol. Those values belong to the current
attempt, including when the conversation contains an earlier review. Repository
instructions remain applicable within that target and the authorized review.

## Establish and gate the scope

Use gh with the supplied host, repository and PR number to read the current PR
title and description, plus relevant linked requirements that establish its
scope. Use available evidence of the original delivery goal; do not claim access
to unavailable discussion or description history.

Apply both PR-quality gates to the complete diff between the supplied merge-base
and head:

- The description clearly explains one concrete problem, intended outcome and
  scope. Multiple independent objectives or a change too broad to review as one
  focused delivery require splitting, even under a common umbrella title.
- Every change serves that original delivery goal. Implementation,
  structural changes, tests and documentation serving the same outcome belong
  together. Independent features, unrelated fixes and incidental cleanup must
  be removed or delivered separately. Broadening the description alone cannot
  legitimize unrelated changes.

Judge purpose, dependencies and reviewability, without arbitrary line or file
limits. Each failed gate is an approval blocker in its own right, without a
runtime failure or a Critical/Major severity label. An unclear description that
prevents establishing scope also blocks approval; request the missing scope.

Read the surrounding implementation and trace changed behavior through callers,
consumers and persisted or exchanged data. Derive expected behavior from relevant
contracts; do not treat a plausible alternative design as a defect.

For each suspected code defect, identify the concrete trigger, affected caller,
observable failure and changed line that introduces it. Compare the original
behavior when needed to distinguish an introduced defect from an existing one.
Include adjacent code only when its interaction with this change causes the
failure.

## Verify consequential defects

Prioritize data loss, incorrect results, broken authorization, unavailable
operations, and lifecycle or concurrency failures that materially affect the
delivered behavior. Examine relevant failure paths and resource ownership, not
only the successful path.

Challenge each candidate independently: follow its callers, inspect the actual
dependency contract, or run a bounded probe that demonstrates its consequence.
Choose verification that distinguishes the suspected failure from correct
behavior. A passing test suite does not by itself settle lifecycle, concurrency,
filesystem, migration or remote-publication behavior. Preserve errors and state
the limits of evidence; discard findings that remain speculative.

Keep probes within the supplied worktree and temporary directory, preserve the
captured target, and obey the task's foreground-process and cleanup rules.

## Select and publish findings

Report PR-quality blockers and actionable Critical or Major defects introduced
by the change.
Critical defects have severe, broad consequences such as destructive data loss
or a fundamental security failure. Major defects break required behavior for a
concrete supported use case. Judge severity by the demonstrated consequence and
reach, not by how small the fix appears.

Defer minor improvement requests, style preferences and pre-existing defects.
Do not grow the review into a repository-wide audit. If an uncertain code-defect
candidate cannot be established with the available evidence, leave it out of
published findings.

Write English comments and identify the reviewing agent as required by the task.
Put out-of-scope changes and code defects on the relevant changed lines. Put
description or PR-wide blockers in the review body when no suitable changed line
exists; a COMMENT review may contain only a body. State the violated scope or
behavior, its concrete effect, and the necessary correction concisely. Keep
investigation narration, reproduction transcripts and lists of things checked
out of comments. Combine duplicate manifestations of one cause.

Approve only when both PR-quality gates pass and no Critical or Major defect
remains. Before publication or retry confirmation, re-read the current title and
description and evaluate the gates again. A matching stable identity on an old
APPROVE does not establish that the current description and scope pass.

Follow the current task's result-publication and retry-reconciliation protocol.
Only its successful publication or confirmation permits its completion marker.
