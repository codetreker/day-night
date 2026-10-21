# Agent Note: Project and Task CLI Design

Status: implemented

## Problem

Developers need terminal access to the service's projects and dependency-gated
tasks. Repeated explicit project IDs interrupt repository work, while Git
transport addresses can spell the same hosted repository in different ways. A
remembered project ID alone cannot distinguish different servers or a changed
repository origin. When this design was adopted, the service already exposed
these APIs and the client had no project or task commands.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-project-task.md) and
[design](../../../../docs/design/daynight-project-task.md) define independent
`project` and `task` command modules in the existing client package. The design
is adopted. Shared configuration, bounded HTTP, repository bindings and
`project create/list/show`, task create/list/show/update/graph and shared syntax
integration are delivered. Installed CLI acceptance against the Go service and
default production-budget probes pass locally and in hosted validation.
[PR #55](https://github.com/codetreker/daynight/pull/55) owns review and integration status. The
[task breakdown](../../../../docs/design/daynight-project-task-tasks.md) owns
implementation status, dependencies, file ownership and completion evidence.

The global YAML gains an additive `serverUrl` origin. Shared document reading
and command-specific validation preserve the existing review fields and state
locations. The server configuration projection can load only that field; help,
update and review retain their independent execution requirements. The
[command composition decision](2026-10-20-client-command-composition.md) remains
the owner of lazy command dispatch. Its original source reorganization preserved
the existing YAML; this design adopts additional configuration without moving
those fields or introducing a review-data migration. The original client design
required global configuration to exist before execution; the
[guided setup decision](../feature/2026-10-21-guided-configuration-setup.md) partially
supersedes that prerequisite. Valid service calls guide only an absent file or
`serverUrl`. Initial configuration I/O remains bounded; an actual setup releases
that deadline, and the post-setup reload starts a fresh business budget. Invalid
existing server values remain errors. Project definitions share
parameter syntax with help and shell completion. Help and argument validation
finish before the shared server runtime is loaded. Project creation takes one
required positional name and the required `--repo` option, then sends the
original name and repository address. Its definition permits `--` to end option
parsing, preserving leading-dash names as `project create --repo <repo> -- -name`.
Names containing spaces remain one quoted argument. The syntax parser checks
positional presence, empty strings and declared choices; command-owned text
validation retains the Unicode rules without trimming the name. Listing reads all projects, and details
use an explicit UUID. These operations do not inspect the working directory or
change repository bindings.

The repository foundation resolves explicit project selection for one invocation,
including outside Git. Otherwise it reads the current worktree's effective
origin, compares normalized identities, and discovers a project through the existing paginated
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

The adopted task composition uses the shared command schema and server runtime.
Description values declare `allowEmpty`, status values declare fixed `choices`,
and dependency options declare `repeatable`. Repeatable values form an ordered
array from the first occurrence, retaining duplicate IDs for server validation.
Text options accept inline assignment split at the first equals sign, preserving
leading dashes and later equals signs. Separated dash-prefixed values remain
invalid; directory, switch and help options reject inline assignment. These
syntax facts belong to the definition consumed by parsing and static shell
completion. Help uses the declared names, value names, required markers and
option descriptions; it does not enumerate `value.choices`. Existing review directory syntax remains unchanged.

Task updates retain expected-version checks, atomic field/dependency updates
and server-side state gates. Local binding checks
cannot replace remote resource validation. Request cancellation and failures remain visible; failed
writes are not automatically retried. Complete paginated JSON is emitted only
after every page has succeeded. Whole-command deadlines and response-byte
budgets bound complete scans; reaching a limit fails without partial output,
while an already-sent write can still have an unconfirmed outcome. The HTTP
foundation uses one disposable operation for shared deadlines and byte counters,
strict response DTOs and complete opaque-cursor traversal. Task versions use
`bigint` internally and retain JSON numeric int64 precision on the wire. Bounded
response cleanup preserves both the original failure and cleanup errors.

The shared server runtime starts that operation before home/configuration I/O
and passes its cancellation signal into configuration reading. It supplies one
API client and operation to a callback that returns the fully rendered result.
After a final cancellation/deadline check it writes stdout once. SIGINT, SIGTERM
and Windows SIGBREAK cancel the same lifetime; completion removes owned signal
listeners and disposes timers without removing other consumers' listeners.

Project and task human output use complete labeled resource blocks with space
proportional to the total field content. A shared terminal helper escapes
controls and line separators while preserving ordinary Unicode. JSON uses the
original API values. Shared text predicates match the Go Unicode White_Space
rule rather than JavaScript trimming, so FEFF-only names remain valid and
NEL-only names remain invalid; validation never rewrites the supplied text.

## Alternatives

**Add a separate positional text kind to bypass trimming for names.** Named text
values already preserve their characters before domain validation. Giving only
some positional arguments that treatment creates two validation policies for
the same raw input. The syntax layer checks presence and choices; each command
owns its semantic validation before I/O, including review's whitespace-only
remote refusal. Explicit per-command terminator metadata preserves review's
existing syntax while allowing project names to begin with a dash.

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

**Pad every project into aligned columns.** A single long name can multiply the
maximum width across every result row, producing output much larger than the
resource content. Complete labeled blocks preserve all fields with linear
rendering space and do not depend on terminal display-width assumptions.

## Consequences

The confirmed design remains distinct from complete feature delivery. Project
commands join review, update and shell completion. Their compiled entry point
is verified against controlled HTTP responses and the delivered Project command
passed native CI. That evidence does not establish real Go/PostgreSQL CLI
integration. Task composition and the shared syntax pass local module, compiled
entrypoint, real-shell and native CI checks, with exact-head review. Installed
service acceptance follows the
[acceptance decision](../testing/2026-10-20-installed-project-task-acceptance.md);
its native and Go/budget paths preserve all existing suites and production limits.
Observed acceptance evidence remains owned by the
[task breakdown](../../../../docs/design/daynight-project-task-tasks.md). Shared
configuration, HTTP, repository and server-runtime modules support that remaining
work. Package versions follow the existing release rules.

Project creation uses `project create <name> --repo <repo>` in help, examples and
generated completion. The removed `--name` option is an argument error. Existing
shells must reload generated completion after installing the new package to use
the same positional grammar as execution.

The implemented repository resolver can infer a repository's project after one
complete discovery and then validate it by ID. The cache remains disposable and
scoped to server, repository and worktree. Automatic resolution can create the
ignored local binding even when preparing a query; remote project/task data
remains in the service. Task command composition finishes that preparation
before mutation. Cache and ignore failures remain errors, and corrupt records
are reported rather than silently discarded.

Discovery costs a complete project scan, and pagination is not one cross-request
snapshot. Cached selection intentionally remains stable after later duplicate
projects appear. Additional lookup capabilities can be introduced later without
replacing the cache format if they preserve the same identity and ambiguity
rules. Arbitrary SSH alias equivalence needs a separate mapping decision;
transport context must not be erased to infer it. Remote authentication,
project/task deletion and task ownership are outside this design and require
their own service contracts.
