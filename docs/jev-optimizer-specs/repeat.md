# Repeated-work detection · Continuity

**User outcome.** Show prior evidence when an agent is about to repeat a deterministic read against the same inputs.

## Interface

Scoped action fingerprint, resolved arguments, working directory, relevant file and config digests, tool version and prior evidence reference. Return previous observation, age, dependency match and a rerun option.

## Behavior

Normalize only whitelisted, read-only tool operations with known dependencies, such as reading the same file range. Reuse exact observations only when all dependencies are unchanged. For tests or commands with clocks, network, external state or unknown dependencies, a repeated command may prompt a suggestion, while execution remains available. Use deterministic comparison locally.

## Failure and fallback

Hash file contents rather than relying on modification time or Git HEAD. Exclude state-changing, interactive and sensitive operations. On a missing dependency fingerprint, expired evidence, ambiguity or an explicit rerun request, allow the requested action. A previous failure is historical evidence.

## Acceptance

Demonstrate one avoided duplicate file read, a read after a same-size edit, a changed working directory, an untracked fixture change and a repeated flaky test. Assert zero suppressed writes, zero blocked explicit reruns, and zero provider requests for exact duplicates.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
