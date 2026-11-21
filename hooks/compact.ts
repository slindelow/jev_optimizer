import type { Register, SessionMessage, ToolUseSummary, ToolResultSummary } from 'claude-code';
import { compact, reductionRatio } from '../vendor/fast-jev-compaction/compact.ts';
import type { Message, ToolUse, ToolResult } from '../vendor/fast-jev-compaction/types.ts';

function competingPlugin(settings: Readonly<Record<string, unknown>>) {
  const enabled = settings.enabledPlugins;
  return !!enabled && typeof enabled === 'object' && Object.entries(enabled).some(([id, active]) =>
    (id === 'fast-jev-compaction' || id.startsWith('fast-jev-compaction@')) && active === true);
}

function supportedTranscript(messages: readonly SessionMessage[]) {
  const pending = new Set<string>();
  const known = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolUses) {
      if (!call.tool_use_id || known.has(call.tool_use_id)) return false;
      known.add(call.tool_use_id);
      pending.add(call.tool_use_id);
    }
    for (const result of message.toolResults ?? []) {
      if (!pending.delete(result.tool_use_id)) return false;
      // Rebuilding a message containing a notebook or another structured result
      // from its text projection could lose data. Defer that transcript to Claude.
      const value = result.result;
      if (value && typeof value === 'object' && 'type' in value && value.type !== 'text') return false;
    }
  }
  return known.size > 0 && pending.size === 0;
}

function plainRead(path: string, result: unknown) {
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(path)) return false;
  if (result !== undefined && result !== null)
    return typeof result === 'object' && 'type' in result && result.type === 'text';
  return /\.(?:[cm]?[jt]sx?|py|rs|go|java|c|cc|cpp|h|hpp|cs|rb|php|sh|swift|kt|sql|css|html|md|txt|json|ya?ml|toml|xml|csv)$/i.test(path);
}

function toolUseSummary(tool: ToolUse): ToolUseSummary {
  const summary: ToolUseSummary = {
    tool_use_id: tool.tool_use_id,
    tool: tool.tool,
    input: tool.input,
  };
  if (tool.text !== undefined) summary.text = tool.text;
  if (tool.isError) summary.isError = true;
  return summary;
}

function toolResultSummary(result: ToolResult): ToolResultSummary {
  return {
    tool_use_id: result.tool_use_id,
    text: result.text,
    isError: result.isError ?? false,
  };
}

/**
 * Maps the library's output back onto session messages. Whatever came back
 * unchanged (a message, a tool use, a tool result) is the engine's own object,
 * handle included; anything rebuilt is a fresh message without a handle, so the
 * engine takes the edited content instead of its original.
 */
function toSessionMessages(
  input: readonly SessionMessage[],
  output: readonly Message[],
): SessionMessage[] {
  const messages = new Map<Message, SessionMessage>();
  const uses = new Map<ToolUse, ToolUseSummary>();
  const results = new Map<ToolResult, ToolResultSummary>();
  for (const message of input) {
    messages.set(message, message);
    for (const tool of message.toolUses) uses.set(tool, tool);
    for (const result of message.toolResults ?? []) results.set(result, result);
  }
  return output.map((message) => {
    const own = messages.get(message);
    if (own) return own;
    const rebuilt: SessionMessage = {
      role: message.role,
      text: message.text,
      toolUses: message.toolUses.map((tool) => uses.get(tool) ?? toolUseSummary(tool)),
    };
    if (message.toolResults && message.toolResults.length > 0) {
      rebuilt.toolResults = message.toolResults.map(
        (result) => results.get(result) ?? toolResultSummary(result),
      );
    }
    return rebuilt;
  });
}

