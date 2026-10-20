# Agent Note: Read-only project dashboard design

Status: implemented

## Problem

Projects and dependency-gated tasks are available through JSON APIs, but there is
no browser view for project progress or execution dependencies. Tasks form a DAG,
not a parent-child hierarchy. Multiple source tasks can share descendants, so a
tree presentation or summed per-root counters would misrepresent the data.

## Decision

The adopted MVP design defines project browsing, project-level statistics,
expandable source-root graphs, and a task detail drawer. The
[requirements](../../../../docs/spec/daynight-web.md) own visible behavior, the
[design](../../../../docs/design/daynight-web.md) owns implementation contracts,
the [task breakdown](../../../../docs/design/daynight-web-tasks.md) owns execution
status, dependencies and completion criteria, and the [interactive preview](../../../../docs/design/mockups/task-dashboard.html)
demonstrates the intended appearance. This note records a delivered design;
the complete graph read is implemented, while the web application and deployment
additions remain unimplemented.

Use a separate React/TypeScript/Vite package with React Flow and Dagre. Serve
its built assets from the existing loopback Go origin, embedded into the binary.
Keep the client review module and its configuration/storage independent. A web build is
an explicit prerequisite for clean server builds, with a visible error when
assets are absent. The existing Docker-only localhost path gains a pinned Node
frontend build stage and repository-root build context; the final image remains
a nonroot Go runtime. Preserve stream forwarding, loopback publication, health
checks and database persistence. The existing localhost entry point starts the
complete UI/API/database stack and retains normal user data. A separate planned
`deployment/dev-ci/` uses that same Dockerfile and nginx configuration with a
unique Compose project, dynamically allocated loopback HTTP port, and disposable
project-scoped database, volumes and network. Browser acceptance uses that
isolated stack; Go coverage and direct-process tests keep their existing isolated
database mechanism.

The implemented [complete graph read](../feature/2026-10-20-complete-task-graph-read.md)
returns complete graph metadata and statistics
from the existing read-only REPEATABLE READ mechanism. Existing paged task
reads do not share a cross-page snapshot. Graph nodes omit descriptions and
contain bounded title previews; full content uses the existing detail endpoint.
Reject graphs exceeding the declared size limits without returning a partial
success. No schema, parent-child, or write-policy changes are required.

Each expanded row contains its root and forward-reachable descendants, plus
explicit boundary nodes for omitted direct prerequisites. Boundary ancestors
stop expanding. Root progress excludes boundary nodes; project totals count
each task once. Only one root graph is mounted at a time. Pure indexing/projection and Dagre
layout remain separate from React rendering and API requests. Page hooks own
request cancellation and snapshot replacement; the drawer never mutates the
project snapshot.

Keep the MVP read-only with manual refresh. Editing and live subscriptions are
additive later features because graph projection remains separate from API
mutations and request triggers. Remote access is not an additive configuration
change: authentication, authorization, and deployment boundaries require their
own design. Graph filtering must retain dependency context; large-graph support
needs a new closed-subgraph contract or measured limit changes.

Require strict unrounded statement coverage above 90% independently for Go and
web, preserving existing Go and native CLI gates. Real-browser acceptance must
exercise the production UI, Go process, and PostgreSQL together.

The dev-ci runner registers bounded cleanup before creating resources, records
the built and running image identity, and exports the discovered URL to the test
command. Cleanup rejects non-test project identities and removes only the current
run. Failed cleanup fails acceptance without discarding the original test error.
Test runs never start, rebuild, or remove the daily localhost stack.

## Alternatives

**React with custom SVG and Dagre.** This permits the visual design, but product code would own pan/zoom,
coordinate transforms, keyboard navigation, focus, and their tests. React Flow
already supplies the graph interaction primitives needed by the MVP. The
standalone preview draws SVG with local JavaScript and does not select a product
framework or layout dependency.

**Vue with Vue Flow and Dagre.** This is technically suitable. The repository has
no established Vue application, so it does not reduce integration work compared
with the selected React stack.

**Concatenate existing task pages.** This avoids a new endpoint but cannot
provide one consistent graph and statistical snapshot while tasks change.
Filtered pages can also omit required predecessor nodes.

**Separate production frontend server.** This avoids embedding assets but adds
another runtime deployment and cross-origin configuration to a local dashboard.
One-origin Go delivery keeps installation aligned with the existing service.

**Use the daily localhost stack for tests or as an override base.** Its fixed
project identity, default port and persistent volume can collide with normal
work. Independent test Compose configuration reuses the production build and
forwarding files while making ownership explicit. Topology checks constrain
configuration drift between the two environment definitions.

## Consequences

The design completes a narrow viewing workflow without adding editing or
realtime infrastructure. Frontend and backend gain independent coverage gates,
and clean Go builds gain a documented frontend build prerequisite. Container
builds need the same frontend sources and command but require no host Node
installation. The design uses the existing ServeMux and one request-logging
wrapper for both UI and API requests. Dev-ci gains a second Compose definition
and lifecycle tests; shared build/proxy artifacts and explicit topology checks
keep that additional configuration aligned. Daily data persists, while each test
run owns and removes its disposable dataset.

Shared task rows are intentionally non-additive. Boundary markers and explicit
snapshot freshness are necessary for an honest graph. The protective graph
limits are product constraints, not measured capacity claims. Implementation
must validate representative boundary-size graphs before claiming performance.

The existing [server task design](2026-10-19-daynight-server-task-design.md)
remains the owner of the service domain and transaction rules; this decision
adds a browser consumer without replacing those rules.
