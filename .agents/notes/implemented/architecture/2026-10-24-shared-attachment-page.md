# Agent Note: Shared attachment page and standalone history

Status: implemented

## Problem

The standalone reader opens one attachment without the task's inventory or file
operations. Reading another file requires returning to the source task, and a
separate reader composition can drift from the attachment panel's behavior.
Standalone file changes also need copyable addresses and browser Back/Forward,
while selecting files inside a task dialog must preserve that page's navigation.

## Decision

Both containers compose the complete `TaskAttachmentsPanel`: directory tree,
refresh, upload disclosure, row menus, deletion confirmation, preview and file
actions. Each page has one `useAttachments` controller. `AttachmentPage` adds only
its standalone return/language header, viewport sizing and route integration;
the shared preview header owns path, metadata, Download and Open in new tab.
The embedded panel retains its existing task-detail container and selection.

Standalone tree selection and successful upload selection notify the outer page,
which navigates only when the selected path differs from the current route.
Route changes apply selection to the controller without emitting a selection
event back to the router. Back/Forward therefore restore a file without creating
new history, and direct loading uses the existing canonical attachment address.
The embedded composition does not register this observer, so its tree and upload
selection remain local and leave the URL and history unchanged.

The standalone page and its authenticated composition retain identity by
project/task across path changes. That preserves inventory, directory disclosure,
sidebar scroll and upload drafts while the selected preview changes. Task and
identity changes still release the old controller and requests. The existing
path/updated-time preview identity and request cancellation reject stale content.

Metadata for a newly selected standalone path requires a complete inventory;
partial pagination and failures cannot establish absence. An incomplete refresh
retains already-confirmed metadata for the same task/path. Deleting the selected file keeps the
current route and shows missing after complete inventory confirmation. Deleting
another file preserves the current preview. Existing upload/delete requests,
confirmation, error visibility, exact-path targeting and K1 semantics apply in
both containers. No new API, storage identifier or renderer is required.

The shared split preserves the left inventory and right preview at narrow widths.
The inventory scrolls independently; the preview body owns Markdown/text/image
scrolling and fitted native HTML/PDF documents own their scroll. The standalone
page has no task-dialog focus trap or iframe keyboard bridge. Its file deletion
confirmation retains its own native modal focus and keyboard ownership.

This partially supersedes the read-only composition in the
[full-reader decision](2026-10-22-task-attachment-full-reader.md), while retaining
its routing, path validation, same-origin content and nonmodal keyboard rules.
The [split-view decision](2026-10-22-task-attachment-split-view.md) retains panel,
upload-draft and scroll ownership. The
[deletion-confirmation decision](../feature/2026-10-23-attachment-delete-confirmation.md)
retains single-file mutation and confirmation behavior. The
[requirements](../../../../docs/spec/daynight-task-attachments.md#独立页面完整阅读)
and [design](../../../../docs/design/daynight-task-attachments.md#独立附件阅读页)
own the complete observable behavior and composition.

## Alternatives

**Add a separate read-only directory tree to the standalone reader.** This would
provide file selection but leave two attachment-page compositions with different
management capabilities. Reusing the existing complete panel shares its directory,
file operations, error handling and validation without another tree or renderer.

**Keep file selection local in both containers.** This retains the embedded
behavior, but standalone addresses would continue to name a previously selected
file. Back/Forward and reload would not follow the displayed document.

**Write history from every selection-state change.** Route restoration and local
selection would feed each other, creating entries during Back/Forward and exposing
races with completed uploads. Explicit user selection events let the standalone
outer page own navigation while route changes only apply state.

## Consequences

The complete attachment experience is available in either container, with one
implementation for file browsing and management. Routing is an outer-page concern;
embedded panels remain usable without changing project navigation. Keeping the
panel mounted across file routes retains native inputs and directory state.

The current address remains meaningful after deletion even though it then names
a missing file. A complete-inventory check reports that absence; selecting an
existing file produces its own address. The design retains existing pagination
costs, normal file-operation failure semantics and trusted same-origin execution.

Validation must distinguish container behavior: standalone file selection and
uploads update history, Back/Forward apply state without writing history, and
embedded file selection and uploads remain local. Both containers require file
operations, error recovery, narrow split geometry, scroll ownership and keyboard
checks. Historical reading-group results retain their recorded source and
browser limits and do not prove subsequent extensions by themselves.
