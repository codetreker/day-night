# daynight-web

The private React/TypeScript workspace implements project browsing, cursor
pagination, request cancellation, runtime API decoding, native browser routing
and a pure dependency graph model with horizontal layout.
The project dashboard, task canvas and task detail dialog are embedded into the Go
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

The planned [authentication requirements](../../docs/spec/daynight-auth.md),
[architecture](../../docs/design/daynight-auth.md) and
[task breakdown](../../docs/design/daynight-auth-tasks.md) define login, private
projects, member and invitation management, and personal access tokens. These
capabilities are not implemented. The current browser workspace uses the
unauthenticated local service. Trusted same-origin previews, relative resources
and keyboard behavior continue after authentication is delivered.

## Languages

The [language requirements](../../docs/spec/daynight-web-i18n.md) define the
implemented English and Simplified Chinese interface. The
[language design](../../docs/design/daynight-web-i18n.md) owns typed catalogs,
cached native Intl formatters, initial resolution, a Provider and the shared
native selector under `src/i18n/`. Production `main.tsx` resolves language and
sets HTML `lang` and the route title before React renders. `App` updates document
metadata on navigation and language changes. The top bar, centered detail dialog
and fullscreen graph expose selectors using the same saved language. Combined
source-bound production verification is separately tracked in Daynight.

`LocaleProvider` requires an explicit initial locale result. `useI18n()` reads
`locale`, `messages` and `format`; `useLocaleCommands()` exposes selection and
save retry; `useLocalePreference()` additionally exposes the current storage
issue. Hooks fail clearly outside the Provider. Component tests can use
`tests/helpers/renderWithLocale.tsx` to choose deterministic language and storage
behavior. `common.status` and `common.requestId` own shared task labels;
`workspace`, `graph` and `inspection` own navigation/project, graph and
detail/PR/attachment messages in both complete catalogs. Structured errors and
semantic notices render in the current language, including operations completed
after switching. User content, request IDs and exact file bytes keep their values.

Initial resolution prefers a valid explicit value, then the first supported
browser language, then English. Chinese language variants use Simplified Chinese.
Automatic detection does not save a choice. Explicit selection saves raw `en` or
`zh-CN` under the origin-local `daynight.web.locale` key, independently of all
per-project browsing records. Read, invalid-value and write failures remain
visible in localized selector text; a successful save clears the current issue,
including startup errors. Cross-tab live synchronization and account preferences
are outside this runtime's persistence guarantee.

With `pnpm web:dev`, open `/tests/mockups/locale-runtime.html` for the
[actual-component runtime preview](tests/mockups/locale-runtime.html). It shows
shared selectors and retained fixture state with production selector styles
and no Go API or PostgreSQL. The actual-component
[browsing](tests/mockups/browsing.html) and
[attachment](tests/mockups/attachments.html) previews also mount the Provider
explicitly. The full bilingual mockup remains attached to Daynight task
`8759f829-dc0c-4aec-9d83-e0fd9e5bd009`. Fixtures verify frontend behavior;
production claims require real service receipts. Web typecheck, test and build
include all translated components under the existing coverage gate.

## Development

Use Node.js 24 LTS and pnpm 11.28.6. From the repository root:

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
browser back/forward and a generic not-found page. A project shows seven statistics
from one complete graph snapshot and two in-project tabs: Standalone tasks and
Task chains. The first visit opens Task chains; subsequent visits restore the
project's last tab. Both tab badges count unfinished tasks (proposed, pending and in
progress) from the complete snapshot. Standalone tasks count individually;
Task chains counts every non-standalone task once across all roots, including
shared successors. Counts ignore completed-item visibility, the active tab and
the expanded chain; all-completed categories display zero. Their sum equals the
project's proposed plus pending plus in-progress total. List toolbars retain visible/total
standalone-item or root-chain counts. A standalone task has no prerequisites
and no successors in the complete graph. Every other root remains a root-based
chain entry, including multiple roots with shared successors. Task status never
changes this classification. The [task view decision](../../.agents/notes/implemented/feature/2026-10-22-project-task-views.md)
records the presentation boundary.

