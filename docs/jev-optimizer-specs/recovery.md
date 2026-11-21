# Exact evidence recovery and handoff · Continuity

**User outcome.** Retrieve the exact error or tool result that informed a previous decision, including after a host switch explicitly authorized for the same workspace.

## Interface

Capture selected tool output with workspace identity, session, capture time, producing action, content digest, original encoding and access scope. Return an opaque reference, a bounded preview and provenance. Retrieval accepts reference or scoped query and returns a byte range, integrity status, revision and capture time.

## Behavior

Filter eligible outputs before capture. Write payload and metadata durably before issuing a recoverable reference. Retrieval by ID is deterministic. Semantic retrieval is optional and operates on approved previews. Grant cross-session access only through an explicit same-workspace handoff naming the selected evidence. Recheck policy at read time. Label resolved evidence historical if the workspace changed.

## Failure and fallback

Excluded content cannot be archived. For redacted captures record which portion was removed and mark the result redacted. Expiry, deletion, missing permission and corruption have distinct outcomes; never reconstruct missing bytes from model memory. Enforce the shared retention budget and support purge.

## Acceptance

Capture a multiline error with whitespace, compact, and recover the exact eligible bytes. Repeat in a second host after handoff. Deny access from a different checkout or unrelated session, even with a copied reference. Exercise tamper, expiry and permission revocation. Confirm interrupted writes never produce a usable reference.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
