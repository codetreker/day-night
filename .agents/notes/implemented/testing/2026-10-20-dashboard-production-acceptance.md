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
keep declared node/handle geometry aligned with physical CSS bounds and verify
Dagre route points rather than substituting hidden handle centers.
The [layout decision](../feature/2026-10-20-task-graph-projection.md) owns ranking,
normalization costs and the version-specific redundant-scan patch. Neither the
pure benchmark matrix nor geometry equivalence establishes arbitrary-DAG browser
latency; the full production gate still owns its fixed capacity verdict.

The [embedded deployment decision](../architecture/2026-10-20-embedded-dashboard-deployment.md)
owns production build and dev-ci resource topology. The
[architecture](../../../../docs/design/daynight-web.md) owns harness structure and
execution requirements, the [acceptance report](../../../../docs/research/daynight-web-acceptance.md)
owns measured outcomes, and the [task document](../../../../docs/design/daynight-web-tasks.md)
owns delivery status.

## Alternatives

No separate runtime architecture was reconsidered for this task. The adopted
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

The complete local run passes both production targets, all fixed datasets and
repeat counts, independent limit refusals and cleanup/recovery. Its dirty source
identity is explicit. A separate real-Docker matrix passes startup/test-failure,
cancellation and cleanup-failure/recovery while a second stack retains its
HTTP/data sentinel. Its final audit confirms no owned resources or processes
remain. That local manual matrix is distinct from CI's controlled lifecycle and
production-browser suites. Exact-source hosted CI, independent review and
approval remain required before W-T6 is complete. Historical
preview and HTTP smoke evidence remains labeled by its actual scope, and fixed-topology results do not
establish arbitrary-DAG latency.
