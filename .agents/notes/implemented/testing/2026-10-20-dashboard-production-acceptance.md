# Agent Note: Production dashboard browser acceptance

Status: implemented

## Problem

Component tests and a preview server cannot establish that a clean Go build or
production image serves the dashboard correctly. Shared descendants, modal focus,
request replacement and capacity also depend on real browser behavior. A green
browser process can hide skipped or retried scenarios, incomplete measurements,
a mismatched image or cleanup failures unless its receipts are validated.

## Decision

`pnpm web:acceptance` builds real embedded assets and a fresh native Go executable.
It owns a PostgreSQL 18.6 container and volume with a unique label, waits for the
process's structured readiness message and runs production Chromium tests. It
then invokes the existing isolated dev-ci runner and runs the same functional
workflows through that production image's stream gateway. The normal localhost
stack and its data do not participate.

Eight stable functional scenarios cover pagination, graph/statistics, detail
navigation, freshness, database failure/recovery, direct routes, keyboard focus
and narrow layout. The native target also runs three fixed capacity datasets and
independent node/edge-limit rejections. Fixtures are created through real APIs;
the page is checked for read-only requests and uncaught exceptions. Database
fault injection verifies the disposable database's ownership before changing it
and restores the resource in a finally path. Browser routing barriers control
response ordering separately from actual backend-failure observations.

Topology is fixed while API-generated UUIDs can change layout tie ordering
between isomorphic runs. Five repetitions share the exact same graph and IDs.
Each capacity dataset has exactly 1,000 nodes: the chain has 999 edges, and merge
and shared-root datasets have 5,000 edges each. Five expansions per dataset must
all meet the 3,000ms click-to-painted complete-canvas budget. Task selection,
zoom and pan must each provide visible local feedback within 300ms. Network
readings remain separate. Each expansion records layout and painted-render
durations from one bounded latest-root User Timing measure; complete `openMs`
remains the performance gate. Each independent over-limit response must be a complete
409 refusal, with accurate counts and no partial browser graph or statistics.

Playwright runs one worker with zero retries. Report validation rejects global
errors, skipped/flaky/retried tests, duplicate/missing stable scenarios, missing
PNG screenshots and inconsistent summary counts. Performance validation requires
all fixed datasets, exactly five valid measurements per dataset, every budget
and both independent limit receipts. CI also requires Linux, the Chromium version
pinned by Playwright 1.64.1 and a clean checkout whose Git SHA equals GITHUB_SHA.
Local browser overrides and dirty state stay explicit in local receipts.

Incremental evidence records source/binary/database/browser identities, both
runtime targets, raw Playwright reports, screenshots, performance and dev-ci
image/cleanup results in the project. The required web job archives browser
acceptance independently of the raw V8 coverage report; it remains dependent on
successful execution and cleanup. Go and web each retain strict unrounded total
statement coverage above 90%, while all native CLI and shell completion gates
remain required.

Timing begins at the trusted browser input event's performance-clock timestamp
and ends after the full DOM/readable-root or feedback condition and two animation
frames. Event queue time remains included; automation actionability and diagnostic
snapshot work are excluded. All five repetitions and all original budgets remain
required. A bounded latest-root User Timing measure separates projection/Dagre
from subsequent rendering without a growing product telemetry history.

Each capacity dataset incrementally retains `feedbackDiagnostics` for every
interaction: trusted input, capture, first ready condition, first/second frame and
final end timestamps, status/error and phase differences. Missing milestones
remain null. The first condition/frame milestones do not replace the final end;
phase values are diagnostic observations, never deductions from the total budget.
Measurement failures and diagnostic/cleanup errors retain their joined causes.

