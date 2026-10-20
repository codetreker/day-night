# daynight-server

The Go service owns PostgreSQL-backed project and task management. Its runtime
foundation is implemented: explicit database configuration, loopback-only HTTP
binding, connection validation, structured request logs, cancellation, and bounded
HTTP shutdown. Versioned migrations and transactional storage are implemented;
project/task APIs and built-process acceptance are implemented; delivery status is in the
[implementation tasks](../../docs/design/daynight-server-tasks.md); the current
executable serves project and task routes.

The [requirements](../../docs/spec/daynight-server.md) own observable behavior and
the [design](../../docs/design/daynight-server.md) owns architecture and concurrency.
The existing TypeScript CLI is a separate application and does not use this
service's database or lifecycle.

## Layout

| Path | Responsibility |
|---|---|
| `cmd/daynight-server/` | Environment, process signals, dependency assembly, exit status |
| `internal/server/` | HTTP lifecycle, request context, request IDs, structured logs |
| `internal/core/store/` | PostgreSQL migrations, transactions, scoped writes and consistent reads |
| `api/` | Project/task DTOs and common HTTP error envelopes |
| `internal/service/` | Project/task use cases, dependency/state/version policy and scoped cursors |
| `internal/core/` | Shared project/task models and resource-not-found marker |

HTTP startup creates and verifies one concrete store. The handler factory receives
that store before the listener accepts requests, allowing the composition root to
assemble services without opening another pool. The runtime owns HTTP shutdown
and pool closure. Startup applies the embedded migrations before accepting requests.
One pinned connection holds a session advisory lock across version checks and all
migration transactions; unknown versions, gaps and checksum mismatches stop startup.

## Local Docker deployment

From the repository root, run `bash deployment/localhost/up.sh` to build and
start this API with PostgreSQL and wait for readiness. Only Docker is required
on the host. The [deployment guide](../../deployment/localhost/README.md) owns
prerequisites, API examples, port selection and persistence/teardown commands.
The gateway publishes host `127.0.0.1:8787` and forwards TCP to the server's
loopback listener in their shared network namespace; the database has no
published host port. Startup uses this module's embedded migrations.

## Build and run

Go **1.27.2** and `pgx/v5` **5.11.0** are pinned. From this directory:

```bash
source scripts/env.sh
go build -o .tmp/daynight-server ./cmd/daynight-server
export DAYNIGHT_DATABASE_URL='postgres://daynight:password@127.0.0.1:5432/daynight?sslmode=disable'
.tmp/daynight-server
```

Use credentials suitable for the local PostgreSQL instance. The process validates
the connection before listening and exits nonzero on startup or shutdown failure.
It never logs the database URL, driver error text, SQL, request body, or query
string. Errors retain their original causes internally; logs expose safe
diagnostics and cause categories.

| Environment variable | Meaning | Default |
|---|---|---|
| `DAYNIGHT_DATABASE_URL` | Explicit PostgreSQL connection string | Required |
| `DAYNIGHT_LISTEN_ADDR` | Numeric loopback IP and port, including IPv6 syntax | `127.0.0.1:8787` |
| `DAYNIGHT_STARTUP_TIMEOUT` | Positive Go duration for database connection and listener startup | `10s` |
| `DAYNIGHT_SHUTDOWN_TIMEOUT` | Positive Go duration for draining HTTP requests | `10s` |

Wildcard, non-loopback, hostname, scoped IPv6, and malformed listen addresses are
rejected. Port `0` requests an ephemeral loopback port; the bound address appears
in the startup log. Invalid timeout values fail validation.

`SIGINT` and `SIGTERM` stop accepting connections and begin draining requests.
Active request contexts remain usable during the drain. On deadline, the runtime
cancels remaining request contexts, force-closes HTTP connections, and closes the
database pool after request-owned database resources are released. Database
operations must use the request context and release acquired connections.

Logs use JSON `slog` records with type, component, phase, and request ID. HTTP
records include method, route template, status, and duration. A supplied
`X-Request-ID` must contain 1–64 ASCII letters/digits with optional `.`, `_`, or
`-` after the first character; invalid or absent values receive a generated ID.
The response returns `X-Request-ID`. An unmatched route has an empty route template.
Handler panics emit a safe request-correlated error and abort the HTTP request;
the recovered value and stack are not printed by the HTTP server.

## Validate

Tests require a real PostgreSQL database and fail when it is unavailable or
`DAYNIGHT_TEST_DATABASE_URL` is missing. For a disposable local instance, use the
same PostgreSQL **18.6-bookworm** image as CI:

```bash
docker run --detach --name daynight-server-tests \
  --env POSTGRES_USER=daynight --env POSTGRES_PASSWORD=daynight-test \
  --env POSTGRES_DB=daynight --publish 127.0.0.1::5432 postgres:18.6-bookworm
docker port daynight-server-tests 5432
docker exec daynight-server-tests pg_isready -U daynight -d daynight
```

