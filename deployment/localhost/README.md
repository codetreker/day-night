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
builds the frontend with Node.js 24 and pnpm 11.28.6, embeds its generated assets
in the Go 1.27.2 binary, recreates all three service containers while preserving
the PostgreSQL and attachment volumes, and waits up to 120 seconds for their
health checks. Build time is separate from that readiness timeout. The final nonroot runtime
image contains the server binary and does not need Node.js. It prepares the
required writable `DAYNIGHT_STORAGE_ROOT` for UID/GID `10001:10001`. The
Compose-managed `attachment-data` volume mounts at that root. Docker initializes
a fresh volume from the image directory with its ownership, so the server writes
as UID 10001 without a privileged startup process.

Open `http://127.0.0.1:8787/` for the project list. Selecting a project opens
`/projects/<projectId>`, with statistics, expandable dependency graphs and task
details. The API is available at `http://127.0.0.1:8787/api/v1` on the same
origin. Task details can approve proposed work and manage attachments; use the
CLI or API to create projects/tasks, claim or complete tasks, and edit metadata.

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
namespace while retaining the database and attachments.

If startup fails, inspect `docker compose ps --all` and `docker compose logs`.
After resolving the reported error, use the startup command again. Tests use the
separate [dev-ci deployment](../dev-ci/README.md); it creates isolated resources
without operating this stack.

## Persistence and backup

Two Compose-managed named volumes hold application data:

| Volume | Container path | Content |
|---|---|---|
| `postgres-data` | `/var/lib/postgresql` | PostgreSQL data, including attachment metadata |
| `attachment-data` | `/var/lib/daynight/storage` | Attachment bytes under `task-attachments/<taskId>/<relativePath>` |

Names are scoped to the Compose project. Server startup applies its embedded
migrations. Normal stop, restart, `up --build --force-recreate`, and `down`
preserve both volumes. Stop the stack and retain all application data:

```bash
docker compose down
```

To deliberately delete projects, tasks, attachment metadata and attachment files,
remove both volumes:

```bash
docker compose down --volumes
```

The database and attachment directory form one backup pair. Stop the server and
any direct database or file writers before capturing both; keep writes stopped
until both artifacts are complete. This makes a normal backup stable but does
not repair a mismatch that already existed: file operations and PostgreSQL
metadata changes are not atomic. A database-only or directory-only restore does
not restore task attachments completely.

From `deployment/localhost/`, create a pair using the running stack's production
image for the archive. The temporary directory is local staging; retain the two
completed artifacts together in the operator's backup location. A failed command
leaves the server stopped so the failure can be diagnosed before writes resume.

```bash
(
  set -eu
  BACKUP_DIR="../../.tmp/daynight-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BACKUP_DIR"
  docker compose stop server
  docker compose exec -T postgres pg_dump --no-owner --no-acl \
    -U daynight -d daynight > "$BACKUP_DIR/postgres.sql"
  docker compose run --rm --no-deps -T --entrypoint tar server \
    -C /var/lib/daynight/storage -cpf - . > "$BACKUP_DIR/attachments.tar"
  docker compose up --no-build --detach --wait --wait-timeout 120
)
```

Restore a matching pair into fresh volumes using the corresponding application
image. The commands below deliberately discard the current stack's application
data. Set `BACKUP_DIR` to the retained pair first; the files must be outside the
volumes being removed. PostgreSQL and the gateway start before restoration, but
the server starts only after SQL and files are restored. Archive extraction uses
the normal UID/GID `10001:10001`, preserving the service's ability to write.

```bash
(
  set -eu
  BACKUP_DIR=../../.tmp/daynight-backup-YYYYMMDDTHHMMSSZ
  test -s "$BACKUP_DIR/postgres.sql"
  test -s "$BACKUP_DIR/attachments.tar"
  docker compose down --volumes
  docker compose up --no-build --detach --wait --wait-timeout 120 postgres
  docker compose up --no-build --detach gateway
  docker compose exec -T postgres psql --set ON_ERROR_STOP=1 \
    -U daynight -d daynight < "$BACKUP_DIR/postgres.sql"
  docker compose run --rm --no-deps -T --entrypoint tar server \
    -C /var/lib/daynight/storage -xpf - < "$BACKUP_DIR/attachments.tar"
  docker compose up --no-build --detach --wait --wait-timeout 120
)
```

After restore, check attachment lists, downloads and relative preview resources,
and upload a new file. This is a manual paired backup/restore procedure; it adds
no backup service or cross-store recovery mechanism. The
[deployment decision](../../.agents/notes/implemented/architecture/2026-10-21-task-attachment-persistence.md)
owns the volume and validation rationale. The
[dev-ci attachment check](../dev-ci/README.md#attachment-persistence-check)
exercises this procedure with disposable data and confirms scoped cleanup.

## Exposure

The unauthenticated dashboard and API are published only on host `127.0.0.1`.
PostgreSQL has no published host port. The stack uses fixed development-only
database credentials (`daynight` / `daynight-local`, database `daynight`).
The gateway forwards TCP to the server's strict `127.0.0.1:8787` listener
inside their shared container network namespace, preserving the server's
HTTP handling.

The planned [authentication requirements](../../docs/spec/daynight-auth.md) and
[architecture](../../docs/design/daynight-auth.md) define UniAuth login and
project authorization. Those capabilities are not implemented in this stack.
Their [task breakdown](../../docs/design/daynight-auth-tasks.md) owns coordinated
authentication activation and fixture updates in the existing same-origin
deployment. The present loopback binding and TCP gateway remain the supported
configuration; trusted same-origin HTML previews keep their execution model.

The review CLI has its own
[review configuration and startup](../../README.md#review-configuration-and-startup).
