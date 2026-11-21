# Code review triage · Verification

**User outcome.** Point the reviewer toward consequential diff hunks and provide enough context to verify or dismiss a concern.

## Interface

A base and head or explicit working-tree snapshot, changed hunks, nearby contracts, callers and tests. Return ordered hunk references, evidence, suggested checks and reviewed coverage. A confirmed finding includes a reachable condition, observed or source-established consequence, and location.

## Behavior

Collect changes locally and classify by affected behavior. Ask Jev to rank existing hunk IDs or review dimensions. A host reviewer inspects source and independently validates claims before displaying findings as confirmed. Show items reviewed, deferred and omitted by limits. Keep automated checks and their runner status separately visible.

## Failure and fallback

A large or binary diff gives partial coverage. Rebase or edit invalidates stale findings. Insufficient evidence remains a question for the reviewer. Triage cannot approve a merge, post a comment, or classify an omitted hunk as safe.

## Acceptance

Use a diff containing an inconspicuous behavioral regression, a large formatting change, and an unchanged caller that demonstrates impact. Verify the hunk and caller anchors, no confirmed issue for pure formatting, and explicit partial coverage under a tight budget. Track seeded defect recall and unsubstantiated findings against ordinary review.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
