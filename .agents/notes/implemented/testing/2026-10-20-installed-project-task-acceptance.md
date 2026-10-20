# Agent Note: Installed Project and Task Acceptance

Status: implemented

## Problem

Module and compiled-entry tests do not establish that a packed CLI can resolve a
real Git repository, persist its binding through native filesystems, or use the
actual Go/PostgreSQL service across restart and competing updates. Injected short
budgets also cannot establish that an installed command enforces its public
30-second request, five-minute operation and decoded-response byte limits.

## Decision

The adopted acceptance design adds two required paths while preserving existing
review, self-update, completion, Go and web validation. Implementation and both
local and hosted validation are complete. [PR #55](https://github.com/codetreker/daynight/pull/55)
owns review and integration status. The [task record](../../../../docs/design/daynight-project-task-tasks.md)
owns observed results and delivery status. This decision adds no production API,
database schema, test-only CLI flag or reduced resource limit.

The native project/task suite packs and installs the actual CLI into an isolated
consumer, drives its public command with real Git and controlled HTTP, and runs
alongside both existing installed suites on Linux, macOS and Windows. A reusable
fixture owns tarball creation, consumer installation, the installed launcher and
task-local resources. The curated repository-root
`.tmp/project-task-evidence.json` identifies source, packed and installed
artifacts, scenarios and cleanup; it does not serialize credentials or an entire
environment.

Real service acceptance reuses the Go command package's fresh race binary,
isolated PostgreSQL schema, readiness and process cleanup. The same installed CLI
creates projects and dependent tasks, verifies rejected state changes and
version conflicts, queries complete results, and reads persisted data after a
real process restart. Database locks and observed waiters order competing
updates. The `installed_cli_project_task_workflow` scenario uses `PT.V*`
requirement identifiers in the existing Go acceptance receipt. Its `installedCli`
identity and CLI process/workspace/request results supplement the original service
scenarios and package-owned coverage.

A Node orchestrator prepares the installation once for the service path, passes
it to the Go acceptance scenarios, and reuses it for production-budget probes.
It retains the existing go-cov arguments, race and critical-block checks and
strict raw-coverage comparison. After that gate succeeds, budget probes run
outside the Go test process and its default ten-minute timer. The probes invoke
the installed public CLI against controlled streaming HTTP with the real
30-second request, five-minute operation, 128 MiB single-response and 256 MiB
cumulative-response limits. Gzip JSON uses whitespace padding: exact decoded-byte
boundaries must succeed with small complete results, and each boundary plus one
byte must fail. Unique progressing cursors cannot evade the total
deadline; decoded bytes, partial-output refusal and already-sent write
uncertainty retain their production meaning.

The repository-root `.tmp/project-task-service-evidence.json` combines the
attributable installation, service and budget results with cleanup. The Go
receipt and raw coverage profile remain separate owners of the server workload.
The existing 20-minute Go CI job retains all prior gates; native CLI and shell
jobs retain their workloads. Presence of a suite or local receipt does not
establish successful hosted validation.

Fixture Git commands disable external fsmonitor so index inspection cannot
launch unrelated monitoring work. Only task-owned CLI, HTTP, Git and service
processes are stopped and reaped.
Database locks are released before waiting for dependent workers; sessions must
disappear before the isolated schema is dropped. Fixtures and temporary
installations are removed after their users stop. Cleanup failures preserve the
original failure and fail acceptance, including when an execution deadline or
signal interrupts a probe.

The [repository validation guide](../../../../README.md#validation) owns commands and
client receipt meanings; the [server README](../../../../packages/daynight-server/README.md)
owns service receipt and coverage interpretation. Source-bound observed results
belong to the corresponding PR and CI run. The existing
[installed-client](2026-10-17-installed-cli-acceptance.md) and
[built-process](2026-10-19-server-process-acceptance.md) decisions retain the
original lifecycle, updater, service and cleanup rationale.

## Alternatives

**Install eagerly in Go TestMain.** This would make filtered command-package
tests perform package-registry work even when their selected tests do not need
the client. It would also place installation and long HTTP probes inside the Go
test lifetime. Explicit orchestration installs once for the acceptance consumers
and leaves the Go runner responsible for its tested service process.

**Run all production-budget probes under Go's ten-minute test timer.** A genuine
five-minute operation probe, request deadline and complete Go workload compete
for that timer. Raising or weakening a tested production limit would change the
claim. A separate orchestrator keeps the original coverage command and runs the
installed budget probes after it without changing the Go timer.

**Create a separate deployment stack for CLI acceptance.** This would duplicate
database, listener, process restart and cleanup mechanisms already owned by the
Go command fixture. Reusing that fixture provides actual service behavior and
observable database ordering without a second service manager or deployment
control API.

## Consequences

Native controlled HTTP/Git validation and Linux real-service validation establish
different facts. Both remain required; neither can replace the other or the
existing suites. One installation per service invocation keeps its Go and budget
receipts tied to the same packed artifact and bounds package-registry work.

The production five-minute probe adds unavoidable elapsed time to the Go job.
Streaming responses keep the test driver bounded, while the installed CLI must
still enforce its own decoded-byte budgets. Receipt selection must distinguish
native and service/budget artifacts and preserve failures and resource cleanup.
The local Linux receipt covers the three installed suites, real Go/PostgreSQL
workflow and six default-budget cases. It records package `0.6.0` from the dirty
`c19b064` development source. Hosted receipts separately identify PR head
`e9a634aca23710ffe46723fcdb2cf8e7a75d56bf` and clean build revision
`2e7b8da99cf4b5de6da9c8083446f84fd19f1daf`; the required native matrix and Go
workload passed in [run 39428165296](https://github.com/codetreker/daynight/actions/runs/39428165296).
The [task record](../../../../docs/design/daynight-project-task-tasks.md) owns
delivery status; PR #55 and its source-bound CI artifacts retain detailed
observations and review history.
