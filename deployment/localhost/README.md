# Localhost deployment

This Docker Compose stack builds and runs the task dashboard, project/task HTTP
API and PostgreSQL together. Docker Engine 28 or newer, Linux containers and
Docker Compose 2.20 or newer are required. The first build accesses Docker Hub,
the npm registry and the Go module registry. No host Go, Node.js or PostgreSQL
installation is needed.

## Start

From the repository root:

```bash
bash deployment/localhost/up.sh
```

The script works from any working directory when invoked with its path. It
builds the frontend with Node.js 24 and pnpm 10.34.5, embeds its generated assets
in the Go 1.27.2 binary, recreates all three service containers while preserving
the PostgreSQL volume, and waits up to 120 seconds for their health checks.
Build time is separate from that readiness timeout. The final nonroot runtime
image contains the server binary and does not need Node.js.

Open `http://127.0.0.1:8787/` for the project list. Selecting a project opens
`/projects/<projectId>`, with statistics, expandable dependency graphs and task
details. The API is available at `http://127.0.0.1:8787/api/v1` on the same
origin. The dashboard is read-only; use the API to create projects or tasks.

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

## Create project data

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
  --data '{"title":"Try the task dashboard","description":"Created locally"}' \
  "http://127.0.0.1:${DAYNIGHT_PORT:-8787}/api/v1/projects/$PROJECT_ID/tasks"
curl --fail-with-body \
  "http://127.0.0.1:${DAYNIGHT_PORT:-8787}/api/v1/projects/$PROJECT_ID/tasks"
```

Refresh the dashboard to load the new data. Project registration stores
repository metadata without cloning or contacting the repository. See the
[server README](../../packages/daynight-server/README.md) for task updates,
dependency rules and the complete HTTP contract.

## Operate and update

The containers are named `daynight-postgres`, `daynight-gateway` and
`daynight-server`. These fixed names allow one localhost stack per Docker
daemon, including when a different Compose project name is selected.

Check health and follow logs:

```bash
docker compose ps
docker compose logs --follow
```

Use Compose to restart the stack:

```bash
docker compose restart
```

After updating frontend or server source, the gateway configuration or image,
the published port, or network configuration, run the startup command again to
rebuild and recreate the stack together:

```bash
docker compose up --build --force-recreate --detach --wait --wait-timeout 120
```

The server shares the gateway's network namespace. A gateway restart outside
Compose, including an automatic container restart, can leave the server attached
to the old namespace and interrupt forwarding. Running the startup command
recreates the containers together and attaches the server to the current gateway
namespace while retaining the database.

If startup fails, inspect `docker compose ps --all` and `docker compose logs`.
After resolving the reported error, use the startup command again. Tests use the
separate [dev-ci deployment](../dev-ci/README.md); it creates isolated resources
without operating this stack.

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

The unauthenticated dashboard and API are published only on host `127.0.0.1`.
PostgreSQL has no published host port. The stack uses fixed development-only
database credentials (`daynight` / `daynight-local`, database `daynight`).
The gateway forwards TCP to the server's strict `127.0.0.1:8787` listener
inside their shared container network namespace, preserving the server's
HTTP handling. The review CLI has its own
[configuration and startup](../../README.md#configuration-and-startup).
