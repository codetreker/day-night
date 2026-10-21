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
lifecycles and delivery. The [task property requirements](../../docs/spec/daynight-task-properties.md)
and [design](../../docs/design/daynight-task-properties.md) own PR associations.
The [attachment requirements](../../docs/spec/daynight-task-attachments.md),
[architecture](../../docs/design/daynight-task-attachments.md) and
[Web decision](../../.agents/notes/implemented/feature/2026-10-21-task-attachment-web.md)
own single-file management, previews and their independent state. The original
offline dashboard mockups remain separate from the application; the attachment
development mockup below reuses the real components with a frontend-only fixture.

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
from one complete graph snapshot. Root rows appear newest creation first, with
descending IDs breaking equal-time ties. The view reverses the exact API root
sequence without reducing timestamp precision; updates do not move older roots.
Fully completed chains are hidden by default, including completed standalone
tasks. A completed root with unfinished descendants remains visible. The native
Show completed chains checkbox reports the completed-chain count and remembers
its per-project choice; the heading shows visible/total chains. Project counters
and every displayed graph retain the complete snapshot. Filtering rows makes no
API request. The complete graph index and API ordering stay unchanged. Rows expand one
horizontal graph at a time, including shared tasks and direct external prerequisites.
Per-project browser
preferences retain the expanded root or an explicitly collapsed list across reloads
and navigation. First visits open the newest visible root; a missing or hidden
saved root selects the current newest visible root while an existing visible
saved root stays open. With no visible roots, the saved ID or explicit collapse
is retained for revealing those rows again. The all-complete state offers a
reveal action that focuses the persistent checkbox before the action disappears. Loading, failed initial reads and empty graphs do not record
an inferred collapsed preference. Storage failures display a notice while the
current page remains usable. Preferences do not save detail selection or canvas
positions and do not change server data. The visibility preference has its own
record, preserving the existing expansion record format. The [preference decision](../../.agents/notes/implemented/feature/2026-10-21-task-browsing-preferences.md)
records this ownership. Nodes open a detail drawer with dependency navigation,
PR associations, stale-data detection and attachment management. Task fields and
graph interactions remain read-only. The PR section follows the description and
displays every ordered title/URL pair, including duplicates. Lists longer than 100 entries use local
100-row pages with a range/total announcement, Previous/Next controls and direct
page selection. The complete ordered list stays in memory; changing pages makes
no requests and imposes no storage or content limit. Replacing the task or
property collection returns to the first page. Focus stays on current pagination
controls or moves to the section heading when those controls disappear.
Empty strings have a display-only marker;
whitespace and long content remain selectable text and wrap within the drawer.
Only absolute HTTP(S) addresses recognized by the browser URL parser become
links, with a new tab and `noopener noreferrer`. Other strings remain plain
text; values are never interpreted as HTML or fetched for metadata. Property
changes are managed through the CLI or API.

The detail decoder requires `properties.pullRequests` with string `url` and
`title` fields. Missing or malformed structure produces the existing detail
error and retry state. It preserves string content, including NUL and arbitrary
address text, without defaults or content validation. The graph decoder retains
its compact projection and never copies properties into graph nodes.

Refresh retains the last successful snapshot with an explicit loading/error
notice and replaces the full graph only on success. A resource change clears
previous-resource content immediately. Live detail never changes graph counters;
a changed prerequisite can alter readiness without revising the task itself.
The drawer offers a full graph refresh when that difference is observed.
Reopening or refreshing details reads current PR associations; an attribute
update changes the task timestamp and uses the same stale-snapshot prompt.

The canvas supports pan, zoom and fit while editing and connection controls stay
disabled. Each node is one native keyboard button. A long graph starts with its
root visible at readable zoom; keyboard focus brings offscreen nodes into view.
The portal drawer locks background focus and scrolling, supports Escape and Tab,
and restores the original node or a current root/page heading on close. Focusable
controls are enumerated with `tabbable` 6.5.0 using its normal browser visibility
checks. Same-origin preview frames bridge Escape and first/last Tab boundaries
back into that drawer lifecycle. Passive unmount restoration remains responsible
for focusing a surviving trigger after DOM removal.

