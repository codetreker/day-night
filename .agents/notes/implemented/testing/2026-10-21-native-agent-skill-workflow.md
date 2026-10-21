# Agent Note: Native Agent skill workflow acceptance

Status: implemented

## Problem

Package-byte and terminal checks establish installation behavior but cannot show
that an Agent automatically loads those instructions or follows their task
workflow. Explicit invocation and skill inventory do not establish ordinary
activation. Controlled service responses cannot prove real dependency, version
or PR-completion behavior, and native auth can leave credentials or processes
outside a test fixture unless ownership is explicit.

## Decision

The opt-in `skill:acceptance` suite in `test/native/` uses actual Codex, Copilot
CLI and Claude Code with the real packed CLI and an isolated Go/PostgreSQL
service. User and Project scopes form six workflow cases; three focused Codex cases
cover missing/ambiguous project association and persistent service failure. A normal development request
names neither Daynight, the skill nor its path; fixture documentation supplies
ordinary project context. Successful native content delivery must match the
installed entrypoint or its native Markdown body. Inventory, invocation intent,
failed reads and path-only output cannot satisfy that proof.

The native adapters keep host-specific protocols concrete. Codex uses ephemeral
app-server threads and successful structured read results. Copilot correlates
the isolated session's native skill context-delivery events; stdout omits them.
Claude correlates successful Skill/Read results with the complete delivered
content, including its first-invocation synthetic user message. Native versions,
source hashes and selected scopes bound what each receipt establishes.

Real installation uses the existing terminal fixture. Real CLI and read-only
GitHub wrappers forward requests unchanged and record results. A second actual
CLI update introduces one version conflict; the Agent must reread and preserve
the concurrent acceptance condition. Immutable arithmetic tests prevent a
rewritten test from proving the requested behavior. Trace order establishes
in-progress before implementation testing, successful tests and actual merged-PR
inspection before completion, and a ready refresh afterward. Any attempted
completion of the open-PR task fails acceptance, even if later reverted. A real committed-create response is dropped once; reconciliation must find and
inspect the unique resource without another create. Existing dependencies are
replaced with a complete set that preserves every required predecessor. Actual
zero/two-project association and persistent scoped network failures preserve the
reported cause, configured server and binding without guessed selections or
resource mutations. Queued successors retain their statuses; service-derived readiness supplies the unlock.

The service helper uses version-pinned Docker images, a fresh source build,
random loopback ports, generated child-only database credentials, tmpfs storage
and unique ownership labels. A transparent HTTP recorder captures real request
metadata without bodies or auth. Deadline handling terminates owned process
trees and bounds reap; cleanup checks zero database sessions and removes only
owned containers, state and fixtures. The opt-in configuration disables Vitest's
non-cancelling outer timeouts: a framework timeout must not start teardown while
an async setup or model owner can still create resources. Individual owners
retain their process/request/readiness deadlines and complete cleanup before
the suite advances. Fixture forwarding children carry private
ownership tokens and stable Linux process identities so cancellation can reclaim
orphans without killing reused unrelated PIDs.

Native host homes and configuration stay inside the task workspace. Existing
operator auth is read-only input, never a copied auth cache. Codex retains its
configured command-backed provider using a helper-only restoration of original
credential lookup; headers become excluded child-only environment values and
shell snapshots are disabled. Claude retains configured bearer auth with native
subprocess credential scrubbing. Copilot uses its supported GitHub auth route.
Known credentials are scanned from owned state before deletion; execution,
scan and cleanup errors retain their causes together.

The [README](../../../../README.md#live-agent-skill-acceptance) owns commands and
prerequisites. The [skill design](../../../../docs/design/daynight-agent-skill.md)
owns acceptance structure. The
[terminal decision](2026-10-21-native-skill-terminal-acceptance.md) continues to
own native PTY/ConPTY proof; this suite does not replace it.

## Alternatives

**Use inventory or explicit Skill invocation.** These can show discovery or
manual loading but cannot establish selection from the ordinary development
request. They remain diagnostic evidence, separate from successful automatic
content delivery.

**Keep real Agent responses but mock task or hosting facts.** This loses the
actual service's dependency/version gates and platform merge state. Isolated real
service data and read-only hosting queries provide those facts without changing
production data or granting external write authority.

**Put model calls in regular CI.** That would make credential-free installation
and CLI validation depend on personal model auth, external availability and
usage costs. A separate suffix/configuration makes real calls explicit while
ordinary tests still typecheck the helpers and exercise local failure invariants.

## Consequences

The suite invokes real models and requires authorized PR references and supported
auth configuration. Current adapters cover command-backed Codex Responses auth,
Copilot GitHub auth and Claude bearer-provider settings; unsupported inputs fail
explicitly. Linux and Docker are prerequisites for this combined harness.
Windows/macOS installer behavior still requires its own native evidence.

Model selection and behavior can vary. Passing receipts prove their exact
versions, content, scope, source and observed workflow; they do not guarantee
all future automatic activations or replace product permission boundaries.
Case filters help diagnose a concrete failure and cannot stand in for the full
matrix. Run-specific events, usage and hashes belong to source-bound receipts
and the associated PR, rather than a rolling repository report.
