# Browser test selection and verification · Verification

**User outcome.** Choose the existing browser flow that exercises a change, then show what its runner actually observed.

## Interface

Acceptance criterion, allowed test target, discovered flow IDs, browser capabilities and optional approved DOM or image input. Return selected flow, executed steps, assertion result, browser/viewport, run ID and artifact references. Selection-only and executed states are separate.

## Behavior

Choose from repo-owned test flows with bounded inputs. Execute through the host-authorized browser runner in the configured test environment. Prefer semantic locators and deterministic assertions. Visual matching may suggest where to inspect; a visual-only observation carries the screenshot reference and requires a declared image comparison or human review for a visual verdict. Screenshots leave the machine only when explicitly enabled for that connection and supported by the route.

## Failure and fallback

Fail visibly on wrong origin, unavailable runner, ambiguous selector, skipped assertion, masked content, or unsupported image input. Preserve the first failure and all authorized retry outcomes. Record contradictions such as a passing retry after a failure as flaky. Limit waits using runner timeouts and keep captured session material out of logs.

## Acceptance

With a controlled checkout fixture, select a rate, change address, and assert the previous choice clears. Run against correct and deliberately broken behavior. Verify trace evidence, a failed-then-passed run, a redirected origin and an unavailable browser. Selecting a flow without running it must never emit a pass.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
