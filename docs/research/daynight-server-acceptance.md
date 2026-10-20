# Server Acceptance Evidence

The [requirements](../spec/daynight-server.md) own the service's observable
behavior, the [design](../design/daynight-server.md) owns its mechanisms, and the
[task breakdown](../design/daynight-server-tasks.md) records delivery status.
This report owns validation scope, evidence interpretation and observed results.

## Validation command

Use Node 24 and pnpm 10.34.5 to run `pnpm install --frozen-lockfile` from the
repository root. From `packages/daynight-server/`, configure an isolated
PostgreSQL instance and run:

```bash
DAYNIGHT_TEST_DATABASE_URL='postgres://daynight:password@127.0.0.1:PORT/daynight?sslmode=disable' bash scripts/check.sh
```

The command runs the shared `pnpm web:build` to validate and publish real embed
assets, builds the normal executable, runs vet, expires Go test results,
and runs race-enabled package tests through fixed go-cov. It checks package
coverage at least 85%, function coverage at least 80%, critical blocks, and total
statement coverage strictly greater than 90%. The last gate reads the same raw
profile using integer arithmetic, so exactly 90% fails regardless of display
rounding. No product files, functions or `ForTest` suffixes are excluded.

The [installed project/task extension](../../.agents/notes/implemented/testing/2026-10-20-installed-project-task-acceptance.md)
passes local validation. The same check entry prepares one packed/installed CLI for Go
command scenarios, retains the original go-cov arguments and strict profile
comparison, then runs real default HTTP-budget probes outside Go's ten-minute
test timer. The 20-minute Go job and its existing workload remain required. CLI
requirements use `PT.V*` identifiers in the existing server receipt; the separate
repository-root `.tmp/project-task-service-evidence.json` owns shared install
identity, Go-phase/coverage result, production-budget probes and cleanup.
[Client acceptance](daynight-acceptance.md#projecttask-installed-and-real-service-acceptance)
owns those probe semantics; the [task record](../design/daynight-project-task-tasks.md#pt-t5)
owns actual delivery and observed results. The local package `0.6.0` source was
`c19b064` with `dirty=true`, distinct from the clean hosted build reported below.
The complete gate passed 309 Go tests (109 top-level) and raw `1153/1155`
statement coverage. Its installed CLI workflow passed with two service and 38 CLI
processes reaped, its workspace and schema removed, no owned sessions, and an
actual `200`/`409` concurrent PATCH pair. All six production-budget probes passed,
including exact decoded limits and plus-one-byte refusals; their precise local
observations belong to the linked client report. Hosted CI and review for this
acceptance delivery are recorded by [PR #55](https://github.com/codetreker/daynight/pull/55);
the hosted receipt below establishes the tested clean build separately.

## Hosted installed CLI acceptance

[Run 39428165296](https://github.com/codetreker/daynight/actions/runs/39428165296)
passed all seven required checks for PR head
`e9a634aca23710ffe46723fcdb2cf8e7a75d56bf`. The actual clean build revision in the
server and installed receipts is `2e7b8da99cf4b5de6da9c8083446f84fd19f1daf`,
with `dirty=false`. Go `1.27.2` and PostgreSQL `18.6` produced binary SHA-256
`837f9dd3a990eb226db287127dc04c3223e5bd8fef5cc15fcf77d2c84dceef72`.
The downloaded raw profile independently passes the strict checker at
`1153/1155` statements.

`installed_cli_project_task_workflow` passed in 10,348 ms with two service
processes and 38 CLI processes started/reaped, its workspace and one schema
removed, and no owned sessions. Competing PATCH requests returned one `200` and
one `409`, with both request IDs retained. All six installed production-budget
cases passed; single/cumulative exact decoded limits succeed, their plus-one-byte
pairs fail with empty stdout, request timeout took 30,148 ms, and the advancing
cursor workload reached its total limit after 300,136 ms and 1,194 requests.
Every probe and the shared installation report successful cleanup with no
composite failures. The [client report](daynight-acceptance.md#observed-hosted-pt-t5-evidence)
owns the platform matrix and detailed budget table. [PR #55](https://github.com/codetreker/daynight/pull/55)
owns current review and integration status; these receipts do not claim that it
has merged or establish results for later revisions.

## Observed local evidence

### Service baseline

The complete T6 development-worktree command passed with Go 1.27.2 and
PostgreSQL 18.6:

| Check | Result |
|---|---|
| Build, vet and race tests | Passed |
| Go tests | 247, including subtests; 87 top-level |
| Strict coverage-checker tests | 9 passed |
| Raw statement coverage | 995/997, 99.7994% |
| Store/service/server packages | 100% each |
| Executable package | 88.2%; main 100%, run 87.5% |
| Actual binary scenarios | 12 passed |
| Owned child processes | 19 started, 19 reaped |
| Owned schemas | 12 removed |
| Owned PostgreSQL sessions | None remaining |

The local receipt honestly records its development checkout as dirty. It is not
a clean hosted receipt or a substitute for the source identity of a later CI
run. A controlled full command against an unavailable loopback PostgreSQL
endpoint failed nonzero and wrote a failed receipt; the positive and negative
receipts were kept separate. The earlier same-configuration stopped-database
control also confirmed that cached coverage cannot hide database unavailability.

### Complete graph extension

The W-T1 complete-graph implementation passed the same full command with real
PostgreSQL 18.6 and Go 1.27.2: 289 Go tests (99 top-level), nine coverage-checker
tests, and raw 1085/1087 statement coverage (about 99.82%). Store, service and
server remain at 100%; the existing executable coverage and all 12 process
scenario groups remain unchanged. The local receipt records the dirty
implementation worktree, so hosted source identity must still be verified from
the matching CI artifact.

The graph tests live in their owning store/service/server packages and count
toward those packages' coverage. They prove exact limits and independent
rejections, project isolation, bounded Unicode previews without description
materialization, a write interleaved between snapshot count and projection,
query cancellation, operational/transaction-completion precedence, and HTTP
DTO/query/method/cache/logging behavior. The browser application and new
built-process graph workflow are separate dashboard tasks; existing process
scenarios do not claim to exercise the new graph route.

### Embedded dashboard extension

The W-T5 full command passed with 307 Go tests (108 top-level), nine strict
coverage-checker tests and raw 1153/1155 statement coverage (about 99.83%). The
webui, store, service and server packages are at 100%; the executable remains
88.2%. No product exclusions were added. The existing 12 process groups still
started/reaped 19 children, removed 12 schemas and confirmed no owned sessions.
The local receipt records the dirty development worktree; it is not clean hosted
source evidence.

Owning HTTP tests cover actual embedded index/assets, exact root and project
routes, HEAD, MIME, no-store/immutable cache headers, asset directories/missing
files/traversal, API JSON 404, method handling and one logging wrapper. Failure
paths preserve error chains and do not write a second body after a response-writer
failure. Latest task-detail reads use no-store. Filesystem publication tests
exercise invalid outputs and replacement/rollback behavior before Go compilation.

The shared Dockerfile built the complete UI/server image without host generated
assets. Through the isolated dev-ci gateway, actual HTTP checks passed page,
asset/cache/HEAD, deep-link and API/graph requests, verified the running image ID
and retained project/task data after whole-stack recreation. Owned resources
were removed. Concurrent real runs proved distinct ports, volumes and datasets;
removing one left the other usable and final cleanup succeeded. These HTTP and
orchestration observations do not claim the full W-T6 production-browser workflow
or boundary-size performance gate. The
[web evidence report](daynight-web-acceptance.md) owns the deployment proof's
scope and remaining requirements.

## Requirement evidence

The binary suite is in
[acceptance_test.go](../../packages/daynight-server/cmd/daynight-server/acceptance_test.go),
with build/process/evidence ownership in
[acceptance_process_test.go](../../packages/daynight-server/cmd/daynight-server/acceptance_process_test.go).
It is part of the existing command package, not an uncovered production helper.

| Requirement | Observable evidence |
|---|---|
| V1: persistent resources | `workflow_restart_persistence`, `graceful_sigterm_drains_committed_request`, `forced_sigterm_cancels_without_late_write`; full objects survive actual process restart and listener reuse |
| V2: dependency refusal and rollback | `refusals_scopes_filters_and_cursors`, `partial_write_http_failure_rolls_back`; rejected writes preserve the complete task; a sequence proves metadata and the first edge were changed before the injected failure |
| V3: concurrency and project independence | `concurrent_reverse_dependencies`, `canceled_request_and_independent_project`; exact owned backend waiters prove competing requests and independent progress |
| V4: state gates | Workflow/refusal scenarios plus `concurrent_reopen_and_start`; package service tests cover all state pairs and candidate updates |
| V5: revisions and no-ops | Workflow/refusal scenarios and `concurrent_same_version`; actual changes compete on one version and matching semantic no-ops retain fields/timestamps |
| V6: listing and HTTP contract | Refusal/filter/cursor scenario and owning HTTP/service tests cover tied keysets, scoped filters, initialized empty resources, DTOs and error mapping |
| V7: transactions and lifecycle | Partial failure, request cancellation, graceful/forced signal, unsupported/failed migration history and concurrent startup scenarios; owning store tests prove the finer snapshot and cross-migration interleavings |
| V8: coverage and race gates | `scripts/check.sh`, `.go-cov.toml`, raw profile and the nine exact-boundary/malformed-profile tests |
| V9: mandatory infrastructure and complete CI | Missing/unavailable PostgreSQL fails the command; test-result expiration preserves real observations; workflow aggregate requires native CLI and Go jobs |
| V10: correlation and privacy | Workflow/refusal/partial-failure/cancellation/startup scenarios verify HTTP request IDs, canonical resource IDs, structured categories and absence of submitted secret markers from logs |

The deterministic unit-level snapshot and lock proofs remain in their owning
packages: `TestQueriesSnapshotRetainsCompleteOldGraph`,
`TestTaskSnapshotKeepsProjectAndDerivedTaskStateConsistent`, and
`TestMigrationsSessionLockSpansCommits`. End-to-end execution supplements those
assertions without introducing production hooks or pretending to credit
cross-package execution to those packages' coverage.

## CI receipt

The Ubuntu Go job runs the same command. It publishes the
`daynight-server-acceptance` artifact with:

- `acceptance-evidence.json`: source Git/GitHub SHA, dirty state, Go/PostgreSQL
  versions, race-binary SHA-256, build/result state, scenario names and cleanup.
- `coverage.out`: the raw profile used by both go-cov and the strict total gate.

The source checkout must be clean and its revision must equal `GITHUB_SHA` when
that CI identity is supplied. A PR run normally tests a merge revision, so the
receipt's identity is the tested checkout, not an inferred branch head. Scenario
receipts update incrementally and retain failed results. The tested temporary
binary is removed after validation; its hash stays in the receipt.

For a successful delivery, inspect the artifact belonging to its exact workflow
run: build and result must be `passed`; all 12 scenario results and cleanup must
pass; process start/reap counts must agree; every schema/session cleanup must be
confirmed. Recompute the strict coverage comparison from the accompanying raw
profile instead of relying on the printed rounded percentage. A failed job or
partial receipt does not prove acceptance.

The process/signal suite runs in the Ubuntu Go job. Existing Linux, macOS and
Windows CLI jobs keep their complete workload and acceptance artifacts; the
aggregate needs all native platforms, the dedicated Linux shell completion job,
the Go job and the web job. The
[native probe decision](../../.agents/notes/implemented/bug-fix/2026-10-20-gh-cold-start-preparation.md)
records the separate gh cold-start evidence, selected-file preparation and shared
10-second deadline. Native versions and complete CLI validation remain required.

## Limits and follow-up

This evidence covers task-management HTTP behavior, PostgreSQL and foreground
process ownership. Authenticated remote deployment, task execution and PR
integration remain outside the confirmed service contract. The embedded read-only
UI is implemented; full production-browser and capacity acceptance remains W-T6
in the separate dashboard task document. The task document
tracks two nonblocking test-fixture improvements: earlier setup cleanup
registration and a stronger graceful-signal observation barrier. Neither changes
the implemented business behavior or the current successful gate's evidence.
