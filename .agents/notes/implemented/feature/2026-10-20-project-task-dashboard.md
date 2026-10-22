# Agent Note: Read-only Project Task Dashboard

Status: implemented

## Problem

The complete graph API and pure projection model need a browser workflow that
preserves snapshot meaning during navigation, refresh and detail reads. A live
task detail can differ from a previously loaded graph even when the task's own
timestamp is unchanged, because prerequisite completion changes readiness.
Keyboard users also need one reliable node action and a modal lifecycle that
does not leave background content interactive. At the declared 5,000-edge limit,
viewport controls must remain responsive while every dependency remains present
and aligned with its task nodes.

## Decision

The project page owns one validated graph/index snapshot, its client receipt time
and revision. Requests are scoped by project identity and generation; a different
resource cannot render an earlier resource's data. Same-project refresh retains
the last successful snapshot with an explicit loading/error notice, and replaces
statistics, indexes and both task-category lists together after success.

The [task view decision](2026-10-22-project-task-views.md) separates standalone
rows, which open details directly, from non-isolated root chains. Only one root
canvas is mounted in the active chain view; inactive panel contents unmount
while their hidden wrappers retain stable tabpanel IDs. The project
restores the expanded root or
an explicitly collapsed list from per-project browser storage; the
[browsing preference decision](2026-10-21-task-browsing-preferences.md) owns its
persistence, reconciliation and failure behavior. The project view shares one
newest-first visible root sequence between list rendering and default-root selection;
the [presentation decision](2026-10-21-task-chain-presentation.md) owns that order
while the complete graph index retains its API order. React Flow owns fixed 220-by-96 task nodes,
native node measurement, keyboard interaction, the viewport and its controls.
Editing, connection, deletion, wrapper focus and interactive-lock controls remain
disabled. The
[dependency inspection decision](2026-10-22-task-dependency-inspection.md) replaces
the original single task action with sibling native inspection and Details
controls. Keyboard focus on either control pans offscreen tasks without changing
zoom. Graph inspection belongs to the mounted canvas; detail resource selection
belongs to the project page.

One memoized SVG beneath task nodes in the public `ViewportPortal` renders every
dependency from the immutable Dagre layout. The inspection decision compiles
its points into bounded quadratic corners while preserving route endpoints,
stable edge/source/target identity, native markers and accessibility semantics.
Solid bodies keep native paint. Long dashed bodies retain immutable locally
horizontal lines and short curved paths, preserving actual curve arc length
and dash phase. The
[long-dashed paint decision](../bug-fix/2026-10-20-long-dashed-dependency-paint.md)
retains the original axis-local raster rationale and links its smooth successor.
The portal shares the React Flow viewport transform; pan and zoom transform the
same complete paths without per-edge store subscriptions or endpoint-admission
work. Selection reuses compiled geometry while changing node, body-piece and
marker presentation together. Edges do not intercept pointer
input, so task buttons and the canvas remain the interaction targets.

The original W-T4 custom-edge integration used invisible framework ports for
edge admission. That choice preserved Dagre's noncentral rectangle intersections:
framework port centers never defined the visible line endpoints. The static SVG
retains that geometry rationale while giving immutable dependency routes their
own rendering owner. The initial single-SVG implementation used native dashing
on each full route, preserving direct geometry without per-edge reactive state.
The long-dashed paint decision partially replaces that body-paint choice after
pinned-engine raster evidence, while canonical routes and native arrows remain.
It uses no connection-port DOM or node-handle readiness state. Initial placement uses known layout bounds after the framework viewport
and positive measured canvas dimensions are ready; native ResizeObserver node
measurement remains enabled.

Initial viewport policy keeps readable zoom. The
[complete context decision](2026-10-22-complete-prerequisite-context.md) anchors
the leftmost upstream rank for graphs that cannot fit at 0.8–1 zoom. A root
already in that rank stays vertically centered, preserving the original long-chain
starting point; ancestors extending left of it start at the top of their rank.
The policy runs once after initialization, while explicit overview controls may
zoom out further. Selection and viewport movement do not rerun layout.

Immutable node presentation variants preserve references whose inspection state
is unchanged. The original detail-coupled selection changed at most two tasks;
complete upstream inspection can restyle many prerequisites and unrelated tasks.
The inspection decision replaces that two-node cost assumption with measured
`selectMs` for all four capacity datasets. Full node/edge DOM, routes and viewport
remain present, and detail opening does not alter inspection. This retains focus
and complete-capacity assertions while measuring the actual changed styling.

Each root row is memoized. Collapsed rows hold no graph-local inspection, so
opening or switching task details does not change their dependency selection. Expanded
state, callback and index changes still invalidate the relevant rows; a new
snapshot index refreshes every row and its statistics.

