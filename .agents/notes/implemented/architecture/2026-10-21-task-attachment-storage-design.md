# Agent Note: Bucket-addressed Task Attachments

Status: implemented

## Problem

Tasks need to carry design documents, architecture documents, images and runnable
UI mockups. When this design was adopted, the task model carried text and
dependency state, the browser was a read-only consumer, and the CLI transport
handled JSON and rendered text. A file mechanism tied to one task model would
also make another file use case repeat the same disk and transport concerns.

## Decision

The delivered artifacts are the adopted [requirements](../../../../docs/spec/daynight-task-attachments.md),
[architecture](../../../../docs/design/daynight-task-attachments.md) and
[implementation breakdown](../../../../docs/design/daynight-task-attachments-tasks.md).
The [file-storage foundation](2026-10-21-bucket-file-storage.md) implements the
generic local adapter and startup integration. The
[attachment HTTP delivery](../feature/2026-10-21-task-attachment-http.md) implements
metadata and backend file operations. The
[attachment CLI delivery](../feature/2026-10-21-task-attachment-cli.md) implements
put/list/read/remove and byte-stream output. The
[persistence delivery](2026-10-21-task-attachment-persistence.md) implements
deployment volumes, isolation and paired backup/restore validation. The
[Web attachment delivery](../feature/2026-10-21-task-attachment-web.md) implements
file management, typed previews and drawer focus integration. This note owns the
adopted cross-component design; the CLI and Web notes own their transport,
rendering and output choices. Combined acceptance remains tracked in Daynight.

Generic file storage uses bucket and real relative path addressing through
Put/Open/Delete. The initial adapter is local disk. Task attachment consumers use
the task-attachments bucket and canonical task ID as the first path component.
Physical sharding is an adapter detail, not another persisted or public path.
The initial layout directly mirrors bucket and path; no sharding configuration
or migration mechanism is part of this delivery.

One PostgreSQL attachment table owns task association, relative path and file
metadata. Directories are inferred from paths. Each upload, overwrite or deletion
addresses one file. Same-path uploads replace current contents; there is no
per-upload object key or version history. The generic storage interface does not
own task policy or a generic PostgreSQL metadata platform.

Web and CLI share path-addressed HTTP APIs. Preview uses the existing application
origin and a fixed task-scoped path; HTML is trusted project code executed in an
ordinary iframe. CLI content reads use a binary streaming channel with
backpressure, cancellation and explicit partial-failure semantics. The
[server baseline](2026-10-19-daynight-server-task-design.md),
[CLI baseline](2026-10-20-project-task-cli-design.md) and
[read-only dashboard baseline](2026-10-20-task-dashboard-mvp-design.md) retain
ownership of their delivered behavior. Attachments extend those baselines and
are tracked separately until their implementation is delivered.

Filesystem mutations and PostgreSQL metadata changes are not atomic. K1 in the
requirements and architecture records the accepted failure and concurrency
window. This delivery does not address K1 through coordination, compensation,
recovery, state ledgers or background reconciliation. Ordinary errors remain
visible, and an unsuccessful request may already have changed storage.

## Alternatives

**Unique immutable keys with a PostgreSQL publication pointer.** This makes the
database select a completed object, but introduces a second file identity and
old-object reclamation into a path-based, current-content feature. Bucket/path
addressing is reusable without that lifecycle. Its cross-store consistency
limitation is explicitly accepted as K1.

**Directory bundles and whole-directory replacement.** A bundle can publish one
mockup with all its resources, but also gives a single upload authority to remove
other files. The selected interface always modifies one file; directories only
organize relative paths and browser resource references.

**Dedicated preview origins, sessions and capability tokens.** These can isolate
untrusted preview code, but add origin allocation, lifecycle and permission
machinery. The selected model treats HTML as trusted project code and uses the
main application origin. It does not claim an execution security boundary.

**Service Worker preview routing.** A worker can provide offline or browser-side
virtual filesystems, but server-backed paths already provide the required
relative-resource routing. Worker registration, control and caching lifecycle
are unnecessary for this delivery.

**Cross-store recovery and reconciliation.** These mechanisms could reduce K1's
failure window or reclaim interrupted-operation residue. They add persistent
state and operational behavior outside the adopted scope. K1 remains a known
issue, not a hidden implementation or acceptance task.

## Consequences

Another file consumer can reuse bucket/path storage without importing task
policy. Normal writes use local staging followed by complete-file replacement;
staging is an IO mechanism, not a historical version system. User-facing paths
and preview URLs remain independent of disk roots and future backend choices.

PG metadata can differ from actual file contents after failures or concurrent
mutations. File response length comes from the object actually opened. Errors
must not be converted into an empty list, missing file or confirmed rollback.
The task breakdown does not include a consistency remediation task or gate.

Trusted same-origin HTML has the privileges of that browser origin. Supporting
untrusted HTML would require revisiting the preview boundary rather than
silently presenting the current iframe as isolation.

Generic local storage, attachment HTTP resources, CLI commands, browser
management and persistent deployment volumes are implemented. The Web delivery
note owns its state, rendering and focus choices; this note retains the
cross-component addressing and accepted K1 decision. A-T6 combined acceptance
progress is maintained in Daynight; the breakdown owns scope and acceptance.
Existing server, CLI and Web contracts remain true for delivered features.
Module-specific validation and source-bound evidence remain required; native CLI
outcomes cannot be inferred from source inspection or another platform's run.
