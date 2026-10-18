# Daynight Acceptance Evidence

The installed-CLI acceptance suite exercises a packed distribution with real Git
and SQLite, controlled GitHub CLI responses and a controlled Copilot executable.
Real Copilot reasoning and GitHub publication require a separately designated
repository, reviewer identity and authorization.

## Commands and scope

```text
pnpm check
pnpm acceptance
node packages/daynight/scripts/validation-environment.ts
```

`pnpm check` runs type checking and ordinary tests. `pnpm acceptance` builds the
package, packs a tarball and installs it into a task-local consumer with the
normal pnpm installer. This separate command requires package-registry access
for dependency resolution. It creates no global installation and needs no live
GitHub or Copilot credentials.

The installed `@codetreker/daynight` package's `daynight` bin starts from temporary
home and working directories containing spaces and Unicode. The test drives its
public command and reads SQLite through an independent connection. Product
scheduling APIs are not replaced. Git transport is limited to the local fixture origin.

Twenty-eight scenarios cover four configuration-registration cases, four local
status-listing cases and the twenty review lifecycle cases. Registration drives the
installed command before review startup and verifies configuration-only operation, working-directory-relative
paths, the default root, and fixed repository paths after a root change. It checks
that registration creates no clone, database, runtime lock, agent invocation or
GitHub request.

The listing cases drive both `review list` and `review ls` before initialization,
while a Draft PR is observed, after a review completes, and after all tracked PRs
close. They check equivalent output, saved observation time, the permanent tracking
boundary and the distinction between uninitialized and empty tracked state. Live
alias comparisons normalize only the last-observed timestamp, which a concurrent
poll can advance between calls. Listing invocations use a restricted PATH without
Git, gh or Copilot, and the assertions check that they issue no external requests
or agent invocation. These cases preserve six agent invocations, five publications,
two normal shutdowns and two cleanups. The combined suite's recovery receipt uses
`automaticStaleLockRecoveries: 1`; the replaced manual-recovery counters remain
only in historical receipts.

The lifecycle cases cover the permanent startup cutoff, Draft/head suppression,
ready review, inline `COMMENT`, missing-marker reconciliation, a clean approval,
head/force-push changes, base-tip exclusion, base-branch changes, isolated PR
sessions, normal shutdown, another working directory, singleton refusal, an
abnormal stop with a retained lock, automatic dead-owner lock recovery, and
merged or unmerged closure cleanup with retained history. The automatic recovery
scenario crashes only after current tool handles drain; it does not establish
that arbitrary orphan agents or tools have stopped. Uncertain review and cleanup
recovery has separate module/runtime coverage.

The fixture records six agent invocations and five publications: one inline
comment review and four approving reviews. The missing-marker attempt publishes
once; the resumed same-session attempt confirms it without another publication.
Only the controlled Copilot child may issue the simulated review POST.

## Evidence and verdict

GitHub Actions runs the ordinary and installed suites on native Linux, macOS and
Windows. Each job uploads only two curated files:

- `validation-environment.json`: checked-out revision, dirty flag, OS,
  architecture, Node/ABI/Node-API, pnpm, Git, gh and loaded SQLite versions.
- `e2e-evidence.json`: installed-package lifecycle assertions and scenario
  receipts, with both live-service flags explicitly false.

The workflow's platform job and final `checks` gate are the validation verdict
for their checked-out revision. A scenario receipt describes its assertions; the
job also covers process and fixture cleanup. Full environment reports,
credentials, sessions and raw runtime logs are outside the artifact selection.

Local package `0.2.0` validation passed type checking, 539 ordinary tests with
eight APFS cases skipped on Linux, and build. The installed suite passed all 28
scenarios in 10.71 seconds on Linux x64. Its receipt records six agent invocations,
five publications (one `COMMENT`, four `APPROVE`), two normal shutdowns, two
worktree cleanups and one automatic stale-lock recovery. Both live-service flags
are false. No fixture directories or processes remained. This is local evidence;
native hosted status-listing receipts remain pending.

Local validation of the durable cleanup barrier across reopen and isolation of
only the affected PR passed `pnpm check`: type checking and 476 ordinary tests,
with eight APFS cases skipped on Linux. `pnpm build` and all 24 installed
acceptance scenarios also passed. This receipt covers the cleanup-barrier repair;
it predates status-listing coverage.

