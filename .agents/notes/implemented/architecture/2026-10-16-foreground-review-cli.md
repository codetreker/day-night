# Agent Note: Foreground Review CLI

Status: implemented

## Problem

A local PR reviewer must keep polling while agents run, retain each PR's context,
and distinguish a completed review from an interrupted one. These needs require
persistent state and execution ordering, but do not inherently require a service
installation or independent execution infrastructure.

## Decision

The repository records the [requirements](../../../../docs/spec/daynight.md) and
[proposed design](../../../../docs/design/daynight.md) for one foreground
TypeScript CLI in `packages/daynight/`. This note records the selected execution
model; application implementation is pending. Configuration, entry point, and
runtime storage follow the [user-home configuration decision](2026-10-16-user-home-review-configuration.md).

Polling, pending work, SQLite updates, worktree management, and direct Copilot
child invocation belong to that single process. Each PR retains a session UUID
and worktree. Captured review revisions are separate from latest desired state,
so an old completion cannot discard a later trigger. Agents publish their own
GitHub outcomes and report completion through one exact final text line.

The CLI supports Linux, macOS, and Windows using ordinary command execution and
platform termination behavior. Normal exit stops children. Abnormal termination
retains unfinished state and requires previous processes to have ended before
retry; no transparent recovery of a live child is promised.

## Alternatives

**Detached runner with IPC and platform helpers.** This can preserve agent
execution across coordinator crashes, but adds admission, independent ownership,
receipts, and native packaging. Those components solve a stronger process
lifecycle problem than the selected foreground CLI needs. Ambiguous abnormal
exits instead remain visible for operator recovery.

**Wait for every review inside the polling loop.** This reduces scheduling code,
but delays discovery and closure detection for the duration of each review. The
same Node.js process can poll and await children asynchronously.

**Parse model findings and publish from the CLI.** This introduces a findings
schema and publisher contrary to the agent-owned publication requirement. The
plain-text marker trusts the agent's assertion and leaves GitHub reconciliation
to that same agent session.

## Consequences

One command starts and owns the workflow, with SQLite preserving cutoff,
revisions, sessions, and retries. The execution model needs no separate runner,
IPC service, or native process helper. Cross-platform subprocess behavior still
requires real platform tests.

Abnormal exits can leave child execution uncertain and require operator
attention. GitHub publication is not atomic with local state, so confirmation
checks prior publication before retrying. The marker does not independently
prove remote effects or transactional exactly-once delivery. Session files live
outside disposable worktrees and must remain available for continuity.
