# Agent Note: Local Review Status Listing

Status: implemented

## Problem

A foreground reviewer retains useful progress while its console is busy or no
longer running. Operators need to distinguish pending work, active records,
completed reviews and exhausted retries without starting another reviewer or
mistaking an old review for the latest observed PR target. Local retained state
also has an explicit observation limit: it cannot describe remote changes that
have not been polled or individually enumerate permanently excluded PRs.

## Decision

`daynight review list` and `daynight review ls` share a one-shot local listing.
The [requirements](../../../../docs/spec/daynight.md) own its visible behavior;
the [design](../../../../docs/design/daynight.md) owns the reader and rendering
mechanics. The command reads the current configuration and a consistent SQLite
snapshot, then groups configured repositories in configuration order and sorts
tracked open PRs numerically. Draft, completed and failed records remain visible
while their PR is open. Removed configuration entries and closed PR history do
not appear.

The output declares its local persisted source. Each repository shows the last
successful complete observation, a saved poll error when present and its permanent
tracking boundary. PRs at or below the boundary were never individually stored,
so the output identifies that exclusion and states its tracked scope. Uninitialized repositories and initialized
repositories with no tracked ongoing PRs have distinct messages. Saved `Running`
state does not establish current process liveness.

The current row matches a review by desired revision, head SHA and target branch.
A base-tip SHA alone does not change that target. Newer pending work and an older
active review retain separate status, attempt count, retry deadline and error
attribution. Draft rows are paused and can still disclose their recorded review.
This preserves the [durable-state decision](../architecture/2026-10-17-durable-review-state.md)
that captured progress cannot satisfy a newer trigger.

The reader parses configuration without the runtime loader's physical path probes.
It opens an existing database read-only and checks schema version 1 within the
same short transaction as its selects. It does not enter runtime startup, acquire
an instance lock, run commands, access the network, migrate state or recover work.
An absent database yields uninitialized repositories without file creation. An
existing empty, corrupt, unreadable or unsupported database fails visibly.
Normalized configured remotes select stored identities; multiple stored GitHub IDs
for the same configured coordinate cause an explicit error.

Read-only means no application-state writes. SQLite may create or update WAL/SHM
coordination sidecars for an existing database. The directory must permit the
SQLite access needed for those files; failures propagate. The reader uses no
`immutable` shortcut, because a running daemon can still commit. SQLite documents
these [read-only WAL requirements](https://www.sqlite.org/wal.html#read_only_databases).
The [foreground CLI decision](../architecture/2026-10-16-foreground-review-cli.md)
continues to own review execution and recovery.

## Alternatives

**Query GitHub while listing.** This could return current remote PR metadata,
but would require authentication, network failure handling and a decision about
reconciling new observations with the daemon. The selected command reports the
local snapshot and its age. A live refresh is a separate additive capability;
keeping rendering independent of observation avoids a new writer or recovery
owner in the listing path.

**Use the runtime database opener and configuration loader.** Those entry points
are appropriate for startup, but can initialize or migrate SQLite and create
physical path probes. A dedicated reader preserves the listing's state-read
purpose and permits use beside an active reviewer without taking its lock.

**Show the newest review record as the PR status.** An older active or failed
record may not describe the latest desired revision, even when its head matches
a later ready transition. Matching revision, head and target branch while showing
older active records separately preserves the consumed budget and pending work.

## Consequences

Operators can inspect local progress without installed Git, GitHub CLI or Copilot
commands and without changing review scheduling. A coherent SQLite transaction
prevents cross-table observations from different commits. The listing does not
assert process health, current GitHub state or agent publication beyond the
persisted record. Timestamps and saved errors expose that limit.

The existing schema and application-state format remain unchanged. A database
with another schema version requires software that understands it; listing does
not migrate or repair it. SQLite coordination sidecars remain native-managed
resources, so read-only access does not imply byte-for-byte directory immutability.
The permanent cutoff prevents enumeration of excluded PRs, and polling gaps can
leave the printed open or Draft state stale until the next successful observation.
