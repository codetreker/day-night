---
name: scope-cut
description: Decide what authorized work includes or defers, distinguish additive features from structural guarantees, and preserve the constraints that keep deferrals affordable.
---

# Cutting Scope

A scope decision is a bet about the cost of deferred work. Record nontrivial
choices using [agent-notes](../agent-notes/SKILL.md) when note writing is within
the authorized task. This skill does not expand the assignment or its permissions.

## Classify the cost

For each candidate, ask: **If deferred, does it cost "add it later" or "redo it
later"?**

| Class | Cost of deferring | Decision to make |
|---|---|---|
| Feature | Add the capability later | Defer when the delivery goal still holds |
| Guarantee | Rearrange existing components or assumptions | Include it or explicitly accept the later redesign |
| Shape | Cheap only if the present implementation leaves room | Defer the capability and constrain the implementation |

A feature adds a capability. A guarantee constrains how existing components work
together: error propagation, ordering, atomicity, or ownership. A guarantee must
hold in the delivered behavior. A shape constraint need not provide the deferred
behavior yet, but must preserve a feasible way to add it.

To detect a guarantee, ask whether it constrains every component, requires changes
at unrelated call sites, reverses a default across existing paths, or is already
assumed downstream. Examine the actual structure; importance or estimated code
size alone does not classify it.

Write a shape constraint as a restriction on form, with its reason. For example,
"Do not couple credential lifetime to a connection handshake; later refresh must
fit the protocol." This preserves an extension without claiming refresh exists.

## Make the cut explicit

Start from the user's confirmed goal, scope, and available requirements. Cite
requirement identifiers when they exist; do not invent a requirements document
or silently add scope. Identify any missing decision that blocks a defensible cut.

The result has three parts:

1. Included work and the behavior that completes it.
2. Deferred work, its concrete later cost, and the observable behavior when the
   deferred case is encountered.
3. Deferred work whose low cost depends on an implementation constraint, with
   that constraint stated explicitly.

For every deferral, explain what makes its cost affordable. If this depends on a
condition, make the condition a shape constraint. State what the chosen scope
does not provide and what would require reconsidering it.

Record only cuts actually considered in `## Alternatives`, with what each would
buy and cost. If no other cut was considered, say so. Do not fabricate a smaller
or larger alternative to make the decision appear tested.

## Failure patterns

- Deferring a structural guarantee because the immediate code change looks small.
- Removing a shape constraint without acknowledging which deferral becomes
  expensive or impossible.
- Citing a document as authority for a deferral it never decided.
- Describing unsupported cases as "not well supported" without an error, limit,
  or other observable outcome.
- Treating an unnamed later phase as an approved scope decision.
