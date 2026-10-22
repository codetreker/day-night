# Agent Note: Opt-in Authenticated Web Workspace

Status: implemented

## Problem

Users need browser access to their private projects, project membership,
invitations and personal access tokens. A partial production switch would expose
a mixture of authenticated and unauthenticated resource paths before the service,
clients and acceptance callers are ready. The frontend also needs to discard a
previous user's data and preserve one-time secrets without making failed requests
look successful.

## Decision

`AuthenticatedApp` is an explicitly mounted application shell. It provides login,
private project creation, account/token pages, member and invitation management,
and explicit invitation acceptance. It composes the existing project list,
project task tabs, graph and centered `TaskDetailDialog`. Production `main.tsx`
continues to render `App` under the persistent `LocaleProvider`; the opt-in shell
uses the same Provider. Both catalogs extend their complete `messages.auth`
contract to login, project creation, account, members, invitations, tokens and
management dialogs. Selectors remain available on login, invitation, workspace
and modal surfaces. Semantic notifications and validation render through the
current catalog, while native formatters render dates and counts. Changing
language preserves inputs, one-time secrets, current identity and pending
requests. The
[authentication architecture](../../../../docs/design/daynight-auth.md) owns the
coordinated production activation. This implements the browser components, not
production authentication or real third-party login.

The shared request boundary uses same-origin browser credentials, cancellation
and request IDs. A current-generation 401 notifies the shell; identity transitions
invalidate outstanding requests and unmount user-owned content. A project 404
stays a resource error. Auth-specific JSON parsing and mutation encoding preserve
member observation versions as `bigint` throughout the positive int64 range.

Creation responses alone supply PAT values and invitation links. The UI keeps
those secrets in the current dialog, supports retrying a failed copy, and
requires confirmation before discarding a secret. Invitation capture removes the
URL fragment immediately and uses tab-local temporary storage across login.
Inspecting an invitation does not accept it; explicit confirmation sends accept,
and finishing the workflow clears the pending invitation.

Management dialogs reuse body scroll locking, background inertness, focus
containment, Escape handling and focus restoration. Existing executable HTML
continues at the application origin with the ordinary iframe, relative resources
and same-origin keyboard bridge. No preview-specific credential or infrastructure
is introduced.

### Login provider dependency

The frontend reads `GET /api/v1/auth/providers` with `{providers:[ids]}` and shows
loading, retryable failure or an explicit empty-provider state. The authoritative
list must reflect the configured UniAuth App's allowed and enabled providers.
There is no fixed provider list or local configuration fallback. The frontend API
is unmounted; actual App-aware discovery and backend exposure belong to the
coordinated activation task. UniAuth's upstream capability is now delivered;
Daynight still uses the earlier SDK baseline until that task upgrades the pin.

The integrated UniAuth baseline is commit
`c82c55c7fcd366824d0bc5ac6bdd17528c0300fa`, Go SDK version
`v0.0.0-20261022051636-c82c55c7fcd3`. Its
[authorization URL builder](https://github.com/codetreker/uniauth/blob/c82c55c7fcd366824d0bc5ac6bdd17528c0300fa/sdk/go/uniauth.go#L82-L119)
validates local inputs and leaves registration and provider availability to the
gateway; the client also retrieves the one-time identity and exposes no provider
list. The [console provider response](https://github.com/codetreker/uniauth/blob/c82c55c7fcd366824d0bc5ac6bdd17528c0300fa/internal/console/handler.go#L233-L242)
reads global availability flags without an App ID. The
[authorization eligibility predicate](https://github.com/codetreker/uniauth/blob/c82c55c7fcd366824d0bc5ac6bdd17528c0300fa/internal/auth/handler.go#L345-L346)
also requires an enabled App, the provider in its allowlist and the registered
redirect URI. These sources preserve the reason discovery was unavailable at
that historical baseline; global flags cannot supply the required App-scoped
list. UniAuth [PR #19](https://github.com/codetreker/uniauth/pull/19), merged as
`0978963813fcefd9d553f6cb9bcc319084c764b3`, now supplies authenticated App-aware
[provider discovery](https://github.com/codetreker/uniauth/blob/0978963813fcefd9d553f6cb9bcc319084c764b3/docs/reference/api.md#L28-L73)
and the Go SDK
[Providers method](https://github.com/codetreker/uniauth/blob/0978963813fcefd9d553f6cb9bcc319084c764b3/sdk/go/providers.go#L14-L37).
It uses the exact registered redirect URI and returns the live App allowlist/
registry intersection. The old Daynight pin is deliberately unchanged in the
frontend task; activation upgrades it and connects the real provider contract.

### Validation ownership

The [Web README](../../../../packages/daynight-web/README.md#authenticated-workspace)
owns the actual-component fixture entry and validation commands. The fixture
mounts the opt-in shell with controlled fetch responses and final styles. The
[static design prototype](../../../../docs/design/mockups/auth/index.html) retains
the broader scenario reference. Browser interaction against controlled responses
proves frontend behavior; real service composition and third-party login require
separate evidence. The
[bilingual requirements](../../../../docs/spec/daynight-web-i18n.md) apply to all
new authentication components, including their failure and pending-operation
states. Controlled bilingual frontend evidence does not replace the separately
tracked combined production acceptance.

## Alternatives

**Switch the production entry before coordinated activation.** The service still
uses its existing unauthenticated resource composition, while authentication,
project-member checks and acceptance callers must change together. An opt-in
shell exercises the actual frontend without publishing mixed access behavior.
This preserves the integration sequence selected by the
[architecture decision](../architecture/2026-10-22-auth-architecture.md).

**Hardcode known login providers or use global provider flags.** Neither proves
that the configured App permits the displayed provider. Explicit discovery
failures made the protocol gap visible at the historical SDK baseline. The
upstream discovery capability is now delivered, and activation must use it rather
than substituting global flags or a fixed provider list.

## Consequences

Frontend composition is reviewable and testable before the production switch.
The current deployed application remains an unauthenticated loopback service;
component availability must not be described as an activated authentication
system. Member versions remain exact, user content has a session lifetime, and
copy failures do not destroy the only displayed secret.

Provider discovery remains an explicit integration dependency. Production
activation must upgrade the old SDK pin, obtain the App-scoped list through the
delivered UniAuth contract and expose it through the Daynight route. Controlled frontend fixtures do not satisfy
that requirement or demonstrate a successful real provider login. Existing
project browsing formats, graph behavior and trusted attachment execution remain
unchanged.