The detail drawer uses a portal outside the application root, background inertness,
body scroll ownership and a dynamic focus trap. Its lifetime is independent of
relation selection. Layout cleanup synchronously releases the keyboard listener,
background inertness and scroll ownership. A separate passive unmount cleanup
calls the latest restoration callback after sibling DOM deletion. It focuses a surviving original trigger, otherwise a visible control in the
active task view. The task view decision extends that fallback to standalone
rows and tabs; a truly empty project retains the project H1 fallback. This ordering avoids selecting a still-connected node that the
same commit will remove; the [focus-restoration decision](../bug-fix/2026-10-20-drawer-focus-restoration.md)
records the failure and integration evidence. The
[Web attachment decision](2026-10-21-task-attachment-web.md) extends this lifecycle
with `tabbable` enumeration for form controls and same-origin frame keyboard
bridges; background ownership and passive restoration remain unchanged.
Latest detail data never patches graph statistics.
Readiness, blocking, dependency, status, preview and timestamp differences produce
a refresh notice; a new graph revision rereads the selected detail.

The pinned React Flow dependency needs a declaration-only mapped-type correction
under exact optional property checking. Two system declarations explicitly
intersect their known NodeBase constraint before the generic omission. Runtime
bundles are unchanged; product strictness and library typechecks remain enabled.
Compile-time assertions preserve custom fields and reject explicit undefined
source/target positions. The
[pinned source](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/system/src/types/nodes.ts)
and [runtime conversion](https://github.com/xyflow/xyflow/blob/3d35b57317576b0916c0bfeaaedd573aaacc2839/packages/system/src/utils/store.ts#L146-L170)
define that relationship. The locked pnpm patch is a build input for local, CI
and container builds.

The [requirements](../../../../docs/spec/daynight-web.md) own behavior and the
[architecture](../../../../docs/design/daynight-web.md) owns module contracts.
[Embedded delivery and isolated deployment](../architecture/2026-10-20-embedded-dashboard-deployment.md)
are implemented. The [production acceptance harness](../testing/2026-10-20-dashboard-production-acceptance.md)
verifies both targets and fixed capacity without changing page runtime policy.

## Alternatives

**Update graph nodes from detail responses.** That mixes independent reads and
can leave global counts or related nodes inconsistent. Explicit stale detection
and complete snapshot replacement retain the single-snapshot meaning.

**Keep the default interactive canvas controls.** The lock control can re-enable
editing, and wrapper keyboard selection does not implement the required task
actions. The original native button and explicit read-only props supplied the
MVP action; sibling controls now distinguish inspection from opening details.

**Represent every immutable dependency as a reactive React Flow edge.** Each
edge then owns wrapper/SVG/store and endpoint bookkeeping. At 5,000 edges those
units participate in viewport work even though the route geometry does not
change. The single public-portal SVG retains every route while the framework
continues to own nodes, viewport interaction and controls.

**Recreate every node data object on selection.** The selection becomes visible,
but all task props change and a detail action can rerender the complete
1,000-node graph. Immutable presentation variants preserve the layout and
references whose styling is unchanged, including the expanded inspection states.

**Always center the complete graph at a clamped readable zoom.** In a thousand-node
chain, its root falls far outside the viewport. Root anchoring preserves the
starting point while retaining pan and overview controls.

**Disable library type checking or widen all optional positions.** That hides the
generic constraint defect or weakens the declared input contract. The scoped
declaration patch and negative type assertions keep those checks meaningful.

## Consequences

Project browsing now reaches real statistics, dependency diagrams and task
details. Controlled component tests cover state/focus transitions, while a local
production-bundle browser check also uses the real Go API and PostgreSQL. The
[task record](../../../../docs/design/daynight-web-tasks.md) distinguishes earlier
preview and pre-static-SVG local results from the current renderer's complete
local production pass. PR #52's earlier hosted shared-graph zoom failure
is retained. A later hosted run also exceeded the shared-graph zoom budget;
diagnostics identify prior drawer-close raster/commit backpressure from long
native dashed routes. A controlled local-coordinate decomposition prototype
reduces that raster work. The committed helper passes complete local production,
capacity and independent geometry/phase checks; actual product traces confirm
the reduced raster. Production acceptance is delivered through
[PR #52](https://github.com/codetreker/daynight/pull/52). Actual browser
checks verify SVG/node alignment and exact route endpoints after zoom, pan and
root changes. Dependency upgrades must revisit the declaration patch and type tests.

The historical W-T4 [project screenshot](../../../../docs/research/assets/daynight-web-project.png)
and [detail screenshot](../../../../docs/research/assets/daynight-web-detail.png)
use generated fixture data from the earlier production-browser functional check.
They illustrate that workflow, before the current renderer and capacity
acceptance, and do not establish current-source performance or hosted delivery.