Standalone rows display the title, individual status, ID and creation time and
open the existing task detail dialog directly. Chain rows display aggregate progress
and status: done only when every distinct root and reachable successor task is
done; in progress when any is done or in progress and the chain is unfinished;
otherwise pending when any main task is todo; otherwise every main task is
proposed. A completed root with unfinished descendants stays visible.
External prerequisite context does not contribute to chain status. Node and
detail status continue to describe individual tasks. Chain badges, completed
counts and filtering share the same model-derived status, rebuilt with each
snapshot; the [chain status decision](../../.agents/notes/implemented/bug-fix/2026-10-22-task-chain-status.md)
records its rationale.

Proposed tasks use the current catalog label, Proposed or 待审批, and a distinct
purple status color in
statistics, standalone rows, chain badges, graph nodes and task details. The
required graph summary includes `proposed`; totals satisfy
`total = proposed + todo + inProgress + done`. Only todo tasks contribute to ready
or blocked counts. Proposed tasks remain unfinished even when all prerequisites
are complete. Creation starts in proposed. Full task details offer Approve /
批准任务, including for proposed tasks with unfinished prerequisites; success
changes only the lifecycle to todo. The [lifecycle decision](../../.agents/notes/implemented/feature/2026-10-22-task-approval-lifecycle.md)
extends the original [reader preparation](../../.agents/notes/implemented/feature/2026-10-22-proposed-task-readers.md).

Approval uses the full reviewed task's positive int64 version, represented as
bigint without passing through a rounded JavaScript Number. Lossless JSON reads
and numeric request serialization retain exact digits above the safe-integer
range through int64 maximum. `TaskDetailSession` owns project/task-keyed detail
and approval state for the App lifetime: closing or reopening details does not
permit a second pending submission. Confirmed responses must match identity,
todo and the expected next version. Success retains that detail and refreshes
the matching project's graph; a graph refresh failure keeps confirmed todo and
an explicit stale-snapshot refresh action. Pre-approval reads cannot restore
proposed. Version conflicts reload current details and graph; approving a newer
version needs a fresh click. Unknown outcomes retain the actual failure and
require current-state reconciliation before another submission. Request
cancellation does not establish rollback. Late results remain with their original
project/task identity. There are no Web claim, complete or metadata-edit controls.
The [actual-component browsing fixture](tests/mockups/browsing.html) is the
frontend-only visual and interaction owner for approval, including blocked,
pending, conflict, unknown-outcome and refresh-failure cases in both languages.

Both lists use newest creation first, with descending IDs breaking equal-time
ties. Presentation reverses the exact API sequence without reducing timestamp
precision; updates do not move older tasks. Completed items are hidden by default
in each category. Each tab has its own completed-count checkbox, visible/total
count and per-project visibility preference. An empty category, hidden all-complete
items and a truly empty project have distinct states. Revealing completed items
focuses the persistent checkbox before the empty-state action disappears. Long
titles grow naturally in compact native row buttons. Chain buttons keep a 62px
minimum height and 7px row gaps; a single-line bordered row is about 64px.
Desktop titles stay 13px and narrow-screen titles 12px, with readable
metadata/status sizes of 11px/10px.

Rows expand one horizontal graph at a time, including shared tasks and all
transitive prerequisites of the root and its reachable successors. External
prerequisites add context without importing their unrelated successors. Each task
and required dependency appears once per canvas. Dashed external nodes use the
label “外部前置”; edges originating at external nodes remain dashed, including
links between external nodes. The toolbar separates chain-task, external-task and
dependency counts. Initial placement fits the complete graph at 0.8–1 zoom when
possible; otherwise it anchors the leftmost rank at 0.8 zoom. A root in that rank
remains vertically centered; when context extends left of the root, its topmost
upstream node starts at a 32px canvas inset. Pan, zoom, Fit view and keyboard
node navigation keep the rest accessible. The [context decision](../../.agents/notes/implemented/feature/2026-10-22-complete-prerequisite-context.md)
owns these projection and viewport choices.