## Task attachments

The section after PR associations lists the task's path-addressed files as a
nested tree. Select one local file, accept its name as the initial target or edit
the relative path, then upload. MIME is selected from the target path with `mime`
4.1.1. Uploading the same path overwrites that file. Each file offers download
and deletion; successful writes refresh only the attachment list and preview.
They do not change the task version, timestamp or graph snapshot.

The attachment hook owns list, write, selection and preview state for one
project/task identity. It follows all pages, keeps already-read files when a
later page fails and labels the result incomplete with a retry action. Scope
changes and unmount cancel requests; generations discard late results. List,
write and preview errors stay local. An overwrite or a refreshed `updatedAt`
reloads the selected content and remounts native previews; the server's
`Cache-Control: no-store` keeps mutable paths current.

Markdown uses `react-markdown` 10.1.0 with `remark-gfm` 4.0.1 for CommonMark and GFM
including tables. Raw HTML remains escaped. Relative images and links resolve
from the Markdown file's directory to the task preview route; standalone `#fragment`
links remain on the rendered document. Paths that escape the task root are
rejected. Text, JSON and source previews preserve text and newlines. Images use
native image loading with error/retry feedback; PDF and HTML use native iframes.
HTML/PDF first check preview availability with HEAD and never decode a HEAD error
as a JSON body. The frame then performs normal resource requests.

HTML loads the fixed same-origin
`/api/v1/projects/{projectId}/tasks/{taskId}/preview/{path...}` URL. Its CSS, JS,
images and relative fetches follow normal browser URL rules. HTML is trusted
project code with main-origin privileges; the ordinary iframe has no sandbox.
There is no separate preview modal, session token, domain or Service Worker.
Other formats show metadata and a download link. Files and metadata can diverge
after a failed write under the accepted K1 limitation; the UI reports errors and
does not implement reconciliation or rollback.

### Frontend-only attachment mockup

Run `pnpm web:dev` and open `/tests/mockups/attachments.html` on Vite's printed
origin. `tests/mockups/main.tsx` renders the production attachment components and
CSS with `tests/mockups/fixture.ts`; metadata changes remain in memory and native
previews use local fixture files. Choose files, empty or upload-error scenarios,
and exercise upload, overwrite, preview, download and deletion without Go,
PostgreSQL or network API calls. Refreshing the page resets fixture state.
Object URLs stay valid through deletion and are released when the fixture is
disposed. This development entry is excluded from the single-index production
build.

The mockup validates appearance and frontend behavior. Local browser probes also
exercise the actual portal drawer, background inertness, CSS-hidden controls,
contenteditable frame boundaries, Escape/Tab release and trigger restoration.
The probe receipts and screenshots live under the task's `.tmp/a-t4/`; a local
existing Chromium override is recorded and does not establish pinned CI-browser
or real-backend delivery. JSDOM uses an upstream `tabbable` test wrapper because
it lacks layout; those unit tests do not prove browser visibility. A-T6 owns the
new real-service attachment journeys and their production CI inventory.

## Frontend-only task browsing mockup

Run `pnpm web:dev` and open `/tests/mockups/browsing.html` on Vite's printed
origin. The fixture mounts the production project page and CSS with mixed,
fully completed and empty project graphs. It demonstrates the exact
newest-first root order, shared dependencies, current task details and per-project
expanded/collapsed and completed-chain visibility preferences across reloads.
It distinguishes hidden all-complete chains from a truly empty project and
preserves focus when the reveal action disappears. The scenario stays in the URL hash.
Graph, detail and empty attachment-list reads are served in memory; unexpected
requests fail instead of reaching a service. This development entry is excluded
from the production build and does not establish real-backend acceptance.

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

