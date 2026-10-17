# Agent Note: Foreground Review Coordination

Status: implemented

## Problem

Repository polling, Git preparation, agent execution and closure cleanup can
observe different PR states. Without shared admission and durable transitions,
they can overlap a worktree, exhaust capacity before reserving work, lose a newer
revision or repeatedly retry a failed revision. Shutdown must also stop pending
commands before releasing shared state.

## Decision

The coordinator connects the [state module](2026-10-17-durable-review-state.md),
[complete observations](2026-10-17-github-observation.md),
[owned worktrees](2026-10-17-owned-review-worktrees.md) and
[Copilot adapter](2026-10-17-copilot-session-execution.md) in the single foreground
CLI selected by the [execution decision](2026-10-16-foreground-review-cli.md).
Configured clones remain an [exclusive review environment](2026-10-17-exclusive-review-environment.md).

Each repository has an independent polling lifetime and retry deadline. A FIFO
pending map holds one latest candidate per PR while preserving its queue position.
Dispatch removes that entry, so a frequently updated PR's successor joins behind
work already waiting. A PR reservation is acquired before the first asynchronous
operation and spans preparation, agent execution or cleanup. Review preparation
and execution consume `maxConcurrentWorker`; cleanup uses the PR reservation
without consuming a review slot.

Observed Draft/closure cancels the active attempt. New head/target revisions wait
for current execution and remain pending after its captured revision completes.
The existing store owns budget consumption, suppression, retries and immutable
revision attribution. Preparation failures do not consume an agent attempt.
Retry delays grow exponentially to a ten-minute cap. An uncertain Git command or
agent stop blocks reuse and cleanup of its resources.

The coordinator owns a lifetime cancellation signal in addition to the caller's
signal. Internal fatal errors cancel pending repository commands and PR work
before awaiting them. Error diagnostics retain repository/PR/review context and
causes. A failed cleanup diagnostic write preserves both the Git error and the
database error.

Startup creates `instance.lock` exclusively and never infers staleness from age
or a missing PID. After an abnormal run, an operator must confirm that the old
CLI and all agents/tools have stopped before manually removing the lock. A new
lock then authorizes explicit reconciliation of interrupted state; saved PIDs
are never used as termination targets. Orderly shutdown closes SQLite and
releases only its own lock after managed operations are safe. Uncertainty keeps
the lock and recorded state.

Agents obey a foreground-tools contract: finish/reap tools and stop services
before returning. Normal unforced exit with drained streams is evidence under
that contract, rather than OS containment of arbitrary descendants. POSIX uses
a referenced child process group with pipes and no `unref`; TERM/KILL targets
the current group, with zombie-only groups distinguished from executing members.
Windows cancellation uses `taskkill /T /F` while the current wrapper is live.
Canceled roots that disappear before tree termination, failed stops and abandoned
capture remain uncertain. No post-crash tree reconstruction is attempted.

The relevant platform contracts are
[Node process groups](https://nodejs.org/api/child_process.html#optionsdetached),
[Node close](https://nodejs.org/api/child_process.html#event-close),
[POSIX kill](https://pubs.opengroup.org/onlinepubs/9799919799/functions/kill.html)
and [Windows taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).

## Alternatives

**Select the first database candidate whenever a slot opens.** Number ordering
lets a continuously changing PR repeatedly bypass other eligible PRs. FIFO
admission preserves waiting order while coalescing each PR's newest revision.

**Use only the caller's cancellation signal.** An internal scheduling failure
can otherwise wait forever on a poll whose caller remains active. A coordinator
lifetime signal gives all started work one explicit shutdown boundary.

**Require independent OS proof for every Windows natural exit.** `taskkill /T`
needs a live tree root; closed stdio does not enumerate arbitrary descendants.
Universal containment would require stronger native process infrastructure.
The selected foreground contract supports ordinary review tools and keeps
abnormal execution visible, without changing the single-process CLI design.

## Consequences

Real SQLite tests exercise admission, revisions, retry budgets, failure isolation,
recovery and shutdown. A local Git origin plus a controlled Copilot process and
production process supervisor verifies the combined review/re-review/closure
lifecycle. Compiled-entry tests verify real state creation, singleton refusal and
signal cleanup without remote credentials.

The CLI is operational after configuration loading. Native CI and designated
live Copilot/GitHub acceptance remain distinct evidence. Detached services or
processes escaping the supported foreground contract require a different
execution design; normal process closure is not presented as a general sandbox.
