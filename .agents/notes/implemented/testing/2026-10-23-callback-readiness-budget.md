# Agent Note: Callback fixture readiness budget

Status: implemented

## Problem

The container-callback fixture observes readiness before releasing browser
permission. Its child already has a five-second lifetime bound, but a separate
three-second readiness observer includes module loading, process identity,
journal writes and the controlled Docker command. Correct startup can exceed
that shorter observer budget while the owned child remains alive.

Main run [39950831052](https://github.com/codetreker/daynight/actions/runs/39950831052)
failed this observer at 3,315 ms before product browser checks or coverage
generation. The same fixture passed in 1,363 ms and 2,883 ms in prior hosted
runs using the same Node version and unchanged fixture. A bounded local probe
passed idle and reproduced the same readiness failure under CPU contention.
These observations establish scheduling sensitivity; they do not identify a
specific one-off infrastructure incident that would justify an unchanged rerun.

## Decision

The fixture's readiness observer shares the existing owned-child lifetime. It
waits for the readiness file while checking actual process exit, and reports the
captured child result when that lifetime ends. The five-second child deadline
continues to terminate a child that does not finish; readiness has no second,
shorter startup deadline.

Receipt identity, exact source/run fields, readiness before browser permission,
responsive IPC, command ordering, abort identity and listener/timer/process
cleanup remain observable requirements. Filesystem and parsing failures remain
errors. This changes fixture synchronization, with no production callback,
browser phase, coverage, capacity or CI-job budget change. The
[pipeline decision](2026-10-21-web-acceptance-pipeline.md) owns those production
stages and their permission/cleanup protocol.

## Alternatives

**Retain a separate three-second readiness deadline.** It rejects valid startup
before the existing child budget expires. The observed failure and controlled
contention reproduction show that this independently timed observer tests
scheduling speed in addition to the intended protocol ordering.

**Increase both timeouts or rerun until the job passes.** A larger child bound
would change an existing lifecycle limit, while repeated unchanged runs would
leave the demonstrated fixture defect in place. One owner preserves the current
bound and the actual protocol assertions.

## Consequences

Module startup and the gated protocol consume one bounded lifetime. A missing
readiness file cannot pass by waiting indefinitely: child exit or its existing
timeout remains a failure, with the original cleanup path retained.

The fixture continues to distinguish diagnostic readiness from actual browser
permission. The five-second child lifetime is independent of the UI-test,
coverage, browser-install and overall workflow limits documented in the
[Web validation guide](../../../../packages/daynight-web/README.md#production-browser-acceptance).
