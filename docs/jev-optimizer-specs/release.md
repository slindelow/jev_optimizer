# Engineering review and release gates

The reviewer should be able to install the distributed package, reproduce a result in a clean sample repository, and see exactly where a recommendation came from. These are proposed gates for future builds. A release records evidence against each gate for its own features.

## Build and compatibility

- Use one shared TypeScript decision engine, two thin host adapters, and independent feature entry points. Host differences belong in capability checks. Provider request formats belong in the three provider adapters. Use a lockfile, reproducible package contents and an allowlist of distributed files. Validate both packaged manifests and inspect the archive for fixtures, raw traces and credentials accidentally included.
- Establish the minimum supported host versions from successful installs. Test the minimum and current supported version. Record OS, architecture, host, build and enabled hooks. Advertise each platform only after its secure credential storage, path handling, install, and removal have passed there. Start CI with macOS and Linux. A clean uninstall should stop hook invocations while preserving only data the user chose to retain.
- Test the packaged release through each host’s public installation path. Exercise one manual feature, one available hook, disabling it, upgrading from the preceding release when one exists, and recovering from an incompatible config. Include Codex desktop and CLI, untrusted hooks and denied network access. Verify no feature changes the user's host model or bypasses approval.

## How to evaluate an optimization

1. Freeze a labeled fixture set and reserve separate held-out tasks before choosing thresholds. Include a second repo with different naming conventions, plausible distractors, absent answers, stale files and tool failures. Keep training and test variants of the same underlying task together. Record snapshot, host, provider/model, question version and baseline settings.
2. Compare native host behavior, local deterministic ranking, and local ranking with Jev where applicable. Pair runs on the same task and initial snapshot. Count retries, wrong confident answers, omissions, and setup costs. Publish absolute counts and denominators, median and p95 latency, paid input and actual or estimated cost, plus task completion and feature-specific metrics. Report uncertainty and run order. Avoid a universal percentage based on a small demo.
3. Promote an automatic feature only if it passes all critical fixtures and improves its declared primary metric on held-out paired tasks without a measured drop in task completion. Use a paired 95% interval on the primary improvement; when evidence is inconclusive keep it manual or in preview. For example, search uses top-five relevant-location recall, while compaction uses context reduction conditional on successful continuation and exact evidence recovery. Record any accepted tradeoff before looking at held-out results.
4. Proposed starting budgets for foreground automatic *advisory* hooks are 100 ms p95 for local work on the reference repo and a one-second total deadline when calling Jev. Fall back on expiry. Measure cold and warm runs separately. Explicit scans, browser execution and native compaction have separate measured budgets; they must support cancellation. Never weaken a mandatory host denial to meet a latency target.

## Release-blocking observations

| Risk | Evidence required from the build |
|---|---|
| A provider or account receives unintended data | Intercept outbound requests in fixture tests. Assert exact destination, allowed fields and no credentials in payloads or logs. Exercise excluded files, secret-bearing snippets, malicious repo text and paths escaping via symlinks. A disconnected demo makes zero requests. |
| A host or provider works only on paper | Record each of the six host/provider combinations through a feature entry point with deterministic fixtures. Perform a real install and end-to-end result in each host. Exercise at least one bounded live decision per provider. Publish the combinations tested live separately from replayed tests and record actual charges. |
| Cost, concurrent state or fallback is wrong | Make two hosts contend for the final budget. Interrupt at reservation, dispatch and settlement. Check one durable charge or conservative reservation per attempt, no negative available budget and no silent provider switch. Exercise rate limits and offline mode. |
| The plugin claims work it cannot prove | Deliberately feed it a stale reference, an invented ID, a skipped assertion, a missing receipt, an inaccessible hook and a recorded demo. Verify the corresponding uncertainty or failure in the user-facing result. |
| Optional functionality interferes with ordinary work | Keep all features off, enable each alone, then enable them together. Verify bounded context growth, predictable hook ordering, no recursion from plugin-owned actions, one decision per logical event, and independent disable controls. |
| A regression reaches existing installs | Save sanitized known-good host outputs. Compare structure, evidence state and scope after upgrades. Verify clean disable, fallback to native behavior, readable diagnostics, store compatibility, and rollback using the previous supported package. |

## Reviewer evidence

Attach the versioned install transcript, compatibility matrix, fixture manifest, provider contract results, paired eval report, budget ledger summary and known limitations. Flag missing signals explicitly. Stop release for credential exposure, unauthorized action, cross-workspace evidence disclosure, invented verification, or corruption of host conversation state. A fresh reviewer should be able to reproduce a failing fixture without a provider account and trace the result to the relevant source location.
