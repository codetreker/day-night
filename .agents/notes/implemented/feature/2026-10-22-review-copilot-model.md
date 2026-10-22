# Agent Note: Configurable Copilot review model

Status: implemented

## Problem

Review operators need to select a Copilot model for their running reviewer.
Model availability belongs to the installed Copilot CLI and its authenticated
account, so a local list of supported model names would become stale. An absent
setting must also preserve Copilot's existing selection rather than introduce a
new override.

## Decision

The review projection of the shared YAML configuration accepts optional top-level
`copilotModel`. The existing nonempty-string validator rejects nonstrings, null,
empty or whitespace-only values and NUL, while preserving an accepted string
exactly. The value is opaque to Daynight; Copilot decides whether a model is
supported and available to the account. Its
[pinned command reference](https://github.com/github/docs/blob/5815d11586b0796688963a98c889680e60d72dc4/content/copilot/reference/copilot-cli-reference/cli-command-reference.md#L710)
defines model selection and the `auto` value.

The [configuration decision](../architecture/2026-10-16-user-home-review-configuration.md)
continues to own startup loading, command-specific projections and preserved YAML
updates. The shared parser recognizes this key, while the server projection
validates only its own fields. Setup and repository registration preserve model
settings and comments. An invalid review value remains an error rather than
triggering configuration guidance. The configured value applies to every review
repository in that process and changes only after restart.

The [Copilot execution decision](../architecture/2026-10-17-copilot-session-execution.md)
continues to own session identity, discovery, invocation and failure handling.
When configured, the formal review child receives `--model` and the original
string as two separate argv entries through the existing `shell: false` path.
New sessions, resumes, retries and later revisions use the same construction.
Omission adds neither argument and leaves Copilot's model choice intact. Skill
discovery receives no model argument. Unsupported or unavailable models retain
Copilot's failure result and the existing attempt/error flow; the setting adds no
SQLite field, session state or execution lifecycle.

The [requirements](../../../../docs/spec/daynight-review.md) own configuration
and invocation behavior; the [review design](../../../../docs/design/daynight-review.md)
owns its runtime and validation mechanisms. Installed-CLI acceptance uses native
controlled Copilot processes to observe YAML-to-argv transfer and retained-session
behavior. That evidence does not establish live model reasoning or account model
availability.

## Alternatives

**Validate against a static model-name enumeration.** This could reject obvious
misspellings earlier, but requires releases to track Copilot's changing models
and still cannot decide account availability. Passing an opaque validated string
keeps those decisions with Copilot.

**Always pass `--model auto` when the field is absent.** This gives the application
one explicit selection mode, but overrides Copilot's own default or persisted
choice. Omitting the argument preserves existing external configuration; `auto`
remains available when explicitly requested.

## Consequences

Operators can choose a model without changing process supervision, session
identity or review publication. Local validation proves that the configuration
contains a usable string, not that the requested model will succeed. Copilot
therefore remains responsible for availability failures and their diagnostics.
A running reviewer keeps its startup choice until restart, including across
retries and revisions. Controlled invocation checks and live Copilot acceptance
retain distinct evidence scopes.
