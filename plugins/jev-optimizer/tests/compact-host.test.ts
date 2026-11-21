import { test, expect } from 'claude-code/testing';
import type { SessionMessage, ProcessRunResult } from 'claude-code';

function transcript(): SessionMessage[] {
  return [
    { role: 'user', text: 'Preserve format version 2.', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool: 'Read', tool_use_id: 'first-read', input: { file_path: '/public/before.ts' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'first-read', isError: false, text: 'export const sample = 1;\n'.repeat(220) }] },
    ...Array.from({ length: 6 }, (_, i) => ({ role: 'user' as const, text: 'Keep recent observation ' + i, toolUses: [] }))
  ];
}

for (const trigger of ['auto','manual'] as const) {
  test(trigger + ' compaction keeps the user constraint, recent messages and original tool pairing', async ($, on) => {
    const input = transcript();
    input.push({ role:'user',text:'<command-name>/compact</command-name>',toolUses:[] },
      { role:'user',text:'/compact',toolUses:[] });
    on('session.cwd', () => ({ value: '/public' }));
    on('settings.read', () => ({ value: {} }));
    on('process.run', (_, call) => {
      expect(call.argv[0]).toBe('node');
      expect(call.argv[1]).toContain('/bin/compact.mjs');
      if (call.argv[2] === 'mode') return { value: { exitCode: 0, stdout: 'read-archive', stderr: '' } as ProcessRunResult };
      expect(call.argv[2]).toBe('plan');
      const data = JSON.parse(call.init?.stdin ?? '{}');
      expect(data.goal).toBe('Keep recent observation 5');
      expect(data.items[0].text).toBe(input[2]?.toolResults?.[0]?.text);
      return { value: { exitCode: 0, stdout: JSON.stringify([{ index: 2, id: 'a'.repeat(64) }]), stderr: '' } as ProcessRunResult };
    });
    const result = await $.session.compact({ trigger, messages: input });
    expect(result.messages?.[2]?.toolResults?.[0]?.text).toContain('recover ');
    expect(result.messages?.[2]?.toolResults?.[0]?.tool_use_id).toBe('first-read');
    expect(result.messages?.[0]?.text).toBe(input[0]?.text);
    expect(result.messages?.slice(-6)).toEqual(input.slice(-6));
  });
}
test('a user compaction instruction passes unchanged to native', async ($, on) => {
  const messages = transcript();
  on('session.compact', (_, event) => ({ messages: event.messages }));
  const result = await $.session.compact({ trigger: 'manual', messages, instructions: 'Keep the entire test output.' });
  expect(result.messages).toEqual(messages);
});
test('mixed notebook content with a long text snapshot stays in the original host message', async ($, on) => {
  const messages = transcript();
  const read = messages[1]!.toolUses[0]!;
  read.input = { file_path: '/public/analysis.ipynb' };
  read.result = {type:'notebook', file:{cells:[{cell_type:'output', attachments:{}}]}};
  on('session.compact', (_, event) => ({ messages: event.messages }));
  const result = await $.session.compact({ trigger:'auto', messages });
  expect(result.messages).toEqual(messages);
});

test('bundled Jev algorithm drops stale tool pairs while preserving recent messages and user constraints', async ($, on) => {
  const messages = transcript();
  on('session.cwd', () => ({ value: '/public' }));
  on('settings.read', () => ({ value: {} }));
  let decisions = 0;
  on('process.run', (_, call) => {
    let stdout = 'conversation';
    if (call.argv[2] === 'conversation') {
      const request = JSON.parse(call.init?.stdin ?? '{}');
      expect(request.state.history[0].text).toBe('Preserve format version 2.');
      expect(JSON.stringify(request.state)).not.toContain('export const sample');
      expect(Object.keys(request.questions)).toEqual(['call_t1', 'result_t1']);
      stdout = JSON.stringify({ answers: { call_t1: { noul: 0.05 }, result_t1: { noul: 0.01 } } });
      decisions++;
    }
    return { value: { exitCode: 0, stdout, stderr: '' } as ProcessRunResult };
  });
  const result = await $.session.compact({ trigger: 'auto', messages });
  expect(decisions).toBe(1);
  expect(result.messages).toEqual([messages[0], ...messages.slice(-6)]);
});

test('a malformed provider answer delegates the original transcript to Claude', async ($, on) => {
  const messages = transcript();
  on('session.cwd', () => ({ value: '/public' }));
  on('settings.read', () => ({ value: {} }));
  on('process.run', (_, call) => ({ value: { exitCode: 0, stdout: call.argv[2] === 'mode' ? 'conversation' : '{}', stderr: '' } as ProcessRunResult }));
  on('session.compact', (_, event) => ({ messages: event.messages }));
  const result = await $.session.compact({ trigger: 'manual', messages });
  expect(result.messages).toEqual(messages);
});