One streamed CDP timeline/User Timing/frame/GC JSON trace per repetition correlates
those markers with browser work. The trace does not enable CPU sampling or CDP
screenshots; scenario PNG evidence stays separate. Bounded completion and resource
closure are required. This is test-side diagnosis for hosted zoom
latency, without changing thresholds, complete graph readiness or success rules.
Hosted traces show that earlier drawer-close raster/commit work can delay later
zoom frames even when the zoom handler is prompt. The budget still includes any
backlog visible after trusted input; work is not deducted because an earlier
interaction initiated it. Controlled raster ablations and pinned-engine evidence identify native dashing
of long oblique routes. The
[local-coordinate paint decision](../bug-fix/2026-10-20-long-dashed-dependency-paint.md)
retains native arrows, modal inertness and all canonical routes while changing
body paint. Production acceptance is delivered through
[PR #52](https://github.com/codetreker/daynight/pull/52); execution results remain
with the corresponding PR and CI.

Interrupted-run recovery checks that the original runner, callback/Playwright
processes and their owned groups have stopped,
then uses recorded Linux PID/executable/start-time identities, the native binary
hash and exact Docker ownership. Chromium has separate detached-group and
project-local profile marker receipts. Only confirmed groups/profiles are
reclaimed; ambiguous startup processes, orphan-only groups or unknown new
profiles fail recovery. A separate recovery result preserves the original
acceptance outcome and does not convert failed measurements into success.
The CI outer recovery step runs after every attempted acceptance invocation.

The pinned Dagre optimization is validated separately from browser timing.
Exact differential checks in both ESM and CJS compare complete geometry with the
unpatched implementation under the same global longest-path policy, while
all-node/edge direction and overlap assertions preserve graph completeness.
The mandatory native `scripts/dagre.test.mts` reconstructs pristine bundles in
memory from the committed patch with published SHA-256 checks. The 23-fixture,
four-direction, three-ranker matrix compares complete coordinates, edge routes,
bounds and repeated geometry through both public exports; direct tie/removal and
usedBias cases protect the ordered scan semantics. Real-browser graph checks also
keep the task-card bounds and the static SVG routes aligned through the public
viewport portal. Every edge's identity, exact canonical Dagre points, native
arrows and pan/zoom transform remain asserted; native node measurement remains
enabled. The open/initial-ready count check includes the declared safe-integer
paint-piece count and actual body-piece DOM, in addition to every node/button and
canonical route. Independent CTM/arc reconstruction checks full ordered coverage,
phase continuity, gap-midpoint seams and native joins after the five timed
repetitions, adding no readback or idle wait between drawer close and zoom.
The [layout decision](../feature/2026-10-20-task-graph-projection.md) owns ranking,
normalization costs and the version-specific redundant-scan patch. Neither the
pure benchmark matrix nor geometry equivalence establishes arbitrary-DAG browser
latency; the full production gate still owns its fixed capacity verdict.

The [embedded deployment decision](../architecture/2026-10-20-embedded-dashboard-deployment.md)
owns production build and dev-ci resource topology. The
[architecture](../../../../docs/design/daynight-web.md) owns harness structure and
execution requirements, and the [task document](../../../../docs/design/daynight-web-tasks.md)
owns delivery status. Source-bound browser artifacts and the corresponding PR
and CI run retain measured outcomes under the
[validation evidence decision](../process/2026-10-20-source-bound-validation-evidence.md).

## Alternatives

No alternative harness target architecture was selected. Rendering alternatives
belong to the [dashboard decision](../feature/2026-10-20-project-task-dashboard.md). The adopted
[MVP design](../architecture/2026-10-20-task-dashboard-mvp-design.md) already
requires real production targets, isolated PostgreSQL and independent strict
coverage. This decision specifies the evidence checks needed to enforce those
requirements rather than changing the application or deployment choice.

## Consequences

The browser gate requires Docker, Go and pinned Chromium in addition to Node/pnpm.
It takes ownership of temporary processes, database resources and a dev-ci run;
completion requires their confirmed cleanup. Raw and derived receipts are both
retained so a rounded percentage, exit code or summary cannot replace the
underlying measurement.

The pre-static-SVG local run passes both production targets, all fixed datasets
and repeat counts, independent limit refusals and cleanup/recovery. Its dirty
source identity is explicit. The first hosted shared-graph zoom measurement
exceeded 300ms; its failed result is retained. The single static edge SVG keeps
all original graph completeness and timing gates. Its new complete local native
and container run passes, including all fixed datasets/repetitions, independent
limits, SVG coordinate/endpoint alignment and cleanup/recovery. Later native-dash
SVG hosted runs exceeded the budget; the local-coordinate body fix is delivered
with production acceptance in PR #52. A separate
real-Docker matrix passes
startup/test-failure,
cancellation and cleanup-failure/recovery while a second stack retains its
HTTP/data sentinel. It predates the SVG change and tests unchanged deployment
lifecycle code, not the new UI image identity. Its final audit confirms no owned
resources or processes remain. That local manual matrix is distinct from CI's
controlled lifecycle and
production-browser suites. W-T6 is complete; the
[task document](../../../../docs/design/daynight-web-tasks.md#w-t6) links its
delivery PRs and source-bound CI verification. Historical preview and HTTP
smoke evidence remains labeled by its actual scope, and fixed-topology results
do not
establish arbitrary-DAG latency.
