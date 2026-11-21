import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, closeSync, openSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProviderError } from './model.mjs';

export const defaultDataDir = () => join(homedir(), '.local', 'state', 'jev-optimizer');
const workspaceKey = (id) => createHash('sha256').update(id).digest('hex');
const monthNow = () => new Date().toISOString().slice(0, 7);
export const rateNanoUsdPerToken = 42;
// No long-context option: a full 64K context bounds accepted input even with provider framing.
export const maximumChargeNano = 65_536 * rateNanoUsdPerToken;

function open(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filename = join(dir, 'usage.sqlite3');
  closeSync(openSync(filename, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE');
    if (db.prepare('PRAGMA user_version').get().user_version > 1)
      throw new ProviderError('ledger_version', 'Upgrade to read this usage database.');
    db.exec(`CREATE TABLE IF NOT EXISTS attempts(
      id TEXT PRIMARY KEY,month TEXT NOT NULL,provider TEXT NOT NULL,workspace TEXT NOT NULL,
      feature TEXT NOT NULL,status TEXT NOT NULL,charge INTEGER NOT NULL,input INTEGER,output INTEGER,
      elapsed INTEGER,rate INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS spend ON attempts(month,provider,workspace);
    PRAGMA user_version=1; COMMIT`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function capNanos(cap) {
  if (!Number.isFinite(cap) || cap < 0 || cap > 1_000_000)
    throw new ProviderError('invalid_cap', 'Set a finite monthly USD cap.');
  return Math.floor(cap * 1e9);
}
export function reserve({ dataDir, invocationId, provider, feature, workspaceId, capUsd, workspaceCapUsd }) {
  const cap = capNanos(capUsd),
    repoCap = workspaceCapUsd == null ? cap : capNanos(workspaceCapUsd);
  const workspace = workspaceKey(workspaceId),
    month = monthNow(),
    db = open(dataDir);
  try {
    db.exec('BEGIN IMMEDIATE');
    if (db.prepare('SELECT id FROM attempts WHERE id=?').get(invocationId))
      throw new ProviderError('duplicate_attempt', 'This invocation was already submitted.');
    const row = db
      .prepare(
        'SELECT SUM(charge) AS total,SUM(CASE WHEN workspace=? THEN charge ELSE 0 END) AS local FROM attempts WHERE month=? AND provider=?',
      )
      .get(workspace, month, provider);
    if ((row.total ?? 0) + maximumChargeNano > cap || (row.local ?? 0) + maximumChargeNano > repoCap)
      throw new ProviderError('budget_exhausted', 'The remaining budget cannot cover this request.');
    db.prepare(
      'INSERT INTO attempts(id,month,provider,workspace,feature,status,charge,rate) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      invocationId,
      month,
      provider,
      workspace,
      feature,
      'reserved',
      maximumChargeNano,
      rateNanoUsdPerToken,
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}
export function settle(dir, id, status, charge, input = null, output = null, elapsed = null) {
  const db = open(dir);
  try {
    db.prepare(
      'UPDATE attempts SET status=?,charge=?,input=?,output=?,elapsed=? WHERE id=? AND status=?',
    ).run(status, charge, input, output, elapsed, id, 'reserved');
  } finally {
    db.close();
  }
}
export async function usageReport({ dataDir = defaultDataDir(), workspaceId, month = monthNow() } = {}) {
  const db = open(dataDir),
    workspace = workspaceId ? workspaceKey(workspaceId) : null;
  try {
    const rows = db
      .prepare(
        `SELECT provider,feature,count(*) AS attempts,
      sum(CASE WHEN status='confirmed' THEN charge ELSE 0 END)/1e9 AS confirmedUsd,
      sum(CASE WHEN status='estimated' THEN charge ELSE 0 END)/1e9 AS estimatedUsd,
      sum(CASE WHEN status='reserved' THEN charge ELSE 0 END)/1e9 AS reservedUsd,
      count(CASE WHEN status='reserved' THEN 1 END) AS unresolved,
      sum(input) AS inputTokens,sum(output) AS outputTokens,sum(elapsed) AS elapsedMs
      FROM attempts WHERE month=? AND (? IS NULL OR workspace=?) GROUP BY provider,feature ORDER BY provider,feature`,
      )
      .all(month, workspace, workspace);
    return { month, groups: rows.map((row) => ({ ...row })) };
  } finally {
    db.close();
  }
}