Per-project browser preferences retain the selected tab,
each tab's page scroll position and completed-item choice, and the chain's
expanded root or explicit collapse across reloads and navigation. First visits
to chains open the newest visible chain root; a missing or hidden saved root
selects the current newest visible root. With no visible chain roots, the saved
ID or explicit collapse is retained for later reveal. Loading, failed initial
reads and empty graphs do not record an inferred collapsed preference. The
existing `{ expandedRootId: string | null }` record and completed-chain boolean
keep their formats; new choices use separate records. Storage failures display a
notice while the current page remains usable. Both tabpanel wrappers keep stable
IDs and use `hidden` for the inactive category; only the active contents mount.
Page scroll restoration does not
persist detail selection, graph coordinates, zoom or pan. Inactive panel contents unmount,
so returning to a chain retains its root choice and initializes its canvas
viewport again. The [preference decision](../../.agents/notes/implemented/feature/2026-10-21-task-browsing-preferences.md)
records storage ownership. Tab switching, filtering and scroll restoration make
no API request and do not change the full project counters, graph index or API
ordering. Nodes open a task detail dialog with dependency navigation,
PR associations, stale-data detection and attachment management. Task metadata and graph interactions remain read-only; the detail dialog offers
the dedicated proposed approval action. The PR section follows the description and
displays every ordered title/URL pair, including duplicates. Lists longer than 100 entries use local
100-row pages with a range/total announcement, Previous/Next controls and direct
page selection. The complete ordered list stays in memory; changing pages makes
no requests and imposes no storage or content limit. Replacing the task or
property collection returns to the first page. Focus stays on current pagination
controls or moves to the section heading when those controls disappear.
Empty strings have a display-only marker;
whitespace and long content remain selectable text and wrap within the dialog.
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
The dialog offers a full graph refresh when that difference is observed.
Reopening or refreshing details reads current PR associations; an attribute
update changes the task timestamp and uses the same stale-snapshot prompt.

The canvas supports pan, zoom and fit while editing and connection controls stay
disabled. The toolbar offers Fullscreen viewing, which fills the browser viewport
with the same mounted canvas. Exit fullscreen or Escape returns to the inline
graph without resetting pan, zoom or nodes. Fullscreen isolates background
controls and cycles Tab through its visible controls; exit restores focus to the
fullscreen button. Task details remain available above the graph, and Escape
closes details before exiting fullscreen. Both views share a counted body scroll
lock so either unmount order restores the original scrolling state. Fullscreen
is local to the mounted graph and is not saved as a browsing preference. The
[fullscreen decision](../../.agents/notes/implemented/feature/2026-10-22-task-graph-fullscreen.md)
records the modal and viewport ownership. Each node is one native keyboard button. A long graph starts with its
root visible at readable zoom; keyboard focus brings offscreen nodes into view.
The centered body-portal dialog has a 960px maximum width, 24px viewport gutters
(12px at 600px and below), and a maximum height of
`min(880px, 100dvh - 2 × gutter)`. A single content region scrolls independently
of the persistent header and footer. Desktop content pairs a reading column with
a 265px metadata/relationship column (225px at 850px and below); at 600px and
below it stacks into one column. The dialog locks background focus and scrolling,
supports its close button, backdrop, Escape and Tab,
and restores a surviving original trigger or a visible control in the active task view on close. Focusable
controls are enumerated with `tabbable` 6.5.0 using its normal browser visibility
checks. Same-origin preview frames bridge Escape and first/last Tab boundaries
back into that dialog lifecycle. Passive unmount restoration remains responsible
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
The planned [authentication architecture](../../docs/design/daynight-auth.md)
adds project-member checks to attachment requests while retaining this trusted
same-origin execution model, relative resources and keyboard behavior.
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
exercise the actual portal dialog, background inertness, CSS-hidden controls,
contenteditable frame boundaries, Escape/Tab release and trigger restoration.
The probe receipts and screenshots live under the task's `.tmp/a-t4/`; a local
existing Chromium override is recorded and does not establish pinned CI-browser
or real-backend delivery. JSDOM uses an upstream `tabbable` test wrapper because
it lacks layout; those unit tests do not prove browser visibility. The production
`task-attachments` journey below uses the real service and the installed CLI on
both runtime targets; its receipts remain separate from this fixture evidence.

