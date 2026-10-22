# Agent Note: Origin-bound CLI Server Credentials

Status: implemented

## Problem

An unattended client needs to supply a personal token without exposing it in
arguments, prompts or diagnostics. Reconfiguring a service must not send a
previous service's credential to a different origin. Configuration now contains
a secret, so parser diagnostics and persistence permissions require explicit
ownership as well as the HTTP transport.

## Decision

The existing server configuration projection adds optional `serverToken`.
It is opaque visible ASCII and is valid for HTTPS or literal localhost/numeric
loopback HTTP development. Review and unrelated commands retain independent
configuration projections. Server authentication failures give setup guidance;
they do not trigger a login preflight, anonymous retry or mutation replay.

Interactive server setup uses hidden terminal input. Scripted setup uses the
boolean `--server-token-stdin` option and one nonempty input line, optionally
terminated with LF or CRLF. Explicit URL-only setup keeps its existing scriptable
behavior. A blank hidden answer preserves a same-origin token or skips a token
for a new origin. The origin and token fingerprint are checked together under
the existing write lock; a changed origin removes the old credential atomically.
Unrelated completed review changes are preserved.

The generic configuration writer uses its parsed document to restrict a
credential-bearing file to POSIX mode0600, including writes by other capability
owners. Files without a token retain the existing permission behavior. The
existing lock, regular-file/symlink checks and atomic replacement remain.

Only one terminal reader owns input at a time. Before opening the hidden prompt,
the ordinary readline interface is closed with its internal cleanup intact;
only application-owned listeners are removed explicitly. Real PTY transcripts
verify individual secret characters never echo and cancellation leaves no
partial configuration.

Strict YAML parsing remains mandatory. Since YAML alias/tag/key messages can
include scalar contents, configuration diagnostics retain safe error category,
code and offsets rather than raw parser text or nested raw causes. Other errors
retain their useful chains. The generic diagnostic formatter and HTTP error
handling do not become a token-redaction framework.

The shared HTTP client attaches Bearer to its existing requests and retains
manual redirects, request/operation/response budgets, pagination, exact versions
and binary stdout. Credentials remain outside repository project bindings.
The [server foundation](2026-10-22-identity-credentials.md) owns issuance and
revocation; the [authentication architecture](../../../../docs/design/daynight-auth.md)
continues to own final activation and the trusted same-origin attachment model.

## Alternatives

**Plain token command-line option.** It places a secret in shell history and
process arguments. Hidden input and stdin cover people and automation through
the existing setup command.

**Implement a CLI provider-login flow.** The confirmed product uses Web-created
personal tokens, and UniAuth supplies confidential-backend identity handoff.
Another login protocol adds an independent credential lifecycle without serving
the selected client model.

**Keep a credential when switching server origins.** The next command could
send it to a different service. Clearing the old token in the URL update's same
atomic write preserves origin ownership.

**Propagate raw YAML errors or redact only their top-level message.** Nested
alias/tag messages still contain scalar data and the formatter traverses those
causes. Safe diagnostics at the credential configuration boundary preserve the
failure and location without copying source values into error objects.

## Consequences

The client stores one token in the existing YAML format, with no new registry,
keychain, project-local secret or provider dependency. Missing tokens remain an
ordinary unauthenticated request outcome until server activation; configured
invalid tokens fail without another request.

Actual installed-client validation pairs the normal UniAuth/Go session-to-PAT
flow with stdin setup, project creation/filtered listing and revocation. Native
terminal and shell checks remain separate platform evidence. Production server
activation and Web account management remain in their own tasks.

Explicit URL replacement currently reports an invalid previously stored origin
before writing its replacement. Restoring the earlier manual-repair behavior is
a deferred minor usability issue; automatic guidance continues to refuse invalid
configuration. The task's primary attachment retains this follow-up separately
from credential acceptance.
