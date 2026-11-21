# Context compaction · Continuity

**User outcome.** Reduce context in long sessions while preserving the exact constraints and observations necessary to finish the task.

## Interface

Host transcript snapshot with roles, message IDs, tool-call/result links and current context budget. Return a proposed retention plan, protected IDs, estimated reduction, recoverable references and host-specific outcome: replaced, checkpointed or native fallback.

## Behavior

Pin instructions, user messages and corrections, unresolved actions, recent working context and observations explicitly marked essential. Keep provenance, order and call/result pairing valid. Score eligible tool outputs for keep, truncate or omit. Only omit recoverable content after verifying durable capture. In Claude Code, evaluate the upstream compactor behind the supported replacement hook and validate its output before applying. In Codex, checkpoint around native compaction and expose recovery through an explicit tool or supported context hook. Keep an original transcript until a replacement is accepted.

## Failure and fallback

Leave native compaction available on timeout, low reduction, unsupported host, malformed links, incomplete capture or provider failure. Detect existing competing replacement hooks and select a single owner explicitly. Never edit an on-disk host transcript. Record native fallback or checkpoint accurately when measuring savings.

## Acceptance

Replay user corrections, interrupted and parallel tool calls, duplicate IDs, excluded content and a full evidence store. Every protected item survives or triggers native fallback; omitted eligible bytes can be recovered. Force a continuation after compaction and grade task completion and exact error recall against the host default. Exercise actual manual and automatic compaction in supported host versions. [Upstream implementation](https://github.com/tamaratran/fast-jev-compaction) · [Codex hooks](https://developers.openai.com/codex/hooks)

Apply the [shared runtime contract](runtime.md) and [release gates](release.md).
