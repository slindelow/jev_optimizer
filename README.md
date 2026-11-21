# Jev Optimizer

One GitHub plugin for file routing, skill routing and compression in Claude Code and Codex. Clear matches resolve locally. Jev can rank ambiguous candidates through TypeSafe, OpenRouter or Vercel AI Gateway.

## Install from GitHub

Install Node.js 22.13 or newer and ripgrep. Both must be on the host’s PATH.

| Host | Add the marketplace | Install |
| --- | --- | --- |
| Claude Code | `claude plugin marketplace add slindelow/jev_optimizer` | `claude plugin install jev-optimizer@jev-tools --scope user` |
| Codex | `codex plugin marketplace add https://github.com/slindelow/jev_optimizer.git` | `codex plugin add jev-optimizer@jev-tools` |

Open a new session in your project and ask **“Set up Jev Optimizer for file routing, skill routing and compression in this repository.”** The setup skill connects your chosen provider and configures feature permissions and a monthly spending cap. Both hosts share provider credentials and the cap on the same machine. Each repository has its own permissions.

Claude conversation compaction requires function hooks. Enable `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in Claude’s user settings. If you already use standalone fast-jev-compaction, choose one compaction handler during setup. In Codex, review the installed handlers in the hooks panel and trust the ones you want to run.

## What ordinary prompts do

| Feature | Example | What reaches the agent |
| --- | --- | --- |
| File routing | “Where does checkout recalculate shipping after an address change?” | Candidate files and line numbers from this repository. Jev can rerank the shortlist. |
| Skill routing | “Help debug keyboard focus on the checkout button.” | A suggested skill or alternatives. Explicit skill requests and configured preferences take priority. |
| Claude conversation compaction | Continue a long coding conversation | At a compaction event, Jev can score older calls and results. The hook shortens history while preserving user instructions and recent messages. Claude can use its native summary on fallback. |
| Codex file-result compression | “Find where the shipping module handles address changes.” | For an eligible large result, the plugin prepares selected passages. The agent can retrieve those passages or recover the original. Codex owns its native reads and conversation compactor. |

A greeting passes through. The existing test matcher is available as a separate opt-in feature. See [compaction behavior](docs/compaction.md) for host-specific triggers and limits.

## Configuration

The setup skill runs `bin/jev.mjs` from the plugin with the working directory set to your project. For scripted setup, pass JSON on stdin to `configure --json`. This example enables the three features and applies a monthly provider cap of US$1.

```json
{
  "provider": "typesafe",
  "enabled": ["search", "route", "compact"],
  "auto": ["search", "route", "compact"],
  "remote": ["search", "route", "compact"],
  "conversationCompaction": true,
  "fileResultCompression": true,
  "capUsd": 1
}
```

Search can send the task and candidate source excerpts. Routing can send the task, skill names and descriptions. Claude conversation compaction can send bounded conversation text and tool inputs. Codex file-result compression can send candidate file passages. Enable each for repositories where those inputs can go to your provider. Removing remote compact permission or changing providers clears the broader compression permissions. Leave `remote` empty for local operation. Set `preferredSkills` to give priority to trusted skill names, including namespaced IDs.

## Provider setup

| Provider | Connection |
|---|---|
| OpenRouter | Browser sign-in with `login openrouter`, interactive SSH with `login openrouter --headless`, or an existing OPENROUTER_API_KEY. |
| Vercel AI Gateway | AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN from the configured environment. |
| TypeSafe | On macOS, `login typesafe` opens a masked dialog and saves the key in the login Keychain. All supported hosts can also use TYPESAFE_API_KEY from the environment. |

Select a provider, permitted features and a positive monthly USD cap in `configure --json`. For example, `{"provider":"openrouter","enabled":["search"],"remote":["search"],"capUsd":1}` allows remote ranking for search. This sends a bounded query and candidate descriptions or code excerpts directly to the chosen provider. Treat a workspace with sensitive source as local-only unless those excerpts may leave the machine. Automated filtering cannot recognize every secret. Provider errors leave local features available. Report shows outstanding reservations as well as confirmed or estimated charges. There is no cross-provider retry.

Use `verify` for a paid synthetic decision, `status` for connection and recent hook activity, and `disconnect` to disable this workspace's provider. `report` separates recorded activity from provider usage. Set `auto` to choose which features may run on ordinary prompts or host events. Upgrades preserve earlier prefix-only settings until you explicitly set `auto` again. Each enabled remote prompt feature may send its bounded input on a matching ordinary prompt. Keep `remote` empty for local processing.

## Development

The [build evidence](docs/build-evidence.md) records the host and provider checks and remaining release gates.

`npm test` runs local fixtures. `npm run demo` exercises the entry point against the example. See [prior-art and reuse decisions](docs/prior-art.md) for the design sources and [the release plan](docs/jev-optimizer-v1-plan.md) for future features.
