# File and symbol search · V1

**User outcome.** Return a small set of openable locations for questions expressed in the engineer’s own words.

## Interface

Query, allowed workspace roots, optional path/language filters and result limit. Return ranked repo-relative paths, line ranges, symbols when known, short verbatim excerpts, snapshot digests, and the search methods and limits used.

## Behavior

Resolve literal paths, identifiers and exact text locally. For a behavioral query, use filename, text, and available symbol/reference indexes to generate candidates. Rank locally, then optionally rerank an ambiguous shortlist with Jev. Cap the first page at five locations by default. Reopen each chosen excerpt before returning it. Stable ties use path then line number.

## Failure and fallback

Report the portion searched when files, language indexes or candidate limits restrict coverage. Recheck changed files once; omit stale results with a reason. Unknown model IDs cannot add new paths. Binary, generated/vendor and ignored content is excluded by default; explicit inclusion still obeys workspace access rules.

## Acceptance

Test exact path, renamed function, duplicate identifiers in two packages, non-ASCII paths, stale index, a symlink outside the repo and a behavior absent from all candidates. Check resolved excerpts byte-for-byte. Compare candidate recall before ranking and top-five recall after ranking so a retrieval failure stays visible.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
