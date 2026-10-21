---
name: daynight-review
description: Enforce a clear, focused pull-request scope and verify introduced Critical or Major defects.
---

# Daynight Review

Use the task-supplied target, publication identity, eligibility checks,
reconciliation rules and completion protocol. Those values belong to the current
attempt, including when the conversation contains an earlier review. Repository
instructions remain applicable within that target and the authorized review.

## Reconcile interrupted publication

Before reviewing or publishing, inspect existing reviews and native review
threads for the supplied stable identity, target commit and captured publishing
actor. Before any publication or draft deletion, require the authenticated GitHub
viewer node ID to match that captured actor; an account change cannot transfer
the round to another publisher. Confirm an existing matching APPROVED review without reviewing
later title or description changes, revoking approval or publishing again. A
matching COMMENTED review is complete only when it owns at least one real
resolvable native review thread. Its open threads do not block confirmation of
that same result. Revalidate the unsent findings of a matching PENDING review and
reuse its existing threads when still justified. For an obsolete or unjustified
owned draft, re-read that exact numeric review ID and verify its author, exact
stable identity, commit and PENDING state immediately before deleting only that
draft. Never delete submitted reviews or submit an obsolete target's findings.
Do not duplicate reviews, comments or replies on retry.

When no valid matching result exists, conduct a fresh review. The task admits
fresh rounds after CI passes and all submitted native review conversations are
resolved. Positively identified PENDING drafts are not submitted conversations.
Resolution is a request to verify the correction, not evidence that it is fixed.
Use the current title and description even when the commit has not changed.

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

## Select and publish the result

Report PR-quality blockers and actionable Critical or Major defects introduced
by the change. Critical defects have severe, broad consequences such as
destructive data loss or a fundamental security failure. Major defects break
required behavior for a concrete supported use case. Judge severity by the
demonstrated consequence and reach, not by how small the fix appears.

Defer minor improvement requests, style preferences and pre-existing defects.
Do not grow the review into a repository-wide audit. If an uncertain code-defect
candidate cannot be established with the available evidence, leave it out of
published findings.

A successful review has one of two results:

- APPROVE when both PR-quality gates pass and no Critical or Major defect remains.
- COMMENT owning at least one real resolvable native review thread when a blocker
  remains. Never submit REQUEST_CHANGES. A top-level review body alone cannot
  satisfy this result.

Write English comments and identify the reviewing agent as required by the task.
Put localized out-of-scope changes and code defects on the relevant changed
lines. Put description or PR-wide scope blockers in a native file-level thread
on the principal changed file using a file subject without a fabricated line.
Explicitly label such a comment as a PR-wide description/scope issue; the file is
its discussion anchor, not an allegation of a code defect. If no truthful changed
file anchor exists or a required thread cannot be published, report the actual
operational failure and withhold the completion marker.

State the violated scope or behavior, its concrete effect, and the necessary
correction concisely. Keep investigation narration, reproduction transcripts and
lists of things checked out of comments. Combine duplicate manifestations of one
cause.

Immediately before fresh publication, re-read the current title and description,
evaluate the gates again, and check the task's target and conversation eligibility.
For a file-level blocker, create a pending review by POSTing its target commit
and stable body without an event. Use GraphQL addPullRequestReviewThread with
that review's node ID, the changed path, subjectType FILE and the finding body;
omit line and side. Submit that review with COMMENT only after its thread exists.
The batch create-review comments payload does not support file subjects. Follow
the task's stable identity format and resume partial publication on retry.
Verify the actual review event, commit, reviewing actor and identity; for COMMENT,
verify the review owns its native thread. Follow the supplied retry protocol.
Only successful publication or valid reconciliation permits the completion marker.
