# Agent Note: Container Callback Readiness Observation

Status: implemented

## Problem

The container callback unit test waits for its child process to atomically write
`ready.json` before checking that the callback remains gated. Its three-second
readiness deadline was close to observed CI startup time: the same test passed
in 2.358 seconds in [main run 39948194087](https://github.com/codetreker/daynight/actions/runs/39948194087), then exceeded the deadline in
[main run 39950831052](https://github.com/codetreker/daynight/actions/runs/39950831052)
while the child remained alive. This makes the regression test depend too
strongly on hosted-runner scheduling.

## Decision

The readiness test allows ten seconds for the child to persist its receipt and
uses a fifteen-second process timeout as a separate safety bound. Other child
process tests keep their existing five-second timeout. A readiness timeout still
fails the test, and its cleanup still kills and reaps the child. These are
test-only bounds; the callback's readiness receipt and permission protocol
remain owned by the [web acceptance pipeline](2026-10-21-web-acceptance-pipeline.md).

## Alternatives

**Keep the three-second readiness bound.** The last successful execution used
2.358 seconds, leaving little scheduling margin; the later 3.315-second
observation exceeded it without the callback exiting.

**Remove the readiness or process timeout.** An unresponsive child could hang CI
indefinitely. Both bounds remain finite, and only the affected child receives a
longer cleanup cap.

## Consequences

The test allows normal startup variation while retaining a ten-second failure
bound and a fifteen-second child-process backstop. Other acceptance-runner tests
and production callback behavior are unchanged.
