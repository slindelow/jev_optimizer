# Documentation drift detection · Verification

**User outcome.** Identify published instructions or examples affected by a code change, with a specific source passage for each candidate.

## Interface

Diff snapshot and scoped docs inventory, including README examples, CLI help fixtures and configuration reference. Return source anchor, doc anchor, affected version or audience, and evidence status.

## Behavior

Extract changed public names, defaults, accepted values and behaviors. Find literal references first, then rank paraphrased candidates if needed. Check against the intended release and executable behavior. For a supported example, use the repo’s trusted example runner to verify the claim. Link both sides and propose review. Text edits remain a separate user action.

## Failure and fallback

Ignore historical release notes and versioned docs whose version still supports the old behavior. An intentionally backwards-compatible alias may make a warning unnecessary. Missing docs or a budget-limited scan produces a scope note. Confidence alone cannot establish drift.

## Acceptance

Rename a flag, keep one documented alias, change a default without renaming it, and leave an older version guide intact. Report the broken current example and contradicted default, cite both source and doc lines, and preserve the verified alias and historical guide.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
