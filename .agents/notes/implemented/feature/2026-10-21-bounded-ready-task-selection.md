# Agent Note: Bounded ready task selection

Status: implemented

## Problem

Routine work selection needs a small number of actionable candidates. The
existing task list reads every page, so its response grows with the backlog even
when the caller only needs the next task. Graph-first skill recovery also loads
unrelated completed work and reaches the graph's node/edge limit as projects grow.

## Decision

`daynight task ready [--limit <N>] [--json] [--project <id>]` returns at most N
ready tasks, defaulting to 10 with a decimal integer range of 1–100. It uses one
existing task-list request with `ready=true&limit=N`, validates its complete page,
and does not follow the cursor. The service filters before limiting and sorts
by `createdAt`, then ID ascending. Readiness remains todo with all direct
prerequisites done; creation order is not a priority model or an ownership claim.

The command owns input validation before service setup or repository discovery.
The API client owns the single-page read, full task validation, exact int64
versions and refusal of duplicates, wrong-ready results and excess item counts.
JSON returns a full-task array. Human output uses existing resource blocks and
says `No ready tasks.` for an empty result. Ordinary `task list --ready` retains
complete traversal for inventory callers. No service endpoint, schema, cursor
option or new task state is introduced.

The [public skill](../architecture/2026-10-21-public-agent-skill-design.md) uses
bounded ready for next-work selection and show for selected or known tasks.
In-progress inventory is read as needed to recover an unknown active task;
graph is read for overall dependencies. An empty ready result cannot establish
that a project has no active or blocked tasks, and a full result cannot establish
that no additional candidates exist. The prior graph-first policy provided a
single complete dependency view for small projects; bounded selection removes
that cost from routine recovery. This partially replaces the original
[project/task CLI decision](../architecture/2026-10-20-project-task-cli-design.md)
that all list-based queries exhaust their cursors.

The [requirements](../../../../docs/spec/daynight-project-task.md) own observable
command behavior; the [design](../../../../docs/design/daynight-project-task.md)
owns transport and rendering. The real Daynight task is
`ada23216-a6e6-45de-89f4-67f1f71fbbfc`; native Agent/service acceptance follows this
command so the public workflow is exercised with its final query strategy.

## Alternatives

**Fetch every ready task and slice the result.** This caps visible output but
still transfers and validates the full backlog, so it preserves the growth cost.
The existing server already filters before applying a page limit.

**Add a limit to complete task list.** This would make the established list
completion promise conditional. A named ready operation states the selection
intent and leaves existing inventory callers and pagination behavior intact.

**Keep graph-first recovery.** A complete graph remains useful for dependency
reasoning and has a bounded node/edge response. Daily next-work selection does
not need unrelated completed nodes, and graph-limit recovery should not force
an unbounded ready list. Graph remains available when that context is needed.

## Consequences

The task request and returned count are bounded without adding service code or
inventing a priority policy. Full task text can still be large, and initial
project discovery can require multiple project pages. The command limits task
count, not total request count or fixed output bytes; shared deadlines and byte
budgets still apply. Intentionally exhaustive task inventory stays available.

Top N is an observed page, not a reservation or a cross-request snapshot.
Concurrent changes can affect later reads; selected task details must be refreshed
before decisions and updates use the exact observed version. Development and
PR-delivered documentation tasks retain merge-bound completion, and ready
selection supplies no execution, merge or deployment authority.