// Keep all intact messages as the original objects, including opaque host handles.
export const register: Register = (on) => {
  let compacting = false;
  on('turn.complete', async ($, event, next) => {
    try {
      if (!compacting && ((await $.session.usage()).context.percent ?? 0) >= 60) {
        const mode = await $.process.run(['node', $.plugin.root + '/bin/compact.mjs', 'mode'], {
          cwd: await $.session.cwd(), timeoutMs: 3000
        });
        if (mode.exitCode === 0 && mode.stdout === 'conversation') {
          const settings = await $.settings.read();
          if (!competingPlugin(settings)) {
            compacting = true;
            try { await $.session.compact(); } finally { compacting = false; }
          }
        }
      }
    } catch {
      // SDK sessions can receive native compaction while being unable to initiate it.
    }
    return next(event);
  });
  on('session.compact', async ($, event, next) => {
    try {
      if (event.instructions || event.agentId || !['auto', 'manual'].includes(event.trigger)) return next(event);
      const messages = event.messages;
      const cwd = await $.session.cwd();
      const helper = ['node', $.plugin.root + '/bin/compact.mjs'];
      const mode = await $.process.run([...helper, 'mode'], { cwd, timeoutMs: 3000 });
      if (mode.exitCode !== 0 || !mode.stdout || competingPlugin(await $.settings.read())) return next(event);
      if (mode.stdout === 'conversation') {
        if (!supportedTranscript(messages)) return next(event);
        let failure = 'unavailable';
        try {
          const result = await compact(messages, {
            async ask(state, questions) {
              const run = await $.process.run([...helper, 'conversation'], {
                cwd, timeoutMs: 12000, stdin: JSON.stringify({ state, questions })
              });
              if (run.exitCode !== 0 || !run.stdout) throw new Error('Conversation scoring unavailable.');
              const response = JSON.parse(run.stdout);
              if (typeof response.reason === 'string' && /^[a-z_]{1,40}$/.test(response.reason)) {
                failure = response.reason;
                throw new Error('Conversation scoring unavailable.');
              }
              return response;
            }
          }, { maxStateTokens: 3000, maxRequestTokens: 4800 });
          const reduction = reductionRatio(result);
          if (!result.stats.requests || reduction < 0.25) return next(event);
          $.ui.log('Jev Optimizer compacted the conversation (' + Math.round(reduction * 100) + '% character reduction).');
          return { messages: toSessionMessages(messages, result.messages) };
        } catch {
          $.ui.log('Jev Optimizer used native compaction (' + failure + ').');
          return next(event);
        }
      }
      if (mode.stdout !== 'read-archive') return next(event);
      const reads = new Map<string, { path: string; index: number }>();
      const seen = new Set<string>();
      const results = new Set<string>();
      const items = [];
      let visible = 0;
      let selectedChars = 0;
      let goal = '';
      for (const [index, message] of messages.entries()) {
        visible += message.text.length;
        if (message.role === 'user' && message.text && !message.toolResults?.length) {
          const candidate = message.text.trim();
          // Slash commands, tool wrappers, hook reminders and resumed-session summaries
          // can occupy user-role messages. Only use a plain current user goal.
          if (candidate && !/^(?:[</]|Caveat: The messages below\b|This session is being continued\b)/i.test(candidate)) {
            goal = /\[(?:redacted|omitted)\]|<redacted>/i.test(candidate) ? '' : candidate.slice(0, 512);
          }
        }
        for (const call of message.toolUses) {
          if (seen.has(call.tool_use_id)) return next(event);
          seen.add(call.tool_use_id);
          visible += JSON.stringify(call.input).length;
          if (call.tool === 'Read' && !call.isError && typeof call.input.file_path === 'string' &&
              plainRead(call.input.file_path,call.result)) {
            reads.set(call.tool_use_id, { path: call.input.file_path, index });
          }
        }
        for (const result of message.toolResults ?? []) {
          if (results.has(result.tool_use_id) || !seen.has(result.tool_use_id)) return next(event);
          results.add(result.tool_use_id);
          visible += result.text.length;
          const read = reads.get(result.tool_use_id);
          if (!read || !plainRead(read.path,result.result) || read.index === 0 || message.role !== 'user' || message.text || message.toolUses.length ||
              message.toolResults?.length !== 1 || result.isError || index >= messages.length - 6 ||
              result.text.length < 2048 || result.text.length > 96000 || items.length >= 20 ||
              selectedChars + result.text.length > 480000) continue;
          items.push({ index, path: read.path, text: result.text });
          selectedChars += result.text.length;
        }
      }
      if (!items.length || results.size !== seen.size || selectedChars < visible / 4) return next(event);
      const run = await $.process.run(['node', $.plugin.root + '/bin/compact.mjs', 'plan'], {
        cwd: await $.session.cwd(), timeoutMs: 12000,
        stdin: JSON.stringify({ goal, visible, items })
      });
      if (run.exitCode !== 0) return next(event);
      const plan = JSON.parse(run.stdout);
      if (!Array.isArray(plan) || !plan.length) return next(event);
      const output = messages.slice();
      for (const { index, id } of plan) {
        if (!items.some(item => item.index === index) || !/^[0-9a-f]{64}$/.test(id)) return next(event);
        const original = messages[index]?.toolResults?.[0];
        if (!original) return next(event);
        output[index] = { role: 'user', text: '', toolUses: [], toolResults: [{
          tool_use_id: original.tool_use_id, isError: false,
          text: '[Earlier file read archived by Jev Optimizer. Exact text: run the installed bin/compact.mjs recover ' + id + ' with Node in this project.]'
        }] };
      }
      $.ui.log('Jev Optimizer compacted ' + plan.length + ' earlier file reads.');
      return { messages: output };
    } catch {
      // The host owns retries, compaction thresholds and fallback.
    }
    return next(event);
  });
};
