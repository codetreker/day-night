# Agent Note: Task Lifecycle Cross-layer Acceptance

Status: implemented

## Problem

Service transitions and isolated client checks do not establish that an installed
CLI, a migrated database, the built service and production browser agree on the
same tasks. HTTP races do not exercise competing CLI processes, and a migrated
current-schema fixture does not prove startup preserves historical rows. Shipped
workflow text also needs artifact validation without mistaking it for observed
Agent decisions.

## Decision

The existing acceptance owners provide complementary evidence for the explicit
[approval lifecycle](../feature/2026-10-22-task-approval-lifecycle.md). The Go
command fixture retains its built race binary, isolated PostgreSQL schema,
project-row barriers, structured request logs and restart/cleanup ownership. The
production Web runner reuses its existing packed CLI, native and container
services, browser phases and request allowlists. Native CLI acceptance validates
the actual installed package. The
[authentication activation](../architecture/2026-10-22-authentication-activation.md)
provides normal real-UniAuth sessions/PATs and explicit membership. Browser and
packed CLI share the fixture's actual Alice identity; private origin-matched
configuration remains with the existing credential/cleanup owner. Controlled
upstream-provider responses remain distinct from the real gateway/SDK flow.
No second runner, test-only service API, database configuration channel,
authorization bypass or production transition is added.

### Historical migration and real CLI processes

`installed_cli_pre_lifecycle_migration_restart` prepares a new isolated schema
with the checked-in SQL migrations through 006 and their exact raw-byte checksum
ledger. It captures the original ledger and todo/in_progress/done rows before
starting the current built service. Production startup applies 007 and 008.
The logged-in nonmember first observes 404 for the legacy project. The fixture
then explicitly provisions admin membership for the actual `/api/v1/me` user,
verifies the members API and confirms the raw historical task rows remain
unchanged. This is authorized fixture preparation; startup does not automatically
adopt legacy resources or invent an identity. Packed CLI show/list/ready/graph
reads verify preserved historical resources and
new proposed creation; explicit actions exercise blocked refusal and the complete
prerequisite/dependent lifecycle. Actual restart compares old rows and ledger,
new states, metadata and readable attachment contents again. The fixture never
starts the current schema and then rewrites its history to look old.

`installed_cli_same_version_claim` and
`installed_cli_same_version_dependency_edit_and_claim` start two installed CLI
processes with the same observed version. The existing real project lock and
observed database waiters hold both mutations before release. Correlated request
logs and process results require one success, one visible version conflict and
no automatic retry. Complete snapshots distinguish the permitted winner states,
exact version progression, timestamp behavior, unchanged metadata and attachment
bytes. In-progress and done tasks cannot acquire an unfinished prerequisite. These process
observations supplement deterministic service/HTTP interleaving tests; one
observed scheduler outcome does not prove every interleaving.

### One task graph across CLI and browser

The existing `task-approval`, `task-approval-conflicts` and
`task-approval-recovery` annotations include the same-data lifecycle journey,
reviewed-version competition and response/identity recovery. The installed CLI
creates an ordinary prerequisite/dependent graph with meaningful descriptions,
PR references and attachment bytes. The production Details control opens the
ordinary graph task; body activation retains prerequisite inspection. The browser
approves the blocked dependent; CLI reads verify todo, blockedBy and readiness. CLI progression of the
prerequisite unlocks dependent claim/completion; that derived readiness change
preserves the dependent's own version and timestamp. Graph/detail/list checks
observe the same resources. Completion visibility and graph browsing state
remain part of the browser oracle.

A real CLI metadata update makes an already-reviewed Web version stale. A real
CLI/Web same-version approval competition permits one commit and exposes the
losing version conflict without another automatic mutation. SPA cross-project
navigation, task switching, closure/reopening and pending activation retain the
existing identity and request-count checks. The later
[withdrawal decision](../feature/2026-10-23-task-unapprove.md) adds `task-unapproval`
for ready/blocked withdrawal, preserved metadata/attachment bytes, title-row
confirmations, cancellation, invalidation, reapproval and committed-response loss.
Only registered project/task approve or unapprove writes and exact fixture file
writes are admitted. The original three journeys keep their source-bound receipts;
the new scenario requires its own current-source run.

