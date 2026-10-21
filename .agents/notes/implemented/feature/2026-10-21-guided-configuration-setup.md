# Agent Note: Guided Configuration by Command Capability

Status: implemented

## Problem

A newly installed CLI cannot execute a server command without its server origin
or a review command without a registered repository. An absent configuration file
exposes a filesystem error without helping an interactive operator supply the
necessary values. Requiring every machine to configure every capability also
burdens machines that only use project and task management. Configuration changes
must preserve unrelated settings and must not activate runtime resources.

## Decision

Valid project/task operations guide only an absent configuration file or
`serverUrl`; valid review run/list operations guide only an absent file or
`repositories` field. They prompt only with terminal stdin and stderr. Complete
configuration executes directly. Shared YAML/schema errors, invalid present values
for the selected capability, empty review repository lists and ordinary read
failures retain their errors. Business values owned only by the other capability
remain outside the current projection.
Noninteractive missing configuration fails with an explicit setup command.
The [client requirements](../../../../docs/spec/daynight.md#c6-按需配置引导)
own these observable rules; the [client design](../../../../docs/design/daynight.md#按需配置引导)
owns composition and persistence.

`daynight setup` selects server access, review or both. Explicit `--server-url`,
`--review-repo` and optional `--review-path` configure the selected capabilities
without prompts. The path option requires a repository. There is no common
initialization-complete marker and no implicit server origin. A server-only
machine never needs review configuration.

Input collection precedes configuration mutation. A single write transaction
acquires the configuration lock and rereads the latest document. Changes to
unrelated fields are preserved; a changed selected field fails with an explicit
conflict rather than overwriting intervening input. The merged selected values
are validated before atomic replacement. It preserves comments, other
capabilities, existing repository paths and permission modes. The
[registration decision](2026-10-18-add-repo-configuration.md) continues to own
remote identity, saved paths, idempotency and configuration-only registration.
It supplies the shared repository updater rather than a second registration path.

Prompts and save diagnostics use stderr. The shared CLI prompt and cancellation
lifecycle also serves [skill installation](../../../../docs/design/daynight-agent-skill.md),
while configuration collection and persistence remain setup-owned. Cancellation
signals and EOF stop input
without saving partial values or entering the original operation. Setup does not
access the network, prepare clones, initialize SQLite or activate a reviewer.
Automatic setup then executes the original operation once with the original
arguments. Initial server configuration I/O remains bounded. An actual setup
releases that deadline, retains cancellation and starts a fresh business budget
for the post-setup reload; complete configuration keeps the original deadline.
Human input consumes no business budget. A later service or review failure keeps
the saved configuration.

This partially supersedes the missing-configuration startup prerequisite in the
[user-home configuration decision](../architecture/2026-10-16-user-home-review-configuration.md)
and [project/task decision](../architecture/2026-10-20-project-task-cli-design.md).
Their original explicit preparation avoided implicit configuration mutations and
kept configuration errors visible. The replacement retains those error and
runtime boundaries while adding an explicit interactive collection step. The
fixed file location, review state format and command-specific field validation
remain unchanged.

## Alternatives

**Require manual configuration before every first command.** This preserves the
original explicit preparation model, but a fresh installation reports an absent
file before an operator has learned how to create it. Scriptable setup remains
available while interactive commands supply the same operation when needed.

**Configure server access and review together on every machine.** This could
establish one initialization-complete state, but asks for repository registration
on machines that do not run review. Independent required fields let each capability
be introduced only when it is used.

**Save each answer as it is entered.** This can persist one valid capability
before another is supplied, but cancellation would leave a partial setup and
separate saves could overwrite intervening changes. Collection followed by one
locked reread and replacement preserves one configuration transaction.

## Consequences

Initial interactive use can continue from configuration to the requested result.
Existing scripted business calls remain noninteractive and receive a concrete
configuration command when incomplete. Redirecting stdout preserves machine-readable
results. Only current command requirements are checked; there is no requirement to
configure optional capabilities.

Input handling and configuration transactions have separate lifetimes. The prompt
must finish before taking the write lock, and business startup must occur after
persistence, keeping human delay outside runtime deadlines and review locks.
Only the structured configuration-missing result releases the initial server
operation; ordinary configuration failures and later business errors do not reset
its deadline.
Concurrent writers can fail on the existing fail-fast configuration lock. Manual
editors remain outside that lock protocol; abnormal lock recovery retains its
existing operator checks.

Credential setup, service deployment, connectivity validation and live reviewer
reload are outside configuration setup. They are additive capabilities with
separate runtime owners; keeping setup independent of network and runtime state
allows them to be considered without changing saved field meanings. The requested
business operation still reports its own connection, authentication and runtime
errors after configuration is saved.