## Frontend-only task browsing mockup

Run `pnpm web:dev` and open `/tests/mockups/browsing.html` on Vite's printed
origin. The fixture mounts the production project page and CSS with mixed,
fully completed and empty project graphs. It demonstrates the exact
two project tabs, newest-first category lists, topology-based standalone classification,
shared dependencies, direct standalone details and per-project tab, scroll,
expanded/collapsed and independent completed-item preferences across reloads.
It uses the final compact row CSS directly, including naturally growing long
titles and complete status/progress fields. Each expanded graph provides the
production fullscreen controls, retained pan/zoom, keyboard focus isolation and
task details above the fullscreen canvas, including on narrow screens. It distinguishes hidden all-complete
items from an empty category and a truly empty project and
preserves focus when the reveal action disappears. The self-contained
[task view mockup](../../docs/design/mockups/task-views.html) offers the final
visual presentation and frontend-only interaction without a development server. The scenario stays in the URL hash.
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
releases the container's sixteen functional checks. Capacity runs last, after all
preparation and coverage commands, container checks, full dev-ci cleanup and
container browser recovery have finished. Every browser phase retains one
worker and zero retries. CI runs controlled deployment fixtures before the
unified pipeline, and keys outer recovery and both artifact uploads to that
pipeline's attempted execution. After the pipeline and recorded recovery, the
Ubuntu web job runs `node deployment/dev-ci/tests/attachments.mts` once for real
volume/recreation/isolation and paired-backup proof. Its
`.tmp/attachment-deployment-*/` receipts join the existing deployment artifact.
Go module/compiler caches remain reusable.
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

Use Node 24, pnpm 11.28.6 and a frozen dependency install first. Chromium requires
its normal Linux runtime libraries; CI installs them with Playwright's
`--with-deps` option. Locally, `DAYNIGHT_BROWSER_EXECUTABLE` can select an existing
Chromium executable. That override is recorded and is forbidden for CI delivery
evidence, which must use the full bundled Chromium channel (`chromium`) pinned by
Playwright 1.64.1. This channel renders PDF pages; MIME-document readiness alone
is not a painted-content oracle. Native and container phases record and require
the same browser identity.

The command builds real embedded assets and a new Go executable and owns a
separate PostgreSQL container/volume and ephemeral loopback listener. In parallel,
the normal dev-ci runner builds and starts the actual production image. Browser
execution proceeds through sixteen native functional scenarios, the same sixteen
functional scenarios through the production image's stream gateway, then five
native capacity/limit scenarios. The native process and PostgreSQL remain alive
through the capacity phase; other preparation commands and the complete
container stack have finished before that phase starts. No normal localhost service or dataset is used. Functional and
capacity fixtures use the real write APIs. The original eight graph scenarios and `project-view-tabs` retain
their GET/HEAD-only browser checks. `task-attachments` and
`language-state-preservation` allow exact fixture-scoped PUT/DELETE file routes;
the latter holds each upload, overwrite and deletion while changing language to
verify one write and retained state. Other language scenarios remain GET/HEAD-only.
The three task-approval scenarios separately admit only registered project/task
POST approve requests with exact expected counts; unrelated mutations remain failures.
One packed/installed CLI is shared by the whole web run. On each target,
`task-attachments` uploads through that CLI and consumes the same task/files in
the production page, then checks Web mutations through raw CLI reads. It covers
Markdown relative images, image/text/PDF and interactive HTML resources. PDF
acceptance polls compositor screenshots for a substantial fixture-only colored
marker. It measures matching connected components independently and checks the
largest main-page candidate extending into the frame's right half. This
fixture/viewer location rule excludes thumbnail-only paint; independent bounds
also prevent a separate thumbnail from diluting the page marker's density. The
successful PNG and component metrics remain in the marker evidence; HTTP success
or an iframe load cannot satisfy this check. The
[combined acceptance decision](../../.agents/notes/implemented/testing/2026-10-21-task-attachment-cross-layer-acceptance.md)
owns the data-sharing and rendering proof.
The chain fixture creates 1,000 independent tasks, then attaches its 999 edges
with versioned PATCH requests from sink to root, avoiding repeated traversal of
a growing ancestor chain during setup. Complete snapshots compare every node's
dependencies with the fixture, including the chain's exact predecessor sequence.