PR CI selects affected modules using the [repository routing rules](../../README.md#ci-selection);
main pushes run the full suite. The final `checks` job accepts only `success` or
`skipped` from every preceding job; failures, cancellations and other results fail
the gate. Deliberately unselected jobs report `skipped`. When selected,
`verify-web` retains its complete workload, including real embedded Go
builds and production-browser acceptance. The CI entry
`node packages/daynight-web/scripts/ci.mts` uses the same acceptance runner as
`pnpm web:acceptance`. CI supplies pinned Chromium installation, including Linux
dependencies, and the existing `pnpm web:test` command as preparation callbacks.
Only the coverage child receives `VITEST_MAX_WORKERS=2`, retaining its `forks`
pool and per-file isolation. Browser and coverage commands each retain a
180-second bound. Native production assets, Go/PostgreSQL and one normal dev-ci
source build/start can proceed concurrently with those callbacks. The dev-ci
runner remains the owner of the built/running image identity and full cleanup.

Native functional checks start after the native process and browser are ready.
Their browser cleanup must pass before an atomic, run/source-bound permission
releases the container's eight functional checks. Capacity runs last, after all
preparation and coverage commands, container checks, full dev-ci cleanup and
container browser recovery have finished. Every browser phase retains one
worker and zero retries. CI runs controlled deployment fixtures before the
unified pipeline, and keys outer recovery and both artifact uploads to that
pipeline's attempted execution. Go module/compiler caches remain reusable.
The [pipeline decision](../../.agents/notes/implemented/testing/2026-10-21-web-acceptance-pipeline.md)
records the scheduling and ownership constraints. The web job uploads
`coverage-final.json` and `summary.json`, which records exact counts and the relative product-source
manifest. Coverage and acceptance artifacts are retained for 30 days. The
[implementation tasks](../../docs/design/daynight-web-tasks.md) retain validation
conclusions and link source-specific delivery evidence. The
[deployment decision](../../.agents/notes/implemented/architecture/2026-10-20-embedded-dashboard-deployment.md)
records embedded HTTP/container smoke checks and concurrent dev-ci isolation;
the [production acceptance decision](../../.agents/notes/implemented/testing/2026-10-20-dashboard-production-acceptance.md)
records the separate real-Docker fault matrix and its limits. CI repeats the
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

The command builds real embedded assets and a new Go executable and owns a
separate PostgreSQL container/volume and ephemeral loopback listener. In parallel,
the normal dev-ci runner builds and starts the actual production image. Browser
execution proceeds through eight native functional scenarios, the same eight
functional scenarios through the production image's stream gateway, then four
native capacity/limit scenarios. The native process and PostgreSQL remain alive
through the capacity phase; other preparation commands and the complete
container stack have finished before that phase starts. No normal localhost service or dataset is used. Functional and
capacity fixtures use the real write APIs; those existing scenarios check the
graph dashboard baseline for read-only requests. They do not cover attachment
mutations. A-T6 in the [attachment breakdown](../../docs/design/daynight-task-attachments-tasks.md#a-t6)
owns new real-backend attachment browser journeys and combined acceptance.
The chain fixture creates 1,000 independent tasks, then attaches its 999 edges
with versioned PATCH requests from sink to root, avoiding repeated traversal of
a growing ancestor chain during setup. Complete snapshots compare every node's
dependencies with the fixture, including the chain's exact predecessor sequence.

Capacity uses fixed 1,000-node graphs: a 999-edge chain and two 5,000-edge graphs
for merges and shared roots. The browser explicitly selects the fixture root so newest-first browsing does not
change the graph workload. Each graph expands five times, with every opening
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
| W8 | `detail-navigation`, `refresh-staleness`: complete current content, ordered PR associations, relation navigation, property refresh and readiness differences without revising a dependent task |
| W9 | `failure-recovery`, `deep-links`, `capacity-limits`: owned-database failure/restoration, correlated errors, empty/not-found states, delayed request replacement and complete size refusal |
| W10 | Native and container functional targets, exact image identity and dev-ci cleanup receipt |
| W11 | Strict raw Go/V8 coverage reports, validated complete browser/performance receipts and the final `checks` result |
| W12 | `keyboard-focus`, `narrow-layout`: modal focus lifecycle including PR links, keyboard node activation and 320px page/drawer geometry |
| TP-V1, TP-V7, TP-V8 | `detail-navigation`, `refresh-staleness`, `keyboard-focus`, `narrow-layout`: real API round trips for empty/NUL/control/long/HTML-looking values and duplicates, complete locally paged lists with bounded row counts, page/collection reset and focus, plain-text unsafe addresses, isolated HTTP(S) navigation, rereading properties and compact graph responses |

Receipts live in `packages/daynight-web/.tmp/acceptance/<run-id>/`, with the
latest aggregate at `.tmp/acceptance/evidence.json` inside this package. They
use top-level `schemaVersion: 2` and record source identity, native binary
SHA-256, PostgreSQL/browser versions, pipeline stages, target phases, capacity
measurements, container image identity and cleanup outcomes. Each stage records
its result, start/end times, observed command process identities and spawned
process groups. Each browser phase records its own result, browser identity,
Playwright process/group and `browserCleanup` result. Raw reports and screenshots
live under `native/functional/`, `container/` and `native/capacity/`; the unchanged
schema 1 capacity receipt is `native/capacity/performance.json`. `CI` requires a clean checkout matching
`GITHUB_SHA`, Linux and the pinned browser. Playwright uses one worker and no
retries; skipped, flaky, duplicate/missing or incomplete scenarios fail validation.
When selected, the web CI job archives `daynight-web-acceptance` separately from raw
coverage for 30 days. Inspect the artifact from the exact workflow run and its
tested checkout identity, which is normally a merge revision for PR runs. A pass
requires the strict union of eight native functional and four native capacity
scenarios, plus the eight container functional scenarios. Every phase and target
rejects missing, extra or duplicate scenarios and skipped/flaky/retried results.
Browser identities must agree across a target's phases; every fixed graph's five
timing repetitions, independent size refusals and cleanup/recovery must pass.
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
Capacity tests disable Playwright's repeated DOM snapshots and trace filmstrip;
action/network traces remain available on failure alongside all 15 streamed CDP
traces, scenario PNGs and complete graph/geometry checks. Controller-side
`controllerDurations` records fixture creation, graph snapshot validation and
per-repetition interaction/total durations. These diagnostics locate harness
costs outside the browser input-to-feedback gates; they do not alter those gates.
The [CI efficiency decision](../../.agents/notes/implemented/testing/2026-10-21-ci-validation-efficiency.md)
records why this avoids duplicate capture work without splitting the suite.

### Cleanup and interrupted-run recovery

The runner registers owned-resource cleanup before creating its database or
native process. Timeouts and cancellation stop owned command groups; browser
receipts identify the detached Chromium group and project-local profile as well.
A passing run requires confirmed native, browser/profile and dev-ci cleanup.
Each phase verifies its Playwright group has stopped and recovers owned browser
resources immediately. After the native functional phase, an atomically written
`container/container-permission.json` binds its completed cleanup to the exact
acceptance run ID, dev-ci run ID and source SHA. The container callback records
its identity before waiting, and inventories browsers only after permission;
its `ready.json` is diagnostic timing, not browser permission. Any stage failure
or unexpected native-server exit cancels sibling work, drains started tasks and
preserves failures before final cleanup.

After the original runner, callback/Playwright processes and their owned groups
have stopped, run
from the repository root:

```bash
node packages/daynight-web/scripts/acceptance.mts --cleanup
# Select a retained run instead of the latest receipt:
node packages/daynight-web/scripts/acceptance.mts --cleanup RUN_ID
```

No receipt is a no-op. Recovery accepts only top-level schema 2 receipts;
schema 1 and unknown versions fail without a compatibility fallback. Valid
receipts constrain recovery to recorded run/source identities, exact Docker labels and names, and Linux PID/executable/start-time
identity. It verifies recorded stage command identities/groups and visits browser
phases in reverse order: `native/capacity`, `container`, `native/functional`.
A still-running native Go process also requires its recorded binary
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
unmount aborts owned work. Attachments have independent scoped list, write and
preview state, while project statistics continue to use complete graph snapshots.
There is no global task cache, task-field editor, polling loop or remote
authentication flow in this workspace.
