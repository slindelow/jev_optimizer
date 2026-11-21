import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { capFor } from './settings.mjs';
import { decide, ProviderError } from './provider/index.mjs';
import { inventory, readDocument, secretLike } from './features/workspace.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const archiveLimit = 16 * 1024 * 1024;
const providerReasons = new Set(['invalid_request','invalid_response','request_too_large','unconfigured','cancelled',
  'budget_exhausted','invalid_cap','duplicate_attempt','ledger_version','auth_expired','quota_rejected','access_denied',
  'unsupported_model','rate_limited','network_error','provider_unavailable']);

const sensitive = text => secretLike(text) || /(?:password|api[_-]?key|secret|authorization|token)\s*["']?\s*[:=]\s*["']?[^\s,"'}]{4,}/i.test(text);

function verifiedText(db, workspaceId, id) {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid recovery ID.');
  const text = db.prepare('SELECT text FROM compact_archive WHERE workspace=? AND id=?').get(workspaceId, id)?.text;
  if (typeof text !== 'string' || digest(text) !== id) throw new Error('Recovery entry unavailable.');
  return text;
}

export async function recover(db, scope, id) {
  const text = verifiedText(db, scope.id, id);
  const listing = await inventory(scope.root);
  for (const {file} of db.prepare('SELECT file FROM compact_origins WHERE workspace=? AND id=?').all(scope.id,id)) {
    if (!listing.paths.includes(file)) continue;
    const current = await readDocument(listing.base,file,listing.scope);
    if (current && !sensitive(current.lines.join('\n')) && !sensitive(text)) return text;
  }
  throw new Error('Recovery origin is no longer eligible.');
}

