# Web Acceptance Evidence

The [requirements](../spec/daynight-web.md) own W1–W12, the
[architecture](../design/daynight-web.md) owns mechanisms, and the
[task document](../design/daynight-web-tasks.md) records delivery status.
This report owns observed validation and its practical limits.

## Local validation

Current W-T6 checks passed package typechecking, 296 functional tests and 36
Node tool tests with Node 24 and pnpm 10.34.5. The tool cases include the earlier
coverage/publication checks, browser-report/performance/process identity checks
and three Dagre differential regressions. The complete production-browser run
below also passed; its local source identity remains distinct from hosted CI. The raw V8 report contains
660 covered statements out of 666 across all 18 product TypeScript/TSX files
(about 99.10%). Exact integer comparison confirms coverage strictly above 90%.
The browser entry, request hooks, canvas and drawer are included; no product
filename exclusions supply that result.

Typechecking retains exact optional properties and checks dependency declarations.
The pinned XYFlow system patch changes only two declaration lines. Static tests
confirm custom-node data/literals and base assignment, and reject explicit
undefined source/target positions. Test-only DOM measurement shims support
React Flow component tests; actual geometry is verified separately in Chromium.

The shared build publishes validated real UI assets into the Go embed directory.
Publication tests cover index references, nonregular output, complete replacement,
rollback, failure propagation and the command entry. Current CLI typechecking,
build and 1,057 tests with ten platform skips passed.

The W-T6 Go full gate passed 307 tests (108 top-level), nine checker cases and
raw 1153/1155 statements (99.8268%), with no product exclusions. Store, service,
server and webui remain at 100%. All 12 process scenarios passed, 19 children
were reaped, 12 schemas were removed, and owned sessions, the test container and
its named volume were cleared. The earlier W-T5 integration also passed its two
installed CLI suites and actual Bash 4.2/modern Bash/zsh completion acceptance;
those historical observations do not establish a new hosted current-head result.

## Complete local production-browser result

Run `20261020103753-bbbed443-8f6c-402c-be61-46b91fe54827` passed both targets,
all fixed capacity measurements and cleanup. It ran on Linux x64 with Node
24.19.0, pnpm 10.34.5, Playwright 1.64.1, its bundled Chromium 156.0.8078.4
(revision 1248, no executable override), Go 1.27.2 and PostgreSQL 18.6.

| Evidence | Observed result |
|---|---|
| Native production target | 12 scenarios passed; eight functional plus four capacity/limit scenarios |
| Container production target | All eight functional scenarios passed through the dev-ci stream gateway |
| Browser geometry | Seven-node real-CSS regression passed physical card/handle bounds and exact Dagre edge-path assertions |
| Capacity | Three fixed graphs, five expansions each; all original 3,000ms/300ms budgets passed |
| Independent node limit | 1,001 nodes/0 edges returned 409 with exact limits and no partial graph/statistics |
| Independent edge limit | 1,000 nodes/5,001 edges returned 409 with exact limits and no partial graph/statistics |
| Original result/cleanup | Both `passed`, including native database/process, Chromium/profile and dev-ci resources |
| Outer recovery | `passed`, retained the original successful evidence and separately recorded absent native process and recovered dev-ci cleanup |

The receipt identifies Git base
`9eb4293627eaf94448c4fda7bb0e6f4e99b2b41c` with `dirty: true` and no GitHub SHA.
It describes the tested development worktree, not a committed clean delivery
revision. Native binary SHA-256 is
`0d749afd281b81014114fb96f2806e117e6b162557b66b9b2f9e6b53311d83d4`.
The dev-ci run is `20261020104138-878457-01853`, with built/running image
`sha256:197f4a783428496f623239935b3eaf18095156b3057ce594858c58b7116f7f1d`.

### Fixed capacity measurements

Durations below are milliseconds, rounded only for display. Each gate compared
unrounded raw values. Every maximum is over the same graph's five repetitions;
maxima in different columns need not come from the same repetition.