Earlier local validation of package version `0.1.2` passed type checking, 472
ordinary tests, build and the combined 24-scenario installed suite. Its installed
receipt records six agent invocations, five publications and one automatic
stale-lock recovery. Those earlier receipts predate the cleanup-barrier repair
and do not establish that repair's behavior.

| Evidence | Observed result |
|---|---|
| Package `0.2.0` local validation, 2026-10-18 | Linux x64 passed type checking, 539 ordinary tests with eight APFS skips, build and all 28 installed scenarios in 10.71 seconds |
| Cleanup-barrier repair local validation, 2026-10-18 | Linux x64 passed `pnpm check` with 476 tests and eight APFS skips, `pnpm build` and all 24 installed scenarios |
| Pre-repair combined local validation, 2026-10-18 | Linux x64 passed `pnpm check`, `pnpm build` and all 24 installed scenarios for package version `0.1.2`, from the integration working tree |
| Pre-integration stale-lock validation, 2026-10-18 | Linux x64 passed type checking, 421 ordinary tests with eight APFS cases skipped, build and the 20-scenario automatic-recovery installed suite; recorded in commit `38d46d6` before repository-registration and version-policy integration |
| Prior registration receipt, 2026-10-18 | Linux x64 passed all 24 registration and manual-recovery lifecycle scenarios in 12.41 seconds, from an uncommitted working tree |
| Original local installed receipt | Passed the 20-scenario manual-recovery suite on Linux x64 before registration coverage was added |
| Original local tools | Node 24.19.0, pnpm 10.34.5, Git 2.53.0, gh 2.88.1 |
| Original local native SQLite | better-sqlite3 13.0.3, SQLite 3.53.4, Node-API 10 |
| Original local OS | Linux x64, glibc 2.39 |
| Original hosted installed matrix | Passed the 20-scenario manual-recovery suite on Linux x64, macOS arm64 and Windows x64 before registration coverage was added |
| Real Copilot/GitHub | Awaiting designated repository, distinct author/reviewer identities and write authorization |

The pre-integration stale-lock coverage includes a killed compiled CLI, competing
lock contenders, invalid or ambiguous owners, and repeated unconfirmed
cleanup/reopen with an independent repository continuing. Its installed recovery
scenario establishes restart after a quiescent abrupt exit.

The prior 2026-10-18 registration receipt records `success: true`, six agent
invocations, five publications (one `COMMENT`, four `APPROVE`), two normal
shutdowns, two worktree cleanups, one singleton refusal, one abrupt stop, one
stale-lock refusal and one operator-confirmed restart. Both live-service flags
are false. The run left no fixture resources behind. This local result covers
the four registration cases and predates automatic dead-owner recovery and the
four listing cases.

