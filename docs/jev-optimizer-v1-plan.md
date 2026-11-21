# Jev Optimizer release plan

The [engineering specifications](jev-optimizer-specs/README.md) define each tool’s behavior and acceptance tests. The [release review](jev-optimizer-specs/release.md) lists the evidence required from a build.

Ship an independently configurable toolkit for Claude Code and Codex. Include OpenRouter, Vercel AI Gateway, and direct TypeSafe access in the first public release. The selected provider bills the engineer or their team. Both hosts use the same local engine and connection settings.

## Installation

Publish host-compatible marketplace entries in the slindelow/jev_optimizer GitHub repository. Use `jev-optimizer` as the plugin name and `jev-tools` as the proposed marketplace name. The flows below are release targets.

| Step | Claude Code | Codex |
|---|---|---|
| Install | Add `slindelow/jev_optimizer` in the plugin marketplace, then select Jev Optimizer and install for the user. The in-session equivalents are `/plugin marketplace add slindelow/jev_optimizer` and `/plugin install jev-optimizer@jev-tools`. | Add the same GitHub source, then select Jev Optimizer in the desktop Plugins directory. The CLI equivalents are `codex plugin marketplace add slindelow/jev_optimizer` and `codex plugin add jev-optimizer@jev-tools`. |
| Open setup | Launch the bundled `/jev-optimizer:setup` skill. | Select the plugin’s setup skill or ask “Set up Jev Optimizer for this repo.” |
| Enable automation | Report whether the installed host has loaded the required hooks. Offer manual use when hooks are unavailable. | Keep manual features available immediately. When an engineer chooses an automatic feature, show which bundled hooks require review in Codex. Mark it active only when trusted and available. |

[Claude Code plugin installation](https://code.claude.com/docs/en/discover-plugins) · [Codex packaging and hook trust](https://developers.openai.com/plugins/build/plugins)

## First run in either host

1. Offer **Try a local example** and **Connect a provider**. The example uses a bundled fixture with recorded decisions, labeled as a demo, with zero provider calls.
2. Show three connection choices. Offer an existing configured connection first. On a fresh machine, highlight OpenRouter browser sign-in. Display the billing provider and the data each selected feature would send before enabling live use.
3. Save the credential in the OS credential store or reference a provider-supported environment variable. Accept manually supplied credentials only through a secure local input. Keep secrets out of chat, logs, and version control. Keep provider choice and connection references on the machine, with an optional local per-repo override. Installing the second host offers to reuse the existing connection while preserving that host’s hook approvals.
4. Choose the enabled features, manual or automatic invocation, and a spending cap. An optional live connection check sends a small synthetic question to the selected model and verifies a typed answer. Clearly distinguish a configured credential from a verified connection.
5. Show a status view with the selected provider and model, credential source, budget, enabled features, and hook readiness. Include controls to switch provider, disconnect, or rerun setup. On authentication failure, provider outage, or exhausted budget, explain the condition and keep the manual local features available. A change of billing provider or data destination requires an explicit selection.

| Provider | Connection and billing |
|---|---|
| OpenRouter | Browser sign-in through OAuth PKCE. Offer an app-specific spending limit. Support its headless authorization flow for SSH and existing OpenRouter credentials for CI. Use the Decisions API and bill the selected OpenRouter workspace. [Sign-in](https://openrouter.ai/docs/guides/overview/auth/oauth) · [Jev support](https://openrouter.ai/typesafe/jev-1.14-20261014) |
| Vercel AI Gateway | Use an existing Gateway API key locally or in CI, or a Vercel OIDC token supplied by a configured environment. Route Jev calls and usage to the selected Vercel team. [Authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok) · [Jev support](https://vercel.com/changelog/typesafe-ais-jev-1-14-is-now-available-on-ai-gateway) |
| TypeSafe | Connect an existing TypeSafe credential, including `TYPESAFE_API_KEY`. Send decisions directly to TypeSafe and bill that account. [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart) |

## Release sequence

- **V1.** Both host packages, all three provider adapters, independent feature switches, and a local usage and comparison report. Ship skill routing, file and symbol search, and feature-to-test matching. The first demo finds a plausible checkout test and shows which requested behavior lacks an assertion. All three adapters must return the same application-level decision types from their respective APIs.
- **Context and continuity.** Reuse the Fast Jev Compaction library where compatible in Claude Code. Offer checkpoints around native Codex compaction, exact evidence recovery, and repeated-work detection. [Fast Jev Compaction](https://github.com/tamaratran/fast-jev-compaction) · [Codex hooks](https://developers.openai.com/codex/hooks)
- **Review and verification.** Add diff triage, browser test selection and verification, documentation drift detection, and policy matching. Deterministic policy checks own hard decisions. Test and browser runners supply execution evidence.

## Acceptance

- Exercise all six host/provider combinations from setup through one feature result using fixtures. Run a clean marketplace install in each host, then one pre-budgeted live synthetic decision per provider through the shared engine. Record the selected model, actual usage, and cost.
- Verify browser sign-in, cancellation, expired credentials, disconnect, budget exhaustion, and provider switching. Confirm a fresh install can run the offline demo with zero network requests. Confirm the second host reuses the connection and reports its own hook status.
- Verify that selecting one feature only activates that feature. Run a labeled example through local search alone and through Jev-assisted ranking. Measure relevant results, correctly identified coverage gaps, latency, and cost. Identify missing evidence explicitly and distinguish a suggested test from a passing assertion.
