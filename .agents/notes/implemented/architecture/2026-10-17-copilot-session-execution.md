# Agent Note: Copilot Session Execution

Status: implemented

## Problem

A review can publish to GitHub before the local process records completion.
Retries must retain the same conversation and reconcile earlier effects. Agent
output is free text, and local process closure alone does not establish either
remote publication or descendant-process exclusion.

## Decision

The Copilot adapter extends the
[foreground execution model](2026-10-16-foreground-review-cli.md). It launches a
direct child in the prepared PR worktree and leaves scheduling, process
exclusion and final review transitions to the coordinator. The existing
[store](2026-10-17-durable-review-state.md) persists the per-PR UUID and launch
intent before spawning; no additional execution database or process layer is
introduced.

First invocation selects the persisted UUID. Existing opaque session history
selects explicit full-UUID resume, including after an interrupted first launch.
Missing history for an established session is an error. The adapter checks only
the session directory; it does not parse Copilot history or JSONL.

The prompt is sent through stdin in Copilot's documented noninteractive mode.
`cross-spawn` handles installed executable and Windows command-shim resolution
with separate arguments and `shell: false`. Prompt text stays out of the command
line. Copilot home, cache, diagnostics and temporary files use runtime paths;
existing home, GitHub CLI configuration and authentication environment remain
available. Copilot's documented authenticated-`gh` fallback avoids copying
credentials into application state or prompts.

The adapter reuses the Git manager's environment isolation before applying the
[prepared raw/full-checkout settings](2026-10-17-owned-review-worktrees.md).
Captured PR/review identity, head, base, merge base and prior unfinished review
identity travel in the prompt. The agent publishes inline `COMMENT` reviews for
Critical/Major findings or `APPROVE` otherwise, binds publication to the captured
commit, rechecks eligibility and reconciles existing publication before retry.

Each attempt has a unique log directory with separate stdout and stderr logs.
A rejected launch intent cannot occupy the next attempt's paths. Full logs stream
to disk; the final stdout line uses at most 8,192 UTF-16 code units in memory. Only a normal zero exit, complete output capture and an exact final
nonempty stdout line `PR N Review Completed` produce a completion assertion.
Timeout, cancellation, malformed output and logging failure remain incomplete.
The result reports direct-child evidence and explicit command-not-found launch
failure; the coordinator supplies process exclusion before retry or worktree
mutation. A Windows command wrapper can have a PID even when the requested
executable never starts. Only an exact structured spawn-ENOENT error identifies
that failed launch, and its wrapper must still close. Other capture failures
remain distinct from this launch evidence. See the
[pinned command-not-found hook](https://github.com/moxystudio/node-cross-spawn/blob/77cd97f3ca7b62c904a63a698fc4a79bf41977d0/lib/enoent.js#L6).

Primary references are the
[programmatic guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically),
[session storage reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference),
[authentication guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli#authenticating-with-github-cli)
and [cross-spawn implementation](https://github.com/moxystudio/node-cross-spawn/blob/77cd97f3ca7b62c904a63a698fc4a79bf41977d0/lib/parse.js).

## Alternatives

**Pass the full prompt with `-p`.** This is supported, but prompt size and shell
metacharacters then travel through Windows command-shim parsing. Supported stdin
input removes those constraints without a custom launcher or binary resolver.

**Select the most recent global session.** Concurrent PRs would share or select
the wrong conversation. Persisted UUIDs make session choice independent of
launch order.

**Parse findings and publish from the adapter.** This would add an output schema
and a second publisher. The selected protocol gives the agent both publication
and retry reconciliation responsibility.

## Consequences

Controlled executables verify invocation, durable intent, session selection,
prompt delivery, stream handling and incomplete outcomes without live reviews.
Actual Copilot/GitHub acceptance remains a separate delivery check. Research
verified the relevant options against local Copilot CLI 1.0.98; this is observed
version evidence, not an inferred minimum-version guarantee.

The completion marker remains an agent assertion. GitHub publication and SQLite
updates are not one transaction, and a closed CLI wrapper does not prove that
all descendants have stopped. The [foreground coordination decision](2026-10-17-foreground-review-coordination.md)
defines the supported foreground-tools contract, current-tree cancellation and
operator recovery for ambiguous execution.
