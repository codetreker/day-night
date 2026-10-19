# daynight-server

The Go service owns PostgreSQL-backed project and task management. Its runtime
foundation is implemented: explicit database configuration, loopback-only HTTP
binding, connection validation, structured request logs, cancellation, and bounded
HTTP shutdown. Project/task APIs and database migrations follow the
[implementation tasks](../../docs/design/daynight-server-tasks.md); the current
executable returns HTTP 404 for application routes.

The [requirements](../../docs/spec/daynight-server.md) own observable behavior and
the [design](../../docs/design/daynight-server.md) owns architecture and concurrency.
The existing TypeScript CLI is a separate application and does not use this
service's database or lifecycle.

## Layout

| Path | Responsibility |
|---|---|
| `cmd/daynight-server/` | Environment, process signals, dependency assembly, exit status |
| `internal/server/` | HTTP lifecycle, request context, request IDs, structured logs |
| `internal/core/store/` | Concrete PostgreSQL pool and database error causes |
| `api/` | HTTP request/response contracts, introduced with API operations |
| `internal/service/` | Business use cases, introduced with project/task operations |
| `internal/core/` | Domain models, introduced with their use cases |

HTTP startup creates and verifies one concrete store. The handler factory receives
that store before the listener accepts requests, allowing the composition root to
assemble services without opening another pool. The runtime owns HTTP shutdown
and pool closure. No database schema or migration is created by this foundation.

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

The check builds the executable, runs `go vet`, and executes race-enabled package
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
