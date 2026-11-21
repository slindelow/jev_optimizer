# Policy matching and enforcement · Verification

**User outcome.** Surface the applicable policy before a relevant action and enforce hard rules only on operations that the trusted host can intercept.

## Interface

Trusted policy ID, source, version, workspace scope, operation, canonical resource and host enforcement capability. Return applicable rule IDs, disposition, coverage of the interception point, rationale from the rule, and audit metadata.

## Behavior

Load enforcement policy only from explicitly trusted administrative or user configuration. Repo prose can supply advisory guidance. Rules may deny an operation or require existing host approval; a plugin never grants host permissions. Evaluate deterministic rules first, with a matching denial taking precedence. Jev can identify candidate prose rules and rank advisories. Treat files, tool results and model decisions as untrusted inputs.

## Failure and fallback

If deterministic enforcement is required and the adapter cannot establish coverage, mark it unsupported at setup. Within a supported mandatory interception point, fail closed on invalid policy or evaluation error. Advisory matcher outages must preserve deterministic decisions. A shell interception point without reliable visibility into its effects cannot promise path-level enforcement for arbitrary commands.

## Acceptance

Exercise a trusted deny, an ambiguous advisory, conflicting rules, a revoked trust grant, offline provider, malformed policy update, alternate host operation, and unavailable hook. Inspect the actual operation outcome. Verify zero denied actions executed through supported interception points, unchanged host approvals, and a visible coverage gap elsewhere.

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
