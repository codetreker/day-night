# Agent Note: Project and Task CLI Design

Status: implemented

## Problem

The service exposes project and dependency-gated task APIs, but the client has
no commands for using them. Repeated explicit project IDs interrupt repository
work, while Git transport addresses can spell the same hosted repository in
different ways. A remembered project ID alone cannot distinguish different
servers or a changed repository origin.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-project-task.md) and
[design](../../../../docs/design/daynight-project-task.md) define independent
`project` and `task` command modules in the existing client package. The design
is adopted. Shared configuration, bounded HTTP and repository bindings are
implemented; command entry points remain pending. The
[task breakdown](../../../../docs/design/daynight-project-task-tasks.md) owns
implementation status, dependencies, file ownership and completion evidence.

The global YAML gains an additive `serverUrl` origin. Shared document reading
and command-specific validation preserve the existing review fields and state
locations. The server configuration projection can load only that field; help, update and review
retain their independent execution requirements. The
[command composition decision](2026-10-20-client-command-composition.md) remains
the owner of lazy command dispatch. Its original source reorganization preserved
the existing YAML; this design adopts additional configuration without moving
those fields or introducing a review-data migration.

An explicit `--project` selects the target for one invocation, including outside
Git. Otherwise the client reads the current worktree's effective origin, compares
normalized identities, and discovers a project through the existing paginated
API. Zero matches is an error; multiple matches require an explicit selection.
The selected project is saved in ignored `.daynight/project.yml` at the current
worktree root, together with server origin and repository identity. A validated
existing binding remains selected if another project later shares the repo.
Server or repository changes require discovery again. Local persistence and the
root ignore rule must succeed before a task mutation. Metadata uses an exclusive
PID/token lock and verifies its owned file before release. Existing locks fail
without waiting; stale files require manual removal only after confirming that
the writer has stopped. A PID check followed by unlink is not an atomic
compare-delete operation, so it cannot safely reclaim a replaced lock. Shared
atomic file replacement serves configuration, ignore and metadata writes.

One client normalization function processes both Git origin and server URLs.
Conventional HTTPS, default-user Git SSH and SCP addresses share a hosted repo
identity. Path case, unusual SSH contexts, aliases and nondefault ports retain
meaningful distinctions. The service keeps its raw registered address and its
existing API, schema, duplicate-project allowance and transaction policies.

Task updates retain expected-version checks, atomic field/dependency updates
and server-side state gates. Local binding checks cannot replace remote
resource validation. Request cancellation and failures remain visible; failed
writes are not automatically retried. Complete paginated JSON is emitted only
after every page has succeeded. Whole-command deadlines and response-byte
budgets bound complete scans; reaching a limit fails without partial output,
while an already-sent write can still have an unconfirmed outcome. The HTTP
foundation uses one disposable operation for shared deadlines and byte counters,
strict response DTOs and complete opaque-cursor traversal. Task versions use
`bigint` internally and retain JSON numeric int64 precision on the wire. Bounded
response cleanup preserves both the original failure and cleanup errors.

## Alternatives

**Require explicit project selection for every task command.** This avoids local
state and discovery but repeats server identifiers during ordinary repository
work. Explicit selection remains available as the per-invocation override.

**Keep a manually configured project ID as the normal repository binding.**
This can choose among duplicate projects, but creates an extra setup step even
when the remote repository identifies one project. Successful automatic
discovery records the association instead.

**Compare raw repository URL strings.** This keeps parsing small but makes the
confirmed HTTPS and SSH spellings fail to match. A shared identity function
provides a precise equality rule without changing the stored server address.

**Put the server address in separate URL and port fields.** This creates two
sources for the port and requires precedence or conflict rules. A single full
HTTP(S) origin expresses the endpoint and is stored with the local binding.

**Add a server repository lookup endpoint and persisted canonical identity.**
This can avoid a first-discovery scan but changes the server API and stored data
for a client capability already supported by complete project pagination. The
client owns one comparison function and preserves explicit ambiguity handling;
a future server lookup must retain those equality and duplicate semantics.

**Automatically reclaim metadata locks using PID or age checks.** A read/check
followed by unlink can delete a new writer's replacement lock. A separate
reclamation guard would itself need manual crash recovery. Retaining existing
locks matches the configuration writer's fail-fast model and keeps ownership
errors explicit without loading SQLite or the review runtime.

## Consequences

The confirmed design is documented separately from shipped CLI behavior. Current
runtime command usage remains review and update until the project/task entry
points and acceptance complete. The common configuration, HTTP and repository modules are available for the
remaining command and acceptance tasks. Future implementation updates the status owners and the package
version under existing release rules.

Ordinary commands can infer a repository's project after one complete discovery
and then validate it by ID. The cache remains disposable and scoped to server,
repository and worktree. Query commands can create the ignored local binding;
remote project/task data remains in the service. Cache and ignore failures stop
mutations, and corrupt records are reported rather than silently discarded.

Discovery costs a complete project scan, and pagination is not one cross-request
snapshot. Cached selection intentionally remains stable after later duplicate
projects appear. Additional lookup capabilities can be introduced later without
replacing the cache format if they preserve the same identity and ambiguity
rules. Arbitrary SSH alias equivalence needs a separate mapping decision;
transport context must not be erased to infer it. Remote authentication,
project/task deletion and task ownership are outside this design and require
their own service contracts.
