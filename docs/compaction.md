# Compaction in Claude Code and Codex

Enable `compact` in the workspace’s `enabled` and `auto` lists. Select a provider, allow remote `compact` decisions and set a provider spending cap for Jev-assisted compression.

## Claude Code

The Claude Code function-hook runtime loads `hooks/compact.ts`. Enable function hooks with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and start a new session. If the standalone `fast-jev-compaction` plugin is also enabled, Jev Optimizer delegates compaction to that plugin.

With `conversationCompaction: true` and remote `compact` enabled, the bundled upstream algorithm sends bounded conversation text and tool inputs to the configured Jev provider. Each tool output is represented by its status and character count. Jev decides which older tool calls and results to keep. An obsolete call can be removed with its result, or the result can be shortened while preserving the call. The first message, the newest six messages and user and assistant text are preserved. The hook applies a decision only when it saves at least 25% of visible characters. Unsupported transcript shapes, explicit compaction instructions and provider failures delegate to Claude. Conversation mode does not archive discarded tool outputs. [Upstream algorithm and license](../vendor/fast-jev-compaction/NOTICE.md)

In interactive Claude Code the turn-complete hook requests compaction when the host reports at least 60% context usage. In SDK sessions that cannot initiate compaction from this hook, Claude schedules the compaction boundary. Both modes use the same replacement hook when Claude supplies a supported transcript.

Without conversation-mode consent, the existing file-read archive mode remains available. Local mode selects older eligible read outputs. Adding `compact` to `remote` permits sending a bounded current goal, eligible relative paths and read lengths to the configured provider. Jev selects reads to replace using those metadata. File bodies stay local. A plan must offer at least 25% estimated visible-character reduction after allowing for recovery notices.

In archive mode, the plugin stores and verifies the exact earlier result in the workspace-scoped private settings database. Each workspace has a 16 MiB archive ceiling. An entry is recoverable while the source remains an eligible text file. Later edits to eligible files preserve access to the historical read. Deleted, ignored or newly sensitive sources suppress recovery. `node <plugin>/bin/compact.mjs purge` discards the workspace's entries. `node <plugin>/bin/compact.mjs recover <id>` returns a recoverable entry.

In a controlled Claude 2.1.329 host replay the next request in the same process contained the recovery reference and retained the original user constraint. A separate resume in a new process restored the original read. Treat reductions as applying to the active conversation; cross-process persistence can differ.

## Codex

With `fileResultCompression: true`, an ordinary file-search prompt can prepare a passage from the top eligible file of at least 4096 bytes. Local search proposes up to eight bounded passages. If remote compaction is enabled, the chosen provider receives the task and passages and selects one or abstains. Codex receives the available file locations and a reference for the plugin's `prepared_file` tool. The `recover_file` tool can return the archived original while its source remains eligible. This applies to the plugin’s own results.

Codex 0.164.0 owns transcript summarization. After native compaction, the plugin uses the compact-source `SessionStart` event to provide up to eight eligible pending project paths. A clean workspace produces no additional context. This checkpoint uses Git and the local search inventory. It makes no Jev request and supplies no transcript reduction estimate. Trust the installed hooks through Codex’s hook review UI. [Codex hook contract](https://developers.openai.com/codex/hooks/)

The plugin neither edits host-managed transcript files nor stores an additional full transcript. Hook event records and provider charges appear in the normal plugin report. A recorded Claude retention plan indicates that recoverable data was prepared; confirmation of model-visible savings requires observing the next request.
