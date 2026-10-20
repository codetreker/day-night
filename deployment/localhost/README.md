# Localhost deployment

This Docker Compose stack builds and runs the project/task HTTP API with
PostgreSQL. Docker Engine 28 or newer, Linux containers and Docker Compose
2.20 or newer are required. The first build requires access to Docker Hub and
the Go module registry. No host Go, Node.js or PostgreSQL installation is needed.

## Start

From the repository root:

```bash
bash deployment/localhost/up.sh
```

The script works from any working directory when invoked with its path. It
builds the server image, recreates all three service containers while preserving
the PostgreSQL volume, and waits up to 120 seconds for their health checks.
Build time is separate from that readiness timeout. The API is available at
`http://127.0.0.1:8787/api/v1` after the command succeeds.

To select a different host port, export it before starting the stack:

```bash
export DAYNIGHT_PORT=18787
bash deployment/localhost/up.sh
```

The equivalent Compose command, and the remaining commands below, run from
`deployment/localhost/`:

```bash
docker compose up --build --force-recreate --detach --wait --wait-timeout 120
```

## Use the API

Create a project:

```bash
curl --fail-with-body --header 'Content-Type: application/json' \
  --data '{"name":"Local project","repoUrl":"https://github.com/example/project.git"}' \
  "http://127.0.0.1:${DAYNIGHT_PORT:-8787}/api/v1/projects"
```

Copy the returned project's `id` into `PROJECT_ID`, then create and list tasks:

```bash
PROJECT_ID=YOUR_PROJECT_ID
curl --fail-with-body --header 'Content-Type: application/json' \
  --data '{"title":"Try the task API","description":"Created locally"}' \
  "http://127.0.0.1:${DAYNIGHT_PORT:-8787}/api/v1/projects/$PROJECT_ID/tasks"
curl --fail-with-body \
  "http://127.0.0.1:${DAYNIGHT_PORT:-8787}/api/v1/projects/$PROJECT_ID/tasks"
```

Project registration stores repository metadata without cloning or contacting
the repository. See the [server README](../../packages/daynight-server/README.md)
for task updates, dependency rules and the complete HTTP contract.

## Operate and update

Check health and follow logs:

```bash
docker compose ps
docker compose logs --follow
```

Use Compose to restart the stack:

```bash
docker compose restart
```

After updating server source, the gateway configuration or image, the published
port, or network configuration, run the startup command again to rebuild and
recreate the stack together:

```bash
docker compose up --build --force-recreate --detach --wait --wait-timeout 120
```

The server shares the gateway's network namespace. A gateway restart outside
Compose, including an automatic container restart, can leave the server attached
to the old namespace and interrupt API forwarding. Running the startup command
recreates the containers together and attaches the server to the current gateway
namespace while retaining the database.

If startup fails, inspect `docker compose ps --all` and `docker compose logs`.
After resolving the reported error, use the startup command again.

## Persistence and exposure

PostgreSQL data lives in the Compose-managed `postgres-data` named volume,
mounted at `/var/lib/postgresql` as required by PostgreSQL 18. Server startup
applies its embedded database migrations. Stop the stack and retain projects
and tasks:

```bash
docker compose down
```

To deliberately delete all local projects and tasks, remove the volume too:

```bash
docker compose down --volumes
```

The API has no authentication and is published only on host `127.0.0.1`.
PostgreSQL has no published host port. The stack uses fixed development-only
database credentials (`daynight` / `daynight-local`, database `daynight`).
The gateway forwards TCP to the server's strict `127.0.0.1:8787` listener
inside their shared container network namespace, preserving the server's
HTTP handling. This deployment runs the independent Go API; the review CLI
has its own [configuration and startup](../../README.md#configuration-and-startup).
