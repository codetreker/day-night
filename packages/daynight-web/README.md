# daynight-web

The private React/TypeScript workspace implements project browsing, cursor
pagination, request cancellation, runtime API decoding, native browser routing
and a pure dependency graph model with horizontal layout.
The project dashboard, task canvas and detail drawer are embedded into the Go
server for single-origin delivery. The [localhost deployment](../../deployment/localhost/README.md)
starts the full UI/API/database stack; [dev-ci](../../deployment/dev-ci/README.md)
provides an isolated instance of the same production build. Production-browser,
fixed-capacity and real Docker lifecycle validation and delivery status belong in the
[implementation tasks](../../docs/design/daynight-web-tasks.md).

The [requirements](../../docs/spec/daynight-web.md) own visible behavior and the
[architecture](../../docs/design/daynight-web.md) owns graph projection, request
lifecycles and delivery. The offline mockup illustrates the intended
workflow with fixture data and is separate from this application.

## Development

Use Node.js 24 LTS and pnpm 10.34.5. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm web:dev
```

Run the Go API separately on `127.0.0.1:8787`, using its
[configuration](../daynight-server/README.md). Vite proxies `/api` to that address
and listens on loopback. The project list requests 50 items per page, preserves
server order, and follows `nextCursor` through Load more. Repeated IDs count once.
Refresh discards old pages and cursors; late responses cannot repopulate them.

The application implements `/` and `/projects/{projectId}`, direct URL reload,
browser back/forward and a generic not-found page. A project shows six statistics
from one complete graph snapshot. Root rows expand one horizontal graph at a
time, including shared tasks and direct external prerequisites. Nodes open a
read-only detail drawer with dependency navigation and stale-data detection.

Refresh retains the last successful snapshot with an explicit loading/error
notice and replaces the full graph only on success. A resource change clears
previous-resource content immediately. Live detail never changes graph counters;
a changed prerequisite can alter readiness without revising the task itself.
The drawer offers a full graph refresh when that difference is observed.

The canvas supports pan, zoom and fit while editing and connection controls stay
disabled. Each node is one native keyboard button. A long graph starts with its
root visible at readable zoom; keyboard focus brings offscreen nodes into view.
The portal drawer locks background focus and scrolling, supports Escape and Tab,
and restores the original node or a current root/page heading on close.

## Validation and build

```bash
pnpm web:typecheck
pnpm web:build
pnpm web:test
```

The build typechecks the package and emits production HTML and hashed assets to
`packages/daynight-web/dist/`. `scripts/publish-assets.mts` validates the index,
its local asset references and ordinary files, prepares a complete staged copy,
and replaces `packages/daynight-server/internal/webui/dist/`. Failed validation
or publication fails the build; a failed swap attempts to restore previous assets
and reports both causes if rollback also fails.
The Go binary embeds the published output. Both generated directories are ignored
by Git, and clean server builds require this explicit build first. The Go
`scripts/check.sh` invokes the same command before build/vet/race/go-cov.
The existing root `build`, `test` and `acceptance` commands retain their CLI scope.

`web:test` runs coverage-checker, asset-publication and acceptance-receipt tool tests,
the full Vitest suite with V8 coverage,
then the exact statement gate. All `src/**/*.ts` and `src/**/*.tsx` files belong
to the product manifest, including the browser entry. Tests live outside `src`.
The checker independently compares that manifest against `statementMap` and `s`
in `.tmp/coverage/coverage-final.json`; missing runtime files fail even when they
were never imported by a test. Empty, malformed and incomplete reports fail.

The required comparison is `covered * 10 > total * 9` using BigInt. Exactly 90%
fails independently of display rounding. Pure-type declarations contribute zero
statements only after the pinned TypeScript compiler's emitted JavaScript proves
that they have no runtime body. Temporary native compiler inputs and outputs live
under this package's `.tmp/` and are removed after classification. Typechecking
remains a separate mandatory check; classification is not a substitute for it.

CI requires `verify-web` alongside the Go server, every native CLI platform and
the dedicated Linux shell completion job. The web job also tests the dev-ci runner
with controlled Docker fixtures. It uploads `coverage-final.json` and
`summary.json`, which records exact counts and the relative product-source
manifest. Coverage and acceptance artifacts are retained for 30 days. The
[implementation tasks](../../docs/design/daynight-web-tasks.md) retain validation
conclusions and link source-specific delivery evidence. The
[deployment decision](../../.agents/notes/implemented/architecture/2026-10-20-embedded-dashboard-deployment.md)
records embedded HTTP/container smoke checks and concurrent dev-ci isolation;
the [production acceptance decision](../../.agents/notes/implemented/testing/2026-10-20-dashboard-production-acceptance.md)
records the separate real-Docker fault matrix and its limits. CI repeats the 12
controlled lifecycle fixtures and full production-browser suite. Manual Docker
fault testing and controlled fixtures each retain their own evidence scope.

## Production browser acceptance

On a Linux host, with Go 1.27.2, Docker Engine 28+, Compose 2.20+ and Linux
containers available, run from the repository root to install the pinned browser
into the project:

```bash
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp/playwright-browsers"
pnpm --filter @codetreker/daynight-web exec playwright install chromium
pnpm web:acceptance
```

Use Node 24, pnpm 10.34.5 and a frozen dependency install first. Chromium requires
its normal Linux runtime libraries; CI installs them with Playwright's
`--with-deps` option. Locally, `DAYNIGHT_BROWSER_EXECUTABLE` can select an existing
Chromium executable. That override is recorded and is forbidden for CI delivery
evidence, which must use the browser pinned by Playwright 1.64.1.

The command builds real embedded assets and a new Go executable, then owns a
separate PostgreSQL container/volume and ephemeral loopback listener. Native
acceptance runs eight functional and four capacity/limit scenarios. The same
eight functional scenarios run through the actual dev-ci production image and
stream gateway. No normal localhost service or dataset is used. Functional and
capacity fixtures use the real write APIs; the page is checked to remain read-only.

Capacity uses fixed 1,000-node graphs: a 999-edge chain and two 5,000-edge graphs
for merges and shared roots. Each graph expands five times, with every opening
at most 3,000ms and local task/zoom/pan feedback at most 300ms. Network timings are
recorded separately. Each expansion also records projection/layout duration and
subsequent painted-render duration; these diagnostics do not replace the complete
opening budget. Independent 1,001-node and 5,001-edge cases require complete
409 rejection. Full node/edge DOM counts, readable root visibility and painted
feedback are checked; a successful process exit without complete reports fails.

The [functional scenarios](tests/e2e/workflow.spec.ts),
[capacity scenarios](tests/e2e/capacity.spec.ts) and
[acceptance runner](scripts/acceptance.mts) map to the
[W1–W12 requirements](../../docs/spec/daynight-web.md) as follows. Names are stable
scenario annotations validated in each target's report.

| Requirement | Production checks |
|---|---|
| W1 | `project-list`: more than 50 projects, cursor requests, unique cards and navigation to a later-page project |
| W2 | `project-graph`, `deep-links`: project entry, direct HTML reload and browser history |
| W3–W4 | `project-graph`, `refresh-staleness`, `failure-recovery`: exact statistics, distinct root progress, consistent full refresh and retained old snapshot after failure |
| W5–W7 | `project-graph`, `keyboard-focus`, `capacity-chain`, `capacity-merge`, `capacity-shared`: complete root projections, shared/external prerequisites, state markers and viewport/node actions |
| W8 | `detail-navigation`, `refresh-staleness`: complete current content, relation navigation and readiness differences without revising a dependent task |
| W9 | `failure-recovery`, `deep-links`, `capacity-limits`: owned-database failure/restoration, correlated errors, empty/not-found states, delayed request replacement and complete size refusal |
| W10 | Native and container functional targets, exact image identity and dev-ci cleanup receipt |
| W11 | Strict raw Go/V8 coverage reports, validated complete browser/performance receipts and the required CI aggregate |
| W12 | `keyboard-focus`, `narrow-layout`: modal focus lifecycle, keyboard node activation and 320px page geometry |

Receipts live in `packages/daynight-web/.tmp/acceptance/<run-id>/`, with the
latest aggregate at `.tmp/acceptance/evidence.json` inside this package. They
record source identity, native binary SHA-256, PostgreSQL/browser versions, each
target's raw Playwright report and screenshots, capacity measurements, container
image identity and cleanup outcomes. `CI` requires a clean checkout matching
`GITHUB_SHA`, Linux and the pinned browser. Playwright uses one worker and no
retries; skipped, flaky, duplicate/missing or incomplete scenarios fail validation.
The required web CI job archives `daynight-web-acceptance` separately from raw
coverage for 30 days. Inspect the artifact from the exact workflow run and its
tested checkout identity, which is normally a merge revision for PR runs. A pass
requires all 12 native and eight container scenarios, every fixed graph's five
timing repetitions, independent size refusals and confirmed cleanup/recovery.
Local receipts retain their source and browser identity; they do not establish
clean hosted delivery results. The
[implementation tasks](../../docs/design/daynight-web-tasks.md#w-t6) own durable
validation conclusions and source-specific CI and PR links. The
[paint decision](../../.agents/notes/implemented/bug-fix/2026-10-20-long-dashed-dependency-paint.md)
retains raster evidence and visual tolerances needed to assess that mechanism.

Capacity receipts also retain per-interaction `feedbackDiagnostics`: input,
capture, first ready condition, first/second frame and final end timestamps,
status/error and phase differences. Missing milestones stay null. Each repetition
attaches `*-chromium-trace.json` from CDP timeline/frame/GC/User Timing events,
without CPU sampling or CDP screenshots. These diagnostics preserve all original
total timing/readiness gates; they do not subtract queue/frame time or turn a
failed measurement into success. Scenario PNG evidence remains independent.

### Cleanup and interrupted-run recovery

The runner registers owned-resource cleanup before creating its database or
native process. Timeouts and cancellation stop owned command groups; browser
receipts identify the detached Chromium group and project-local profile as well.
A passing run requires confirmed native, browser/profile and dev-ci cleanup.

After the original runner, callback/Playwright processes and their owned groups
have stopped, run
from the repository root:

```bash
node packages/daynight-web/scripts/acceptance.mts --cleanup
# Select a retained run instead of the latest receipt:
node packages/daynight-web/scripts/acceptance.mts --cleanup RUN_ID
```

No receipt is a no-op. Valid receipts constrain recovery to recorded run/source
identities, exact Docker labels and names, and Linux PID/executable/start-time
identity. A still-running native Go process also requires its recorded binary
hash before targeted termination. Browser recovery checks its recorded executable,
process group and profile marker; ambiguous startup processes, orphan-only groups
or unknown new profiles cause failure and remain for diagnosis. It does not kill
unidentified processes or remove unidentified profiles. Dev-ci recovery uses the
same recorded project identity and bounded cleanup entry.

Recovery writes separate per-run/latest `recovery.json` receipts and preserves
the original acceptance outcome. A successful recovery does not turn a failed
browser or performance result into acceptance. The CI `always()` recovery step
and artifact upload retain this distinction; cleanup uncertainty fails the job.

## Dependency declarations

Dagre is pinned to 3.1.1 with a runtime pnpm patch for its public ESM and CJS
entries. The adapter uses one global longest-path ranker, preserving default
crossing minimization and alignment. The patch skips an empty flat-graph border
conflict scan and indexes equal truthy barycenters while preserving original
scan/tie/removal order. Exact differential geometry checks compare patched and
unpatched code under that same ranker policy. `scripts/dagre.test.mts`, included in `web:test`, reverses the committed patch
in memory and checks pristine published bundle hashes before comparing 23
fixtures across four directions and three rankers in both formats. Direct
barycenter/tie/removal assertions and license/source-map checks supplement exact
coordinate, edge-point, bounds and determinism comparisons. Upgrades must rerun
these regressions. Longest-path can lengthen edges and normalization depends on rank
spans; fixed capacity timings do not promise the same latency for arbitrary DAGs.
The [layout decision](../../.agents/notes/implemented/feature/2026-10-20-task-graph-projection.md)
owns those trade-offs.

React Flow is pinned to 12.12.0. Its system dependency 0.0.83 has a declaration-only
pnpm patch in the root `patches/` directory, referenced by the workspace and lockfile.
The patch restates a mapped generic's NodeBase constraint; it changes no runtime
bundle and leaves exact optional checking and library checks enabled. Type-only
assertions in `tests/xyflow-types.ts` protect custom fields and reject explicit
undefined positions. Frozen installs and container builds must include the patch.

## Boundaries

API errors expose fixed safe text and a validated request ID; raw response bodies
and server diagnostics do not reach the page. Project names and addresses render
as text. The API parser verifies DTO shape and resource identity. The implemented graph
model separately verifies dependency closure, acyclicity, status/readiness and
summary consistency. It projects root descendants plus direct external
prerequisites, caches distinct root progress, and marks shared tasks. The Dagre
adapter returns finite left-to-right node positions and routed edge points for
220-by-96 cards. The read-only React Flow canvas consumes these results without changing domain
objects. React Flow owns fixed task nodes, native ResizeObserver measurement,
keyboard behavior, viewport and controls. One memoized SVG in its public
ViewportPortal renders every exact Dagre path, with stable edge identity,
arrowheads, boundary dashes and accessibility semantics. It shares the viewport's
transform, so selection/pan/zoom reuse geometry without per-edge reactive state.
Canonical routes retain native arrow markers and full Dagre points. Dashed body
paint uses `dashes.ts` to derive locally horizontal rotated lines and short native
vertex paths, with the original 5/4 pattern and continuous positive arc-length
phase. Solid bodies remain native. Pieces are noninteractive and hidden from the
accessibility tree; canonical edges keep their existing identity/semantics. The
[paint decision](../../.agents/notes/implemented/bug-fix/2026-10-20-long-dashed-dependency-paint.md)
owns the pinned raster evidence, phase preservation and visual tolerances.
Initial placement uses known layout bounds after the viewport and positive
measured canvas dimensions are ready. Dependency geometry does not require
connection-port DOM or per-edge endpoint readiness.
Ordinary/selected canonical node variants retain unaffected references, and
memoized collapsed root rows keep a null selection until expanded. New snapshot
indexes still refresh all rows. The one-time initial viewport policy is separate
from explicit fit controls and does not run again on selection or pan.

Page hooks own requests and cancellation. Navigation or refresh invalidates the
previous request generation, continuation failures preserve loaded cards, and
unmount aborts owned work. There is no global task cache, editor, polling loop or
remote authentication flow in this workspace.