The SQL-seeded large-int64 approval is a separate case inside those existing
annotations: a maximum version cannot support an arbitrary multi-hop sequence.
Its actual GET/POST digits and database result remain the oracle. Response loss
is injected after a real service commit; graph-read failure uses the owned real
failure path. Timing barriers and browser response handling are declared
controls, not substitutes for actual state-changing service/database requests.
Forwarded browser requests use the existing credential-redacting authenticated
API wrapper, preserve original request/CSRF fields and return actual status,
headers and body. Action evidence retains identities and outcomes without tokens
or private configuration contents. Authentication retains its own management
annotations; this extension changes only the three existing approval annotations.
The production native/container inventory, capacity topology, strict coverage,
performance, one-worker/no-retry and cleanup gates remain unchanged.

### Installed instructions and source attribution

The installed skill fixture validates all six resources, YAML frontmatter,
contained prose references and content digests on the packed installation and
published target copies. Fenced task examples remain examples. Bounded
cross-reference instruction contracts check registration, proposed run requests without approval, explicit approval,
claim, resume, conflict, unknown outcome, open-PR retention, accepted completion
and shared Markdown/Goal ownership. Their receipt identifies the input,
obligation and resource/section evidence, with agentExecution false. Existing
native terminal installation and byte-copy checks remain distinct. Artifact
contracts establish shipped instructions and discovery, not actual model
compliance or live provider behavior.

Existing source receipts add required gitTreeSha from actual
`git rev-parse HEAD^{tree}`:
`source.gitTreeSha` in shared packed-CLI and Web source records, and root
`gitTreeSha` in Go acceptance. Handoff, callback and recovery validation require
matching commit, tree, dirty state, package and artifact identities. Missing or
mismatched tree identity fails; no schema-version bump or legacy fallback
reinterprets an incomplete receipt. A tree identifies committed content; dirty
state is not a digest of modifications, and tree equality alone proves neither
an executed gate nor reviewer approval. Original artifact and platform identities
remain intact under the [evidence ownership decision](../process/2026-10-20-source-bound-validation-evidence.md).

The [server README](../../../../packages/daynight-server/README.md#built-process-acceptance-and-ci-evidence)
and [Web README](../../../../packages/daynight-web/README.md#production-browser-acceptance)
own repeatable commands, scenario mappings and receipt interpretation. This
extends the [installed project/task](2026-10-20-installed-project-task-acceptance.md),
[built-process](2026-10-19-server-process-acceptance.md) and
[dashboard acceptance](2026-10-20-dashboard-production-acceptance.md) decisions.
The [attachment cross-layer decision](2026-10-21-task-attachment-cross-layer-acceptance.md)
retains original-byte, rendering, reader-input and K1 storage boundaries; shared
artifacts do not collapse those separate proofs into this lifecycle journey.

## Alternatives

**Create another combined acceptance runner.** It would duplicate service,
database, installation and cleanup ownership. The existing Go and Web fixtures
already expose the actual boundaries required by the journey and preserve their
own platform and fault-injection constraints.

**Relabel service or HTTP races as installed-client proof.** Those checks can
order transactional interleavings but do not execute command parsing, installed
process failure and retry behavior. Real CLI competitors supplement rather than
replace those deterministic checks.

**Seed the current schema and rewrite its migration history.** That avoids
preparing the historical SQL prefix but cannot prove production startup applies
the genuine migrations while preserving rows and the original checksum ledger.
Executing the checked-in prefix before launching the built service preserves the
actual upgrade boundary.

## Consequences

The receipts connect the same resources across installed commands, service
transactions, database upgrades and production views while preserving each
oracle's provenance. A failed assertion, interrupted operation or cleanup remains
a failed acceptance result. Task-owned processes stop and are reaped before
schemas, installations, storage roots and browser profiles are removed; retained
original failures are not replaced by cleanup success.

Real PostgreSQL/process/browser evidence, controlled client transport/provider
fixtures and installed instruction artifacts establish different facts. Local
Linux results do not establish hosted macOS/Windows or container success, and
native installation launchers do not exercise live Agents. Required runtime,
platform, protected-delivery and independent-review results remain tied to the
actual PR/CI source and are not accumulated as rolling Markdown counts or hashes.