The [runtime integration CI](https://github.com/codetreker/day-night/actions/runs/39040002167)
passed Linux, macOS and Windows before the installed-package suite was added.
It is component/runtime evidence, not an installed-package or live-model receipt.

## Historical hosted installed receipts

[Pre-repair native recovery CI](https://github.com/codetreker/day-night/actions/runs/39131014417)
passed Linux, macOS and Windows at head `3fee5e61`. It validates automatic owner
recovery and the guard at that revision, whose uncertain-cleanup policy froze
the repository. It predates the durable cleanup barrier across reopen and
isolation of only the affected PR, and does not establish the repair's result.

[Native installed-package CI](https://github.com/codetreker/day-night/actions/runs/39043517844) passed all three platforms and the final matrix gate on 2026-10-17.
The curated artifacts agree on clean checkout revision `9df51dbc9ffd16129069519ba7118009dc648b01`.
Each records six invocations, five publications, preserved restart/session state
and two worktree cleanups. These receipts cover retained-lock refusal followed
by operator-confirmed lock removal and restart. They predate both the four
registration cases and automatic dead-owner recovery, and establish neither
behavior's hosted result.

| Platform | OS release | Node | Git | gh |
|---|---|---|---|---|
| Linux x64 | `6.17.0-1022-azure` | `v24.21.0` | `git version 2.55.0` | `gh version 2.102.0` |
| macOS arm64 | `25.6.0` | `v24.21.0` | `git version 2.56.0` | `gh version 2.102.0` |
| Windows Server 2025 x64 | `10.0.26100` | `v24.21.0` | `git version 2.56.0.windows.2` | `gh version 2.102.0` |

All three used pnpm 10.34.5, Node-API 10, better-sqlite3 13.0.3 and SQLite 3.53.4.
The Linux receipt reports glibc 2.39. Both live-service flags remain false.

## Supported baselines

Development and validation use Node.js 24 and pnpm 10.34.5. The suite requires
Git 2.48 or newer because its relative-worktree fixture uses
`git worktree repair --relative-paths`. Git 2.43's failure on that fixture does
not establish a production runtime defect. The
[Git 2.48 release notes](https://github.com/git/git/blob/67ad42147a7acc2af6074753ebd03d904476118f/Documentation/RelNotes/2.48.0.adoc#L56-L58)
record relative worktree linkage support. Production minimum versions beyond the
named tested environments require their own runtime evidence.

The inspected better-sqlite3 13.0.3 Linux x64 prebuild requires `GLIBC_2.34` and
`GLIBCXX_3.4.29`. These symbol requirements constrain older distributions; they
are not a complete compatibility guarantee. The named receipt covers its actual
OS and architecture. Other distributions, architectures and musl require their
own native receipt. The [state decision](../../.agents/notes/implemented/architecture/2026-10-17-durable-review-state.md)
records the packaged binary choice.

## Native termination follow-up

The post-merge [runtime check](https://github.com/codetreker/day-night/actions/runs/39044760027)
observed `kill EPERM` during macOS's signal-zero probe after forced group
termination. Published [XNU signaling code](https://github.com/apple-oss-distributions/xnu/blob/ac9718fb1af618d5ce8678d0dc6e8a58f252216f/bsd/kern/kern_sig.c#L1703-L1719)
filters zombies before counting eligible group members, so `EPERM` alone cannot
establish that executing members remain. That source is release 12377.121.6;
the recorded runner used 12377.161.14. The log did not capture simultaneous
process status and does not independently prove a zombie-only group.

The supervisor inspects its existing exact-PGID status after this probe result.
Absent/all-zombie groups have no executing members; live groups rethrow the
original denial. Inspection failures remain errors. Deterministic classification
cases and a real POSIX denied-live-group case preserve these distinctions, while
the original native cooperative and forced termination tests remain unchanged.

The same post-merge run also reported an unsuccessful Windows `taskkill /T`
snapshot while fixture tools were exiting. The installed stale-lock scenario
uses a controlled abrupt CLI exit after all current direct tool handles drain.
A native child/stdin-close precondition verifies that the public Node resource
list exposes `ProcessWrap` while the child is active and removes it after close.
The main preload waits for that resource to disappear, records the actual CLI
PID, then exits synchronously with code 73 before another scheduling turn.
That fixture gate remains the abrupt-stop precondition. The installed suite now
asserts retained-lock diagnostics and automatic dead-owner recovery, while
ordinary singleton refusal uses a live CLI owner. Earlier receipts for refused
stale-lock restart and operator-confirmed recovery remain historical. Product
cancellation errors are still errors, and the separate native Windows
process-tree termination tests remain unchanged. See
[Node active resources](https://nodejs.org/api/process.html#processgetactiveresourcesinfo).

## Live acceptance scope

The prepared isolated fixture adds a discount calculation with a confirmed
100-fold cents-scale defect, then corrects it. Local baseline and corrected
tests pass; the candidate fails its two amount assertions. It calls no payment
provider or external service.

Live acceptance needs authorization to create a fixture branch and PR, toggle
Draft/ready, push the correction, publish inline `COMMENT` and `APPROVE` as a
non-author reviewer, and close the test PR and remove its branch. The daemon
must start before the new fixture PR so its permanent cutoff does not exclude it.
Session UUIDs, reviewed heads, stable review IDs, inline comment locations and
remote review verdicts form the receipts. Worktree cleanup and restart continuity
must also be observed. Test authors and reviewers must have the relevant access,
and Copilot must be entitled to run with the prepared authentication.

The controlled suite already forces missing-marker reconciliation. A live
missing-marker check must distinguish confirmed remote publication from local
completion and retain the same Copilot session. None of the controlled receipts
is presented as evidence that a real model followed that publication protocol.
