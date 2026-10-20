# Daynight Acceptance Evidence

Client acceptance exercises the toolkit through separate installed review
lifecycle, installed self-update, installed project/task and real-shell completion
suites. Project/task real-service integration and production-budget validation
pass locally and in hosted validation.
[PR #55](https://github.com/codetreker/daynight/pull/55) owns review and integration
status; the [project/task task record](../design/daynight-project-task-tasks.md#pt-t5)
owns functional completion and its evidence. The
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
package and runs three installed suites. The review lifecycle suite packs a
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
`review`, `project` and `task` groups. Lifecycle registration uses `review add-repo`, monitoring uses `review run`,
and local status uses `review list` or `review ls`. Current validation must cover
root/group/operation help without review dependencies, invalid former entry
forms, the stable `dist/main.js` bin, a clean distribution after module moves,
and updater package-directory resolution. An independent pre-refactor-format
YAML/SQLite fixture must establish retained-state reuse without generating its
baseline through the current store. Historical scenario receipts below describe
the source and workload observed on their dates; they do not establish these
command-composition and existing-data checks for current source.

The current review suite contains forty-six scenarios: three client-composition
and existing-data cases, including packaged completion generation, four configuration-registration cases, four local
status-listing cases, twenty-five review lifecycle cases and ten bundled-skill
cases. Registration drives the
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
or agent invocation. These cases preserve six review-agent invocations, five publications,
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

The ten bundled-skill cases compare all installed bundle bytes with source,
check native discovery and the explicit current-snapshot prompt on create and
resume, clear inherited additional discovery roots, pass the plugin directory as
one argument through a home path containing commas, spaces and Unicode, and
preserve the prepared checkout. Replacing the isolated installed asset while the daemon runs must
leave that daemon's snapshot unchanged. An orderly restart must capture the new
digest and bytes while retaining the same PR session UUID. Six discovery
children are recorded separately from the six review-agent invocations and five
publications. These are controlled loading and lifecycle assertions; actual
model activation has a separate native Copilot probe.

## Project/task installed and real-service acceptance

Status: local and hosted validation passed.
[PR #55](https://github.com/codetreker/daynight/pull/55) owns review and integration
status. This section separates the implemented paths from source-bound observations. The
[acceptance decision](../../.agents/notes/implemented/testing/2026-10-20-installed-project-task-acceptance.md)
owns the alternatives and lifecycle costs.

The project/task native installed suite joins the existing review and updater suites in
`pnpm acceptance`. The
[`installed-cli.ts`](../../packages/daynight/test/fixtures/installed-cli.ts) fixture
packs the source CLI, installs the tarball
in an isolated consumer and drives that installation's public command with real
Git and controlled HTTP. Linux, macOS and Windows must establish repository
selection, normalization, binding/ignore persistence, locks and atomic replacement,
complete JSON, refused writes and cleanup. The repository-root
[`project-task.acceptance.ts`](../../packages/daynight/test/cli/project-task.acceptance.ts)
writes `.tmp/project-task-evidence.json` to identify source, tarball and installation,
scenario outcomes and owned resources. Existing review and updater assertions
remain independent and required.

Real Go/PostgreSQL validation uses the existing server command fixture and runs
through `bash packages/daynight-server/scripts/check.sh` with an isolated
`DAYNIGHT_TEST_DATABASE_URL`. The Node orchestrator builds and installs the CLI
once, shares that installation with Go command scenarios and reuses it for budget
probes. The Go scenarios use the fresh race binary, PostgreSQL 18.6, actual
restart and observed database waiters; they verify project/task workflow,
dependency refusal, full reads, persistence and competing expected versions.
Their CLI requirement identifiers use the `PT.V*` namespace, distinct from the
original service requirements. The scenario is
`installed_cli_project_task_workflow`; the existing server receipt also records
validated `installedCli` identity, CLI started/reaped counts, workspace removal,
refusal request IDs and concurrent HTTP status/request IDs.

After the unchanged go-cov/race/critical and strict raw-profile gate, public CLI
probes run outside Go's default ten-minute timer. The six invocations all use installed
`project list --json` with production defaults: a unique cursor advancing every
250 ms until the five-minute total limit, a started response stalled until the
30-second request limit, and paired decoded-byte boundaries. Valid gzip JSON
uses whitespace padding so exact 128 MiB single-response and 256 MiB cumulative
bodies succeed with one and three small unique project resources respectively;
every continuation page remains protocol-valid. Each boundary plus one byte must
fail with empty stdout. Probes also require no further pages after rejection,
attributable errors and closed/reaped resources. Cumulative byte pages are 96, 96
and 64 MiB, with the rejected case adding one byte only to the final page. Both
deadline cases run concurrently while the four byte cases run sequentially.
They do not introduce a product test switch or reduce the production budgets.

The repository-root `.tmp/project-task-service-evidence.json` combines the shared
installation identity, Go phase and raw-profile result, bounded probe counts and
wire/decoded bytes, failures and cleanup. The server's existing acceptance receipt
and raw coverage profile remain distinct. Native and service paths prove
different requirements; neither controlled HTTP nor a suite's presence proves
successful hosted validation.

### Observed local PT-T5 evidence

The local source was `c19b064b094aae6634ca6d62e943a73d22008262` with `dirty=true`,
package `0.6.0` and Node `v24.19.0` on Linux. This identifies an implementation
worktree, not the future delivery commit's clean source. The shared installed
artifact recorded tarball SHA-256
`9b2101ede96604a743d6eba5cce4ffc3b6b2b372c4409ffd5a07ad195c2086a0`
and entry SHA-256
`f97d234eb1bdcb56ad2dc1fe86adde5dc88da1bbf5eea93cc22c39d7aa71e552`.

| Validation | Observed result |
|---|---|
| Type checking, build and ordinary tests | Passed; 1,510 tests passed and ten platform-specific tests skipped on Linux |
| Installed suites | Review, updater and project/task all passed |
| Final project/task native receipt | Ten scenario families, 69 HTTP requests; installation removed, children exited, servers closed, zero cleanup errors |
| Go build, vet, race, fixed go-cov and strict raw profile | Passed; 309 tests, 109 top-level, `1153/1155` covered statements |
| Actual service workflow | Go `1.27.2` and PostgreSQL `18.6`; 8,818 ms; workflow, restart, full reads and competing versions passed |
| Workflow cleanup | Two service processes and 38 CLI processes started/reaped; workspace and one schema removed, owned sessions absent |
| Concurrent PATCH | One actual HTTP `200`, one `409`; distinct request IDs retained |

The six installed public-command budget outcomes were:

| Probe | Decoded bytes / request count | Exit / stdout | Elapsed |
|---|---|---|---|
| Single response at limit | `134217728` bytes | `0`, 202 bytes | 952 ms |
| Single response plus one byte | `134217729` bytes | `1`, empty | 813 ms |
| Cumulative responses at limit | `268435456` bytes across `100663296 + 100663296 + 67108864` | `0`, 602 bytes | 1,543 ms |
| Cumulative responses plus one byte | `268435457` bytes | `1`, empty | 1,540 ms |
| Request deadline after headers | One request | `1`, empty | 30,104 ms |
| Command deadline with progress | 1,187 requests, 1,186 completed pages | `1`, empty | 300,103 ms |

Every probe records `passed=true`, `childReaped=true`, `socketsClosed=true`,
`serverClosed=true` and `fixtureRemoved=true`. The final composite records
`passed=true`, `installedFixtureRemoved=true` and `failures=[]`. Separate
cancellation controls cover an already-aborted setup and an active pnpm process
with a grandchild, preserving the original cancellation reason and removing the
installation. Fixture Git commands disable external fsmonitor per command.

After the Go gate, an independent SQL check found zero owned schemas and
sessions. Budget directories and the shared installation were absent; the owned
PostgreSQL container and anonymous volume were removed. These observations remain
tied to the dirty local source; the hosted observations below identify their own
clean build revision. PR #55 owns review and integration status.

### Observed hosted PT-T5 evidence

[Run 39428165296](https://github.com/codetreker/daynight/actions/runs/39428165296)
passed all seven required checks for PR head
`e9a634aca23710ffe46723fcdb2cf8e7a75d56bf`. Its receipts identify the actual clean
merge build revision `2e7b8da99cf4b5de6da9c8083446f84fd19f1daf`, with
`dirty=false`, package `0.6.0` and Node `v24.22.0` on every native CLI platform.
All installed entry hashes match
`f97d234eb1bdcb56ad2dc1fe86adde5dc88da1bbf5eea93cc22c39d7aa71e552`.
The local dirty receipt above retains its own source identity.

| Native platform | Project/task cases | Observed cleanup |
|---|---|---|
| Linux | Ten scenario families, 69 HTTP requests | Installation removed, children exited, servers closed, zero errors |
| macOS | Ten scenario families, 69 HTTP requests | Installation removed, children exited, servers closed, zero errors |
| Windows | Eight scenario families, 67 HTTP requests | Installation removed, children exited, servers closed, zero errors |

Windows excludes the POSIX EACCES and actual POSIX SIGINT cases; those results
are not claimed on Windows. Its eight common families still establish Git
root/subdirectory discovery, worktrees and submodules, cache selection, locks,
atomic files and refusal paths. Review, updater, completion, web and the Go
workload retain their required checks.

The hosted Go receipt reports Go `1.27.2`, PostgreSQL `18.6` and binary SHA-256
`837f9dd3a990eb226db287127dc04c3223e5bd8fef5cc15fcf77d2c84dceef72`.
The downloaded raw profile independently passes the strict check at `1153/1155`.
The CLI workflow passed in 10,348 ms, with two service and 38 CLI processes
started/reaped, workspace and schema removed, owned sessions absent, and actual
concurrent PATCH statuses `200` and `409` with request IDs.

| Hosted default-budget probe | Exit / stdout | Elapsed / requests |
|---|---|---|
| Exact 128 MiB single response | `0`, 202 bytes | 1,207 ms / one |
| Single response plus one byte | `1`, empty | 849 ms / one |
| Exact 256 MiB cumulative response | `0`, 602 bytes | 1,734 ms / three |
| Cumulative response plus one byte | `1`, empty | 1,712 ms / three |
| Request deadline after headers | `1`, empty | 30,148 ms / one |
| Command deadline with valid progress | `1`, empty | 300,136 ms / 1,194 |

The byte counts and gzip page construction match the local cases. Every hosted
probe reports passed, child reaped, sockets/server closed and fixture removed;
the shared installation was removed and the composite failure array is empty.
These observations establish the tested source and workload. PR #55 owns the
current review and integration state; this receipt does not assert that the PR
has merged or extend a pass to a later source revision.

## Bundled review skill acceptance

Local installed validation on 2026-10-20 used working-tree source package
`0.4.1`, Linux x64, official Node `v24.22.0`, pnpm `10.34.5` and npm `11.19.1`.
Type checking passed. The ordinary suite passed 1,057 tests with ten skips across
37 files: 36 files passed and one was skipped, in 8.01 seconds. Its clean build
included the complete skill-resource copy. Real copy-script regression tests
verify fresh complete copying from an unrelated working directory, repeated
exclusive-copy rejection without overwriting, and visible missing-source
failure. Both installed suites passed in 14.81 seconds. Their curated lifecycle and update
receipts report `success: true`; the lifecycle has forty-six scenarios and the
real-npm suite has seventeen.

The lifecycle compares the complete source bundle with the installed tarball's
files, then records six native discovery children separately from six review
children and five publications: one `COMMENT` and four `APPROVE`. Discovery and
review share the same worktree, plugin snapshot and cleared ambient custom-skill
environment. The isolated home contains commas, spaces and Unicode, so this
also exercises single-argument plugin-path transport through installed shims.
All review prompts identify their current snapshot. Replacing the isolated
installed skill leaves the running daemon's original bytes intact; orderly
restart captures a different digest and body while resuming the same UUID.
The reviewed checkout stays clean. Existing shutdown, cleanup, cutoff, retry,
publication and state-reuse assertions remain in place, including two clean
shutdowns and two cleaned worktrees.

The npm suite replaces fixture `1.0.0` with `1.0.1` and verifies distinct bundled
skill bytes in the actual global installation. Controlled metadata and tarball
503 failures remain visible as exit 1, preserving the already installed skill
and invalid review configuration/database fixture bytes. Those failures are
deliberate acceptance inputs. Task-owned installations and processes were
cleaned after validation.

These local receipts use controlled Copilot/GitHub responses and have both live
service flags set to false. They establish installed resources and orchestration,
including resume input, rather than actual model activation or GitHub effects.
Native macOS and Windows results must come from the checks for the delivered
revision; older receipts below remain tied to their own sources.

## Native skill activation

A local loading probe on 2026-10-20 used Copilot CLI `1.0.100`, the actual
compiled `0.3.2` skill, production `prepareReviewSkill`, and the exact adapter
activation paragraph. Its isolated cache path contains a comma, spaces and
Unicode. The deterministic plugin wrapper is discovered at its exact prepared
directory with `source: "plugin"`.

The integrated `0.4.1` package retains the same skill bytes, with SHA-256
`d8f27fe7fb155aba37b80e25f5da5e0d6ecd80cc7b54ecd39e0efab90b8f4471`.
This native result remains the observed `0.3.2` loading probe; the `0.4.1`
installed and ordinary results above cover the integrated package.

Both initial creation and changed-bundle resume completed the native `skill`
tool successfully with `source: "plugin"`, retaining one full UUID. The first
answer correctly identified the skill's Critical/Major publication scope and
its final section. For resume, a verification value existed only in the updated
isolated skill body and was absent from both prompts; the resumed answer returned
that new value. The original compiled resource and earlier snapshot retained
their bytes, while the updated snapshot used a different digest. This establishes
actual current-body loading through the selected transport, beyond directory
listing or controlled prompt inspection.

The probe supplied no PR target and performed no review or publication. It
restricted available tools to `skill` and `view`, denied shell/write/URL tools,
disabled built-in MCPs and custom instructions, and used bounded model turns.
For observation it passed the loading request with `-p` and selected JSON output;
the production stdin and text-completion protocol retain their separate
controlled process and installed coverage. Raw sessions, homes, caches and
checkouts were removed after the probe. The sanitized receipt records zero
remaining probe processes and zero credential occurrences in isolated state.

Earlier Copilot CLI `1.0.98` probes established the transport choice: plain,
backslash-escaped, quoted, JSON-array and percent-encoded comma paths supplied
through `COPILOT_SKILLS_DIRS` discovered no skill. A single `--plugin-dir` argument
discovered it with a comma path and the modern minimal manifest. The wrapper
follows GitHub's [pinned plugin reference](https://github.com/github/docs/blob/2d0a7bedfba3fec537f96da6e4188165ca25c252/content/copilot/reference/copilot-cli-reference/cli-plugin-reference.md).
These observed versions are evidence, not a declared minimum-version guarantee.
Production does not parse Copilot transcript events. Real PR reasoning and
GitHub publication remain a separate live-service acceptance.

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
drives actual Tab insertion through a terminal. Extracted zsh starts with a
private `ZDOTDIR/.zshenv` under `zsh -d -i`; the startup file sets the package's
exact native-module and completion-function paths before ZLE initializes, then
disables later `RCS` and `GLOBAL_RCS` startup files. It does not append host
`fpath` entries. An explicit `compaudit` must pass before `compinit -D`; audit
failure exits without an interactive trust prompt. Candidate-function output
alone cannot establish Readline quoting, directory suffixes or zsh insertion. Required
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

The [hosted completion job](https://github.com/codetreker/daynight/actions/runs/39391433132/job/118523637325)
at head `b9bb4e15626f179f73f51aa8438d36fefc2526f4` passed all 46 scenarios on each
Bash version, then timed out before zsh became ready. ZLE attempted to load its
module from the unavailable system package path, and `compinit` waited for an
answer about inherited insecure function directories. The harness configured
relocation only after interactive startup and retained host search paths. This
job records a fixture bootstrap failure before zsh Tab scenarios; it does not
establish zsh insertion behavior at that revision. The startup mechanism above
places package-specific paths before ZLE and retains the completion security
audit.

Local validation on 2026-10-20 used working-tree source package `0.4.0` on Linux
x64 with Node `v24.19.0` and pnpm `10.34.5`. Type checking passed. The ordinary
suite passed 965 tests with ten existing platform skips across 35 files: 34 files
passed and one was skipped. Its recorded duration was 6.34 seconds. The completion
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
toolchain and interactive-shell results. Hosted completion results belong to the
CI job and artifact for their exact source revision; a local receipt does not
substitute for that result or establish native macOS or Windows shell behavior.

The two installed acceptance suites for source package `0.4.0` passed in 14.45
seconds, covering the packaged review lifecycle, real-npm self-update, completion
help and script generation. These installed checks establish packaging and
generation; the 138-scenario PTY matrix records built-source interactive insertion
behavior for that local run.

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

Seventeen scenarios cover the npm launcher before and after replacement, a prefix
with spaces and Unicode, same-installation replacement, configured scoped registry,
changed default prefix, a target pinned after `latest` moves, conflicting
caller-project `.npmrc`, help without state, preservation of invalid review-state
bytes, current/ahead no-install results, and
metadata/installation failures. Three bundled-resource cases require the packaged
skill before replacement, the replacement version's exact skill bytes, and
unchanged installed skill bytes after the controlled failed update. They
preserve an unrelated prefix, caller project
files and user configuration/state. The installed manifest, launcher and fresh
CLI version establish the replacement result. This evidence is separate from
the forty-six review scenarios and establishes neither live npm
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
Windows. Each native CLI job uploads four curated files; the project/task receipt
does not replace the existing ones:

- `validation-environment.json`: checked-out revision, dirty flag, OS,
  architecture, Node/ABI/Node-API, pnpm, Git, gh and loaded SQLite versions.
- `e2e-evidence.json`: installed-package lifecycle assertions and scenario
  receipts, with both live-service flags explicitly false.
- `update-evidence.json`: controlled npm self-update scenarios, source package
  version and replacement result, distinct from review lifecycle and live-service
  evidence.
- `project-task-evidence.json`: the new installed project/task suite's source,
  tarball, installation, controlled HTTP/Git scenarios and cleanup. Its integration
  and current result are owned by PT-T5.

A separate `validation-probes.json` diagnostic artifact preserves command
resolution, launcher, PID, timing, bounded output and failures even when complete
environment collection fails. The gh probe also records selected-file bytes,
SHA-256 and preparation duration. File preparation and native execution share
one 10-second budget, and every native version must succeed before the complete
environment receipt is written. The
[cold-start decision](../../.agents/notes/implemented/bug-fix/2026-10-20-gh-cold-start-preparation.md)
owns the measurements and deadline semantics.

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
| Bundled review skill local validation, 2026-10-20 | Working-tree source package `0.4.1` on Linux x64 with official Node `v24.22.0` and npm `11.19.1`: type checking, clean build and 1,057 ordinary tests with ten skips in 8.01 seconds; both installed suites passed in 14.81 seconds, with 46 review scenarios including packaged completion generation, 17 real-npm update scenarios, six discovery children separate from six review children, running-daemon snapshot retention and changed-bundle same-UUID resume |
| Shell completion local validation, 2026-10-20 | Working-tree source package `0.4.0` on Linux x64: type checking, 965 ordinary tests with ten existing platform skips in 6.34 seconds, both installed suites including packaged completion generation in 14.45 seconds; 138 actual Tab scenarios, 46 each on GNU Bash `4.2.0(2)-release`, Bash `5.2.21(1)-release` and zsh `5.9`; clean missing-`compinit` refusal, plus fresh and cached local toolchain preparation; hosted results belong to the exact revision's completion job and artifact |
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

## Native APFS fixture ownership

The [macOS job from run 39412445956](https://github.com/codetreker/day-night/actions/runs/39412445956/job/118593266497)
reported 1,292 passing test cases and then failed APFS fixture finalization. An
ordinary detach by mountpoint first reported `Resource busy`. The subsequent
`lsof` command returned after 35 ms saying that the path was not a filesystem;
`diskutil` returned after 39 ms without finding a disk. After the one-second
pause, another detach by that same mountpoint failed with `No such file or
directory`. These observations show that the mountpoint was no longer a usable
attachment identity. They do not identify a holder, explain what changed the
mount, or establish that the complete backing image was detached.

Fixture finalization retains the attached image's device identity and verifies
the exact fixture image's attachment state before removing its directory. The
[device-ownership decision](../../.agents/notes/implemented/bug-fix/2026-10-20-apfs-device-ownership.md)
owns that mechanism. The eight native APFS assertions, ordinary detach policy,
30-second finalization budget, three-attempt limit, 40-second hook and 600-second
platform gate remain in force. The failed job remains failure evidence; a native
pass for the repaired fixture requires a successful job at its tested revision.

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
