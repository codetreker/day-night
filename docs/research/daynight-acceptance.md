# Daynight Acceptance Evidence

Client acceptance exercises the toolkit through separate installed review
lifecycle, installed self-update and real-shell completion suites. The
[client requirements](../spec/daynight.md) own command composition, package
updates and shell completion; the [review requirements](../spec/daynight-review.md)
own review execution and retained data. The lifecycle suite uses real Git and SQLite,
controlled GitHub CLI responses and a controlled Copilot executable. Self-update
uses real npm with a controlled HTTP registry and task-local global prefixes.
Real Copilot reasoning and GitHub publication require a separately designated
repository, reviewer identity and authorization.

## Commands and scope

```text
pnpm check
pnpm acceptance
pnpm completion:acceptance
node packages/daynight/scripts/validation-environment.ts
```

`pnpm check` runs type checking and ordinary tests. `pnpm acceptance` builds the
package and runs both installed suites. The review lifecycle suite packs a
tarball and installs it into a task-local consumer with the normal pnpm installer.
The update suite installs packed fixture versions into isolated npm global
prefixes inside its temporary directory. Dependency resolution requires package-
registry access; package-update metadata and tarballs come from a controlled local
HTTP registry. Neither suite changes the operator's installed CLI or needs live
GitHub or Copilot credentials.

The installed `@codetreker/daynight` package's `daynight` bin starts from temporary
home and working directories containing spaces and Unicode. The test drives its
public command and reads SQLite through an independent connection. Product
scheduling APIs are not replaced. Git transport is limited to the local fixture origin.

The public client commands are root help/version, `update`, `completion` and the
`review` group. Lifecycle registration uses `review add-repo`, monitoring uses `review run`,
and local status uses `review list` or `review ls`. Current validation must cover
root/group/operation help without review dependencies, invalid former entry
forms, the stable `dist/main.js` bin, a clean distribution after module moves,
and updater package-directory resolution. An independent pre-refactor-format
YAML/SQLite fixture must establish retained-state reuse without generating its
baseline through the current store. Historical scenario receipts below describe
the source and workload observed on their dates; they do not establish these
command-composition and existing-data checks for current source.

The current review suite contains thirty-five scenarios: two client-composition
and existing-data cases, four configuration-registration cases, four local
status-listing cases and twenty-five review lifecycle cases. Registration drives the
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
ready review after pending/failed CI passes, new-head CI waiting, no-CI review,
inline `COMMENT`, missing-marker reconciliation, a clean approval,
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

## Shell completion evidence