Set the reported loopback port in the test URL, then run:

```bash
export DAYNIGHT_TEST_DATABASE_URL='postgres://daynight:daynight-test@127.0.0.1:PORT/daynight?sslmode=disable'
bash scripts/check.sh
docker rm --force daynight-server-tests
```

The check builds the executable, runs `go vet`, expires project-local Go test
results so database changes cannot be hidden by cached coverage, and executes race-enabled package
tests through `go-cov` pinned to commit
`d6caf2759e330b48d69a543695e37002a48feb1d`. The checked-in `.go-cov.toml`
requires at least 85% coverage per package and 80% per function, with critical
blocks enforced and no production exclusions. A separate exact calculation over
the raw coverage profile requires overall statement coverage **strictly greater
than 90%**. Exactly 90% fails. The check also tests that calculation's boundary
and malformed-profile behavior.

`scripts/env.sh` places downloaded tools, dependencies, caches, binaries, and
temporary outputs under this module's `.tmp/`. Both local validation and CI use
`scripts/check.sh` and the same coverage configuration. The tests cover real
database connection/query cancellation, HTTP cancellation, graceful and forced
drain, listener/pool reuse, process configuration/exit status, and log redaction.

## Storage boundaries

`Store.WriteProject` locks one project in a `READ COMMITTED` transaction before
calling the supplied operation. The operation receives a project-scoped
`ProjectTx`; its subsequent reads observe commits made while it waited for the
lock. Returning an error rolls back fields, dependencies, version and timestamps
together. Only expose a captured resource after the outer call succeeds.

`Store.ReadSnapshot` uses read-only `REPEATABLE READ` for project/task queries and
derived readiness. Pages use a validated limit and optional `(createdAt, id)`
position; status/readiness filters run before keyset pagination. Page lookahead
is returned as `HasMore`; HTTP cursor encoding belongs to the API layer.

The shared `core.Project` and `core.Task` models have one representation across
storage and service. Store queries report prerequisite/dependent records and
candidate reachability. The service owns reference validation, DAG/state rules,
optimistic version comparison and semantic no-ops. There are no foreign keys or
delete operations. Direct database writers must not bypass these service rules.

Store tests use unique owned schemas and real PostgreSQL sessions. They prove
multi-migration exclusion, rollback after partial writes, snapshot consistency,
project-lock serialization, independent projects and cancellation. Rollback and
advisory unlock use independent bounded contexts and preserve original causes.

## Project API

| Method | Path | Result |
|---|---|---|
| `POST` | `/api/v1/projects` | `201`, project and `Location` |
| `GET` | `/api/v1/projects` | `200`, project page |
| `GET` | `/api/v1/projects/{projectId}` | `200`, project |

Creation accepts `name` and `repoUrl`. Names preserve accepted text and must be
nonempty UTF-8 without NUL. Repository addresses accept HTTPS, SSH URL and SCP
syntax, including SSH aliases and `@` inside repository paths. HTTPS userinfo,
SSH passwords, controls, query and fragment are refused. Credential-like
ambiguous SCP forms are rejected; use explicit SSH URL syntax when needed.
Registration performs no network, Git, clone or CLI-configuration operations.
Different projects can reference the same repository. UUID IDs are canonicalized
to hyphenated lowercase; project repository metadata has no update/delete API.

Creation requires `application/json` (optionally UTF-8 charset), one object within
1 MiB, exact field names and unique keys. Unknown/read-only fields, null required
fields, wrong types, invalid UTF-8 and trailing JSON return `invalid_input`.

Lists accept `limit` (default 50 only when absent, range 1–100) and opaque
`cursor`. Empty, repeated, malformed and unknown query parameters fail. Cursors
bind a version, list kind, project/filter scope and exact `(createdAt, id)`
position. Responses contain `items: []` for empty lists and `nextCursor: null`
on the final page. Individual reads use one snapshot; pagination does not retain
a cross-request snapshot.

Errors use `{"error":{"code":"not_found","message":"...","requestId":"..."}}`:
input 400, missing
resource 404, unsupported method 405 with `Allow`, and internal failure 500.
Responses and logs do not echo submitted URLs, bodies, SQL or driver messages.
The request ID matches `X-Request-ID`; parsed resource operations log the
canonical project ID. Database/transaction completion failures take precedence
over a pending missing-resource result. Already-cancelled requests do not write
a response.

## Task service

`service.NewTasks` exposes `Create`, `Get`, `List` and `Update` over the same
concrete store. HTTP task routes use the same instance. Creation uses `todo`;
updates require a positive expected version and at least one mutable pointer
field. Nil means omitted, while an empty description or supplied empty dependency
list clears that value. The task HTTP boundary rejects explicit JSON null
before constructing these Go parameters.

