# Agent Note: UniAuth-backed Project Authorization Design

Status: implemented

## Problem

When this architecture was adopted, the delivered local service had no user or
membership model. Its global project list could not express which people may
access a project's tasks and attachments.
The application needs individual identity, revocable credentials and project
membership while preserving the existing trusted attachment execution model.

## Decision

The adopted [requirements](../../../../docs/spec/daynight-auth.md),
[architecture](../../../../docs/design/daynight-auth.md),
[interactive UI](../../../../docs/design/mockups/auth/index.html) and
[task entry point](../../../../docs/design/daynight-auth-tasks.md) define the
implementation. This note records the adopted architecture; runtime delivery
remains separately tracked and is not claimed by document completion. The
[identity foundation](2026-10-22-identity-credentials.md) implements persistent
users, sessions/PATs and callable handlers without mounting them into the current
application. The [membership foundation](2026-10-22-project-membership.md) adds
transaction-scoped access, private creation, roles and invitations without
mounting them. [CLI credentials](2026-10-22-cli-server-credentials.md) implement
origin-bound optional tokens, hidden/stdin setup, safe persistence and shared
HTTP Bearer transport. The opt-in [Web workspace](../feature/2026-10-22-web-auth-workspace.md)
implements authentication and project-management components without replacing
production `main.tsx`. App-aware provider discovery, production mounting and
full activation remain separately tracked.

Existing UniAuth and its Go SDK provide one-time identity handoff. Daynight owns
stable local users, browser sessions, personal access tokens, project memberships
and invitations. The creator becomes an admin atomically; admin/member share
existing resource read/write authority, and admins manage membership. Resource
access uses current membership inside the existing snapshot or write transaction.

### Adopted trusted same-origin preview boundary

Executable HTML remains trusted project code at the main application origin,
with the viewer's current main-origin authority. The ordinary iframe, relative
scripts/styles/images/fetch and existing same-origin keyboard bridge remain.
Attachment requests reuse the main browser session and normal project checks.
This preserves the [attachment architecture decision](2026-10-21-task-attachment-storage-design.md)
and [Web attachment decision](../feature/2026-10-21-task-attachment-web.md).

Independent preview domains/origins, preview credentials/sessions, bootstrap
exchanges, cross-origin shells and their DNS/TLS/gateway infrastructure are
outside the adopted architecture. Authentication must not add them as inferred
prerequisites. Changing the trusted preview model requires a separate explicitly
authorized architecture decision. Project membership is request authorization;
it does not promise to sandbox trusted uploaded HTML.

### Integration and scope

Identity and membership modules are tested before mounting them. One activation
integrates resource checks, clients, required config, health checks and all
existing acceptance callers. It already proves the integrated security contract;
a final combined receipt supplements those proofs.

Development and CI reuse same-origin numeric-loopback HTTP and UniAuth's existing
explicit AllowLoopbackHTTP support. Production uses the application's configured
HTTPS origin and existing entry point. A concrete UniAuth limitation must be
reported with evidence to its maintainer; an assumed gap does not authorize a
workaround architecture or changes to UniAuth.

## Alternatives

**Shared instance key.** It cannot represent the confirmed per-user project
membership requirements.

**Generic downstream OIDC client or authentication proxy.** UniAuth provides a
product handoff rather than downstream OIDC tokens. A proxy would not replace
project authorization and adds a deployment component; the existing SDK fits.

**Independent preview origins and scoped credentials.** They would isolate
uploaded code from the viewer's other authority, but introduce a different
content-trust model, credential lifecycle and deployment requirements. The
adopted product treats HTML as trusted same-origin project code and explicitly
keeps that architecture. This alternative is not an authentication task.

**Incremental exposure of partly authenticated resource paths.** This would
leave mixed access or require skipping existing checks. Tested components
followed by one complete activation keep the existing local boundary until the
whole authenticated composition is ready, without an auth-disable flag.

## Consequences

The implementation adds local users, memberships, invitations and two ordinary
credential types, with final-style frontend artifacts. CLI credential transport
is implemented without a new provider-login flow or credential framework;
Web token management is implemented in the opt-in workspace. Production mounting
and actual App-aware provider discovery remain separate work. It reuses the
existing application origin, file storage, project locks, runtime and deployment topology.
No preview-specific lifecycle or infrastructure is introduced.

Existing project assignments are deferred to manual membership maintenance.
Zero-member projects remain inaccessible through the normal query, with no
legacy branch. Revocation rejects new resource admissions; admitted file
transfers may finish and previously downloaded data cannot be recalled.
Filesystem/PostgreSQL atomicity remains the accepted K1 limitation.

The trusted HTML decision is a constraint on implementation and review, not an
untracked future promise to add isolation. Runtime implementation, actual upstream
login and complete acceptance remain unfulfilled until their own evidence and
required PR integration are confirmed.
