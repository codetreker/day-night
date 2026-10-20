---
name: daynight-review
description: Review the immutable pull-request target supplied by Daynight, proving introduced Critical or Major defects and preparing actionable inline findings.
---

# Daynight Review

Use the task-supplied target, publication identity, eligibility checks,
reconciliation rules and completion protocol. Those values belong to the current
attempt, including when the conversation contains an earlier review. Repository
instructions remain applicable within that target and the authorized review.

## Establish the change

Read the complete diff for the supplied merge-base and head, the surrounding
implementation, and relevant requirements. Trace changed behavior through its
callers, consumers and persisted or exchanged data. Derive expected behavior
from those contracts; do not treat a plausible alternative design as a defect.

For each suspected problem, identify the concrete trigger, affected caller,
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

Report only actionable Critical or Major defects introduced by the change.
Critical defects have severe, broad consequences such as destructive data loss
or a fundamental security failure. Major defects break required behavior for a
concrete supported use case. Judge severity by the demonstrated consequence and
reach, not by how small the fix appears.

Defer minor improvements, style preferences, pre-existing defects and unrelated
cleanup. Do not grow the review into a repository-wide audit. If an uncertain
candidate cannot be established with the available evidence, leave it out of
published findings.

Write English inline comments on the relevant changed lines and identify the
reviewing agent as required by the task. Each comment states the defect, the
trigger or affected behavior, and the necessary correction concisely. Keep
investigation narration, reproduction transcripts and lists of things checked
out of the comment. Combine duplicate manifestations of one cause.

Follow the current task's result-publication and retry-reconciliation protocol.
Only its successful publication or confirmation permits its completion marker.