Dependencies are canonicalized UUIDs, sorted and checked for duplicate identity,
self-reference, missing/cross-project tasks and cycles. Every update validates
its complete candidate, including metadata-only updates and semantic no-ops.
Active/done tasks require done predecessors; reopening a done task is refused
when a direct dependent is active or done. Fault task IDs are sorted and do not
include other projects' task content.

Task writes hold the project lock while comparing versions and validating the
graph. A stale version conflicts even when values match. A matching semantic
no-op preserves version and update time; any actual change increments once.
Dependency order/case spelling does not create a change after canonicalization.
Predecessor changes derive readiness on read without changing downstream status,
version or timestamps.

Expected refusals are captured before any write and returned only after the
outer lock-only transaction succeeds; transaction/cleanup failures remain
operational errors. Lists and reads check project existence and task state
inside one RR snapshot. Task cursors bind the canonical project and optional
status/ready filters, preserving the difference between absent and false.

## Task HTTP API

| Method | Path | Result |
|---|---|---|
| `POST` | `/api/v1/projects/{projectId}/tasks` | `201`, task and `Location` |
| `GET` | `/api/v1/projects/{projectId}/tasks` | `200`, task page |
| `GET` | `/api/v1/projects/{projectId}/tasks/{taskId}` | `200`, task |
| `PATCH` | `/api/v1/projects/{projectId}/tasks/{taskId}` | `200`, updated task |

Creation accepts required `title`, optional `description` and optional
`dependsOn`; omitted optional values mean empty text and an empty dependency
set. Status, version and identity are server-owned on creation. PATCH accepts
a positive integer `version` and at least one of `title`, `description`,
`status`, `dependsOn`. Omitted fields stay unchanged; explicit null (including
null dependency elements) fails. Empty description or `dependsOn: []` clears
that field. Fractions, exponents, strings and out-of-range versions fail.

Task responses contain identity, project, title, description, status, version,
UTC timestamps, sorted `dependsOn`/`blockedBy` arrays and `ready`. A missing
project or a task outside the specified project returns 404. The initialized
empty project returns `items: []`, `nextCursor: null`.

Lists support `limit`, `cursor`, `status` and `ready`, once each. `ready` accepts
literal `true` or `false`; filters combine with AND and remain bound to the
cursor's canonical project scope. HTTP input uses the same strict JSON and
query rules as project operations.

Version conflicts, dependency cycles and unmet dependency/state rules return
409 with `version_conflict`, `dependency_cycle` or `dependency_unsatisfied`.
Relevant sorted IDs appear in `error.details.taskIds`. Operational failures
remain 500, and cancelled requests write neither response body nor creation
Location. Parsed project/task IDs and the request ID correlate safe logs; known
refusals use their domain `error_code` and cause instead of an internal label.

For example, after obtaining a project and task ID:

```bash
curl --header 'Content-Type: application/json' \
  --data '{"title":"Implement API","dependsOn":[]}' \
  http://127.0.0.1:8787/api/v1/projects/PROJECT_ID/tasks
curl --request PATCH --header 'Content-Type: application/json' \
  --data '{"version":1,"status":"in_progress"}' \
  http://127.0.0.1:8787/api/v1/projects/PROJECT_ID/tasks/TASK_ID
```

To inspect a failure, match its response `requestId` with JSON logs on stderr:

```bash
jq 'select(.request_id == "REQUEST_ID")' .tmp/server.jsonl
```

Capture stderr to that project-local path when starting the process; submitted
URLs, bodies, SQL and credentials are excluded from logs.

## Built-process acceptance and CI evidence

The same check runs 12 actual-process scenario groups. TestMain freshly builds a
race-enabled server, starts only owned loopback children against isolated real
PostgreSQL schemas, and checks HTTP workflows, restart persistence, competing
mutations, partial-write rollback, cancellation, graceful/forced SIGTERM,
migration failures and simultaneous startup. This signal acceptance runs in the
Ubuntu Go CI job. Existing three-platform CLI validation remains separate.

The test process incrementally writes `.tmp/acceptance-evidence.json` with the
checked-out Git/GitHub SHA, dirty state, Go/PostgreSQL versions, tested binary
SHA-256, named results and cleanup counts. CI requires a clean checkout and a
revision matching `GITHUB_SHA`. All children stop before schemas are removed;
the receipt records reaping, removed schemas and disappearance of owned sessions.
The temporary tested binary is removed after the run; its hash remains in the
receipt.

CI uploads `daynight-server-acceptance` after validation, including the JSON
receipt and raw `.tmp/coverage.out`, even when validation fails. Successful
package-level coverage and actual process results are separate evidence: binary
HTTP tests do not replace the store/service/server package tests. The
[acceptance report](../../docs/research/daynight-server-acceptance.md) owns the
V1–V10 mapping and receipt interpretation.
