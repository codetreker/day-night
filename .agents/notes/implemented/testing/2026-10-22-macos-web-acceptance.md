# Agent Note: Native macOS Web Acceptance

Status: implemented

## Problem

The shared Web acceptance pipeline used Linux procfs directly. Docker Desktop
could run the production containers on macOS, but that did not provide native
process recovery, Chromium bundle ownership or case-sensitive attachment storage.
The [pipeline decision](2026-10-21-web-acceptance-pipeline.md) established complete
functional and capacity evidence and cancellation ordering; those guarantees must
survive the platform extension.

## Decision

Keep one pipeline for Linux and macOS with the same 31 scenarios, four fixed
capacity datasets, five measurements and existing latency limits. Linux remains
the full CI platform; macOS local acceptance requires native execution and does
not imply a macOS CI job.
The [bounded-line rendering decision](../bug-fix/2026-10-22-bounded-dashed-dependency-lines.md)
owns the GPU paint correction needed to retain those capacity budgets on macOS.

Process identity includes the host platform, PID, actual executable, process
group and exact kernel start identity. Linux retains procfs; macOS compiles a
small Apple SDK helper into project temporary storage and reads libproc/sysctl.
Argument matching uses argv entries, preserving spaces. Process discovery filters
exact run environment markers without exporting unrelated process environments.
Chromium inventory includes verified macOS bundle helpers and Crashpad.
The native inspector requests zombie status explicitly: macOS can report an
exited child as present to signal probes while excluding it from the default
BSD identity query. It also rechecks that status when executable lookup races
with exit. Argument inspection can return `EINVAL` after an exiting task loses
its argument memory but before BSD publishes its zombie state. Only that error
with the kernel's `INEXIT` flag permits up to ten 10ms waits, rechecking PID,
exact start identity and process group each time. Only confirmed disappearance
or zombie status counts as absent; an unfinished exit, permission error or
changed identity still fails.

Storage preparation owns an exclusive control directory. A case-sensitive parent
uses a direct data directory; macOS case-insensitive parents use an owned
case-sensitive APFS sparse image. Atomic local receipts and parent persistence
precede attachment. Cleanup verifies directory/image identity and mount topology,
requires the native service to stop, and detaches before recursive removal.
Explicit busy failures retry at one-second intervals within a shared 30-second
deadline, revalidating ownership each time. A separate three-attempt limit would
end cleanup after about two seconds even when most of the deadline remained;
transient volume users can outlast that window. Cleanup never forces detachment.
Unknown ownership remains an explicit recovery failure. Routine Web tests do not
attach images on macOS: receipt tests run without authorization, while an explicit
native storage suite shares one mounted image across cases. Complete acceptance
owns one native storage image per run. This keeps native coverage available
without repeated administrator dialogs during ordinary test runs.
The native suite verifies busy recovery with a real acknowledged read-only file
holder. Only a real detach refusal followed by a PID-specific open-file check,
acknowledged release and successful retry establishes that lifecycle evidence.

Top-level evidence and recovery use schema 3. Older schemas and cross-platform
process identities are rejected; receipt interpretation never guesses identity
units or silently drops ownership checks. Capacity and container-permission
receipt formats remain unchanged.

Both Compose stacks expose `DAYNIGHT_NPM_REGISTRY` as an opt-in build argument.
The official registry remains the default; host npm configuration does not
implicitly enter container builds.

## Alternatives

**Docker-only acceptance.** Running only in Docker would keep Linux tooling but
leave macOS native development and process cleanup unverified.

**Parsing `ps`.** Its start time would lose subsecond identity, while rendered
command lines would lose argv boundaries.

**Weaker acceptance.** Skipping case-sensitive attachment checks or relaxing
performance limits would change acceptance meaning between development hosts.

**Global prerequisites.** Installing global GNU tools or mounting an untracked
shared volume would add machine state without reliable task ownership and crash
recovery.

## Consequences

macOS needs the Apple SDK/compiler and permission to attach disk images. Failed
or interrupted runs can leave attributable resources for explicit recovery;
ambiguous mounts are not forcibly detached. Native helper and APFS lifecycle
checks add platform-specific maintenance while the runner remains shared.
Windows native Web acceptance stays unsupported. A future macOS CI job must
provision these prerequisites and execute the complete gate before claiming CI
parity. The [Web README](../../../../packages/daynight-web/README.md#production-browser-acceptance)
owns setup and recovery commands; the [design](../../../../docs/design/daynight-web.md)
owns the pipeline mechanism.
