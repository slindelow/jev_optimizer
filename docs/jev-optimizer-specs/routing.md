# Skill and tool routing · V1

**User outcome.** Choose a callable skill or tool for a task while preserving explicit user selections and host permissions.

## Interface

Task text, named skill if any, current host inventory with stable qualified IDs, source, availability and short descriptions, plus trusted repo preferences. Return one eligible ID or abstain, alternatives on ambiguity, selection method, and the descriptions or rules used.

## Behavior

Resolve explicit qualified names locally. A missing explicitly requested tool produces an unavailable result and optional alternatives. Filter disabled, unreachable and incompatible tools before ranking. Apply deterministic preferences first. For competing candidates, send only relevant descriptions and a bounded task excerpt to Jev. Pair selection with a question about whether any option fits. The host loads the selected definition on demand and rechecks availability before use.

## Failure and fallback

If the host exposes only a static inventory, label suggestions unverified and require host resolution before loading. On a name collision show qualified alternatives. A timeout returns the local shortlist. A changed inventory invalidates cached routes.

## Acceptance

Give both hosts a similarly named global and repo skill, a disabled exact match, an explicit qualified request, and an unrelated task. Assert eligible IDs, abstention for no fit, zero calls for explicit or unambiguous selections, and zero skill execution from routing alone. Compare top-one accuracy and wrong confident selections against lexical routing.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