Capacity uses four fixed 1,000-node graphs: a 999-edge chain and three
5,000-edge graphs for merges, shared roots and dense external ancestry. The dense
external graph displays two chain tasks and 998 external prerequisites, retaining
all 5,000 dependencies. The browser explicitly selects the fixture root so
newest-first browsing does not change the graph workload. Each graph expands five times, with every opening
at most 3,000ms and local task/zoom/pan feedback at most 300ms. Network timings are
recorded separately. Each expansion also records projection/layout duration and
subsequent painted-render duration; these diagnostics do not replace the complete
opening budget. Independent 1,001-node and 5,001-edge cases require complete
409 rejection. Full node/edge DOM counts, readable initial focus-task visibility
and painted feedback are checked; the dense external case starts at an upstream task, while
the original datasets retain root visibility. A successful process exit without
complete reports fails.

The [graph functional scenarios](tests/e2e/workflow.spec.ts),
[attachment journey](tests/e2e/attachments.spec.ts),
[language journeys](tests/e2e/i18n.spec.ts),
[approval journeys](tests/e2e/approval.spec.ts),
[capacity scenarios](tests/e2e/capacity.spec.ts) and
[acceptance runner](scripts/acceptance.mts) map to the
[W1–W13 requirements](../../docs/spec/daynight-web.md) and
[language requirements](../../docs/spec/daynight-web-i18n.md) as follows. Names are stable
scenario annotations validated in each target's report.

| Requirement | Production checks |
|---|---|
| W1 | `project-list`: more than 50 projects, cursor requests, unique cards and navigation to a later-page project |
| W2 | `project-graph`, `deep-links`: project entry, direct HTML reload and browser history |
| W3–W4 | `project-graph`, `project-view-tabs`, `refresh-staleness`, `failure-recovery`: exact statistics, topology-based tabs, distinct root progress, direct standalone details, independent completion filters, per-project tab/scroll/expansion restoration, dependency reclassification and consistent full refresh |
| W5–W7 | `project-graph`, `keyboard-focus`, `capacity-chain`, `capacity-merge`, `capacity-shared`, `capacity-external`: complete root projections, shared/external prerequisites, state markers and viewport/node actions |
| W8 | `detail-navigation`, `refresh-staleness`: complete centered-dialog content, ordered PR associations, relation navigation, property refresh and readiness differences without revising a dependent task |
| W9 | `failure-recovery`, `deep-links`, `capacity-limits`: owned-database failure/restoration, correlated errors, empty/not-found states, delayed request replacement and complete size refusal |
| W10 | Native and container functional targets, exact image identity and dev-ci cleanup receipt |
| W11 | Strict raw Go/V8 coverage reports, validated complete browser/performance receipts and the final `checks` result |
| W12, TI6–TI7 | `detail-navigation`, `keyboard-focus`, `narrow-layout`, `project-view-tabs`, `refresh-staleness`, `task-attachments`: centered 1440px/320px dialog geometry, independently scrolling content and persistent controls; graph/standalone entry, layered fullscreen Escape, trigger disappearance, inert/scroll release and same-origin frame keys |
| W13 | `task-approval`, `task-approval-conflicts`, `task-approval-recovery`: real versioned approval, blocked prerequisites, pending protection, exact int64 digits, reviewed-version conflicts, unknown-outcome reconciliation, graph refresh failure and identity/focus/browsing preservation |
| FA1–FA12 | `task-attachments`: installed CLI and production UI operate on the same real task/files on native and container targets, exact binary round trips, independent mutations/previews, visible PDF content and full task state unchanged |
| TP-V1, TP-V7, TP-V8 | `detail-navigation`, `refresh-staleness`, `keyboard-focus`, `narrow-layout`: real API round trips for empty/NUL/control/long/HTML-looking values and duplicates, complete locally paged lists with bounded row counts, page/collection reset and focus, plain-text unsafe addresses, isolated HTTP(S) navigation, rereading properties and compact graph responses |
| L1–L4 | `language-startup-preferences`: browser default, saved override, reload, route metadata, shared selectors and unchanged user data |
| L2, L4–L5 | `language-state-preservation`: graph geometry/viewport, fullscreen and modal focus, PR page, file input and iframe identity; pending upload, overwrite and deletion execute once |
| L3–L4, L6–L8 | `language-errors-and-narrow`: storage failures/retry, owned-database failure with current-language safe text and unchanged request ID, English/Chinese 1440px/320px graph/dialog/attachment layout |
| L9–L10 | Task-attached offline mockup checks, typed catalog/component checks, and complete native/container production receipts with the existing coverage and cleanup gates |

