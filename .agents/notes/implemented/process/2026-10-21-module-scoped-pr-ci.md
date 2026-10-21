# Agent Note: Module-Scoped Pull Request CI

Status: implemented

## Problem

Unrelated module validation makes a PR wait for native CLI, shell completion,
Go/PostgreSQL and browser/container suites even when its changed files affect
only one module. Documentation maintenance also pays the full application-test
cost. Reducing that work must preserve meaningful module validation and make a
failed selection step distinguishable from an intentional skip.

## Decision

The [checks workflow](../../../../.github/workflows/checks.yml) starts with a
lightweight, dependency-free Node.js routing job. PR selection compares the
explicit event head with the merge base of the event base and head. Full Git
history and `git diff --name-only -z --no-renames` preserve deleted paths,
cross-module moves and unusual filenames without a changed-file API limit.
Application jobs continue testing the checked-out PR merge result. The
[README routing table](../../../../README.md#ci-selection) owns the exact paths.

Each module keeps its complete job: the CLI selects all three native platforms
and shell completion; Go selects server validation; web selects web validation.
Multiple changed modules select their union. Shared workspace/dependency inputs
select all consumers. Known web dependency patches select web; unclassified
inputs select every module until their ownership is explicit. All CLI source
paths select CLI validation before documentation exclusions, preserving the
existing release-input policy and recursive runtime-skill packaging. Repository
docs and workflow guidance otherwise skip application tests.

The Go job retains real web builds and installed-CLI acceptance. The web job
retains production Go builds, browser and deployment acceptance. Module selection
changes job scheduling without separating or weakening these integration suites.
Every main push runs all jobs, preserving the successful exact-commit main run
consumed by [npm publication](2026-10-20-npm-trusted-publishing.md).

The workflow starts on every PR, including documentation changes. Its final
`checks` job runs with `always()`, requires successful routing, validates every
selection flag and accepts only success for selected jobs and skipped for
unselected jobs. Selection failure, absent outputs, unexpected skips, failed
checks and cancellations fail the aggregate. Routing and aggregate tests run in
the lightweight job without installing pnpm dependencies.

This refines the scheduling described by the
[CLI toolchain decision](2026-10-16-typescript-cli-toolchain.md),
[server foundation](../architecture/2026-10-19-server-runtime-foundation.md) and
[dashboard acceptance decision](../testing/2026-10-20-dashboard-production-acceptance.md).
Their module workloads and acceptance criteria continue to apply when selected.
GitHub documents [job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)
and [dependency handling](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds);
the explicit aggregate distinguishes deliberate omissions from failed execution.

## Alternatives

**Filter the entire workflow by changed paths.** This prevents the workflow from
producing its final check on excluded PRs. GitHub's
[path-filter documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)
explains that skipped workflows can leave required checks pending. Job-level
selection preserves a consistent aggregate for every PR.

**Allow every skipped dependency in the aggregate.** This cannot distinguish
an intended omission from a selected job skipped because routing or a dependency
failed. Validating the selection and expected result preserves that distinction.

**Run every module on every PR.** This was the existing scheduling behavior and
provided broad integration evidence before each merge. It spends the full
native/browser/database workload on unrelated source and documentation changes.
Whole-module PR checks and full main validation retain the existing test suites
while removing that repeated work.

## Consequences

Module-only PRs wait for their own job family; documentation-only PRs run only
routing tests and aggregation. Every selected suite retains its original
coverage, real-process behavior, time bounds and cleanup failures. No repository
protection changes or additional workflow permissions are required.

The path map is maintained alongside package and tooling ownership. Unknown
paths deliberately incur full validation, so a new package or dependency patch
cannot silently lose verification. Mainline full validation can discover a
cross-module regression after a module-only PR merges; broad pre-merge evidence
requires changing the routing policy or explicitly selecting the affected paths.
The existing integration inside module jobs reduces that gap without claiming
that each PR executes every consumer's acceptance suite.
