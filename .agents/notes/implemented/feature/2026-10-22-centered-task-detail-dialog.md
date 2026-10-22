# Agent Note: Centered task detail reading

Status: implemented

## Problem

Task details combine descriptions, pull requests, attachments, relationships and
metadata. The original 460px right-side layout constrains reading space,
particularly for planning documents and previews, while a full-width narrow-screen
layout leaves no visible separation from the page. Moving that content must
preserve keyboard containment, nested fullscreen behavior and focus restoration
when refresh removes the original entry.

## Decision

`TaskDetailDialog` is the shared task-detail entry for graph nodes and standalone
rows. It retains the existing detail request hook, relationship navigation, PR
pagination, attachment state and stale-snapshot notice. `task-detail.css` owns one
`task-detail-*` namespace for its shell and content.

The body portal centers the dialog in the available viewport, with a maximum
width of 960px and 24px gutters, reduced to 12px at 600px and below. Maximum height
is `min(880px, 100dvh - 2 × gutter)`. The content region scrolls independently of
the header and footer, keeping the close control accessible. Desktop content pairs
a reading column with a 265px metadata/relationship column; the latter becomes
225px at 850px and below, and both columns stack at 600px and below. Long text
wraps and preformatted content scrolls within its own region.

The [dashboard decision](2026-10-20-project-task-dashboard.md) and
[original dashboard design](../architecture/2026-10-20-task-dashboard-mvp-design.md)
retain their snapshot and modal ownership. This decision partially supersedes
their right-side reading layout. Synchronous layout cleanup releases keyboard
listeners, background inertness and counted scroll ownership; the separate
passive cleanup restores focus after sibling DOM removal, as required by the
[focus restoration decision](../bug-fix/2026-10-20-drawer-focus-restoration.md).
Relationship navigation changes the resource within one dialog lifetime.

The dialog remains above the [fullscreen graph](2026-10-22-task-graph-fullscreen.md).
Escape closes details before the graph; a vanished entry falls back to the
surviving fullscreen exit control or the current project view's visible controls,
with the project heading retained for an empty project. Both modal owners use
the same counted body scroll lock, including when the graph unmounts first.
The [attachment decision](2026-10-21-task-attachment-web.md) continues to own
same-origin frame load, replacement and unmount listeners. Its Tab/Escape bridge
uses `dialogFocusables` and the same dialog lifecycle.

The [inspection requirements](../../../../docs/spec/daynight-task-inspection.md)
TI6–TI7 and [design](../../../../docs/design/daynight-task-inspection.md) own the
visible contract. The [web acceptance map](../../../../packages/daynight-web/README.md#production-browser-acceptance)
owns the production journeys for geometry, independent scrolling, graph and
standalone entries, refresh removal, fullscreen and frame keys. The
production-component mockups reuse the dialog and styles; the standalone
inspection prototype remains a target for the still-pending graph and Markdown
work, rather than evidence that those behaviors are delivered.

## Alternatives

**Keep the right-side layout and increase its width.** A wider side panel retains
the existing attachment and modal composition, but its position does not provide
the centered reading behavior required by TI6. Reusing that composition inside a
centered shell preserves the lifecycle without retaining the original geometry.

## Consequences

Reading and preview content gain a wider desktop column while metadata remains
nearby. Narrow screens retain visible gutters and stack the same content without
page-wide horizontal overflow. The fixed header and footer reduce the available
reading height, so long content requires scrolling within the dialog.

The dialog remains an independent live detail read and never patches the graph
snapshot. Descriptions remain plain text; Markdown descriptions and relative
attachment navigation belong to UX-T4. Graph-card inspection and smooth paths
belong to UX-T2. Keeping the same opening callback and attachment-state ownership
allows those tasks to extend the dialog without replacing its modal lifecycle.
