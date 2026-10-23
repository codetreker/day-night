# Agent Note: Stable Project Header During Membership Loading

Status: implemented

## Problem

The project page restores the selected task view's saved document scroll position
when its task graph is ready. Membership lookup completes independently and
controls which project actions are visible. Adding those actions can narrow the
title enough to wrap onto another line after scroll restoration, moving the
content below the heading while leaving the browser at the old scroll offset.

## Decision

The project heading reserves the same membership action geometry while the
membership request is unresolved. An inaccessible, hidden placeholder provides
the localized member and settings labels and reserves the width of the longer
localized administrator badge. Once membership is known, the
placeholder is replaced by the authorized links and the actual role badge; the
settings link remains available only to an authorized member. The project view
E2E holds the membership response until after scroll restoration and verifies
that both the heading geometry and saved scroll position remain unchanged.

## Alternatives

**Delay scroll restoration until membership lookup finishes.** This couples the
project view's readiness to an independent authorization request and delays
restoring content even when the task graph is already ready. A failed membership
request would also need a separate restoration path.

**Change the scroll assertion to allow the shifted position.** That would hide a
real document reflow and weaken the per-view scroll-position behavior already
owned by the [project task view decision](../feature/2026-10-22-project-task-views.md).

## Consequences

Membership loading no longer changes the width available to the project title,
including when role labels differ in length. The placeholder is absent from the
accessibility tree and does not expose links before authorization. Responsive
wrapping remains owned by the existing action group; the regression covers the
project-view reload at the width where the original title wrapped.
