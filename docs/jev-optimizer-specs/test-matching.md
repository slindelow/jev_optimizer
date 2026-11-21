# Feature-to-test matching · V1

**User outcome.** Show which part of a requested behavior has a relevant assertion and which part still needs verification.

## Interface

Receive explicit acceptance criteria or a host-proposed decomposition linked to the request, plus repo snapshot and optional runner artifacts. Return one row per criterion with candidate tests, assertion source, setup evidence, execution status, revision and search limitations.

## Behavior

Use test discovery, names, fixtures, imports and the exercised call path to locate candidates. Evaluate precondition, action and expected observation separately. A static match can be suggested or source-supported. Assign a verified pass or failure only to an observed run with matching revision, case identity and evidence that the relevant assertion executed. When the runner proves only that a file or suite passed, attach that fact and leave the criterion unverified. Execution goes through the configured host runner with its normal permissions.

## Failure and fallback

Distinguish no candidate in the searched scope from insufficient evidence, unsupported test format, skipped assertions and a failed runner. A timeout or dirty-tree change cannot inherit a previous pass. Preserve parameterized case IDs and conditions on assertions.

## Acceptance

Fixture A renders the initial shipping rate. Fixture B changes the address after rate selection and checks the reset. A alone must leave the reset uncovered in the fixture; B without a run must stay source-supported. Exercise B as passed, skipped, failed, and conditionally bypassed. A green sibling or stale run must never verify B. Evaluate criterion-level precision and uncovered-behavior recall.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
