# Agent Note: Stale Instance Lock Recovery

Status: implemented

## Problem

An abnormal CLI exit leaves `instance.lock` behind. Unconditionally rejecting
that file prevents a quiescent daemon from restarting even when its recorded
owner no longer exists. Concurrent restart attempts must not replace each
other's ownership, and the absence of the CLI does not establish whether its
agents or tools still use retained worktrees.

The [foreground coordination decision](../architecture/2026-10-17-foreground-review-coordination.md)
originally required an operator to exclude the CLI and every agent/tool before
removing any retained lock. Its process-exclusion rationale remains necessary
for unresolved execution and cleanup, but applying it to every dead CLI owner
also prevents automatic recovery when no such work exists.

## Decision

The instance lock retains JSON fields `owner`, `pid` and `startedAt`. Existing
metadata is validated before probing; the PID must be a positive integer no
greater than `2147483647`.
[`process.kill(pid, 0)`](https://nodejs.org/docs/latest-v24.x/api/process.html#processkillpid-signal)
checks CLI liveness. Only
`ESRCH` proves that the recorded process does not exist and permits replacement.
Successful probes, `EPERM`, unknown errors and invalid metadata preserve the
lock and fail startup. PID reuse therefore conservatively requires inspection.
Neither lock age nor timestamps prove death, and saved PIDs are never killed.

A separate `${lockFile}.sqlite` database serializes lock read, liveness probe,
creation or replacement, and release in short synchronous `BEGIN IMMEDIATE`
[transactions](https://www.sqlite.org/lang_transaction.html). A complete
temporary lock file is atomically renamed over the
stale file while holding the transaction. Release rechecks ownership under the
same guard. The operating system releases a crashed process's SQLite lock;
the database remains at its path and must not be unlinked while any CLI can use
it. SQLite documents that
[unlinking a database in use](https://www.sqlite.org/howtocorrupt.html#unlinking_or_renaming_a_database_file_while_in_use)
can give connections different physical database files.

Automatic reclamation returns `previousProcessesExcluded: false` in the lock
result; the process supervisor receives no proof that old execution is excluded. Persisted
`preparing`, `running` and `interrupted` reviews remain interrupted and block
their PRs. A repository with unresolved `cleanup_pending` is frozen before its
first poll so a reopened PR cannot erase that marker; another crash still
retains the uncertainty. Diagnostics identify the required process exclusion.
Other repositories continue, as do independent PRs in repositories without
uncertain cleanup. The daemon retains its lock on shutdown while that old work
remains unconfirmed.

A quiescent crash can restart without manual deletion. To resume uncertain
resources, an operator stops the current daemon, confirms the previous CLI and
all its agents/tools have stopped, removes only `instance.lock`, and restarts.
The guard database, review SQLite, sessions and logs remain. Fresh acquisition
with no instance lock preserves the explicit operator-confirmed exclusion
contract used by existing recovery: the captured target, session and consumed
budget survive, and no interrupted attempt becomes completed merely because
the daemon restarted. This decision does not add arbitrary process-tree
reconstruction or attach to surviving agents.

## Alternatives

**Require manual lock removal after every abnormal exit.** This was the original
coordination policy because CLI death cannot exclude orphan agents or tools.
It blocks a safe quiescent restart as well. Keeping manual exclusion for
uncertain resources preserves that rationale without requiring intervention
for every confirmed dead owner.

**Probe the owner, then unlink and recreate without serialization.** Concurrent
starters can both observe the dead owner and one can remove the other's newly
acquired lock. A SQLite transaction serializes the ownership decision; atomic
replacement also avoids an absence window while replacing the stale file.

**Use lock age or a stored timestamp to decide staleness.** A long-running CLI
can own an old lock, and an immediately crashed CLI can leave a recent one.
Neither observation establishes death, so both can misclassify active ownership.

## Consequences

Confirmed dead CLI ownership no longer blocks idle restart. Live or ambiguous
owners still produce explicit errors, and guard serialization remains effective
when an owner crashes. The permanent guard database is an additional retained
file, and process liveness errors remain visible.

CLI liveness and resource exclusion remain separate. Conservative PID reuse
refusal and blocked resources can still require an operator. Pending cleanup
freezes the affected repository until exclusion, preserving its marker across
reopen observations and repeated crashes without adding a schema migration.
The [acceptance report](../../../../docs/research/daynight-acceptance.md) owns
actual validation receipts; historical manual-recovery platform results do not
establish automatic-recovery behavior on those platforms.
