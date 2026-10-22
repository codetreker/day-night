# Agent Note: Task attachment tabs and split preview

Status: implemented

## Problem

Task attachments share a reading column with descriptions and pull requests.
Browsing a file inventory and reading its selected content compete for the same
space. A constrained viewport can also leave the detail body, preview wrapper
and embedded document with separate vertical scrollbars along the preview side.
Users need the file inventory to remain adjacent to the document while all
preview actions and the dialog close control remain reachable.

## Decision

`TaskDetailDialog` composes `TaskDetailPanels` beneath the common task heading.
Every project/task identity starts on Overview. Overview retains descriptions,
pull requests, relationships and metadata; Attachments owns file management and
preview. Stable tab/panel relationships, roving tabindex and automatic arrow and
Home/End activation provide keyboard navigation. Both panels stay mounted and
the inactive panel is hidden and inert. Tab round trips retain the attachment
controller, native file input, relative-path draft, directory expansion and
preview state. A new project/task identity resets them. Future description
attachment navigation activates this same panel and controller.

The attachment panel is one bounded grid with a vertical divider. Its left
sidebar contains the file tree, refresh and single-file upload and may scroll
independently. Its right pane combines a non-scrolling preview header with a
flexible body. The panes remain adjacent at all supported widths, including
320px. Shrinkable descendants have explicit zero minimum sizes so their content
does not enlarge the viewport chain. Short viewports use compact heading and
control spacing, including at 844×390; they do not restore outer dialog scrolling
around the preview.

There is one right-side vertical scroll owner. Markdown, text/JSON/source and
large images use the preview body without child vertical height caps. Tables
and code retain local horizontal scrolling. Ready HTML/PDF use a fitted iframe;
the preview body and frame wrapper hide overflow while the embedded document or
native reader scrolls. The header exposes the full path and keeps download and
delete reachable. Overview has its own normal content scrollbar.

The [requirements](../../../../docs/spec/daynight-task-attachments.md#web-管理与预览)
own visible behavior, and the [attachment design](../../../../docs/design/daynight-task-attachments.md#web-文件树与预览)
owns composition and renderer sizing. This decision partially supersedes the
placement in the [original Web attachment decision](../feature/2026-10-21-task-attachment-web.md)
and the content scroll ownership in the [centered detail decision](../feature/2026-10-22-centered-task-detail-dialog.md).
Their file, request, trusted-origin and modal lifecycle decisions remain valid.

The confirmed reading delivery separates the tab/split layout, full-page reading
in a new browser tab, and independent integrated real-service acceptance. The
layout delivery includes local behavior and regression validation. The full
reader remains a later capability: the current preview offers working download
and delete actions without a placeholder new-tab button. Its later cost remains
additive because renderer sizing is explicit and file identity continues to use
project, task and the complete relative path; the reader need not replace the
attachment controller, invent another storage address or alter service preview
URLs. Independent acceptance observes the integrated production page and actual
native rendering rather than inferring frame success from HEAD.

## Alternatives

**Keep attachments below pull requests in the reading column.** This preserves
the initial composition, but leaves file browsing dependent on scrolling through
task prose and allows the inventory and selected document to compete vertically.
A dedicated tab keeps task reading and attachment browsing separately bounded.

**Let an outer detail scrollbar compensate for a tall preview.** That permits a
wrapper to scroll while a document or native reader also scrolls. Assigning one
owner through the full size chain preserves a single right-side scrollbar and
keeps the title and actions available in short viewports.

**Deliver layout, full reader and integrated acceptance as one task.** Those
outcomes would couple a modal layout change, browser route behavior and a
cross-layer acceptance expansion. Separate deliveries preserve independent
review and acceptance while retaining each implementation's own required
checks. The existing shared renderer and unchanged file addressing keep the
full reader extension affordable.

## Consequences

File selection no longer moves the task prose and metadata. Narrow layouts keep
the inventory beside its preview, trading pane width for continuous context.
The compact file sidebar and wrapping or accessible truncation of long paths
are required parts of that layout, not optional polish.

The modal retains body portal ownership, shared body scroll locking, background
inertness, close/Escape behavior, focus containment/restoration and same-origin
iframe keyboard bridges. Locale changes update labels without changing tab,
controller or preview identity. Single-file writes, exact-path overwrite,
relative resource resolution, raw-byte download, stale-response rejection and
the accepted K1 filesystem/PostgreSQL boundary remain unchanged.

The frontend-only production-component mockup proves its own visual and
interaction behavior. Source-bound UI and browser checks establish the layout
on their tested artifact; neither replaces the separately tracked real-service
acceptance or claims the pending full-page reader has shipped. Changes that
remove explicit renderer sizing, mount a second attachment controller or add
another vertical overflow ancestor require revisiting this decision.
