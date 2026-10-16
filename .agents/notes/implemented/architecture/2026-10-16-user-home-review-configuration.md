# Agent Note: User-Home Review Configuration

Status: implemented

## Problem

A persistent reviewer needs one predictable configuration and state location.
Resolving configuration or state relative to the launch directory can select a
different database, cutoff, or session history for the same user's repositories.

## Decision

The [requirements](../../../../docs/spec/daynight.md) and
[design](../../../../docs/design/daynight.md) specify
`daynight --deamon-review` as the review-mode entry point, preserving that exact
flag spelling. Configuration is YAML at `~/.daynight/config.yml`. The program
resolves the current OS user's home directory on Linux, macOS, and Windows.
Relative repository paths resolve against the configuration directory.

All runtime state resides under `~/.daynight/`: SQLite and its sidecar files,
retained Copilot sessions, the instance lock, logs, caches, temporary files, and
PR worktrees. Repository clones retain their configured paths. Configuration
errors report the affected file and stop startup. These are recorded design
decisions; application implementation is pending.

This location choice complements the
[foreground CLI decision](2026-10-16-foreground-review-cli.md) without changing
its single-process execution or agent-owned publication model.

## Alternatives

**Explicit JSON configuration and a configurable state directory.** The earlier
design proposal used `--config ./daynight.json` and a `stateDir` field. That
allows separate instances, but makes the configuration/state selection depend
on invocation details. The selected fixed user-home layout gives repeated
launches a single configuration, cutoff history, session store, and instance
lock. There is no deployed application data to migrate.

## Consequences

Launching from another working directory preserves the same review history and
session identities. YAML examples and path resolution must agree with the fixed
layout. Platform tests must cover home-directory resolution and relative clone
paths; tests inject a temporary home-resolution result rather than write into
an actual user profile. Runtime files deliberately use the specified home
location, while development probes remain in the task worktree's `.tmp/`.
