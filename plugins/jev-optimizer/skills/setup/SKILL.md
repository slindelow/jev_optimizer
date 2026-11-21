---
name: setup
description: Set up Jev Optimizer, inspect account and hook status, or disconnect an account on explicit request.
---

When the user chooses a direct TypeSafe key on macOS, run the plugin's `login typesafe` command and wait for the native masked dialog. The user enters the key there. Confirm only the connection status. Provider selection and permission for live spend are separate settings.

Find bin/jev.mjs two directories above this skill. Run it with Node 22.13+ and the user's repo as the working directory. Start with status and offer the offline demo. Offer OpenRouter browser sign-in, Vercel AI Gateway (key or OIDC), and TypeSafe. Never request secrets in chat. Use the host environment or private credentials store.

For the combined plugin, set `enabled` and `auto` to `["search","route","compact"]` in the current project. For live Jev, record the user's chosen provider, monthly cap and approved `remote` features. Search can send prompt and code excerpts. Routing can send prompt and skill descriptions. Ask whether conversation text and tool inputs may go to the chosen provider for Claude, and whether source passages may go for Codex file-result compression. Set `conversationCompaction` and `fileResultCompression` individually to match the answer. Optional `preferredSkills` is an ordered list of trusted skill IDs. Local-only operation leaves `remote` empty. Confirm the saved choices with status.

On Claude, check for other enabled conversation compactors, including fast-jev-compaction. Ask which should own the session before disabling another plugin. Store the provider credential through the shared connection flow. Do not copy it into project files. On Codex the plugin prepares its own search result under the compact permission and exposes the selected passage and recovery through its MCP tools.

Check host hook registration. In Codex review the installed plugin's hooks in `/hooks` and trust the selected handlers. In Claude check the installed version and the function-hook setting described in docs/compaction.md. Test prompt hooks with an ordinary code question about the user's repo and check for a delivered candidate. A greeting should pass through. Compaction runs at its own lifecycle event. A previous hook observation is historical.

Offer to reuse an existing connection when the second host is installed. Use report to inspect usage and disconnect to disable the connection in this repo. Forgetting a stored credential affects every workspace using it.
