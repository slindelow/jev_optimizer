# Local usage and comparison report · V1

**User outcome.** Let an engineer decide whether a feature helps on their own workload and identify what they paid for.

## Interface

Consume deduplicated events keyed by invocation, dispatch attempt, feature, local workspace ID and host. Track provider/model, request status, actual or estimated charges, token counts when available, duration, cache hit, fallback, outcome and evidence completeness. Return per-session and per-feature totals plus a paired comparison when a baseline exists.

## Behavior

Group using the explicit connection and currency. Count billed attempts even if a feature fails. Keep reservations and estimates visible separately from confirmed charges. Show sample sizes, failed tasks, cache state, skipped runs and the definition of each metric. Compare the same tasks on pinned snapshots with and without the feature. Report missing host costs as unknown. Only claim savings for paired outcomes with comparable accounting.

## Failure and fallback

After a crash, rebuild totals from the durable event ledger. A duplicate delivery cannot count twice. Results from different currencies, scopes or model versions require separate rows. Store locally by default, with no raw source, user prompts, credentials or automatic uploads.

## Acceptance

Use a known ledger with duplicate events, a timed-out paid attempt, a cache hit, one missing host cost, and resumed sessions in two hosts. Assert exact totals and explicit uncertainty. A one-arm run may report cost and runtime but cannot produce a savings percentage.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
