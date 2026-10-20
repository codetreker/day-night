# Isolated development and CI deployment

This deployment runs the dashboard, API and PostgreSQL in a disposable Docker
Compose project. It uses the [localhost Dockerfile](../localhost/Dockerfile) and
[TCP gateway configuration](../localhost/nginx.conf), with the same frontend
build, embedded Go assets and nonroot runtime as the normal deployment. It
requires Bash, standard shell utilities, Docker Engine 28 or newer, Linux
containers and Docker Compose 2.20 or newer. Host Node.js, Go, PostgreSQL and jq
are not required by the runner.

## Run a command against the stack

From the repository root:

```bash
bash deployment/dev-ci/run.sh bash -c \
  'curl --fail-with-body "$DAYNIGHT_BASE_URL/api/v1/projects?limit=1"'
```

The runner can be invoked by path from any directory. It builds a unique image,
starts the three services, waits up to 120 seconds for health and discovers the
random port published on `127.0.0.1`. It checks that the running server uses the
exact image ID produced by this run, then calls the command with its arguments
unchanged. The command inherits:

| Variable | Value |
|---|---|
| `DAYNIGHT_BASE_URL` | HTTP origin, such as `http://127.0.0.1:32777` |
| `DAYNIGHT_DEV_CI_RUN_ID` | Unique run identity used in receipts and cleanup |

The runner does not evaluate the command as shell text. Explicit `bash -c` is
needed when a command needs shell expansion, as in the example. The callback
keeps its caller's working directory. Build time has a separate 600 second
bound; the startup command has a 150 second outer bound around Compose's 120
second readiness wait. The callback's duration is controlled by its caller.

Each invocation uses `daynight-dev-ci-<run-id>` as the explicit Compose project
and a unique `daynight-dev-ci:<run-id>` image tag. All Compose operations use the
same absolute file and project directory with an empty environment file,
regardless of inherited `COMPOSE_FILE` or `COMPOSE_PROJECT_NAME`. Services,
networks and the named PostgreSQL volume have project-scoped names. PostgreSQL
has no host port, and no resource uses a fixed container name or an external
volume/network. Multiple invocations can run concurrently.

## Completion, failure and cancellation

Cleanup is registered before Docker operations. Normal exit, callback failure,
partial startup and `INT`/`TERM` all collect project diagnostics, run targeted
`down --volumes --remove-orphans`, confirm that the project's containers,
volumes and networks are absent, and remove only this run's image tag. Callback
process groups receive termination on cancellation. Docker commands and cleanup
operations have independent bounds; a callback's failure status is retained if
cleanup also fails. Cleanup failure makes a successful callback fail. The
callback's process group remains owned after its leader exits, so cleanup also
terminates background descendants after successful or failing callbacks.

The runner never operates `daynight-localhost`, the normal fixed-name
containers, another dev-ci project, or shared build caches. It does not run
Docker prune or remove unnamed resources by global enumeration.

## Receipts and CI recovery

Receipts remain in `.tmp/dev-ci/<run-id>/` at the repository root:

| File | Content |
|---|---|
| `manifest.json` | Versioned run identity, project, image tag/ID, observed container/volume/network identities, origin, final phase, command result and cleanup result |
| `compose-ps.txt` | Project-scoped service diagnostics |
| `compose-logs.txt` | Project-scoped service logs |
| `image-id`, `base-url`, `container-ids`, `volume-names`, `network-ids` | Validated scalar/list state used by recovery without sourcing shell code |
| `recovery-manifest.json` | Result of an explicit recovery cleanup, preserving the original manifest |

The manifest is atomically replaced at each phase. `result` is `running`,
`passed`, `failed` or `cancelled` for a normal invocation; recovery records
`recovered`. `cleanupResult` is `pending`, `passed` or `failed`. The manifest
stores neither callback arguments nor environment dumps or request bodies.
Service diagnostics follow the server's sanitized logging policy.

A CI `always()` cleanup step can handle a runner killed before its trap finishes:

```bash
bash deployment/dev-ci/run.sh --cleanup RUN_ID
```

Stop the original runner and its callback process group before recovery, so it
cannot create resources after cleanup. `RUN_ID` must match the generated numeric
identity format and have an existing local receipt. The runner derives the
project and image tag from that identity, uses the same bounded, targeted
cleanup and writes `recovery-manifest.json`. Empty, malformed, unknown and normal
localhost identities are rejected before Docker operations. An interrupted run
can leave a unique image tag or project resources until recovery succeeds; retain
the receipts as CI artifacts when reporting a failure.

## Runner checks

The Bash fixture tests exercise success, malformed cleanup identities, build and
partial-startup failures, image mismatch, callback failure, cleanup failure,
recovery, cancellation and callback descendants without starting Docker:

```bash
bash deployment/dev-ci/tests/run.sh
```

Production-image HTTP/browser acceptance uses this runner with a real Docker
daemon. Fake-Docker checks only verify orchestration and cleanup decisions.