`pnpm completion:acceptance` builds the client and runs the Python 3 PTY harness
on a POSIX host. It requires a real Bash 4.2 selected by `DAYNIGHT_TEST_BASH42`, a
modern Bash selected by `DAYNIGHT_TEST_BASH` (default `bash`), and zsh selected by
`DAYNIGHT_TEST_ZSH` (default `zsh`). `DAYNIGHT_TEST_ZSH_ROOT` supports an extracted
zsh toolchain. On Linux, `prepare-completion-shells.sh` verifies the pinned GNU
Bash 4.2 archive before building its executable locally, uses an existing zsh or
extracts downloaded Debian zsh packages under `.tmp/shell-completion/`, and
writes `environment.sh` for local sourcing. It does not install global packages.
The [README](../../README.md#cli-development) owns repeatable preparation,
invocations and optional receipt selection; the
[completion design](../design/daynight-completion.md) owns the required behavior.

The harness loads generated scripts in shells with isolated startup files and
drives actual Tab insertion through a terminal. Candidate-function output alone
cannot establish Readline quoting, directory suffixes or zsh insertion. Required
coverage includes nested commands and aliases, current-layer options, shell
arguments, already-consumed arguments, `--path` before and after remote, remote
colons, special-character directories, command/directory name collisions and a
cursor before the end of the line. Ordinary tests separately exercise shared
syntax, script generation and the compiled entry's dependency isolation.

The dedicated Ubuntu 24.04 `verify (shell completion)` job runs the real-shell
suite and uploads `.tmp/completion-evidence.json` as
`daynight-completion-acceptance`. The final `checks` gate requires this job along
with every native CLI platform, server and web job. A suite definition or job's
presence is not a pass receipt; historical installed-client receipts below do
not establish completion behavior.

Local validation on 2026-10-20 used working-tree source package `0.4.0` on Linux
x64 with Node `v24.19.0` and pnpm `10.34.5`. Type checking passed. The ordinary
suite passed 833 tests with ten existing platform skips across 30 files: 29 files
passed and one was skipped. Its recorded duration was 5.06 seconds. The completion
receipt reports `passed: true` for 138 PTY scenarios: 46 each on GNU Bash `4.2.0(2)-release`,
GNU Bash `5.2.21(1)-release` and zsh `5.9`. The scenarios check actual inserted
text and resulting argv, including quoted command names, special-character
paths, remote colons, cursor placement and consumed options. They also enforce
that Tab starts neither daynight nor Node. An uninitialized zsh exits 1, emits
only the `compinit` initialization diagnostic and leaves completion unregistered.

The Linux preparation helper passed both a fresh download/build/extraction run
under a project path containing spaces and a cached-toolchain run. The observed
build used GCC `13.3.0`; Bash 4.2 came from the checksum-verified unpatched GNU
release, and zsh was extracted locally from downloaded packages. These are local
toolchain and interactive-shell results. Hosted completion CI has not been run
for this working tree, and this receipt does not establish native macOS or
Windows shell results.

The installed acceptance suites for source package `0.4.0` passed the packaged
review lifecycle and real-npm self-update. A focused installed-package check also
passed completion help and script generation. These installed checks establish
packaging and generation; the 138-scenario PTY matrix establishes current
built-source interactive insertion behavior.

## Client composition and existing-data evidence

Local validation on 2026-10-20 used working-tree source package `0.3.0`, Linux
x64, Node `v24.19.0` and pnpm `10.34.5`. Type checking passed. The ordinary suite
passed 768 tests with ten skips across 26 files: 25 files passed and one was
skipped. Its recorded duration was 6.11 seconds. Build validation seeded obsolete
`dist/cli.js`, `dist/config.js`, `dist/update.js` and `dist/legacy-obsolete.js`;
the clean build removed all four while retaining `dist/main.js` and the new
client/review/update outputs.

The two installed suites passed in 15.61 seconds. Both curated receipts report
`success: true` and source package version `0.3.0`. Installed root, group and
operation help runs before review configuration or state exists. The review
suite seeds YAML plus version 1 schema and rows from independent fixture files,
not the current store implementation. Installed `review list` and `review ls`
read that existing database and preserve its configuration bytes, schema and
all rows. The fixture includes a permanent cutoff, desired/completed revisions,
session and worktree identities, completed/failed/retry/interrupted reviews and
a cleanup barrier, so listing must retain their distinct ownership.

The full controlled review workflow still records six agent invocations, five
publications (one `COMMENT`, four `APPROVE`), two clean shutdowns, two worktree
cleanups and one automatic stale-lock recovery. The separate real-npm suite
uses npm `12.0.2` and confirms pinned replacement `1.0.0` → `1.0.1` after `latest`
moves to `1.0.2`, preserved review bytes, no installation for current/ahead
versions, and exit 1 for metadata and tarball failures. Task-owned fixture
processes and temporary installations were cleaned after verification.

This is local Linux evidence from the integration working tree. It does not
establish current-source native macOS or Windows results, real model execution,
or GitHub publication. The historical native receipts below remain tied to
their original revisions. Existing-format fixture reuse here establishes the
installed read path; runtime persistence, recovery and repeated startup retain
their separate ordinary and full-lifecycle coverage.

## Coordinator cooldown boundaries

Cooldown scenarios use the production coordinator's injected clock and real
SQLite. The tests observe completed scans or persisted review state before
advancing time, require suppression immediately before the deadline, and require
admission at the deadline. Independent PR/host progress and attempt-budget
assertions remain explicit. A repository scan that fails after a new open PR was
listed must retain the complete prior snapshot until a successful retry commits.

The [cooldown validation decision](../../.agents/notes/implemented/bug-fix/2026-10-20-coordinator-cooldown-clock.md)
records the failed hosted assertion and controlled reproduction. It does not
claim a particular infrastructure delay; native CI validates the changed tests
without increasing polling windows, timeouts or acceptance thresholds.

## Controlled npm self-update acceptance

The separate `update.acceptance.ts` suite uses real npm global installation and
replacement in task-local prefixes. It stages packed `@codetreker/daynight`
versions `1.0.0`, `1.0.1` and `1.0.2` behind a local scoped HTTP registry; these
fixture versions do not represent public npm releases. The successful replacement
advances `1.0.0` to `1.0.1`; `1.0.2` is used for an installation-failure case.
Calls use the installed absolute CLI and exercise its default updater without
replacing product dependencies.

Fourteen scenarios cover the npm launcher before and after replacement, a prefix
with spaces and Unicode, same-installation replacement, configured scoped registry,
changed default prefix, a target pinned after `latest` moves, conflicting
caller-project `.npmrc`, help without state, preservation of invalid review-state
bytes, current/ahead no-install results, and
metadata/installation failures. They preserve an unrelated prefix, caller project
files and user configuration/state. The installed manifest, launcher and fresh
CLI version establish the replacement result. This evidence is separate from
the thirty-five review scenarios and establishes neither live npm
publication nor a running reviewer's restart.

The suite writes `.tmp/update-evidence.json` with the source package version,
Node/npm versions, platform and architecture, scenarios and replacement result.
An earlier focused Linux x64 run on 2026-10-20 passed all fourteen scenarios in
8.03 seconds using working-tree source package `0.2.4`, Node `v24.19.0` and npm
`12.0.2`; the client-composition receipt above records the later `0.3.0` combined
run. npm returned a singleton JSON array for the queried version. The receipt
records successful replacement `1.0.0` → `1.0.1` after `latest` moved to `1.0.2`,
no installation for current/ahead versions, one successful target-tarball request,
and status 1 for metadata and tarball HTTP 503 failures. The final installed
version remained `1.0.1`; user npm configuration and review-state bytes survived.

The fixture's isolated npm user configuration disables lifecycle scripts. This
run verifies real package installation, replacement and command execution; it
does not establish native-addon replacement while a reviewer is running. The
local result is separate from native macOS/Windows evidence and live npm
publication. Native results belong to the exact revision's CI jobs; the suite's
presence alone is not a pass receipt.

## Evidence and verdict

GitHub Actions runs the ordinary and installed suites on native Linux, macOS and
Windows. Each native CLI job uploads three curated files:

- `validation-environment.json`: checked-out revision, dirty flag, OS,
  architecture, Node/ABI/Node-API, pnpm, Git, gh and loaded SQLite versions.
- `e2e-evidence.json`: installed-package lifecycle assertions and scenario
  receipts, with both live-service flags explicitly false.
- `update-evidence.json`: controlled npm self-update scenarios, source package
  version and replacement result, distinct from review lifecycle and live-service
  evidence.

The dedicated Linux completion job uploads its shell receipt separately. The
workflow's required jobs and final `checks` gate are the validation verdict for
their checked-out revision. A scenario receipt describes its assertions; the
job also covers process and fixture cleanup. Full environment reports,
credentials, sessions and raw runtime logs are outside the artifact selection.

Local CI-admission validation of package `0.2.1` passed type checking, 662
ordinary tests with eight APFS cases skipped on Linux, build and all 33 installed
scenarios. The five added lifecycle cases cover pending and failed CI waiting,
passing CI admission, new-head CI waiting and direct review without CI. API tests
also cover jobless blocked workflows, latest attempts, immutable target and
complete suite pagination, errors and rate limits. Hosted results belong to the
exact revision's native CI jobs and remain separate from these local receipts.

Earlier local package `0.2.0` validation passed type checking, 552 ordinary tests with
eight APFS cases skipped on Linux, and build. The installed suite passed all 28
scenarios in 10.62 seconds on Linux x64. Its receipt records six agent invocations,
five publications (one `COMMENT`, four `APPROVE`), two normal shutdowns, two
worktree cleanups and one automatic stale-lock recovery. Both live-service flags
are false. No fixture directories or processes remained. This is local evidence;
those receipts predate CI-admission coverage.

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
| Shell completion local validation, 2026-10-20 | Working-tree source package `0.4.0` on Linux x64: type checking, 833 ordinary tests with ten existing platform skips in 5.06 seconds, both installed suites and focused packaged completion generation; 138 actual Tab scenarios, 46 each on GNU Bash `4.2.0(2)-release`, Bash `5.2.21(1)-release` and zsh `5.9`; clean missing-`compinit` refusal, plus fresh and cached local toolchain preparation; hosted result outstanding |
| Client composition local validation, 2026-10-20 | Working-tree source package `0.3.0` on Linux x64: type checking, clean build with obsolete-output rejection, 768 ordinary tests with ten skips in 6.11 seconds, and both installed suites in 15.61 seconds; 35 review scenarios plus 14 real-npm update scenarios, including independent existing-schema listing reuse |
| Self-update focused local validation, 2026-10-20 | Linux x64 passed all fourteen controlled real-npm scenarios from working-tree source package `0.2.4` in 8.03 seconds, using Node `v24.19.0` and npm `12.0.2`; separate from the review lifecycle baseline and native hosted results |
| Package `0.2.1` CI-admission local validation, 2026-10-18 | Linux x64 passed type checking, 662 ordinary tests with eight APFS skips, build and all 33 installed scenarios |
| Package `0.2.0` local validation, 2026-10-18 | Linux x64 passed type checking, 552 ordinary tests with eight APFS skips, build and all 28 installed scenarios in 10.62 seconds |
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
