# daynight-web

The private React/TypeScript workspace implements project browsing, cursor
pagination, request cancellation, runtime API decoding and native browser routing.
Project task dashboards and embedded deployment remain tracked in the
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

The current application implements `/` and a generic not-found page. Project
URLs and typed graph/detail clients establish the next task's integration points;
the project task view is not registered until W-T4. No placeholder project data
or task dashboard is rendered.

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
the relative product-source manifest. Browser/real-service deployment acceptance
is a later task and is not claimed by these controlled-fetch component tests.

## Boundaries

API errors expose fixed safe text and a validated request ID; raw response bodies
and server diagnostics do not reach the page. Project names and addresses render
as text. Graph parsing here verifies DTO shape and resource identity; dependency
closure, acyclicity and summary consistency belong to the graph model task.

Page hooks own requests and cancellation. Navigation or refresh invalidates the
previous request generation, continuation failures preserve loaded cards, and
unmount aborts owned work. There is no global task cache, editor, polling loop or
remote authentication flow in this workspace.
