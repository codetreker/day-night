# Agent Note: External Dependency Architecture

Status: implemented

## Problem

A dependency can express a genuine prerequisite without making its two tasks
members of the same delivery chain. Root reachability currently gives both
relationships the same meaning: shared descendants enter several chains and
make completed prerequisite work appear unfinished. Persisting a separate group
identity would also require creation, reassignment and representative rules that
are unnecessary for distinguishing these edges.

## Decision

The delivered [design](../../../../docs/design/daynight-external-dependencies.md)
and [requirements](../../../../docs/spec/daynight-external-dependencies.md)
specify an explicit boolean classification on each existing dependency row.
Classification storage and the service, CLI and Web read contract are
implemented. Public classification inputs and the ordinary-component Web model
remain target behavior.

The complete `dependsOn` set continues to own scheduling, blocking, readiness,
cycle detection and capacity. A required `externalDependsOn` subset communicates
the classification in full task and graph resources. Partial API updates retain
the nature of surviving edges when only references change. All candidates,
metadata writes, approve, unapprove, claim, complete and store replacement writes
carry both sets under the existing project transaction. New unspecified edges
are ordinary. Current public inputs still reject `externalDependsOn`; the design
for an explicitly supplied subset remains the later classification-write
contract.

The target ordinary-edge weak components define exclusive chain membership. The complete
all-edge ancestor closure supplies reading context. A dashed edge means an
explicit external prerequisite; a dashed card means a task outside the selected
ordinary component. These are independent properties. The current root-derived
projection and context rules remain current Web behavior:
the [projection decision](../feature/2026-10-20-task-graph-projection.md),
[complete context](../feature/2026-10-22-complete-prerequisite-context.md) and
[progressive overview](../feature/2026-10-22-progressive-task-graph.md) retain
their original rationale and existing guarantees.

The representative is the earliest ordinary root in exact service order.
Saved expansion records retain a task witness, resolving it to the current
component after an ordinary-edge merge or split. No persistent group identity
is published. Ordinary components and their ancestor closure are connected, so
the existing 50-node/100-edge overview and 20-neighbor expansion remain enough
to reach every projected task.

Public classification writes require every supported reader to understand the
distinction, including the Web chain model and presentation. Deployable states
without those consumers only establish ordinary edges. Readers do not fabricate
missing classification.

CLI output preserves the required external subset and labels it in its shared
dependency block. Web retains the subset in graph/detail resources and includes
it in graph equality and detail freshness. Root-based membership and contextual
dashes are unchanged until ordinary-component consumption is implemented.

Migration `011_external_dependencies.sql` adds the non-null boolean with the
ordinary default after project-settings migration 010, preserving prior schema
checksums and other task data. Historical
external classification is not inferred. The original worker regression remains
useful even though a later read found its two cross-chain edges already removed.
Current-data audits may identify existing edges for review, but neither the
schema migration nor acceptance recreates deleted prerequisites.

## Alternatives

**Persist `groupId` and independent membership.** This can represent unrelated
members and stable group identity through dependency edits. It adds membership,
anchor or representative, and migration rules. The confirmed outcome uses an
edge distinction; the design deliberately accepts derived chain identity and
keeps unconnected tasks independent. A later membership feature would need its
own stored model and migration, while preserving prerequisite classification.

**Replace dependency IDs with structured edge objects.** Objects naturally
carry metadata per edge, but replace the public `dependsOn` element type in
every caller. One binary property is represented exactly by a subset while the
complete scheduling set remains stable. The cost is an explicit subset invariant
and well-defined partial update rules. Richer edge metadata would justify
reconsidering the wire representation.

**Filter external edges but keep one chain per root.** This still duplicates C
for ordinary `A → C ← B`. Weak components express one connected chain with
multiple starting tasks and give each member one progress owner.

**Infer old external classifications.** Root order, titles and timestamps do not
record whether a prerequisite is external. Such inference would persist unknown
intent. A false migration default preserves every existing relationship; explicit
classification is a reviewed versioned operation on current data.

**Expose writes before updating readers.** This creates a release where valid
external markers still produce ordinary membership in Web. Reader-first tasks
avoid that inconsistency without a feature flag or another compatibility path.

## Consequences

All-edge execution integrity, classification preservation, strict read contracts
and reader-before-writer delivery are structural guarantees included in every
affected layer. Existing project locks, fault codes, sanitized errors, request
correlation and graph budgets suffice; no FK, scheduler or logging framework is
introduced.

Derived chains can merge or split when ordinary edges change. Their heading and
ordering can change with the representative. Disconnected UX members remain
independent, and no artificial prerequisite is added to make them appear
together. Stable names, empty-group lifecycle and explicit independent members
are outside this outcome. Keeping computed representatives out of the public
resource model leaves those future choices separate from prerequisite semantics.

Changing all-normal multi-root projection to weak components can merge formerly
overlapping entries even though migration changes no endpoints. The design and
prototype expose that behavior for review. Production results remain source-bound
acceptance artifacts, not claims established by the design or prototype.
