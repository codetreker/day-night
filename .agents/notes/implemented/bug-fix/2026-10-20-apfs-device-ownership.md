# Agent Note: APFS Disk Image Device Ownership

Status: implemented

## Problem

An APFS volume's mountpoint can disappear while disk-image finalization is still
in progress. The [observed macOS failure](https://github.com/codetreker/day-night/actions/runs/39412445956/job/118593266497)
reported a busy detach, then diagnostics could no longer resolve the mountpoint,
and another detach by that path failed. No holder was established. A missing
mountpoint cannot establish whether the backing disk image remains attached.
Cleanup needs an identity that covers the complete image before deleting its
backing directory.

The [original finalization decision](../testing/2026-10-18-apfs-fixture-finalization.md)
retains its ordinary-detach policy, resource budget and diagnostic requirements.
This decision replaces mountpoint-based attachment identity and adds explicit
proof that the fixture's complete image is absent.

## Decision

The APFS fixture creates an explicit single-partition GPT disk image, resolves
its canonical path with `realpath`, and captures `hdiutil attach -plist` output.
The whole-image device is the unique `GUID_partition_scheme` entity's actual
`dev-entry`. It is not inferred from a mounted APFS volume or from an assumed
device-number pattern. Apple's [disk-image test helper](https://github.com/apple-oss-distributions/hfs/blob/d1bac2f062e6e9c0dfcce302d9aacb10173d0eea/tests/disk-image.m#L393-L462)
provides the attach-plist and returned-device identity pattern. Its forced-detach
policy is not adopted.

The platform `plutil` selectively extracts typed fields. Raw array extraction
supplies the inventory count; raw string extraction reads each image path. Only
the attachment's or matching image's `system-entities` array is extracted as JSON.
The entire inventory is never converted to JSON, so unrelated binary image aliases
are not part of identity parsing.

Before each detach, `hdiutil info -plist` must match the exact canonical fixture
image path and its retained whole-image device. This prevents a reused device
name from authorizing cleanup of another image. When attachment was attempted
but its result is uncertain, the unique exact-image entry supplies recovery
identity. Malformed output, ambiguous image or device entries, ownership changes
and inspection failures remain errors and retain the fixture.

Cleanup uses at most three ordinary device-targeted detach attempts within the
existing absolute 30-second budget, including inspection, diagnostics and pauses.
Only confirmed C-locale `Resource busy` responses permit another attempt. The
40-second hook, 600-second platform gate and eight APFS assertions remain
unchanged. Diagnostics retain command status and bounded stdout/stderr, including
when a mountpoint is no longer a filesystem or later cleanup succeeds. Image
inspection reports only the fixture path, attached/absent state and device identity.

A successful detach is followed by inspection proving that the exact fixture
image is absent. A vanished mountpoint alone cannot authorize directory removal.
An already-absent image also permits removal when inspection establishes that
state. Setup that never attempted attachment can remove its directory directly.
No directory is removed while image ownership or attachment remains uncertain.

## Alternatives

**Continue detaching by mountpoint.** The observed mountpoint disappeared before
the second attempt, so the same path could no longer identify the attached image.
Retaining the returned whole-image device avoids depending on volume mounting.

**Treat an absent mountpoint as successful detach.** APFS volumes and the backing
disk image have different lifecycles. Deleting the image's directory on that
observation would discard evidence without proving that all its devices detached.

**Force detach.** This overrides a busy refusal and can disrupt an active consumer.
Ordinary detach plus exact-image inspection preserves the existing refusal policy
and leaves unresolved resources available for investigation.

## Consequences

Finalization follows fixture image ownership across mountpoint changes and rejects
ambiguous or changed identities. The required filesystem assertions and validation
budgets remain intact; teardown failure continues to fail the native job.

Deterministic fixtures validate image/device selection, changed ownership,
uncertain attachment, disappeared mounts, full-image absence and failure retention.
Native APFS execution remains necessary to establish actual platform behavior;
passing product assertions followed by failed teardown is not a successful job.
