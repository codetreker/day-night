# Agent Note: npm Trusted Publishing

Status: implemented

## Problem

Publishing the CLI requires repeatable package validation and a durable mapping
from an npm version to its source commit. A release tag must identify a package
that is available from the public registry. Interrupted publication and tagging
must be recoverable without replacing an existing version or moving a tag.
Maintainers also need CI publication without storing a long-lived npm token.

## Decision

The manual [`publish` workflow](../../../../.github/workflows/publish.yml)
accepts only `refs/heads/main` and captures `GITHUB_SHA` as the release source.
The release group allows one active run and does not cancel it when another run
is dispatched.
The [toolchain version gate](2026-10-16-typescript-cli-toolchain.md) remains
independent: the reviewed change selects the package version, and publication
neither increments it nor commits changes. Prerelease versions fail because this
workflow publishes stable releases to `latest`. A previously unpublished version
must have greater precedence than the registry's current stable `latest` version.

A read-only preparation job waits for the latest main-push `checks.yml` run at
the captured commit to succeed. A missing or failed matching run stops the
release. Preparation then uses Node.js 24 and pnpm 10.34.5 for a frozen
install, type checking, tests and installed acceptance. It packs the staged CLI
with the captured commit in `gitHead`, smoke-installs the resulting tarball, and
uploads `.tmp/npm-release/artifact/package.tgz` together with `release.json` as
an immutable Actions artifact. The receipt binds package name, version, source,
tag and SHA-512 integrity to the tarball. Publishing a tarball does not infer
`gitHead` from the checkout, so the staged manifest supplies it explicitly;
the [npm publish implementation](https://github.com/npm/cli/blob/ae98c62586b6fea44114f72e249e246a2981de70/lib/commands/publish.js)
distinguishes tarball and directory publication.

The publishing job downloads that artifact on a GitHub-hosted Ubuntu runner
with Node.js 24 and npm 12.2.0. It receives `id-token: write` for npm OIDC and
`contents: write` for the final tag. It publishes the tarball to the public npm
registry with `latest`, provenance and lifecycle scripts disabled. No npm token
is provided. The package repository metadata identifies the GitHub source and
CLI subdirectory, as required for source attribution.

The npm package's trusted publisher identifies GitHub owner `codetreker`,
repository `daynight`, workflow filename `publish.yml`, and no environment.
It must allow direct `npm publish`; the always-allowed staged action does not
grant that permission. A package owner configures this connection on npmjs.
The first successful publication must validate a newly created connection within
two days, after which npm binds it to the repository's immutable identity.
The [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers)
owns these registry requirements; the [provenance documentation](https://docs.npmjs.com/generating-provenance-statements)
owns source and build attestation requirements.

Publication completion is determined through the public registry. The release
requires the registry's `gitHead` and SHA-512 integrity to match the receipt,
downloads the registered tarball, and verifies its bytes. Only then does it
create the lightweight `daynight-v<version>` tag at the captured source commit.
The prefix distinguishes CLI releases from the independent server. Existing
refs are never rewritten. A tag already pointing to the source is accepted;
a different target fails. An existing npm version is accepted only with the
same source and artifact, allowing an interrupted run to finish its missing tag.

Recovery re-runs the failed jobs of the same Actions run, preserving the captured
source and reusing its validated artifact within the 30-day retention period.
A separate dispatch at a different commit with the same package version fails
the source check even if its application files happen to be unchanged. This
keeps one published version attached to one reviewed commit. Registry errors,
artifact mismatches and conflicting tags remain visible failures.

## Alternatives

**Create a version tag before publishing.** This supplies a tag trigger but
leaves a release marker when authentication, validation or npm publication
fails. A tag created only after registry verification preserves the meaning of
an available release.

**Store an npm publishing token in GitHub secrets.** This allows unattended
publication but requires secret storage, rotation and token-access management.
OIDC meets the requested publishing mechanism and limits registry credentials to
the configured GitHub workflow.

**Publish on every main merge.** This makes each merge a release authorization,
including documentation-only changes whose package version is unchanged. A
manual dispatch keeps publication intent separate from integration while using
the same exact-commit validation gate.

## Consequences

The release uses one validated tarball across preparation, installation,
publication and public-registry verification. The privileged publishing job
does not rebuild the package or execute package lifecycle scripts. Tagging is
ordered after an observable successful publication, and re-runs complete
interrupted releases without mutating package versions or existing tags.

npmjs trusted-publisher configuration is an external prerequisite, and GitHub
repository rules must permit the workflow token to create the release tag. A
successful local check cannot establish either external permission. Expired
publisher configuration and repository permission failures require their owner
to correct the configuration before the same run can complete. The
[README publication instructions](../../../../README.md#npm-publication)
own maintainer setup and invocation.
