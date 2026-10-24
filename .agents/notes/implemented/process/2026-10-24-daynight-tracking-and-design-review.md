# Agent Note: Require Daynight tracking and design review

Status: implemented

## Problem

Large work loses durable scope and dependency context when tracked only in a
conversation. Solution, architecture, and design discussions also need readable
current material before a user can review them. A repository or PR link alone
does not place that material with its owning task. Requiring separate creation
permission after an explicit instruction to use Daynight leaves required tracking
dependent on a redundant authorization request. Editing an installed skill copy
also separates the effective instructions from their versioned source.

## Decision

The repository instructions and public skill require Daynight for large work when
the skill and Daynight are available. Every solution, architecture, and design
review uses its owning task, including small discussions. Before requesting user
review, the complete current material is saved in its description or attachments,
read back, and identified by task and resource reference. Revisions and review
decisions stay synchronized there. Short review proposals may use the description;
detailed task plans retain their primary Markdown owner.

An explicit user or applicable repository tracking/review instruction supplies
standing creation permission for necessary tasks within the user's confirmed
scope. Existing suitable tasks are reused. This partially supersedes the
[mode decision](../architecture/2026-10-21-using-daynight-modes.md)'s creation
permission rule while preserving its rationale and separate approval, execution,
autopilot and delivery gates. Availability is established through the actual CLI,
configured service and intended project; failed writes retain their actual cause
and do not establish readable review material.

Skill updates belong in their owning source repository. The repository instructions
prohibit modifying globally installed skill copies. The
[skill requirements](../../../../docs/spec/daynight-agent-skill.md) and
[design](../../../../docs/design/daynight-agent-skill.md) own the public workflow;
the [Goal protocol](../../../../docs/design/daynight-goal-workflow.md) retains
stage and shared-artifact ownership.

## Alternatives

**Require a separate creation request after mandated tracking or review.** This
preserves an explicit prompt per registration but stalls a workflow the user has
already required. Scoped standing permission preserves backlog control without
repeated confirmation.

**Leave review material in chat or behind repository and PR links.** This avoids
an upload but leaves the task without the actual current material the user must
review. Supplementary links remain useful after the content is saved and verified.

**Edit the installed skill alongside its source.** This immediately changes one
environment but bypasses source delivery and can mix instructions from different
package versions. Source-only updates keep the requested rule versioned.

## Consequences

Review handoff includes a confirmed task write even for small design discussions.
Task creation, attachment upload and metadata updates remain independent writes
with their existing version and reconciliation rules. Missing service access or
failed uploads remain visible blockers to that handoff. No service resource,
review command, lifecycle transition, or automatic execution permission is added.
Skill and document checks establish instruction integrity; they do not prove
that every model follows the workflow.
