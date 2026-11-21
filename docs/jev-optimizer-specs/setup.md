# Host installation, configuration and status · V1

**User outcome.** Install in either host, try a fixture offline, choose an account and turn on exactly one feature. An engineer installing the second host can reuse the approved connection on the same machine.

| Surface | Proposed entry point | What counts as ready |
|---|---|---|
| Claude Code | Add the GitHub marketplace slindelow/jev_optimizer, install jev-optimizer from jev-tools, open /jev-optimizer:setup. | Installed artifact loads its setup skill. Probe each required lifecycle hook through a fixture before displaying automatic support. |
| Codex | Add the same marketplace via the CLI or configured directory, install jev-optimizer@jev-tools, then invoke its setup skill in desktop or CLI. | Manual invocation succeeds. Report a hook-backed feature as automatic only when the current definition is trusted and active. |

**First run.** Offer offline demo or connect. Display provider, billing account if known, data classes sent by each feature, cap and scope. Discover credential *presence* without displaying values. Prefer an existing connection, otherwise highlight OpenRouter. After selection offer a synthetic live check with estimated maximum spend. Show configured, verified, expired, or disconnected separately from per-host hook readiness. The same controls support status, disable, switch, disconnect and purge local retained evidence.

**State changes.** Persist completed setup atomically. Cancelling a staged provider change leaves the previous connection usable. Local workspace overrides refer to user-approved connections. Hook approvals and host capabilities remain host-specific. Disconnect removes locally held credentials and explains where remote revocation is possible. Externally managed environment values stay under their owner's control.

**Acceptance.** From a clean install in each host, complete the demo with outbound traffic disabled, connect each provider via the [provider contract](providers.md), enable search alone and observe one search result. Install in the second host and verify connection reuse plus separate hook state. On denied hook trust, hook-definition change, failed authentication, cancelled setup, read-only checkout or missing keychain, test status and manual fallback. With no secure credential store offer an environment-backed connection. Never put an API key into a chat prompt or repo file. [Claude Code marketplaces](https://code.claude.com/docs/en/discover-plugins) · [Codex plugin trust](https://developers.openai.com/plugins/build/plugins)
