# Agent Note: Web Acceptance Pipeline

Status: implemented

## Problem

Preparing a cache-only production build and later invoking the normal dev-ci
build repeats work on the web critical path. Waiting for every preparation step
before browser work also serializes independent native and container setup.
Increasing overlap must preserve complete production validation and keep
capacity timing free of competing builds, coverage and container cleanup.

The preceding optimizations and stability work are delivered through
[PR #70](https://github.com/codetreker/daynight/pull/70) and
[PR #71](https://github.com/codetreker/daynight/pull/71). The
[post-PR #71 main run](https://github.com/codetreker/daynight/actions/runs/39545046061)
at `0a1510aa1af9482c7670a09c67096bbd391041a2` passed its complete workload in
4 minutes 28 seconds. That source-bound baseline explains the remaining
scheduling work; it does not validate this pipeline.

## Decision

One acceptance runner owns the fixed dependencies of the complete web job,
without shards. `scripts/acceptance/runner.mts` exports `runAcceptance`,
`runContainerCallback` and `recoverAcceptance` without starting work or registering
signal handlers on import. The thin `scripts/acceptance.mts` CLI and `scripts/ci.mts`
pass explicit cancellation controllers to that runner. CI supplies callbacks for
pinned Chromium installation and the unchanged `pnpm web:test` command; only the
coverage child receives `VITEST_MAX_WORKERS=2`, retaining its `forks` pool and
per-file isolation. Controlled deployment fixtures run before the unified CI
entry. This partially replaces the cache-only preparation and target sequencing
of the [CI efficiency decision](2026-10-21-ci-validation-efficiency.md) and the
original schedule of the
[dashboard acceptance decision](2026-10-20-dashboard-production-acceptance.md).
Their real targets, complete scenarios, coverage, performance and cleanup
requirements continue to apply.

The runner starts normal dev-ci source build/start once, concurrently with native
production UI/Go/PostgreSQL preparation and CI browser/coverage callbacks. The
existing shell runner remains authoritative for the unique image, running-image
check and full stack cleanup. Native functional browser work waits only for the
native process, shared installed CLI and browser preparation. Its nine scenarios and immediate
browser recovery must pass before the runner releases the container browser.

Release is an atomic `container/container-permission.json` receipt with schema 1,
phase `native-functional-cleaned`, acceptance run ID, dev-ci run ID and source
SHA. The container callback records its process identity before waiting and
inventories browsers only after validating that exact permission. Its
`ready.json` records diagnostic timing and grants no permission. The callback
runs the nine container functional scenarios, confirms browser cleanup and
returns to the normal shell exit path. The outer stage waits for full dev-ci
cleanup and browser recovery before completing.

Capacity runs last, after every preparation/check command, native functional
phase, container functional phase and complete container cleanup. The native
Go process and PostgreSQL remain alive for this final phase. One browser worker,
zero retries, all three fixed graphs with five repetitions, both independent
limits, complete geometry, fifteen CDP traces and all original timing gates
remain required. Native functional and capacity phases strictly aggregate to
thirteen unique scenarios; the container target requires nine. Per-phase and
aggregate validation reject missing, extra or duplicate scenarios and retries,
and require matching browser identity within a target.

The top-level evidence and recovery receipts use schema 2. Pipeline stages record
names, results, timestamps, observed managed-command process identities and their
spawned process groups. Short-lived commands retain their observed group without a
fabricated process identity. Identity lookup treats both ENOENT and ESRCH as an
absent process: Linux can return ESRCH when a descriptor opened before process
exit is subsequently read, as described by the
[pinned proc documentation](https://github.com/torvalds/linux/blob/a804c5742bff224d4cb4d25dd383554d598be32b/Documentation/filesystems/proc.rst#L121-L127).
Other filesystem errors remain failures. A regression interposes the actual
open/exit/read sequence rather than relying on scheduling luck; permission
failures retain their original error object. Target aggregates contain `phases` and `scenarios`;
each browser phase records its functional/capacity kind, timestamps, actual
Playwright process/group, browser identity and `browserCleanup`. Raw phase data
lives under `native/functional`, `container` and `native/capacity`; capacity
`performance.json` retains schema 1. Top-level schema 1 and unknown versions are
rejected rather than interpreted through a compatibility fallback.

Any task failure cancels siblings and drains every started task before final
cleanup; an unexpected native-server exit follows the same path. Browser phase
cleanup verifies actual process groups and owned profiles immediately. Final
and interrupted-run recovery examine browser phases in reverse order, then use
the existing exact native-process and Docker ownership checks. CI recovery and
both artifact uploads share the unified acceptance step's attempted-execution
condition, so partial preparation remains attributable and recoverable.

The [web README](../../../../packages/daynight-web/README.md#production-browser-acceptance)
owns commands and evidence interpretation. The
[attachment acceptance decision](2026-10-21-task-attachment-cross-layer-acceptance.md)
adds one shared installed CLI and one same-data attachment scenario per functional
target; it retains this schedule and all four capacity scenarios. The
[web design](../../../../docs/design/daynight-web.md#验证与-ci) owns mechanisms.
Measured outcomes remain tied to their source, environment and PR/CI run.

## Alternatives

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

**Introduce a generic scheduler or pass previously built binaries between
entries.** These add scheduling configuration or artifact-identity rules beyond
the fixed acceptance dependencies. Both entries instead call the same runner,
which builds fresh native artifacts and owns their exact identity and lifetime.

## Consequences

Preparation and functional work can overlap while capacity remains isolated.
The normal dev-ci runner keeps its existing public interface, production image
checks and targeted cleanup. The native service lives longer because both native
browser phases use the same verified process and database.

Phase separation adds explicit permission and recovery evidence. A complete
result requires every phase, strict scenario union, matching browser identities
and cleanup, not merely successful child exits. The timing benefit still requires
complete hosted CI observation; local validation and historical main runs retain
their own source and environment limits.
