# Agent Note: Bounded Zombie-State Observation

Status: implemented

## Problem

The installed-CLI recovery test held the child’s parent in a synchronous read so
it could verify that recovery waits for reaping. After sending `SIGTERM`, the
test treated a signal-zero process-group probe as proof that the child had
already entered the zombie state. The probe proves only that the group still
exists; the child may still be running before the signal is processed. Main run
[39992460602](https://github.com/codetreker/daynight/actions/runs/39992460602)
observed `R` where the test expected `Z`.

## Decision

The test waits up to five seconds for `/proc/<pid>/stat` to report `Z` before it
checks that process identity is absent and recovery remains pending. It then
releases the parent and verifies that recovery completes after reaping. The
process lifecycle and ownership contract remain defined by the
[web acceptance pipeline](2026-10-21-web-acceptance-pipeline.md).

## Alternatives

**Keep the one-shot state read.** A signal-zero probe does not synchronize with
signal delivery, so a valid process can remain `R` when the test reads `/proc`.

**Wait without a deadline.** A child that fails to terminate could hang the test
suite indefinitely; the observation therefore remains bounded.

## Consequences

The test observes signal delivery before asserting zombie-state and parent-reap
ordering. If the child does not become a zombie within five seconds, the test
fails and its existing cleanup releases and reaps owned processes.
