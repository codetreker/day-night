# Agent Note: TypeScript CLI Toolchain

Status: implemented

## Problem

The CLI needs reproducible type checking, an executable package, strict
configuration handling, and native-platform verification before review runtime
components can share its configuration and command boundary.

## Decision

The repository uses a pnpm workspace with application code in
`packages/daynight/`, Node.js 24 LTS, pinned dependencies, TypeScript ESM with
NodeNext module resolution, and emitted JavaScript. The package bin points to
the shebang-bearing `dist/main.js`. Vitest executes source tests and compiled CLI
probes; the test command builds before running them. The pnpm dependency store
is local to `.tmp/pnpm-store`.

YAML parsing is followed by explicit field/type/path validation. Only omitted
numeric settings use documented defaults; invalid supplied values fail. Existing
path components must be directories, while missing clone directories remain
valid. Filesystem errors retain their causes across platform-specific error
codes. The [configuration design](../../../../docs/design/daynight.md)
owns the schema and path rules.

The CLI supports help, version, argument validation, and configuration loading.
Until the coordinator is integrated, review mode fails explicitly after
configuration validation and creates no review state. This prevents a successful
or indefinitely idle invocation from implying that monitoring is operational.

GitHub Actions runs type checking, build, and tests on native Linux, macOS, and
Windows. A final `checks` job requires the entire matrix to succeed. Actions are
pinned to the inspected commits:
[checkout](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1),
[setup-node](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1),
and [pnpm setup](https://github.com/pnpm/action-setup/tree/ea17c68df8912ef543352723c149a84f56e3d413).

## Alternatives

**Compile a separate test tree for the built-in Node test runner.** This avoids
a test framework dependency but adds test-output layout, cleanup and command
handling alongside the production build. Vitest provides source-test discovery
on each platform while subprocess tests still exercise emitted JavaScript.

**Make the incomplete review command wait indefinitely.** This resembles the
future foreground lifecycle but supplies no monitoring behavior or failure
signal. An explicit unavailable-coordinator error preserves the entry contract
without claiming that the review runtime exists.

## Consequences

All implementation tasks share concrete build and validation commands. Tests
can inject home resolution and command boundaries without modifying an actual
user profile. Platform CI provides native process and filesystem evidence as
features are added; it does not establish live Copilot/GitHub behavior.

The current delivery is the CLI/configuration foundation. SQLite, repository
management, Copilot execution, continuous scheduling and authorized live
acceptance remain separate tasks. A task stays in progress through its PR review
and closes only after accepted integration.
