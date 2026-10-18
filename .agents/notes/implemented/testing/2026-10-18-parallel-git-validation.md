# Agent Note: Parallel Git Validation

Status: implemented

## Problem

The Git lifecycle tests dominated native Windows validation even though each
case used a separate repository and database. In three successful CI runs, the
single Git test file took 126.561 to 196.409 seconds. Other test workers finished
while its independent cases continued sequentially. Every case also repeated
eleven native Git commands to construct the same initial bare repository.
The [timing report](../../../../docs/research/windows-ci-performance.md) owns
the measurements and source revisions.

## Decision

Git scenarios are divided into separate test files for repository snapshots and
failure handling, ownership and cleanup, configuration and submodules,
administrative authority, and the two sparse-configuration scopes. Vitest's
isolated file workers schedule these suites in parallel. Cases within each file
remain sequential. The Windows ordinary-test step sets `VITEST_MAX_WORKERS=6`;
other platforms retain Vitest's default. In the first native split-suite run,
the default three Windows workers kept later Git files queued and ordinary
tests still took 110.67 seconds. Six workers allow more native command and I/O
waits to overlap while retaining the default `forks` pool and file isolation.

Each file explicitly owns a fixture factory and its lifecycle hooks. The factory
constructs one bare-origin seed with native Git, then copies it into a unique
directory for every case. Copies contain independent files, objects and refs;
they use no hardlinks or shared object alternates. SQLite databases, clones,
worktrees, command interceptors and observation state remain private to each
case. Only the seed survives case cleanup, and file cleanup removes it.

All existing Git scenarios and assertions remain exercised. The manager still
executes real clone, fetch, worktree, sparse-checkout and submodule operations.
Fixture commands retain their dynamic environment filtering, Unicode and space
paths, fixed commit identities and committed byte-preservation attributes.
The three-platform workflow and installed CLI acceptance retain their full
workload and existing time limits. The worker override applies only to ordinary
Windows tests; installed acceptance retains its independent execution.

## Alternatives

**Run cases concurrently inside the original file.** Environment stubs are
process-wide, and case cleanup closes databases and removes directories owned
by its fixture factory. Concurrent cases could alter another case's environment
or remove its active resources. File isolation preserves those ownership rules.

**Reuse prepared clones or worktrees.** Their administration pointers, refs,
filesystem identity and persisted registration are test subjects. Copying only
the initial bare origin removes repeated setup without bypassing those subjects.

**Keep the default Windows worker limit.** Vitest 5.0.5 reserves one available
CPU in run mode. The first split-suite run used three workers; its files consumed
299.181 seconds in total across a 110.67-second execution, with sparse-primary
starting about 83 seconds after the run began. A Windows-only numeric override
exposes more of this independent work to the scheduler. Its value is bounded
and retains process isolation.

**Optimize dependency caching or repeated builds first.** The latest baseline
spent five seconds installing dependencies and 201 seconds running ordinary
tests. These other costs do not explain the dominant Windows delay. They remain
independent optimizations if later measurements make them material.

## Consequences

The worker scheduler distributes native Git work across independent cases.
Additional test files and six Windows workers use more memory and keep more
private fixtures active than the default. Hosted timings determine whether
overlapping native commands outweighs CPU and disk contention. CI runner size
remains unchanged.

Fixture setup still uses native Git once per file, and every case still creates
its own real repository state. Future scenarios must retain per-case mutable
resources and per-file cleanup ownership. The optimization changes validation
structure and is exempt from the package version policy.