Receipts live in `packages/daynight-web/.tmp/acceptance/<run-id>/`, with the
latest aggregate at `.tmp/acceptance/evidence.json` inside this package. They
use top-level `schemaVersion: 2` and record source identity, the installed CLI
receipt and raw artifact identities, native binary
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
requires the strict union of sixteen native functional and five native capacity/limit
scenarios (21 native total), plus the sixteen container functional scenarios. Every
phase and target rejects missing, extra or duplicate scenarios and skipped/flaky/retried results.
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

The runner persists one `installedCli` ownership record before package
preparation: its deterministic `<acceptanceRun>/installed-cli` root and cleanup
state exist even if a completed receipt does not. Preparation creates that root
exclusively. Cleanup requires recorded commands/groups to have stopped, validates
completed artifacts when present, removes only that root and persists its cleanup
state in the original evidence before later native/Docker cleanup. Recovery can
repeat after interrupted preparation or a subsequent cleanup failure; a live
preparation process blocks removal.

Recovery writes separate per-run/latest `recovery.json` receipts and preserves
the original acceptance outcome while retaining completed cleanup state. A successful recovery does not turn a failed
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
summary consistency. It projects root descendants plus their complete ancestor
closure, excluding unrelated descendants of contextual tasks. `mainIds` retains
chain membership; `externalIds` identifies additional ancestors. Every dependency
ending at a visible task is retained, and an edge is external when its source is
external. It derives distinct root progress and aggregate chain status from main
tasks in the same traversal, and marks shared tasks. The Dagre
adapter returns finite left-to-right node positions and routed edge points for
220-by-96 cards. The read-only React Flow canvas consumes these results without changing domain
objects. React Flow owns fixed task nodes, native ResizeObserver measurement,
keyboard behavior, viewport and controls. One memoized SVG in its public
ViewportPortal renders every exact Dagre path, with stable edge identity,
arrowheads, external-context dashes and accessibility semantics. It shares the viewport's
transform, so selection/pan/zoom reuse geometry without per-edge reactive state.
Canonical routes retain native arrow markers and full Dagre points. Dashed body
paint uses `dashes.ts` to derive locally horizontal rotated lines and short native
vertex paths, with the original 5/4 pattern and continuous positive arc-length
phase. Solid bodies remain native. Pieces are noninteractive and hidden from the
accessibility tree; canonical edges keep their existing identity/semantics. The
[paint decision](../../.agents/notes/implemented/bug-fix/2026-10-20-long-dashed-dependency-paint.md)
owns the pinned raster evidence, phase preservation and visual tolerances.
Initial placement uses known layout bounds after the viewport and positive
measured canvas dimensions are ready, fitting within 0.8–1 zoom or anchoring the
leftmost rank at 0.8 zoom. The root remains vertically centered when already
leftmost; otherwise the topmost upstream node starts at a 32px canvas inset.
Dependency geometry does not require connection-port DOM or per-edge endpoint readiness.
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