export function purge(db, workspaceId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['compact_origins', 'compact_archive']) {
      if (db.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get('table', table))
        db.prepare('DELETE FROM ' + table + ' WHERE workspace=?').run(workspaceId);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function storeRead(db, workspaceId, file, text) {
  db.exec('CREATE TABLE IF NOT EXISTS compact_archive(workspace TEXT NOT NULL,id TEXT NOT NULL,text TEXT NOT NULL,PRIMARY KEY(workspace,id)); CREATE TABLE IF NOT EXISTS compact_origins(workspace TEXT NOT NULL,id TEXT NOT NULL,file TEXT NOT NULL,PRIMARY KEY(workspace,id,file))');
  const id = digest(text);
  db.prepare('INSERT OR IGNORE INTO compact_archive VALUES(?,?,?)').run(workspaceId, id, text);
  db.prepare('INSERT OR IGNORE INTO compact_origins VALUES(?,?,?)').run(workspaceId, id, file);
  if (verifiedText(db, workspaceId, id) !== text) throw new Error('Recovery validation failed.');
  return id;
}

function checkArchiveLimit(db, workspaceId) {
  const { total } = db.prepare('SELECT sum(length(CAST(text AS BLOB))) AS total FROM compact_archive WHERE workspace=?').get(workspaceId);
  if (total > archiveLimit) throw new Error('Project compaction archive is full.');
}

// The caller resolves the file against the current workspace inventory before archiving.
export function archiveRead(db, scope, file, text) {
  if (typeof text !== 'string' || sensitive(text)) throw new Error('Ineligible archive text.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const id = storeRead(db, scope.id, file, text);
    checkArchiveLimit(db, scope.id);
    db.exec('COMMIT');
    return id;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function conversationEnabled(config) {
  return Boolean(config.conversationCompaction === true && config.provider &&
    config.enabled.includes('compact') && config.auto.includes('compact') && config.remote.includes('compact'));
}

export async function scoreConversation({ db, scope, config, dir, input, decideFn = decide }) {
  if (!conversationEnabled(config)) throw new Error('Conversation compaction disabled.');
  const { state, questions } = input;
  if (!state || !Array.isArray(state.history) || !questions ||
      Object.keys(questions).some(key => !/^(call|result)_t[0-9]+$/.test(key))) throw new Error('Invalid compaction state.');
  // Examine raw strings as well as decoded tool inputs (stored as JSON in fitted state).
  const possiblySensitive = value => {
    if (typeof value !== 'string') return value && typeof value === 'object' && Object.values(value).some(possiblySensitive);
    if (sensitive(value) || /\bjv_live_[\w-]{8,}/i.test(value)) return true;
    if (value.startsWith('{')) {
      try { return possiblySensitive(JSON.parse(value)); } catch { /* abridged input */ }
    }
    return false;
  };
  if (possiblySensitive(state) || possiblySensitive(questions)) throw new ProviderError('sensitive_input', 'Sensitive compaction input.');
  const start = performance.now();
  const response = await decideFn({ workspaceId: scope.id, provider: config.provider, feature: 'compact',
    state, questions, capUsd: capFor(db, config.provider), dataDir: dir });
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(randomUUID(), scope.id, 'compact', 'jev-conversation-decisions', performance.now() - start, Date.now());
  return { answers: response.answers };
}

export async function retentionPlan({ db, scope, config, dir, input, decideFn = decide }) {
  const start = performance.now();
  if (!config.enabled.includes('compact') || !config.auto.includes('compact')) return [];
  const record = method => db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), scope.id, 'compact', method, performance.now() - start, Date.now());
  const fallback = reason => {
    record(reason);
    return [];
  };
  const { items, goal, visible } = input;
  if (!Array.isArray(items) || !items.length || items.length > 20 || !Number.isSafeInteger(visible) || visible <= 0) return [];
  const listing = await inventory(scope.root, {});
  const listed = new Set(listing.paths);
  const eligible = [];
  for (const item of items) {
    if (!Number.isSafeInteger(item.index) || item.index < 1 || typeof item.path !== 'string' ||
        typeof item.text !== 'string' || item.text.length < 2048 || item.text.length > 96000 || sensitive(item.text)) continue;
    const requested = path.resolve(scope.root, item.path);
    let file;
    try { file = path.relative(scope.root, realpathSync(requested)); }
    catch { continue; }
    if (!listed.has(file) || !requested.endsWith(path.sep + file) || file.length > 240 || sensitive(file)) continue;
    const current = await readDocument(listing.base,file,listing.scope);
    if (current && !sensitive(current.lines.join('\n'))) eligible.push({ index: item.index, file, text: item.text });
  }
  const worthwhile = entries => entries.reduce((sum, e) => sum + e.text.length - 240, 0) >= visible / 4;
  if (!eligible.length) return fallback('native-no-eligible-reads');
  if (!worthwhile(eligible)) return fallback('native-insufficient-reduction');
  let selected = eligible;
  if (config.remote.includes('compact')) {
    if (!config.provider || typeof goal !== 'string' || !goal.trim() || goal.length > 512 || sensitive(goal)) return fallback('native-remote-input-ineligible');
    const state = { goal, earlierReads: eligible.map(({ index, file, text }) => ({ index, file, characters: text.length })) };
    const questions = Object.fromEntries(eligible.map(({ index }) => ['r' + index, {
      type: 'noul', instructions: 'Can read ' + index + ' be replaced with an exact local recovery reference while continuing the current task? Uncertainty means no.'
    }]));
    let decision;
    try {
      decision = await decideFn({ workspaceId: scope.id, provider: config.provider, feature: 'compact',
        state, questions, capUsd: capFor(db, config.provider), dataDir: dir });
    } catch (error) {
      const reason = error instanceof ProviderError && providerReasons.has(error.code) ? error.code : 'other';
      return fallback('native-provider-' + reason);
    }
    selected = eligible.filter(({ index }) => decision.answers['r' + index]?.noul >= 0.8);
    if (!selected.length) return fallback('native-jev-abstained');
    if (!worthwhile(selected)) return fallback('native-jev-insufficient-reduction');
  }
  // Commit and re-read every exact text before allowing the host to replace a single result.
  db.exec('BEGIN IMMEDIATE');
  try {
    const plan = selected.map(({ index, text, file }) => ({ index, id: storeRead(db, scope.id, file, text) }));
    checkArchiveLimit(db, scope.id);
    record(config.remote.includes('compact') ? 'jev-retention-plan' : 'local-retention-plan');
    db.exec('COMMIT');
    return plan;
  } catch {
    db.exec('ROLLBACK');
    return fallback('native-archive-failed');
  }
}

export async function codexContinuity(scope) {
  // Only include actual project paths; never elevate repository prose to developer instructions.
  const output = execFileSync('git', ['-C', scope.root, 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
    { encoding: 'utf8', timeout: 1500, maxBuffer: 256 * 1024 });
  const listed = new Set((await inventory(scope.root, {})).paths);
  const files = output.split('\0').map(row => row.slice(3)).filter(file =>
    listed.has(file) && /^[\w./@+-]{1,180}$/.test(file) && !secretLike(file)).sort().slice(0, 8);
  if (!files.length) return null;
  return 'Workspace files with pending changes after native compaction: ' + files.map(file => JSON.stringify(file)).join(', ') + '.';
}
