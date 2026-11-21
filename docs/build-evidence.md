# Jev Optimizer build evidence

## Marketplace packaging in 0.3.1

Both marketplaces install `plugins/jev-optimizer/`. Codex can refresh the marketplace's Git index, reflogs and installation metadata independently of the installed hooks. Version 0.3.0 used the marketplace root as the plugin source, so a refresh could invalidate a previously approved hook hash. The packaging regression test checks both manifests use the same dedicated subtree.

## Combined plugin in 0.3.0

The release candidate was installed into disposable Claude Code and Codex profiles. Ordinary prompts in a synthetic shipping project reached both hosts with file and skill suggestions. The host integration tests used local model-protocol servers so the next model input could be inspected. TypeSafe Jev decisions were live.

- Claude reached native automatic compaction on a controlled context-usage report. The next request omitted an old Read result and retained the user's instruction. The bundled hook reported a 95% character reduction on this fixture.
- Codex received a reference to a selected source passage of 1,068 bytes from a 12,845-byte file. Both file tools were discovered by the Codex app server. Reading the passage returned the implementation, and concatenating the recovery pages reproduced the original text exactly.
- The three provider adapters were separately exercised on both installed clients with synthetic HTTP responses. These adapter checks do not establish live availability of all three providers.

To repeat the public marketplace installation checks on a development machine with both clients installed, run `node scripts/host-smoke.mjs --github`. It uses new configurations and synthetic credentials and exercises the installed entry points.

## Automatic hooks in 0.2.0

On November 20, 2026, Claude Code 2.1.329 and Codex 0.164.0 each sent three ordinary coding prompts and one conversational control to a local request recorder. Each host included file suggestions, a skill selection or alternatives, and test candidates in its respective coding request. Each conversational control passed through with zero plugin calls. Codex loaded its hooks from the marketplace and verified their trust hashes.

The signed-in Codex account then attempted three public Python packaging fixes in each mode using GPT-6.1 Terra with medium effort. All six hook-enabled trials received a result, and all three live trials received a TypeSafe Jev decision. The Claude account reached its workspace usage cap before coding began.

| Codex mode | Complete fixes | Total host tokens, including cache reads | Median seconds | Estimated API-equivalent USD per complete fix |
|---|---:|---:|---:|---:|
| Native | 2/3 | 603,245 | 52.7 | 0.0476 |
| Local hooks | 2/3 | 645,643 | 68.0 | 0.0479 |
| Live Jev hooks | 2/3 | 647,769 | 47.2 | 0.0483 |

Both equipped search trials opened the suggested parser implementation. The live routing trial opened the normalization skill. Both equipped matching trials ran the suggested specifier suite. Every mode passed the parsing and normalization tasks and missed a hidden constructor behavior on the third task. The study reused one known public bug per feature, including the retrieval case used during development. These observations establish delivery and show individual outcomes. Broader performance gains remain unproven.

Separate compaction exercises used the installed hosts with a scripted local model endpoint. In an active Claude session a real Read result fell from 15,103 characters to a 192-character recovery notice, and the original text was recoverable. The local hook avoided the host summary request. On the same public example, live Jev delegated to native compaction. Codex ran its own compaction and included the plugin's changed-file context in the next model request. The coding trials did not measure compaction. See [compaction behavior and scope](compaction.md).

Run `npm test` for the 32 Node checks and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .` for the four native Claude module tests. Both suites passed. The coding benchmark froze its prompt-hook implementation before the final compaction recovery and fallback-reporting changes.

## 0.1.0 local build

Local release candidate verified on November 20, 2026, on macOS arm64 with Node 26.5.0, ripgrep 15.2.0, Claude Code 2.1.329 and Codex CLI 0.164.0.

| Check | Observed result |
|---|---|
| `npm test` | All 22 tests passed. The CLI observed a passing native assertion, then reported the targeted failure after the fixture's behavior changed. Tests also exercised skipped and stale evidence, credential exclusions, cancellation, workspace scoping and cross-process reservations. |
| `node scripts/host-smoke.mjs` | Claude Code and Codex each installed the marketplace plugin into a fresh disposable configuration. The CLI inside each installed copy completed the local demo. Routing reached the correct adapter for each of the six host/provider combinations using intercepted HTTP and synthetic credentials. |
| Claude plugin validation | The plugin manifest passed strict validation. Both native marketplace installers accepted their manifests. |
| Independent code review | A separate reviewer inspected the implementation. Follow-up fixes covered OAuth cancellation, scanner deadlines, evidence freshness and revocation, and case-specific assertion verification. The reviewer accepted the final fixes within the trusted local Node test scope. |

The offline matrix checks provider request construction and answer handling. Live identity, billing, remote response compatibility and real OS credential-store persistence still require an authorized account per provider. Paid provider spend for this build was $0. Host installs used CLI workflows. Interactive desktop onboarding and hook-trust dialogs still need hands-on verification. Held-out comparative efficacy, token savings, and the minimum supported host/runtime versions have not been established.

The release uses native JavaScript ES modules, Node's SQLite binding and ripgrep. It has no npm runtime dependencies. Manual test verification currently supports selected, trusted JavaScript Node tests using recognized assertions. The observation binds to the selected case, assertion line and test-file revision. Dependencies and environment state are outside that revision. Hook outcomes are historical and expire after five minutes; retrieval rechecks current feature settings and eligible source digests. Local and configured comparisons report timing and usage with snapshot uncertainty.

The [prior-art research](prior-art.md) covers each example from the video. The [release plan](jev-optimizer-v1-plan.md) and [feature specifications](jev-optimizer-specs/README.md) identify the remaining continuity and verification work.
