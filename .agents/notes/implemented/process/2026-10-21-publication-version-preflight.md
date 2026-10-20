# Agent Note: Publication Version Preflight

Status: implemented

## Problem

A manual publication of an unchanged package version performs the complete
validation workload before discovering an existing npm version or release tag.
When main has advanced since publication, the existing source check then rejects
the run even though the requested version already exists. Maintainers need a
successful early skip for that case while retaining the ability to finish a
publication that npm accepted before verification or tagging failed.

## Decision

The manual [publication workflow](../../../../.github/workflows/publish.yml)
uses an initial read-only preflight before waiting for main CI, installing
dependencies or preparing an artifact. It validates the frozen source and CLI
manifest, then checks the exact `daynight-v<version>` GitHub tag and the exact
`@codetreker/daynight@<version>` public npm record. Tag presence short-circuits
the npm lookup. Either marker produces an explicit successful skip, regardless
of its source or contents. Both absent admits preparation. Only HTTP 404 means
absence; other HTTP failures, network failures and invalid responses propagate.
A skip makes no publication, package-verification or tag-completion claim.

The publishing job repeats preflight before downloading the artifact and
installing npm when it first uses the artifact from preparation. Preparation
exposes its Actions run attempt alongside the artifact version; matching the
current attempt identifies first use. If preparation failed and is retried,
its first publishing job still runs this check. GitHub increments the
[`run_attempt` context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context)
on each rerun; the preparation output records the attempt that actually produced
the artifact. Successful prerequisites are reused when
[only failed jobs are rerun](https://github.com/actions/runner/issues/1961#issuecomment-1163227296).
Publication and verification retain their existing exact-source and immutable-tag
guards for state changes after the second check.

Re-running failed jobs after publication fails reuses the successful preparation
job's artifact and earlier attempt output. This publishing-job retry bypasses
the fresh-publication preflight. The existing strict recovery verifies the
registry source, integrity and downloaded bytes before creating a missing tag.
A conflicting source, artifact or tag target fails visibly. Re-running all jobs
repeats the initial preflight and can skip an interrupted release; completing it
requires the failed publishing job and its retained validated artifact.

This partially replaces the admission policy of the
[trusted-publishing decision](2026-10-20-npm-trusted-publishing.md), whose original
source checks rejected new dispatches for existing versions at another commit.
That policy protected source attribution by accepting only the captured source.
Existence-only admission now makes repeated dispatches successful no-ops;
source attribution remains strict for actual publication and same-run recovery.
OIDC, single-artifact identity, public visibility deadlines and immutable tag
creation remain owned by that earlier decision.

## Alternatives

**Keep source verification for every existing version.** This permits recovery
from any dispatch only when source and artifact match, but repeats the entire
validation workload and rejects ordinary dispatches after main advances.
The unchanged-version case requires existence-only admission.

**Apply the skip to failed publishing-job retries.** This gives every attempt
the same existence rule, but an accepted npm version would prevent its own
missing tag from being completed after a visibility or tag-creation failure.
Retaining strict same-run recovery preserves that completion path.

**Use only the workflow run attempt to identify recovery.** A run attempt above
one can also be the first publication after failed preparation. Comparing with
preparation's attempt preserves the second preflight in that case.

## Consequences

Repeated new dispatches for an existing version finish without the dependency,
test, packing or publication workload. A marker from another commit succeeds
without moving it. A tag without an npm record also skips, and an npm record
without a tag skips without repairing the tag; skipping reports existence only.

A failed publishing-job retry retains the previous source and artifact contract.
New dispatch and re-run-all operations cannot be used to repair an interrupted
release. Lookup errors remain failures and cannot authorize fresh publication.
The workflow's release concurrency group continues to serialize its own runs;
external publication between preflight and mutation is still subject to strict
publication guards. The CLI package version is unchanged because these workflow,
script and test changes are outside the runtime release inputs.
