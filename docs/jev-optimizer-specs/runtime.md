# Shared runtime contract

**Owner and boundary.** The host adapter supplies the active user, workspace root, working directory, session identity, trust state, and callable capabilities. A feature receives a read-only snapshot plus only the host operations it needs. The decision client accepts a bounded question and a closed set of candidate IDs. The only component that can send provider traffic is the provider adapter behind the budget and disclosure checks. Host permissions apply to every action.

## Request and result

Version 1 requests carry a feature ID, invocation ID, mode (manual or automatic), workspace identity, input, cancellation signal and deadline. Resolve relative paths against the authorized root. Bind source references to repo-relative path, content digest, line range and optional symbol. Use the actual working tree, including unsaved-to-Git changes on disk. Host-only editor buffers require an explicit revision from the host.

Every result records a schema version, feature ID, outcome, evidence references, and any limitations. Outcomes are completed, partial, unavailable, denied or cancelled. Distinguish a local result, recorded demo, provider inference and runner observation. A model choice may select an existing ID or abstain. Reject unknown IDs, non-finite values, missing questions and incompatible response types. Keep source excerpts typed as untrusted data, including text from tools or model providers. Never interpolate them into executable commands, privileged hook instructions, or authorization decisions.

## Execution and storage

- Local eligibility and exact matches run first. Use a single decision batch for independent questions over the same data, within provider limits. Apply per-feature excerpt and time budgets before dispatch. Fetch expensive content on demand.
- Local configuration starts with features off. An explicit invocation can preview one feature. The user's selected provider and permitted payload types bound any remote call. Filter ignored and secret-bearing files, resolve symlinks and check path containment before reading. Revalidate on open. Use synthetic examples for setup. Host permission, workspace trust and configured exclusions apply equally to caches and history.
- Keep user-scoped connection references separate from local per-workspace settings. Never accept credential destinations, endpoints, spending increases or permission grants from an untrusted checkout. Resolve built-in provider endpoints from the selected adapter. Avoid automatic cross-provider retries.
- Use transactional local storage, e.g. SQLite, for budget reservations, run IDs and evidence metadata shared by both hosts. Bind cache keys to workspace, inputs, content revisions, rule and inventory versions, algorithm, provider/model version and question version as applicable. Use restrictive user-only storage permissions. Persist raw output only when a feature requires recovery and the user has enabled local retention.
- Proposed recovery defaults are seven days and 100 MiB per workspace, with oldest unpinned entries removed first. If active pins cannot fit, decline new compaction and explain storage pressure. Purge, disable, expiry, and workspace removal must cover payloads and lookup indices. Usage records contain counts and IDs with no prompts or snippets.
- Store schema versions and migrate transactionally. A newer incompatible store disables writes from older clients. A failed migration preserves the original. A failed or untrusted optional hook yields control to the host. Only an explicitly configured deterministic enforcement hook may veto an action.

## Verification

Simulate two hosts reserving the final available budget, changed worktree content during ranking, cancellation during dispatch, path aliases outside the workspace, an older client opening a newer store, a disabled module and a full disk. Verify bounded runtime, atomic state, explicit result status, and absence of content in logs. Defaults for timing and quality promotion are defined in [release review](release.md).
