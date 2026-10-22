# Agent Note: Web Acceptance Pipeline

Status: implemented

## Problem

Preparing a cache-only production build and later invoking the normal dev-ci
build repeats work on the web critical path. Waiting for every preparation step
before browser work also serializes independent native and container setup.
Increasing overlap must preserve complete production validation and keep
capacity timing free of competing builds, coverage and container cleanup. Network-
dependent browser downloads must also stay outside the five-second UI-test
deadline, while installation and coverage retain bounded command deadlines.

The preceding optimizations and stability work are delivered through
[PR #70](https://github.com/codetreker/daynight/pull/70) and
[PR #71](https://github.com/codetreker/daynight/pull/71). The
[post-PR #71 main run](https://github.com/codetreker/daynight/actions/runs/39545046061)
at `0a1510aa1af9482c7670a09c67096bbd391041a2` passed its complete workload in
4 minutes 28 seconds. Main run
[39785915428](https://github.com/codetreker/daynight/actions/runs/39785915428)
later failed in browser preparation: Playwright's apt phase needed 4 minutes 56
seconds to download 25.9 MB, while the command had a 180-second deadline. PR run
[39788510354](https://github.com/codetreker/daynight/actions/runs/39788510354)
showed the same package set taking 8 minutes 31 seconds. PR run
[39791820767](https://github.com/codetreker/daynight/actions/runs/39791820767)
then spent 13 minutes 17 seconds fetching 23.1 MB from the Azure archive and
exceeded its 600-second install deadline. [PR #148](https://github.com/codetreker/daynight/pull/148)
selected official Ubuntu archives to remove that slow mirror from hosted
preparation. PR run
[39794986474](https://github.com/codetreker/daynight/actions/runs/39794986474)
then fetched 25.9 MB of apt packages in 7 seconds, downloaded Chromium in about
10 seconds under the original 180-second bound, and passed the complete web
acceptance. The first main run after that fix,
[39798535790](https://github.com/codetreker/daynight/actions/runs/39798535790),
fetched 5.8 MB and 21.1 MB apt package sets in 5 and 3 seconds. During coverage,
Playwright downloaded a 191.1 MiB Chromium archive while the 5-second progressive
graph-visibility test timed out. The test failure was reported as the download
reached 80%; the browser download then completed. These logs show that
network-heavy browser preparation overlapped the timing-sensitive test; they do
not isolate whether CPU, I/O or another shared-runner resource caused the timeout.

## Decision

One acceptance runner owns the fixed dependencies of the complete web job,
without shards. `scripts/acceptance/runner.mts` exports `runAcceptance`,
`runContainerCallback` and `recoverAcceptance` without starting work or registering
signal handlers on import. The thin `scripts/acceptance.mts` CLI and `scripts/ci.mts`
pass explicit cancellation controllers to that runner. CI supplies callbacks for
pinned Chromium installation and the unchanged `pnpm web:test` command; only the
coverage child receives `VITEST_MAX_WORKERS=2`, retaining its `forks` pool and
per-file isolation. Browser installation, including Playwright's Linux dependency
installation, and coverage each retain a 180-second deadline. Both commands
remain required: a nonzero exit or timeout fails acceptance. The web job retains
its 20-minute overall timeout. Controlled deployment fixtures run before the
unified CI entry. This partially replaces the cache-only preparation and target
sequencing of the [CI efficiency decision](2026-10-21-ci-validation-efficiency.md)
and the original schedule of the
[dashboard acceptance decision](2026-10-20-dashboard-production-acceptance.md).
Their real targets, complete scenarios, coverage, performance and cleanup
requirements continue to apply.

The runner starts coverage, native production UI/Go/PostgreSQL preparation,
container callback and normal dev-ci source build/start concurrently. Browser and
Linux dependency installation starts only after coverage passes, removing apt and
browser downloads from the 5-second UI-test deadline. Browser installation still
overlaps native and dev-ci preparation. The existing shell runner remains authoritative for the
unique image, running-image check and full stack cleanup. Native functional
browser work waits only for the native process, shared installed CLI and browser
preparation. Its thirteen scenarios and immediate browser recovery must pass
before the runner releases the container browser.

If coverage or another active phase fails while browser preparation is waiting,
the pipeline marks cancellation and the browser callback checks it as soon as
coverage drains; it never starts the installer. The [pipeline regressions](../../../../packages/daynight-web/scripts/acceptance/pipeline.test.mts)
verify coverage-before-browser ordering, cancellation while waiting, continued
native/container overlap, browser-install failure handling, and capacity after
full container cleanup.

Release is an atomic `container/container-permission.json` receipt with schema 1,
phase `native-functional-cleaned`, acceptance run ID, dev-ci run ID and source
SHA. The container callback records its process identity before waiting and
inventories browsers only after validating that exact permission. Its
`ready.json` records diagnostic timing and grants no permission. The callback
runs the thirteen container functional scenarios, confirms browser cleanup and
returns to the normal shell exit path. The outer stage waits for full dev-ci
cleanup and browser recovery before completing.

Capacity runs last, after every preparation/check command, native functional
phase, container functional phase and complete container cleanup. The native
Go process and PostgreSQL remain alive for this final phase. One browser worker,
zero retries, all four fixed graphs with five repetitions, both independent
limits, complete visible induced geometry, twenty CDP traces and all original
timing gates remain required. Native functional and capacity phases strictly
aggregate to eighteen unique scenarios; the container target requires thirteen.
Per-phase and aggregate validation reject missing, extra or duplicate scenarios
and retries, and require matching browser identity within a target.

The [progressive overview decision](../feature/2026-10-22-progressive-task-graph.md)
retains those complete API inputs and existing timing thresholds while requiring
bounded overview DOM, all induced visible edges and explicit expansion/reset.
Phase ownership and the 31-scenario inventory remain unchanged.

The top-level evidence and recovery receipts use schema 2. Pipeline stages record
names, results, timestamps, observed managed-command process identities and their
spawned process groups. Short-lived commands retain their observed group without a
fabricated process identity. Identity lookup treats both ENOENT and ESRCH as an
absent process: Linux can return ESRCH when a descriptor opened before process
exit is subsequently read, as described by the
[pinned proc documentation](https://github.com/torvalds/linux/blob/a804c5742bff224d4cb4d25dd383554d598be32b/Documentation/filesystems/proc.rst#L121-L127).
Other filesystem errors remain failures. A regression interposes the actual
open/exit/read sequence rather than relying on scheduling luck; permission
failures retain their original error object. Target aggregates contain `phases`
and `scenarios`; each browser phase records its functional/capacity kind,
timestamps, actual Playwright process/group, browser identity and `browserCleanup`.
Raw phase data lives under `native/functional`, `container` and `native/capacity`;
capacity `performance.json` retains schema 1. Top-level schema 1 and unknown
versions are rejected rather than interpreted through a compatibility fallback.

Any task failure cancels siblings and drains every started task before final
cleanup; an unexpected native-server exit follows the same path. Browser phase
cleanup verifies actual process groups and owned profiles immediately. Final
and interrupted-run recovery examine browser phases in reverse order, then use
the existing exact native-process and Docker ownership checks.

Installed-CLI recovery first verifies the recorded leader and discovered owned
members before sending SIGTERM to the recorded group. Each of the existing two
50-attempt, 100ms polling phases completes only when no owned members remain and
`kill(-PGID, 0)` reports ESRCH for that original group. Empty `/proc` ownership
results or an absent executable do not prove that the group has disappeared:
an exited child can await its parent's reap while the kernel still reports the
group. Both conditions are awaited within the existing budget. Remaining owned
members retain the exact identity check before SIGKILL. An initially live group
with no verified owned members still fails immediately; EPERM and other probe
errors propagate. Recovery neither signals an unidentified group nor treats
process-discovery absence as cleanup success.

A controlled real-kernel reproduction exercises this exit/reap interval through
`recoverCliProcesses`. The hosted failure that motivated that repair retained no
child-state observation, so the reproduction establishes the mechanism without
asserting that the CI child was a zombie. The browser-install timeout and ordering
decisions do not alter command cancellation or recovery semantics; the broader
process-discovery and privileged-permission questions in
[issue #86](https://github.com/codetreker/daynight/issues/86) remain separately
tracked.

CI recovery and both artifact uploads share the unified acceptance step's
attempted-execution condition, so partial preparation remains attributable and
recoverable.

The [web README](../../../../packages/daynight-web/README.md#production-browser-acceptance)
owns commands and evidence interpretation. The
[attachment acceptance decision](2026-10-21-task-attachment-cross-layer-acceptance.md)
adds one shared installed CLI and one same-data attachment scenario per functional
target; it retains this schedule and the original capacity scenarios. The later
[task view decision](../feature/2026-10-22-project-task-views.md) adds
`project-view-tabs` to both functional targets without changing phase ownership
or capacity isolation. The
[complete context decision](../feature/2026-10-22-complete-prerequisite-context.md)
adds the dense-external capacity graph while preserving that isolation. The
[bilingual interface decision](../feature/2026-10-22-web-bilingual-interface.md)
adds three functional scenarios per target, preserving phase ownership, strict
aggregation and all capacity conditions. The
[web design](../../../../docs/design/daynight-web.md#验证与-ci) owns mechanisms.
Measured outcomes remain tied to their source, environment and PR/CI run.

## Alternatives

**Run browser preparation concurrently with coverage.** This hides some setup
time, but main run 39798535790 timed out a 5-second progressive visibility test
while Playwright downloaded Chromium. Waiting for coverage isolates those tests
from browser downloads and still overlaps browser setup with native and dev-ci
preparation.

**Raise the browser-install deadline to 600 seconds.** The longer bound was
introduced for the Azure archive delay, but PR run 39791820767 still exceeded ten
minutes while that mirror fetched packages. PR #148 selected official Ubuntu
archives; PR run 39794986474 then passed complete web acceptance with the original
180-second installation bound. Main run 39798535790 fetched apt package sets in
8 seconds total, but a timing-sensitive test failed while Chromium downloaded.
The larger deadline addresses neither the slow mirror nor this test overlap.

**Wait for all preparations before starting browser installation.** This would
also separate browser downloads from coverage, but would serialize independent
native and dev-ci work. Waiting only for coverage protects the short UI-test
deadline while retaining the other preparation overlap.

**Remove `--with-deps` in CI.** This avoids apt work but leaves the runner without
the Linux libraries and fonts that Playwright prepares for Chromium. Browser
acceptance would depend on incidental runner-image contents rather than an
explicit environment requirement.

**Increase the whole job timeout.** That expands the deadline for every CI phase
and does not remove shared-runner contention during coverage. The existing
20-minute cap is retained; each preparation command has its own 180-second bound.

**Keep cache-only preparation followed by a later normal build.** This allowed
preparation overlap without changing deployment ownership, but scheduled a second
production-build invocation and delayed native work until all preparation ended.
Starting the authoritative normal dev-ci build early preserves the same image
and cleanup checks while removing the duplicate preparation path.

**Overlap capacity with coverage, builds or container cleanup.** That can reduce
elapsed time but changes CPU conditions for the strict browser performance gate.
The fixed pipeline overlaps functional work and preparation, then waits for all
competing work and full stack cleanup before capacity.

**Shard the job.** Additional runners duplicate setup and require independent
identity and report aggregation rules. The adopted scope excludes shards and
retains one complete job with explicit phase dependencies.

**Stop waiting when owned-process discovery becomes empty.** The discovery scan
can lose executable/environment ownership data before the parent reaps an exited
child. Returning then makes a final group probe race with reaping. Polling both
absence conditions preserves the original cleanup requirement and deadline.

**Introduce a generic scheduler or pass previously built binaries between
entries.** These add scheduling configuration or artifact-identity rules beyond
the fixed acceptance dependencies. Both entries instead call the same runner,
which builds fresh native artifacts and owns their exact identity and lifetime.

## Consequences

Coverage completes before the network-dependent browser preparation begins, while
both continue to overlap native service and dev-ci preparation. The official
Ubuntu archive selection addresses the slow package mirror measured in runs
39785915428 and 39791820767; the coverage gate keeps Chromium downloads away from
the five-second UI-test timing budget observed in run 39798535790. Coverage and
browser installation both retain 180-second command limits, and the complete web
job retains its 20-minute limit. A Chromium transfer that exceeds its command
bound fails acceptance; it does not lengthen CI without limit.

The normal dev-ci runner keeps its existing public interface, production image
checks and targeted cleanup. The native service lives longer because both native
browser phases use the same verified process and database. Phase separation adds
explicit permission and recovery evidence. A complete result requires every
phase, strict scenario union, matching browser identities and cleanup, not merely
successful child exits. Hosted CI remains the authority for full acceptance;
local validation and historical main runs retain their own source and environment
limits. A complete hosted acceptance run after this ordering change remains
necessary to validate the production browser scenarios under the updated pipeline.