| Dataset | Nodes/edges | Five collapsed-root open times | Max layout | Max render | Cold navigation | Graph network |
|---|---|---|---|---|---|---|
| Chain | 1,000/999 | 729.3, 680.3, 666.9, 677.6, 714.7 | 244.5 | 484.0 | 1959.7 | 14.2 |
| Merge | 1,000/5,000 | 1978.0, 2077.9, 2054.0, 1954.5, 1863.6 | 1014.6 | 1097.7 | 4045.9 | 30.0 |
| Shared roots | 1,000/5,000 | 2145.4, 2286.2, 2253.0, 2173.7, 2330.6 | 1102.1 | 1277.2 | 4566.3 | 23.0 |

| Dataset | Max detail local feedback | Max detail network | Max zoom | Max pan |
|---|---|---|---|---|
| Chain | 89.5 | 3.820 | 52.1 | 38.5 |
| Merge | 193.0 | 4.682 | 74.3 | 72.1 |
| Shared roots | 231.9 | 4.454 | 81.2 | 78.7 |

Cold navigation includes page/asset loading and the first graph request/render;
it is recorded separately and is not one of the five collapsed-root openings.
The declared budgets apply to every measured opening and each local interaction,
not an average or a network-inclusive navigation promise. The raw performance
receipt retains all 15 full measurement records, graph/detail network values,
layout/render times and independent limit results.

These are local fixed-topology observations under the stated browser/environment.
API-generated UUIDs may change layout tie ordering between isomorphic runs.
Normalized rank spans can also change layout cost; this matrix does not establish
the same latency for arbitrary DAGs. Clean hosted source/image and performance
receipts remain required before delivery. The separate real-Docker fault matrix
below supplies startup/test-failure, cancellation and cleanup-failure evidence
beyond the normal browser run and controlled lifecycle fixtures.

## Production acceptance command and receipts

