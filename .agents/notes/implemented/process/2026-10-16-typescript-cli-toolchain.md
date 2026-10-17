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
codes. Physical directory identity and ancestry detect existing aliases and
state overlap. Missing destinations under one physical ancestor with equal
component counts use a temporary candidate-path probe: one spelling is created
inside an owned sandbox and the other is looked up by the filesystem. Created
directories are recorded and removed deepest-first without recursive deletion.
Creation, inspection, and cleanup failures remain visible. No platform casing,
JavaScript lowercase, or Unicode-normalization rule replaces actual lookup.
The [configuration design](../../../../docs/design/daynight.md) owns the schema
and path rules.

The CLI supports help, version, argument validation, and configuration loading.
Review mode acquires the instance lock, opens SQLite and runs the
[foreground coordinator](../architecture/2026-10-17-foreground-review-coordination.md).
Configuration failures report their filename and preserve the original cause.

GitHub Actions runs type checking, build, and tests on native Linux, macOS, and
Windows. macOS tests mount temporary case-sensitive and case-insensitive APFS
images and verify their actual lookup behavior before exercising configuration
validation. A final `checks` job requires the entire matrix to succeed. Actions are
pinned to the inspected commits:
[checkout](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1),
[setup-node](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1),
and [pnpm setup](https://github.com/pnpm/action-setup/tree/ea17c68df8912ef543352723c149a84f56e3d413).

## Alternatives

**Compile a separate test tree for the built-in Node test runner.** This avoids
a test framework dependency but adds test-output layout, cleanup and command
handling alongside the production build. Vitest provides source-test discovery
on each platform while subprocess tests still exercise emitted JavaScript.

**Make the incomplete review command wait indefinitely.** At the original
configuration-only stage, an idle invocation supplied no monitoring behavior or
failure signal. An explicit unavailable-coordinator error kept that stage from
implying a working reviewer. The integrated coordinator now owns the foreground
lifetime.

**Infer path case rules from the operating system or existing names.** macOS
supports both APFS variants, and a directory's name is looked up in its parent,
which can be on another volume. Empty destination ancestors provide no names
for a read-only probe. JavaScript lowercase comparison also misses Unicode
normalization aliases on APFS, while global normalization would conflate
distinct Linux filenames. Conditional candidate-path probing observes lookup
under the actual parent of the future clone without introducing native helpers
or platform commands.
Node's [filesystem guidance](https://nodejs.org/learn/manipulating-files/working-with-different-filesystems)
also recommends probing behavior rather than assuming it from the platform.

## Consequences

All implementation tasks share concrete build and validation commands. Tests
can inject home resolution and command boundaries without modifying an actual
user profile. Platform CI provides native process and filesystem evidence as
features are added; it does not establish live Copilot/GitHub behavior.
Validation can require write permission on an existing ancestor when ambiguous
missing destinations require a probe. Failure to create, inspect, or remove it
is an error; validation never accepts an uncertain case comparison silently.

The toolchain establishes the CLI/configuration foundation. The
[durable state module](../architecture/2026-10-17-durable-review-state.md)
adds SQLite persistence, and the
[Git manager](../architecture/2026-10-17-owned-review-worktrees.md) owns repository
and worktree operations. The
[Copilot adapter](../architecture/2026-10-17-copilot-session-execution.md) uses
`cross-spawn` for native and Windows command-shim execution with typed arguments
and stdin prompts. Continuous scheduling is connected through the foreground
coordinator; authorized live acceptance remains separate evidence. A task stays in progress through its PR review and closes only
after accepted integration.
