# Jev Optimizer engineering specifications

Proposed specifications for review, November 20, 2026. The [release plan](../jev-optimizer-v1-plan.md) sets the scope. Each link below leads to an independently testable capability. The install names, interfaces, performance gates, and storage defaults are design decisions to validate against the first implementation.

| Release | Capability | Implementation dependency |
|---|---|---|
| V1 | [Host setup and configuration](setup.md) | Shared runtime, provider adapters |
| V1 | [OpenRouter, Vercel AI Gateway, TypeSafe](providers.md) | Shared runtime |
| V1 | [Skill and tool routing](routing.md) | Session capability inventory |
| V1 | [File and symbol search](search.md) | Local workspace reader |
| V1 | [Feature-to-test matching](test-matching.md) | Search and runner evidence |
| V1 | [Usage and comparison report](report.md) | Runtime decision events |
| Continuity | [Exact evidence recovery and handoff](recovery.md) | Local evidence store |
| Continuity | [Context compaction](compaction.md) | Evidence recovery and host capability check |
| Continuity | [Repeated-work detection](repeat.md) | Evidence recovery and dependency fingerprints |
| Verification | [Code review triage](review.md) | Search and diff reader |
| Verification | [Browser testing](browser.md) | Host test runner and evidence |
| Verification | [Documentation drift](docs-drift.md) | Search and diff reader |
| Verification | [Policy enforcement](policy.md) | Host capability check and trusted policy loader |

Start with the [shared runtime contract](runtime.md). Build a vertical slice from a fresh install to a search result with a real path and line, then add each capability behind its switch. Use the [release review](release.md) for the evidence required to ship. Runtime code and per-feature tests can follow the same boundaries. Keep a single local process invocation and embedded storage until measurements justify a daemon or service.

The reference scenario is an address change after a shipping rate was selected. Search locates the state transition, the matcher checks for the precise assertion, and the browser runner can later reproduce it. Each tool also works on its own through a manual entry point.

Two published practices inform the design. Cursor uses on-demand references to recover details while keeping context small. OpenAI describes verifying architecture and behavior with executable checks. Here those ideas translate into revision-bound evidence and a release gate exercised through each host. [Cursor engineering](https://cursor.com/blog/dynamic-context-discovery) · [OpenAI engineering](https://openai.com/index/harness-engineering/)
