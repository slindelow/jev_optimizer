#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { defaultDir, openSettings, readSettings, workspace } from '../src/settings.mjs';
import { codexContinuity, conversationEnabled, purge, recover, retentionPlan, scoreConversation } from '../src/compaction.mjs';
import { ProviderError } from '../src/provider/index.mjs';

async function readInput() {
  const parts = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new Error('Oversize input');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
const command = process.argv[2];
let db;
try {
  const input = ['purge','recover','mode'].includes(command) ? null : await readInput();
  const codex = command === 'codex';
  if (!codex || (input.hook_event_name === 'SessionStart' && input.source === 'compact' && typeof input.cwd === 'string')) {
    const dir = defaultDir();
    const scope = workspace(codex ? input.cwd : process.cwd());
    db = openSettings(dir, false);
    if (command === 'recover') {
      process.stdout.write(await recover(db, scope, process.argv[3]));
    } else if (command === 'purge') {
      if (db) purge(db,scope.id);
    } else if (db) {
      const config = readSettings(db, scope.id);
      if (config.enabled.includes('compact') && config.auto.includes('compact')) {
        if (command === 'mode') {
          process.stdout.write(conversationEnabled(config) ? 'conversation' : 'read-archive');
        } else if (command === 'conversation') {
          process.stdout.write(JSON.stringify(await scoreConversation({ db, scope, config, dir, input })));
        } else if (command === 'plan') {
          process.stdout.write(JSON.stringify(await retentionPlan({ db, scope, config, dir, input })));
        } else if (codex) {
          const start = performance.now();
          const context = await codexContinuity(scope);
          db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(randomUUID(), scope.id, 'compact', context ? 'codex-workspace-continuity' : 'codex-native-clean', performance.now() - start, Date.now());
          if (context) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
        }
      }
    }
  }
} catch (error) {
  if (command === 'conversation') {
    // Only program-defined error codes may cross back into the host's log.
    const reason = error instanceof ProviderError && /^[a-z_]{1,40}$/.test(error.code) ? error.code : 'unavailable';
    process.stdout.write(JSON.stringify({ reason }));
  }
  if (command === 'recover' || command === 'purge') {
    process.stderr.write('Archive operation unavailable for this workspace.\n');
    process.exitCode = 1;
  }
} finally {
  db?.close();
}
