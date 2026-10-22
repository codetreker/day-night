# Agent Note: Standalone attachment reading

Status: implemented

## Problem

The task dialog bounds the area available to read an attachment. Users need a
separate browser tab that can reload without the original dialog while retaining
rendered Markdown, native media and interactive HTML with relative resources.
Opening raw Markdown bytes does not retain the existing reading experience.
Moving a native frame outside the dialog must also preserve normal browser
keyboard behavior and avoid a second scrollbar around its document.

## Decision

The preview action immediately after Download is an accessible Open in new tab
anchor with an external-link icon, `target="_blank"` and
`rel="noopener noreferrer"`. `attachmentPageUrl` generates
`/projects/{projectId}/tasks/{taskId}/attachments/{path...}` from the selected
metadata, independently of pending content. It shares the existing canonical-ID
and encoded-path validators. The source dialog and its selection remain open.

`App` renders `AttachmentPage` outside the workspace shell and modal. The route
owns project, task and exact case-sensitive path, and the reader fetches through
its own `useAttachments` instance. Only a complete inventory establishes either
selected metadata or a missing file; failed or partial inventories remain errors
with retry. The same `AttachmentPreview` renders every supported format and
its failure states. Content URLs remain the existing raw/preview endpoints, so
Markdown resources and trusted same-origin HTML keep their current resolution
and execution rules. No new metadata API, preview credential or storage address
is introduced.

The frontend splits the raw route path before decoding segments once, rejects
decoded separators and applies the existing path validator. The Go UI mux serves
the index for GET/HEAD of this exact page shape and rejects other methods with
405 and `Allow: GET, HEAD`. Unknown page shapes remain JSON 404. Invalid IDs in
a known page shape retain the established index response and frontend not-found
behavior. The existing raw attachment path guard protects the new namespace
before ServeMux normalization or redirects, including paths whose later parent
segments would conceal their attachment intent. Literal percent names remain
valid through one encoding/decoding pass.

The root `LocaleProvider` supplies the reader's messages, route title, metadata
formatting and language selector. Entering the route focuses its main reading
region; locale updates preserve resource and frame identity. A `100dvh` flex
column gives the actual-height header its space and the renderer all remaining
height. The outer page hides overflow. Markdown, text and images use the shared
preview body as their vertical scroll owner; HTML/PDF use a fitted iframe whose
document or native reader owns scrolling. Header height is never subtracted as
a fixed constant.

`TrustedFrame` installs the existing Escape/Tab bridge only with an actual dialog
ancestor and a provided close callback. A standalone frame receives neither the
bridge nor modal focus, inertness or scroll locking. The original inline
preview retains its dialog keyboard and cleanup behavior.

The [attachment requirements](../../../../docs/spec/daynight-task-attachments.md#独立页面完整阅读)
own visible behavior and the [design](../../../../docs/design/daynight-task-attachments.md#独立附件阅读页)
owns the route and rendering mechanism. This decision extends the
[split-view decision](2026-10-22-task-attachment-split-view.md), which retains
inline tabs, state and scroll ownership. The
[original Web attachment decision](../feature/2026-10-21-task-attachment-web.md)
retains rendering, file operations and trusted-origin rationale; the
[embedded delivery decision](2026-10-20-embedded-dashboard-deployment.md)
retains one mux, real assets and exact page registration.

## Alternatives

**Open each file's raw preview URL directly.** HTML and native media retain their
browser rendering, but Markdown is served as file content and loses the shared
CommonMark/GFM view. One explicit reader route provides a consistent reloadable
entry for all existing formats without changing their file endpoints.

**Use originating-tab state or temporary object URLs for navigation.** A copied
address, reloaded page or closed source dialog would lack authoritative metadata
and content ownership. Complete inventory lookup keeps production navigation
independent; fixture object URLs remain local demonstration resources.

**Reuse the dialog frame keyboard bridge on the full page.** Escape would be
consumed for a nonexistent dialog and boundary Tab would inherit modal rules.
Restricting the bridge to a real dialog retains standalone browser behavior
while preserving the existing modal interaction.

## Consequences

The full reader is an additive capability over the split layout: file identity,
content rendering and relative resources remain shared, while route, request
and keyboard ownership are explicit. Complete inventory reads retain the cost
of listing every page before missing-file decisions; they avoid another metadata
endpoint and prevent partial failure from becoming false absence.

The page remains a read-only view with a download action. File management stays
in the task's attachment tab. Authentication rollout, task lifecycle, description
Markdown, single-file mutation semantics, storage formats and the accepted K1
filesystem/PostgreSQL boundary remain unchanged.

The production-component fixture supplies reloadable bundled-file reader URLs
for visual and interaction checks. Implementation checks own this feature's
route, rendering, failure and sizing behavior on their tested source. Independent
real-service production acceptance for the attachment-reading task group remains
separately tracked; implementation and fixture evidence do not complete it.
