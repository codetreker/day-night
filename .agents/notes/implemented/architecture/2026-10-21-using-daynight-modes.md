# Agent Note: One public skill with explicit task modes

Status: implemented

## Problem

A task-management skill combines reference material, work registration, execution
and continuous scheduling. Loading it for a command question can therefore be
mistaken for authorization to start tasks or continue through a backlog. Keeping
plans, acceptance and progress together in task descriptions also makes stable
requirements harder to distinguish from the current execution position.

## Decision

The public bundle is named `using-daynight`. Its entrypoint routes from the actual
request and context to handbook, create-task, run-task or autopilot, with one
reference document per mode. A bare invocation uses context; insufficient or
ambiguous context prompts for intent. Autopilot requires an explicit user request
for continuous execution. Mentioning automation, loading the skill or finishing
a task does not activate it. The handbook provides a command-purpose index and
operational context such as repository discovery, read scope, observed-version
updates and attachment independence. Installed CLI help owns argument and option
usage; the handbook does not duplicate invocation examples or decoding code.

This partially replaces the
[original public distribution decision](2026-10-21-public-agent-skill-design.md):
portable packaged files, the interactive Agent/scope flow and complete replacement
remain, while the public name and workflow ownership change. The
[bounded-selection decision](../feature/2026-10-21-bounded-ready-task-selection.md)
continues to own query cost and candidate semantics; autopilot owns next-work
selection, and run-task owns one task's delivery.

Every task creation requires explicit user permission to create tasks. A direct
creation request or existing explicit permission applies within its stated scope
without repeated confirmation. Implementation requests, inferred routing,
tracking needs and autopilot activation do not imply this permission. Missing
creation permission requires asking before creating a task, including during
autopilot. This keeps the persistent backlog under the user's control.

Create-task checks creation permission, skips one-off and trivial work, matches
existing problem/scope and attached acceptance, and prepares artifacts before
creating a durable task.
The description contains the problem and real attachment references. One primary
Markdown attachment owns solution and acceptance sections in the task's language.
Frontend tasks also include an interactive mock UI matching the intended final
visuals and representative states, with its necessary assets. Dependencies remain
in dependsOn; PR URLs and titles remain in properties.pullRequests. Verification
results and merge references belong with the attachment's acceptance items.
Execution position, blockers and next steps use an existing session or project
checkpoint. No new task state or ownership mechanism is introduced.

Registration is complete only after necessary attachments and associations are
read back. Partial creation retains the same task ID; uncertain writes are
reconciled before retrying. Run-task reads the plan and applicable mock UI,
executes only its designated task and returns after completion or an external
blocker. Development and PR-delivered documentation require all necessary PRs
platform-confirmed merged plus satisfied acceptance before done. User instructions
to retain a PR keep the task in progress and return it for review; completion
rules grant no merge authority.

Autopilot restores the checkpoint's current task, otherwise picks exactly one
ready todo most related to the authorized goal. In-progress inventory does not
establish ownership, and a bounded ready page does not establish complete backlog
state. Delivery waits and subagents remain on the current task. Only confirmed
done permits the next selection; external blockers retain the current task and
return control rather than switching to unrelated work.

The installer publishes the complete using-daynight bundle before removing the
legacy daynight leaf in the same selected physical skill root. Other scopes,
other roots and unrelated skills remain unchanged. Parent aliases are preserved;
leaf links are replaced or removed without following them. Planning rejects
installation or legacy-cleanup paths that could delete another selected target.
Legacy cleanup failure preserves the new bundle and reports partial migration
with a nonzero result. Successful destinations and unattempted targets remain
explicit. Existing replacement, cancellation and native terminal guarantees hold.

The [requirements](../../../../docs/spec/daynight-agent-skill.md) and
[design](../../../../docs/design/daynight-agent-skill.md) own the full current
contract. This work consumes the adopted attachment capability; it does not add
attachment APIs, storage or commands.

## Alternatives

**Three public skills for usage, autopilot and execution.** This separates
triggers, but creates several discoverable entrypoints and duplicates common
rules or requires cross-skill installation. A single bundle with internal modes
keeps installation, versioning and command reference ownership together.

**Keep one undifferentiated task-management flow.** This preserves the old name,
but does not distinguish a handbook request, registration, one-task execution
and a continuous queue. Explicit mode boundaries make starting and continuing
work depend on the actual user request.

**Default bare invocation to handbook.** This is predictable but discards clear
context such as a previously designated task or a current creation request.
Context-based routing preserves that intent; ambiguity is resolved with the user,
and autopilot still has its explicit-request gate.

**Put solution, acceptance and progress in the description.** This was convenient
before attachment-backed planning was available, but keeps unrelated lifetimes in
one field and encourages repeated copies. Problem text, attached requirements,
structured dependencies and execution checkpoints each have one owner.

**Delete the legacy entry before publishing the new bundle.** This reduces the
period with two names but can remove working guidance before replacement succeeds.
Publishing first preserves the new bundle even if legacy cleanup fails, at the
cost of an explicit partial-migration error and a possible temporary duplicate.

## Consequences

One installed directory contains the complete protocol and four mode references.
Command usage stays with the installed CLI, and the compact handbook explains
the operational facts needed to choose and combine commands. Task execution and
repeated selection share one completion gate. Explicit autopilot entry prevents ordinary skill use
from silently becoming a continuous work queue. Explicit task creation permission
prevents autonomous execution from expanding the persistent backlog; missing
permission requires user input before registration. Task attachments become required
inputs to execution; create-task must reconcile partial registration and cannot
claim readiness from an existing task ID alone.

The instructions constrain agents but do not add a server lock or guarantee model
compliance. Static bundle checks and independent scenario review cover content;
packed native installer tests prove files and interactions. These remain separate
claims, as required by the
[installation acceptance decision](../testing/2026-10-21-simulated-agent-installation-acceptance.md).
Other-scope legacy copies may remain discoverable under host precedence and need
scope-appropriate installation. Automatic global migration, cross-target rollback
and live model acceptance are not implied by a successful installation.
