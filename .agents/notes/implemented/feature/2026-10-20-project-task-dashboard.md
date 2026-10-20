# Agent Note: Read-only Project Task Dashboard

Status: implemented

## Problem

The complete graph API and pure projection model need a browser workflow that
preserves snapshot meaning during navigation, refresh and detail reads. A live
task detail can differ from a previously loaded graph even when the task's own
timestamp is unchanged, because prerequisite completion changes readiness.
Keyboard users also need one reliable node action and a modal lifecycle that
does not leave background content interactive.

## Decision

The project page owns one validated graph/index snapshot, its client receipt time
and revision. Requests are scoped by project identity and generation; a different
resource cannot render an earlier resource's data. Same-project refresh retains
the last successful snapshot with an explicit loading/error notice, and replaces
statistics, indexes and root rows together after success.

Only one root canvas is mounted. React Flow renders immutable layout data while
editing, connecting, deletion, wrapper focus and interactive-lock controls remain
disabled. Each node has one native button for pointer, Enter and Space activation.
Keyboard focus pans offscreen nodes without changing zoom. Routed edges retain
Dagre's actual points; invisible measured handles satisfy React Flow's edge
admission without changing those paths.

Initial viewport policy keeps readable zoom. When the graph cannot fit at that
zoom, the chosen root is placed near the left edge and vertically centered;
centering the entire bounding box would open a long chain in its middle. The
policy runs once after initialization, while explicit overview controls may
zoom out further. Selection and viewport movement do not rerun layout.

The detail drawer uses a portal outside the application root, background inertness,
body scroll ownership and a dynamic focus trap. Its lifetime is independent of
relation selection. Closing restores the original node or the current root/page
heading when that node is gone. Latest detail data never patches graph statistics.
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
Embedding and isolated deployment remain later tasks.

## Alternatives

**Update graph nodes from detail responses.** That mixes independent reads and
can leave global counts or related nodes inconsistent. Explicit stale detection
and complete snapshot replacement retain the single-snapshot meaning.

**Keep the default interactive canvas controls.** The lock control can re-enable
editing, and wrapper keyboard selection does not open task details. A single
native button plus explicit read-only props implements the intended actions.

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
[acceptance report](../../../../docs/research/daynight-web-acceptance.md) distinguishes
that evidence from pending single-service/container and hosted performance
acceptance. Dependency upgrades must revisit the declaration patch and type tests.
