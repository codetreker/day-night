# Agent Note: Installed CLI Acceptance

Status: implemented

## Problem

Module tests can pass while a packed distribution omits runtime files, resolves
dependencies differently or fails through a platform command shim. Final review
delivery also needs evidence that separates controlled process behavior from
actual Copilot reasoning and GitHub effects.

## Decision

`pnpm acceptance` builds, packs and installs the application into a project-local
consumer, then drives its installed `daynight` command. The test uses real Git
and SQLite with controlled `gh` and Copilot executables. It injects no runtime
or coordinator dependencies and adds no product test flags.

Windows `execFile("gh")` receives a native executable: a copy of the existing
Node binary preloads a bounded fixture module before resolving the absent API
entrypoint. The ordinary Copilot command shim remains on PATH. Temporary home
and working directories exercise spaces and Unicode. Git protocols are limited
to the exact local fixture origin, and live credentials are removed from the
controlled environment.

The fixture drives triggers, exact session continuation, publication ownership,
missing-marker reconciliation, installed singleton refusal, abnormal-lock
diagnostics, restart and worktree cleanup. The abnormal-exit fixture waits for
current direct tool handles to drain, acknowledges the actual CLI PID and exits
synchronously before the runtime can release its lock. A native child verifies
the public `ProcessWrap` visibility used by that gate on each platform. This
is a controlled fault-injection point; ordinary native process-tree cancellation
keeps its own unchanged tests. The
[acceptance report](../../../../docs/research/daynight-acceptance.md) owns the
scenario receipts, commands, tested baselines and live-service limits.

The separate command performs normal registry dependency resolution. The pnpm
store alone cannot satisfy a fresh consumer's offline metadata lookup after a
frozen workspace install. The ordinary `pnpm check` remains independent of this
additional consumer installation. See the inspected
[pnpm resolver](https://github.com/pnpm/pnpm/blob/702ad5f860ffd50d64a3a711d9f8a3da16fc796e/resolving/npm-resolver/src/pickPackage.ts#L143-L179).

Native CI runs both commands and uploads only the environment and lifecycle
JSON receipts. The environment manifest selects version and OS fields; it never
serializes the full process report or environment. The
[pinned artifact action](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml)
includes only those explicit paths. The final matrix gate remains authoritative,
including fixture cleanup and failed assertions.

## Alternatives

**Validate only source modules or a linked checkout.** This misses package-file
selection, consumer dependency layout and generated installed command shims.
Packing and normal consumer installation exercise those public boundaries.

**Seed an offline consumer by constructing lockfile/cache metadata.** That adds
pnpm internals to a distribution test and bypasses ordinary resolution. An
explicit registry-backed acceptance stage keeps the package installation real
while ordinary tests remain separate.

**Treat a simulated publication as a live-service receipt.** Controlled responses
prove orchestration and the text/session protocol, but cannot prove model
judgment, entitlement or GitHub authorization. Live acceptance retains its own
repository, reviewer and write-authorization requirements.

## Consequences

The same installed lifecycle can run on native Linux, macOS and Windows without
review credentials or global installation. CI artifacts identify the exact tested
toolchain and clearly mark both live-service flags false.

Package-registry access is required for acceptance. Local fixture success does
not extend OS/architecture support beyond observed receipts. Real Copilot and
GitHub acceptance remains outstanding until the designated test effects are
authorized and observed.