After the [browser prerequisites](../../packages/daynight-web/README.md#production-browser-acceptance)
are installed, run from the repository root:

```bash
pnpm web:acceptance
```

The harness builds embedded production assets and a new Go executable, owns an
isolated PostgreSQL 18.6 instance and native listener, then runs the functional
suite again through the actual dev-ci production-image gateway. Native acceptance
requires 12 stable scenarios; container acceptance requires the same eight
functional scenarios. Capacity runs only against the native production process.
Fixtures, including capacity datasets, use the real project/task write APIs.
Page requests remain GET/HEAD. The complete local run above passed this command;
clean hosted acceptance remains pending.

| Requirement | Production evidence and hosted requirement |
|---|---|
| W1 | `project-list`: more than 50 projects, cursor requests, unique cards and navigation to the later-page project |
| W2 | `project-graph` and `deep-links`: project entry, direct HTML reload and browser history |
| W3–W4 | `project-graph`, `refresh-staleness` and `failure-recovery`: exact statistics, distinct root progress, consistent full refresh and retained old snapshot after failure |
| W5–W7 | `project-graph`, `keyboard-focus` and capacity cases: complete source-root projections, shared/external prerequisites, state markers and viewport/node actions |
| W8 | `detail-navigation` and `refresh-staleness`: current content, relation navigation and readiness differences without revising a dependent task |
| W9 | `failure-recovery`, `deep-links` and `capacity-limits`: actual owned-database failure/restoration, correlated errors, empty/not-found states, delayed request replacement and full size refusal |
| W10 | Both native and container functional targets, exact image identity and dev-ci cleanup receipt |
| W11 | Strict raw Go/V8 reports, validated complete browser/performance receipts and the required CI aggregate |
| W12 | `keyboard-focus` and `narrow-layout`: actual modal focus lifecycle, keyboard node activation and 320px page geometry |

The report parser requires first-attempt success, a unique complete stable-scenario
set, valid owned PNG screenshots, consistent totals and no skipped/flaky/global
errors. CI checks a clean source revision equal to GITHUB_SHA and requires the
Linux Chromium version bundled by Playwright 1.64.1; a local executable override
is recorded and cannot satisfy that identity. The complete run must also confirm
native and dev-ci resource cleanup, with original errors preserved.

Each acceptance run incrementally writes
`packages/daynight-web/.tmp/acceptance/<run-id>/evidence.json` and updates the
package's `.tmp/acceptance/evidence.json` latest receipt. Target directories keep
raw `playwright.json`, `browser.json`, screenshots and target state; native
performance remains in `native/performance.json`. The aggregate records source,
binary SHA-256, PostgreSQL/image/browser identities, target results, production
container receipt and cleanup outcome. CI archives the acceptance tree with
`.tmp/dev-ci/` as `daynight-web-acceptance`; the separate `daynight-web-coverage`
artifact retains `coverage-final.json`, source manifest and exact counters.

The datasets have fixed topology; task UUIDs are generated by the API, so layout
ties can differ across isomorphic runs. All five repetitions within one run use
the same exact IDs and graph. The fixed chain contains 1,000 nodes and 999 edges. Merge and shared-root datasets
each contain exactly 1,000 nodes and 5,000 edges. Every dataset requires five
collapsed-root expansions with full node/edge DOM counts and a painted, readable
source root. Timing begins at a trusted browser input event timestamp and ends
after the browser condition and two animation frames; automation setup and trace
snapshots are outside the interval, while browser event queue time remains inside. Every opening must be at most 3,000ms; task-detail local feedback,
zoom and pan must each be at most 300ms. Graph and detail network times are
recorded separately. Each expansion records `layoutMs` for projection/Dagre
and `renderMs` from layout completion through complete DOM/readable root and two
animation frames; `openMs` remains the full budget. The bounded latest
`daynight:task-layout` measure identifies only the selected root. Independent node-only and edge-only over-limit cases require
409 counts of 1,001/0 and 1,000/5,001, with neither partial graph nor statistics.
Missing, malformed or over-budget measurements fail the gate.

### Cleanup evidence and recovery interpretation

The required outer cleanup command is
`node packages/daynight-web/scripts/acceptance.mts --cleanup [run-id]`. It uses the
latest receipt by default and leaves resources unchanged when no receipt exists.
The original runner, callback/Playwright processes and their owned groups must
already be stopped. Linux
PID/executable/start-time evidence, native binary hash and exact Docker ownership
limit recovery to the recorded run. Chromium group/profile receipts and markers
are checked separately; unidentified startup resources or uncertain orphan
ownership fail rather than being removed by a broad process/profile sweep.

Recovery writes separate `recovery.json` files and preserves the original result.
A successful local hard-SIGKILL probe confirmed that recorded Chromium processes
and their owned project-local profile were removed after the Playwright CLI was
killed. Recovery of a failed exploratory acceptance run also passed while keeping
its failed original receipt. The complete successful run above additionally confirmed cleanup and outer
recovery. None of these local observations establishes a clean hosted source
identity; failed exploratory results stay failed and are not reused as passing
capacity receipts.

## Real Docker deployment-fault matrix

The local manual probe `fault-1792493712152-d0ae9b41` passed all four fault cases
and final cleanup using the unchanged `deployment/dev-ci/run.sh` against a real
Docker daemon. A separate baseline B stack remained alive throughout. Its UI and
API returned 200 and the same project sentinel survived after every case and
while the cleanup-failure volume was busy. These operations used only uniquely
owned test projects; the normal localhost stack was not touched.

| Case | Real fault and expected observation | Cleanup observation |
|---|---|---|
| Startup mid-failure | Stop the verified owned PostgreSQL during startup; runner exits 1 and never calls the callback | Run resources removed; B remains healthy |
| Callback failure | Callback exits 23 after starting a background heartbeat descendant; runner preserves 23 exactly | Descendant/heartbeat stops and resources are removed; B remains healthy |
| Signal cancellation | Send SIGTERM to the verified runner; result is 143/cancelled | Callback group and resources are gone; B remains healthy |
| Cleanup failure/recovery | A verified read-only holder keeps the run's named volume busy; runner exits 1 and reports cleanup failed | Remove only the verified holder, then recover by recorded run ID; recovery passes and the original failed manifest stays unchanged |

The tested identities are retained independently for each built/running image:

| Project role | Run ID | Image ID |
|---|---|---|
| Baseline B | `20261020105512-919474-25541` | `sha256:9a8c40653c0559dce28177bc24e8fae627ad832af8d1208e6c82bc83678a629a` |
| Startup fault | `20261020105525-920602-23589` | `sha256:f34d66c07b525d35652e7b64bc48c1fb590c5868790644165675cbcb55c3d28d` |
| Callback fault | `20261020105527-921649-04664` | `sha256:ddb882115819241b4479b0a3d05eacb965614626ac1776431584b7d97a149da1` |
| Cancellation | `20261020105541-923446-26381` | `sha256:7607312d698cd6a8a93f6975ec6f88847e20877ca7f1140d78f3cfff8af3bdc6` |
| Cleanup fault | `20261020105554-925330-18788` | `sha256:7edcd8b1a115a5d02dbf0164d1c33c4b08b5d53d57024241662cee301581d66b` |

The source receipt records base
`9eb4293627eaf94448c4fda7bb0e6f4e99b2b41c`, `dirty: true`, tracked-diff SHA-256
`28516c9a74796961cba4c486812e4bf480785b4cb7d1e9954729e711205cd627`, Dagre tool
SHA-256 `2fd4316cd30b6bd023297cf9984c690b8cb1e614fc76a7e0f85c13658e1ce713`
and runtime-patch SHA-256
`142fd75deec2b03c9d6839bcdb87804ff902b25f9af621d6f8140b52c765ef7b`. These
fingerprints identify local evidence; they do not substitute for clean CI source.

The earlier probe `fault-1792493614390-6bf49cd9` retained passing product-case
observations but a failed auxiliary cleanup receipt: its case-sensitive
post-cleanup classifier misread Docker's lowercase missing-object response.
That original report was preserved. After correcting only the temporary probe,
the second complete matrix passed. An independent final audit checked both
rounds: all ten run resource sets had zero containers, volumes, networks or image
tags, both holder sets were empty, and all ten recorded process sets had no live
members. The product runner was unchanged between those two probes.

The committed [lifecycle evidence](evidence/daynight-web-lifecycle.json) preserves
the original first report, second passed report and independent final audit
unchanged inside a versioned provenance wrapper. It retains the failed auxiliary
classification, per-case source/image identities and all ten resource/process
observations after task-local files are removed. Historical loopback origins,
run IDs and relative source paths are evidence, not operator configuration. The
artifact contains no user-specific absolute paths, task bodies, SQL, database
connection strings or credentials.

This is manual dirty-worktree acceptance, not clean CI evidence, a new CI harness
or a claim that CI repeats the fault matrix. CI continues to run the 12 controlled
lifecycle fixtures and complete real production-browser suite, archiving its own
clean tested-source/image and performance receipts. Hosted delivery remains
required.

## Historical real API browser check

The W-T4 local production bundle was served by Vite preview with an API proxy to an
actual built Go service and isolated PostgreSQL 18.6. The service used an owned
ephemeral loopback port and named test volume. Projects and the workflow tasks
were created through existing HTTP APIs. Chromium 151.0.7922.34 verified:

- Project list → project page, six exact statistics and root-main progress.
- Left-to-right node positions, arrow paths, shared descendants and explicit
  external prerequisites, with only one root expanded.
- Mouse, Enter and Space node activation; relation navigation in the drawer.
- Portal/background inertness, dynamic Tab cycling, Escape and focus restoration.
- An API prerequisite completion that changed a dependent task's readiness
  without changing its own timestamp or version. Live detail showed staleness;
  manual graph refresh updated counts and dependencies together.
- Zoom, fit, deep-link reload, empty projects and 320/390/768px page geometry.
- A controlled interrupted refresh that retained the earlier snapshot and
  recovered on retry. This interruption was injected by the browser harness;
  it is not evidence of a database outage test.

No page exceptions or browser-originated write requests occurred. The
[project screenshot](assets/daynight-web-project.png) and
[detail screenshot](assets/daynight-web-detail.png) use generated test data.

## Historical capacity probe

A separate owned PostgreSQL fixture contained a valid 1,000-node chain seeded
directly for a rendering probe. The real graph API and production browser page
rendered 1,000 nodes and 999 edges in about 1.24 seconds from navigation in one
local run, with the selected root visible at the initial readable zoom and no
page exception. Direct SQL seeding here does not validate task creation policy.

This is a single local geometry/timing observation, not the required five-run
Linux CI performance verdict, not a 5,000-edge capacity result, and not a
guarantee across machines or graph shapes. W-T6 owns those fixed-dataset gates.

## W-T5 embedded HTTP and deployment checks

W-T5 built the shared production Dockerfile from repository sources without host
`node_modules` or prebuilt assets. The Node 24/pnpm 10.34.5 stage consumes the
locked declaration patch, the Go 1.27.2 stage embeds real assets, and the final
nonroot runtime contains only the executable. The localhost and dev-ci effective
Compose configurations were compared for build inputs, stream forwarding,
shared network namespace, database privacy and persistent storage. The normal
localhost stack was neither started nor modified by these tests.

The actual dev-ci HTTP smoke was run again after integration with the current
mainline. It verified root HTML, hashed assets/cache/HEAD, project deep-link,
API and complete task graph, built/running image identity, and data retention
after recreating all three services. The run receipt reported passed cleanup.
Two concurrent real dev-ci runs used distinct loopback ports, database volumes
and test data. Cleanup of one left the second healthy with its own data; both
finally confirmed cleanup. These observations validate the Docker production
path and isolation but do not exercise every browser interaction.

Twelve Bash cases with controlled Docker commands passed success, invalid
identities, build/partial-startup failure, wrong image identity, callback failure,
cleanup failure, recovery, cancellation and remaining callback descendants. The
runner owns the process group after its leader exits. Recovery preserves the
original manifest and records a separate result, and requires the original
runner/callback group to be stopped first. Controlled orchestration cases do not
prove the corresponding real Docker failure paths.

Local run manifests, image/port/resource identities and concurrent-isolation
receipts are temporary evidence under `.tmp/`; they are not stable source or CI
artifacts. The complete W-T6 local production run above extends this scope with
browser and performance results. Delivery still requires matching clean hosted
source/image identities and archived browser, failure/cleanup and performance
receipts.

## Required delivery evidence

Local worktree checks do not establish a clean hosted source identity. The
required web job publishes raw `coverage-final.json` and `summary.json`; its
source manifest and exact counters must be checked against the corresponding run.
Go retains its independent raw-profile gate and native CLI validation remains
required by the aggregate check.

Embedded Go UI, localhost integration, the isolated dev-ci environment and the
production-browser harness are implemented, and complete local browser/capacity
acceptance passes, and the separate real-Docker deployment-fault matrix passes
with independent resource/process cleanup. W-T6 still requires the delivery PR's
clean hosted source/image
evidence, real required-check results, independent review and approval. The
W-T4 preview and W-T5 HTTP smoke observations retain their historical scope; the
complete local result supplies the separate production-browser measurements.

The required aggregate retains every native CLI platform, the dedicated Linux
shell completion job, Go and web. Local success does not authorize describing
W-T6 as merged or the full delivery as complete.
