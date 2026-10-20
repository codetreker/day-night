# daynight-web

The private React/TypeScript workspace implements project browsing, cursor
pagination, request cancellation, runtime API decoding, native browser routing
and a pure dependency graph model with horizontal layout.
The project dashboard, task canvas and detail drawer are implemented; embedded
deployment and complete production acceptance remain tracked in the
[implementation tasks](../../docs/design/daynight-web-tasks.md). The existing Go
service still serves JSON APIs; a successful frontend build does not install a
page into the localhost deployment yet.

The [requirements](../../docs/spec/daynight-web.md) own visible behavior and the
[architecture](../../docs/design/daynight-web.md) owns graph projection, request
lifecycles and delivery. The offline mockup illustrates the complete planned
workflow and is separate from this application.

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
`packages/daynight-web/dist/`. Embedding those assets into the Go binary belongs
to W-T5. The existing root `build`, `test` and `acceptance` commands retain their
CLI scope.

`web:test` runs the coverage checker tests, the full Vitest suite with V8 coverage,
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

CI requires `verify-web` alongside the Go server and every native CLI job. It
uploads `coverage-final.json` and `summary.json`, which records exact counts and
the relative product-source manifest. The [acceptance report](../../docs/research/daynight-web-acceptance.md) records
local production-bundle checks with a real Go API and PostgreSQL. Complete
single-service/container and hosted performance acceptance remain later tasks;
controlled-fetch component tests do not replace them.

## Dependency declarations

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
objects. Its one-time initial viewport policy is separate from explicit fit
controls and does not run again on selection or pan.

Page hooks own requests and cancellation. Navigation or refresh invalidates the
previous request generation, continuation failures preserve loaded cards, and
unmount aborts owned work. There is no global task cache, editor, polling loop or
remote authentication flow in this workspace.
