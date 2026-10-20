# Agent Note: Embedded dashboard and isolated deployment

Status: implemented

## Problem

The read-only dashboard needs an ordinary local startup path and a reproducible
production build. A source build that silently embeds stale or placeholder files
can pass API tests while shipping no usable page. Tests also need the complete
HTTP/database topology without sharing the daily stack's fixed names, port or
persistent data. Cancellation must reclaim resources even when a callback leaves
background descendants after its leader exits.

## Decision

The Go executable embeds the real Vite output through `internal/webui`. Root
`pnpm web:build` typechecks, builds, validates ordinary files and local index
references, stages a complete copy and replaces the embed directory. A failed
swap restores the previous directory when possible and propagates failures;
failed publication stops the build. Generated files are ignored by Git, and a
clean Go build without them fails at compilation. No placeholder index is
committed. Go `scripts/check.sh` invokes this shared command before its existing
build/vet/race/go-cov sequence; source checkouts first install fixed Node 24 and
pnpm 10.34.5 workspace dependencies with the frozen lockfile. Go CI declares the
same prerequisites explicitly.

`internal/server` keeps one ServeMux and the existing single logging wrapper.
Exact root and project-page routes return index HTML; asset routes serve only
actual files. Missing resources and unknown pages do not become index HTML, and
unknown APIs retain JSON errors. HTML, graph snapshots and latest task details
use no-store; hashed resources use immutable caching. Static responses retain
request IDs, HEAD/method behavior and the existing sanitized error handling.

The [localhost stack](../../../../deployment/localhost/README.md) builds from the
repository root. Its Node stage installs only the web dependency closure,
including the locked Dagre runtime and XYFlow declaration inputs in `patches/`.
A Go stage embeds the published
assets; the final nonroot runtime contains only the server executable. Host Node
or Go is unnecessary. The existing startup command launches UI/API, PostgreSQL
and the stream gateway together, preserving loopback publication, shared network
namespace, readiness and the normal persistent volume. The
[localhost topology decision](2026-10-20-localhost-compose.md) owns those rules.

The independent [dev-ci stack](../../../../deployment/dev-ci/README.md) reuses that
exact Dockerfile and nginx file. A unique explicit Compose project and image tag,
random host-loopback port and project-owned database volume/network permit
concurrent runs. The runner registers cleanup before creating resources, checks
the built/running image identity, then passes the discovered `DAYNIGHT_BASE_URL`
to an argument-preserving callback. Lifecycle commands are bounded. Callback
process-group ownership survives its leader's exit; cleanup terminates remaining
descendants before removing only this run's resources and image tag. Cleanup
failure fails acceptance while retaining the original command failure.

Incremental receipts retain run/project/image identities, URL and cleanup state
inside the repository's `.tmp/dev-ci/`. Explicit recovery requires an existing
validated run identity after the original runner and callback group are stopped.
Recovery preserves the original manifest and records its own outcome. Empty,
malformed, unknown and daily-stack identities are rejected before Docker calls.
No global prune, normal localhost operation or shared-cache removal is used.

## Alternatives

**Run a separate production frontend server.** It avoids an embed build step but
adds another runtime service and origin configuration to a local read-only UI.
Embedding keeps the installed runtime and API on one address; the source-build
prerequisite is explicit and checked.

**Use the daily stack as a test base or Compose override.** Fixed container names,
ports and persistent volumes make concurrent acceptance and cleanup unsafe.
Independent environment definitions reuse the production build and forwarding
files; effective-topology checks limit drift to identity, port, data and lifecycle.

**Commit a generated or placeholder dashboard.** This would allow standalone Go
compilation without Node, but a stale or empty page could then satisfy a clean
build. Real output is generated and validated by source and container builds.

## Consequences

Source Go builds now require the web build toolchain; runtime deployments still
need only the executable and PostgreSQL. The Docker-only startup remains the
operator path. Two Compose definitions require topology parity checks, while the
shared Dockerfile, proxy configuration and build command avoid two application
implementations. Each test invocation owns its callback group and resources and
retains a recovery receipt when cleanup cannot be confirmed.

The W-T5 validation establishes embedded HTTP behavior, production image
identity, whole-stack recreation with persistent data, concurrent dev-ci
isolation and controlled runner failure/cleanup decisions. Its scope does not
establish the complete production-browser workflow or fixed five-run performance
requirements. The subsequent
[production acceptance harness](../testing/2026-10-20-dashboard-production-acceptance.md)
records both production targets, source identities and fixed measurements. Both
targets, the 1,000-node/5,000-edge matrix and cleanup/recovery pass locally;
actual deployment-fault acceptance also passes with another run retaining its
HTTP/data sentinel throughout. Clean CI source and image verification remains
required. W-T6 in the
[task document](../../../../docs/design/daynight-web-tasks.md) owns delivery status
and the [acceptance report](../../../../docs/research/daynight-web-acceptance.md)
owns measured results. The [MVP design decision](2026-10-20-task-dashboard-mvp-design.md)
continues to own read-only scope, graph semantics and deferred capabilities.
