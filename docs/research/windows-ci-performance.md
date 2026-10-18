# Windows CI Performance

## Scope and measurement

The baseline is main revision `8a8f3c41ccec94783141cc05e9a42d3b39d2e658`.
Measurements use completed successful GitHub Actions runs, step timestamps from
the jobs API and per-file durations from Vitest logs. Job time excludes queue
delay; it includes runner setup, post steps and inter-step gaps. All table values
are seconds. Separate runs have different runner load, so historical variation
is included rather than treating one measurement as a stable benchmark.

## Baseline

| Run | Platform | Job | Dependency install | Ordinary tests | Installed acceptance |
|---|---|---:|---:|---:|---:|
| [39132420464](https://github.com/codetreker/day-night/actions/runs/39132420464) | Windows | 281 | 5 | 201 | 37 |
| 39132420464 | Linux | 65 | 3 | 27 | 14 |
| 39132420464 | macOS | 91 | 3 | 50 | 18 |
| [39132068273](https://github.com/codetreker/day-night/actions/runs/39132068273) | Windows | 189 | 4 | 129 | 26 |
| 39132068273 | Linux | 52 | 2 | 24 | 12 |
| 39132068273 | macOS | 109 | 4 | 60 | 23 |
| [39131014417](https://github.com/codetreker/day-night/actions/runs/39131014417) | Windows | 264 | 5 | 187 | 36 |
| 39131014417 | Linux | 52 | 3 | 22 | 12 |
| 39131014417 | macOS | 98 | 6 | 52 | 17 |

The first run is the baseline main push. The other two are earlier revisions
of the stale-lock repair, used to check whether the Windows timing pattern
persists across successful runs, not as identical-workload comparisons.

The [baseline Windows job](https://github.com/codetreker/day-night/actions/runs/39132420464/job/117690121799)
reported `git.test.ts` at 196.409 seconds and the entire ordinary Vitest run at
196.94 seconds. Its 48 expanded Git cases summed to 196.406 seconds. The next
largest ordinary files were version checks at 25.215 seconds and coordinator
tests at 13.217 seconds. Installed acceptance took 31.919 seconds inside its
37-second step. The same Git file took 24.235 seconds on Linux and 46.049 on
macOS. Earlier Windows runs reported 126.561 and 181.836 seconds for that file.

## Cause and implementation

The initial fixture starts eleven native Git commands before each case reaches
the manager: one initialization, four object-writing commands for each of two
commits, and two ref updates. Native Git operations also occur throughout the
cases themselves. The observed Windows cost is spread across these cases;
there is no single timeout explaining the file duration.

All 48 cases originally occupied one file. Vitest runs files across isolated
workers by default while cases within a file run sequentially, as documented in
its [parallelism guide](https://vitest.dev/guide/parallelism.html). Independent
files expose this work to the existing scheduler. A per-file immutable bare
seed avoids reconstructing identical starting objects for each case, while
fresh copies preserve separate mutable origins and all real manager operations.
The [decision note](../../.agents/notes/implemented/testing/2026-10-18-parallel-git-validation.md)
defines fixture ownership and the alternatives considered.

## Validation boundaries

The unchanged local Linux baseline passed type checking and 476 ordinary tests,
with eight platform-specific APFS skips, in a 15.63-second Vitest run. The split
suite passed the same 476 tests and eight skips in 4.35 seconds. Type checking
and the 24-scenario installed acceptance also passed. Local timings cannot
establish native Windows speed or filesystem behavior. Hosted validation must
include all three platforms, the same 48 Git cases and the installed CLI
lifecycle. Type checking, package build, version checks, artifact capture,
acceptance scenarios and timeout limits retain their existing rules.

This report concerns controlled native validation. Live Copilot and GitHub
acceptance retain the boundaries in the
[acceptance report](daynight-acceptance.md).
