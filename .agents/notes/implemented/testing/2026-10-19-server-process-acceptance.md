# Agent Note: Built-process Task Service Acceptance

Status: implemented

## Problem

In-process tests cannot establish that the built command assembles the intended
routes, owns its OS process, retains state across restart or stops database work
when signalled. Coverage alone also cannot prove competing HTTP mutations and
resource cleanup. A delivery needs evidence tied to its actual tested source.

## Decision

Test-only command-package files build a fresh race-enabled executable for each
test invocation and drive it over loopback HTTP against isolated PostgreSQL
schemas. They parse existing JSON readiness logs instead of adding a health
endpoint, test-only production API or alternate runtime. Package tests continue
to own store/service/server coverage.

Twelve named scenarios exercise persistence, refusal semantics, filtered pages,
three deterministic write races, partial-write rollback, request cancellation,
graceful/forced SIGTERM, migration failures and simultaneous process startup.
Exact child application names identify PostgreSQL waiters. A nontransactional
sequence verifies that changed metadata and the first dependency existed before
an injected write failure. This prevents a pre-write error from passing as
evidence of rollback.

Only owned children are stopped or killed, then waited for. Row locks are
released before cleanup waits; child sessions must disappear before isolated
schemas are dropped. Build directories are removed after execution. Cleanup is
part of each scenario's pass/fail result, not an assumed final action.

The incremental JSON receipt records Git/GitHub revision, dirty state, compiler
and database versions, tested binary hash, named results and cleanup counts.
CI requires a clean checkout matching its supplied GitHub SHA. The Go job
uploads that receipt and the exact raw profile after validation, including on
failure. The [acceptance report](../../../../docs/research/daynight-server-acceptance.md)
owns requirement mapping, observed results and interpretation.

## Alternatives

**Call the command's run function for all acceptance.** Those tests exercise
composition but cannot prove an executable's actual signal, exit, listener reuse
and restart behavior. Existing in-process tests remain useful, while the binary
scenarios provide separate caller-visible evidence.

**Reuse an already-built executable.** A stale binary could pass while the
current checkout is wrong. Building once per invocation and recording its hash
and source identity makes the artifact attributable.

**Use HTTP 500 alone as rollback proof.** A failure before the first mutation
would satisfy that assertion. A database-side sequence after verified partial
mutation supplies an observable, non-rolled-back barrier.

**Replace package tests with end-to-end coverage.** The selected tool does not
credit cross-package calls to their owning packages. Real package tests retain
coverage and precise interleaving proofs; binary tests supplement them.

## Consequences

The complete validation command now proves both the module's strict `>90%`
statement gate and actual process behavior. Controlled unavailable-database
validation still fails; positive and negative receipts are retained separately
so a negative control cannot masquerade as the successful acceptance artifact.

The suite targets the Ubuntu Go CI job for process signals, while all existing
native CLI jobs remain required. It creates no production helpers, service
interfaces or coverage exclusions. Minor test-fixture strengthening is tracked
in the [task document](../../../../docs/design/daynight-server-tasks.md) without
expanding the delivered task-management contract.
