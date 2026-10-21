# Agent Note: CI Gate Simplification

Status: implemented

## Problem

The package-version policy is evaluated on a PR before its release inputs reach
main. Repeating that policy after merging adds a second version decision to
mainline application validation. A terminal CI job also reinterprets module
selection and job states that the workflow already exposes, despite publication
consuming the workflow result.

## Decision

The [checks workflow](../../../../.github/workflows/checks.yml) runs the
package-version step only for `pull_request` events on the Ubuntu CLI job. It
passes the PR event's base and head commits directly to the existing version
script. Main pushes retain every application suite. The local script keeps its
push comparison mode, including initial-push baseline validation.

Module detection still selects complete PR job families and selects every module
on main pushes. Routing and application jobs determine the workflow result
directly. The terminal `checks` aggregation job and its result-validation helper,
CLI path and dedicated tests are removed; routing tests remain in the lightweight
job. The main ruleset requires no named check context, and
[npm publication](../process/2026-10-20-npm-trusted-publishing.md) already consumes
a successful whole `checks.yml` main-push run at the exact source commit. These
consumers require no configuration or publication-workflow change.

This partially supersedes the
[CLI toolchain decision](../process/2026-10-16-typescript-cli-toolchain.md), which
originally checked versions on both PR and push events, and the
[module-scoped CI decision](../process/2026-10-21-module-scoped-pr-ci.md), which
originally added selection-aware result aggregation. Their release-input policy,
module routing, native validation and complete acceptance workloads remain.

## Alternatives

**Keep version enforcement on main pushes.** This repeats the version policy
already applied to the reviewed PR. Mainline validation still runs all application
suites without making the release-number decision again.

**Keep the terminal aggregation job.** Its selection-aware validation originally
provided one status that distinguished intentional skips from unexpected skips.
The workflow result already represents the jobs used by publication, and the
repository requires no named aggregate status. Maintaining another result
calculation adds a job and helper code for that duplicate responsibility.

## Consequences

Version failures remain visible in the PR's Linux CLI job and workflow result.
Main-push runs provide the same full application evidence required for publication
without repeating the PR version policy. Documentation-only PRs run routing tests
and skip application jobs. Job selection, coverage thresholds, real-service
acceptance and cleanup requirements are unchanged.

Workflow consumers use the workflow conclusion or individual application-job
results. There is no separately computed status that validates expected selected
and skipped job combinations.
