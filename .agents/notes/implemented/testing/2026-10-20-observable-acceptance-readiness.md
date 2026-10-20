# Agent Note: Observable Acceptance Readiness

Status: implemented

## Problem

Acceptance drivers can act before the component being tested reaches the state
that an assertion assumes. An HTTP handler can be entered before PostgreSQL
executes its query, and a shell command can print a completion marker before the
next interactive editor exists. Those signals can produce network-write errors
or dropped input while leaving the actual cancellation or completion behavior
unobserved.

## Decision

Database cancellation and shell interaction tests synchronize on observable
execution readiness. Production code, public protocols, existing timeout bounds
and acceptance assertions remain unchanged.

The server runtime tests run a uniquely marked sleep query. An independent pgx
connection matches the exact SQL, current database and a different backend PID
in `pg_stat_activity`, requiring `active`, `Timeout` and `PgSleep` before the
client is canceled or forced draining begins. Polling and observer closure are
bounded. Buffered result channels preserve assertion values; independent closed
completion channels let failure cleanup cancel requests, stop the runtime and
join both goroutines even after results were consumed. Strict context errors,
the 30 ms drain deadline, the one-second shutdown bound, HTTP timeout and pool
health checks retain their meaning. The
[server design](../../../../docs/design/daynight-server.md) owns those guarantees.

The PTY driver first waits for a new primary-prompt generation and then requests
a dedicated Readline/ZLE widget acknowledgement for that same generation, an
empty buffer and cursor zero. Setup, clearing and command execution all return
through this handshake before another completion scenario is typed. The first
prompt of each real shell is blocked by an inherited anonymous pipe. A queued
probe receives no editor acknowledgement during the former 30 ms quiet window;
after releasing the gate, the real editor must acknowledge it. This proves the
transition directly without adding sleeps or increasing deadlines. All candidate,
argv, cursor, startup and no-CLI-on-Tab assertions remain intact. The
[completion design](../../../../docs/design/daynight-completion.md) owns the
interactive validation mechanism.

## Alternatives

**Treat handler entry or an in-command marker as readiness.** Those events occur
before the database execution or next editor phase. They do not establish the
precondition for the subsequent cancellation or input assertion.

**Wait for quiet output or add a fixed delay.** A blocked prompt transition can
be silent indefinitely, and scheduler delay changes the relationship between
elapsed time and readiness. The pipe-gated counterexample retains a quiet window
while proving that the editor is still unavailable.

**Accept more cancellation errors or retry unchanged failures.** This would let
the database test pass without observing cancellation of running work and could
conceal the original phase race. The observation barriers preserve the existing
strict error and cleanup checks.

## Consequences

Tests require one additional observer connection and two shell readiness phases.
SQL markers and prompt generations isolate unrelated work and stale output.
The observer does not share the running query's connection or transaction;
cleanup remains possible after a failed readiness assertion.

The focused race probe passed both database cases across 20 iterations each,
and the complete server gate passed build, vet, race, critical coverage checks
and the raw strict comparison at 1153/1155 statements. The three real shells
passed their 46 existing scenarios each, all three gated readiness proofs and
the zsh initialization refusal. These local receipts describe their tested
sources; required hosted checks and review still govern integration.

No runtime behavior, database schema, command grammar or completion candidate
changes are part of this testing decision. No package-version increase is
required for test and documentation changes alone.
