import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { decide, usageReport, connectOpenRouter, providerIds } from '../src/provider/index.mjs';
import { credential } from '../src/provider/credentials.mjs';
import { maximumChargeNano } from '../src/provider/ledger.mjs';

const testKey = 'synthetic-only-fixture';
const cap = maximumChargeNano / 1e9;
const urls = {
  openrouter: 'https://openrouter.ai/api/alpha/decisions',
  vercel: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
  typesafe: 'https://api.typesafe.ai/v1/systemone',
};
const modelIds = {
  openrouter: 'typesafe/jev-1.14',
  vercel: 'typesafe-ai/jev-1.14.0',
  typesafe: 'jev-1.14.0',
};
const template = {
  workspaceId: 'private-project-name',
  feature: 'search',
  state: { query: 'private query' },
  capUsd: 0.01,
  provider: 'typesafe',
  questions: {
    match: { type: 'choice', instructions: 'Choose a location', options: ['item-1', 'item-2'] },
    fits: { type: 'noul', instructions: 'Does any location fit?' },
    quality: { type: 'score', instructions: 'How close?', levels: ['unrelated', 'exact'] },
  },
};
const answer = {
  match: { type: 'choice', choice: 'item-2', confidence: 0.94 },
  fits: { type: 'noul', noul: 0.9 },
  quality: { type: 'score', score: 0.75 },
};
const getCredential = () => ({ secret: testKey });
async function directory(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'jev-tests-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

for (const provider of providerIds) {
  test(provider + ' uses its own route, model, typed request and billing record', async (t) => {
    const dataDir = await directory(t);
    const fetchImpl = async (url, options) => {
      assert.equal(url, urls[provider]);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer ' + testKey);
      const body = JSON.parse(options.body);
      assert.equal(body.model, modelIds[provider]);
      assert.deepEqual(body.questions.match.criteria, { 'item-1': 'item-1', 'item-2': 'item-2' });
      assert.deepEqual(body.questions.quality.criteria, ['unrelated', 'exact']);
      assert.equal(JSON.parse(body.state).query, 'private query');
      return Response.json({
        model: body.model,
        answers: answer,
        usage:
          provider === 'openrouter'
            ? { prompt_tokens: 111, completion_tokens: 3, cost: 0.000005 }
            : { input_tokens: 111, output_tokens: 3 },
      });
    };
    const result = await decide({ ...template, provider, dataDir }, { fetchImpl, getCredential });
    assert.deepEqual(result.answers, answer);
    assert.equal(result.model, modelIds[provider]);
    const {
      groups: [entry],
    } = await usageReport({ dataDir, workspaceId: template.workspaceId });
    assert.equal(entry.inputTokens, 111);
    assert.equal(entry.outputTokens, 3);
    assert.equal(entry.attempts, 1);
    assert.equal(entry.reservedUsd, 0);
    assert.equal(entry.confirmedUsd, provider === 'openrouter' ? 0.000005 : 0);
    assert.equal(entry.estimatedUsd, provider === 'openrouter' ? 0 : (111 * 42) / 1e9);
    assert.deepEqual((await usageReport({ dataDir, workspaceId: 'other-project' })).groups, []);
    const bytes = await readFile(join(dataDir, 'usage.sqlite3'));
    for (const sensitive of ['private-project-name', 'private query', testKey])
      assert.equal(bytes.includes(sensitive), false);
  });
}
test('uses Vercel OIDC without mixing another provider credential', async () => {
  assert.deepEqual(await credential('vercel', { VERCEL_OIDC_TOKEN: 'token' }), {
    source: 'VERCEL_OIDC_TOKEN',
    secret: 'token',
  });
  assert.deepEqual(await credential('vercel', { VERCEL_OIDC_TOKEN: 'oidc', AI_GATEWAY_API_KEY: 'gateway' }), {
    source: 'AI_GATEWAY_API_KEY',
    secret: 'gateway',
  });
});
test('request failures do not retry or change destinations', async (t) => {
  const dataDir = await directory(t);
  for (const [status, code] of [
    [401, 'auth_expired'],
    [402, 'quota_rejected'],
    [404, 'unsupported_model'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
  ]) {
    let count = 0;
    const fetchImpl = async (url) => {
      count++;
      assert.equal(url, urls.typesafe);
      return new Response('do not expose', { status });
    };
    await assert.rejects(
      decide({ ...template, dataDir }, { fetchImpl, getCredential }),
      (e) => e.code === code && !e.message.includes('do not expose'),
    );
    assert.equal(count, 1);
  }
  assert.equal((await usageReport({ dataDir })).groups[0].unresolved, 1);
});
test('ambiguous dispatch survives reopening and blocks replays and cap overruns', async (t) => {
  const dataDir = await directory(t);
  const args = { ...template, dataDir, capUsd: cap + 1e-9, invocationId: 'ambiguous' };
  const fetchImpl = async () => {
    throw Error('sensitive upstream error');
  };
  await assert.rejects(decide(args, { fetchImpl, getCredential }), { code: 'network_error' });
  await assert.rejects(decide(args, { fetchImpl, getCredential }), { code: 'duplicate_attempt' });
  await assert.rejects(decide({ ...args, invocationId: 'second' }, { fetchImpl, getCredential }), {
    code: 'budget_exhausted',
  });
  assert.equal((await usageReport({ dataDir })).groups[0].reservedUsd, cap);
});
test('rejects missing credentials, disabled budget, cancellation, invalid input before dispatch', async (t) => {
  const dataDir = await directory(t);
  const fetchImpl = async () => assert.fail('unexpected network');
  const run = (overrides) => decide({ ...template, dataDir, ...overrides }, { fetchImpl, getCredential });
  await assert.rejects(decide({ ...template, dataDir }, { fetchImpl, getCredential: () => ({}) }), {
    code: 'unconfigured',
  });
  await assert.rejects(run({ capUsd: 0 }), { code: 'budget_exhausted' });
  await assert.rejects(run({ workspaceCapUsd: 0 }), { code: 'budget_exhausted' });
  await assert.rejects(run({ signal: AbortSignal.abort() }), { code: 'cancelled' });
  await assert.rejects(run({ questions: { q: { instructions: 'where', type: 'box' } } }), {
    code: 'unsupported_question',
  });
  await assert.rejects(run({ state: 'x'.repeat(31000) }), { code: 'request_too_large' });
  assert.deepEqual((await usageReport({ dataDir })).groups, []);
});
test('unknown IDs, wrong kinds and out-of-range scores never reach callers', async (t) => {
  const dataDir = await directory(t);
  for (const invalid of [
    { ...answer, match: { type: 'choice', choice: 'surprise' } },
    { ...answer, quality: { type: 'score', score: 4 } },
    { ...answer, fits: { type: 'noul', noul: -1 } },
    { ...answer, fits: { type: 'score', score: 0 } },
    {},
  ]) {
    const fetchImpl = async () => Response.json({ answers: invalid, usage: { input_tokens: 42 } });
    await assert.rejects(decide({ ...template, dataDir }, { getCredential, fetchImpl }), {
      code: 'invalid_response',
    });
  }
  const [row] = (await usageReport({ dataDir })).groups;
  assert.equal(row.attempts, 5);
  assert.equal(row.inputTokens, 210);
});
test('competing processes cannot overspend the last allowance', async (t) => {
  const dataDir = await directory(t);
  const ledgerUrl = new URL('../src/provider/ledger.mjs', import.meta.url).href;
  const childScript = `import {reserve} from ${JSON.stringify(ledgerUrl)};try{reserve(JSON.parse(process.argv[1]));console.log('ok')}catch(e){console.log(e.code)}`;
  function launch(id) {
    return new Promise((resolve, reject) => {
      const args = { ...template, dataDir, invocationId: id, capUsd: cap + 1e-9 };
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', childScript, JSON.stringify(args)],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let text = '';
      child.stdout.on('data', (out) => {
        text += out;
      });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(text.trim()) : reject(Error('child failed'))));
    });
  }
  assert.deepEqual((await Promise.all([launch('a'), launch('b')])).sort(), ['budget_exhausted', 'ok']);
});
test('browser PKCE rejects invalid state then exchanges the one-time code', async () => {
  let challenge;
  const onUrl = async (raw) => {
    const url = new URL(raw);
    challenge = url.searchParams.get('code_challenge');
    assert.equal(url.searchParams.get('limit'), '1.00');
    const callback = new URL(url.searchParams.get('callback_url'));
    callback.searchParams.set('state', 'mismatch');
    callback.searchParams.set('code', 'synthetic');
    assert.equal((await fetch(callback)).status, 400);
    callback.searchParams.set('state', url.searchParams.get('state'));
    assert.equal((await fetch(callback)).status, 200);
    assert.equal((await fetch(callback)).status, 409);
  };
  let saved = false,
    exchanges = 0;
  const deps = {
    fetchImpl: async (url, options) => {
      exchanges++;
      assert.equal(url, 'https://openrouter.ai/api/v1/auth/keys');
      const payload = JSON.parse(options.body);
      assert.equal(challenge, createHash('sha256').update(payload.code_verifier).digest('base64url'));
      assert.equal(payload.code, 'synthetic');
      return Response.json({ key: testKey });
    },
    save: async (provider, key) => {
      assert.equal(key, testKey);
      assert.equal(provider, 'openrouter');
      saved = true;
      return { configured: true };
    },
  };
  assert.deepEqual(await connectOpenRouter({ onUrl, limitUsd: 1 }, deps), { configured: true });
  assert.equal(saved, true);
  assert.equal(exchanges, 1);
});
test('headless cancelled or expired auth never stores credentials', async () => {
  const abort = new AbortController();
  await assert.rejects(
    connectOpenRouter({
      limitUsd: 1,
      onUrl: (url) => {
        assert.equal(new URL(url).searchParams.has('callback_url'), false);
        abort.abort();
      },
      signal: abort.signal,
      headlessCode: () => new Promise(() => {}),
    }),
    { code: 'login_cancelled' },
  );
  await assert.rejects(
    connectOpenRouter(
      { limitUsd: 1, onUrl: () => {}, headlessCode: () => 'expired' },
      { fetchImpl: async () => new Response('', { status: 403 }), save: () => assert.fail() },
    ),
    { code: 'invalid_login' },
  );
});

test('a browser denial without state cancels immediately and cannot exchange a credential', async () => {
  const deps = { fetchImpl: () => assert.fail('unexpected exchange'), save: () => assert.fail() };
  for (const search of ['', '?error=access_denied']) {
    const onUrl = async (raw) => {
      const callback = new URL(new URL(raw).searchParams.get('callback_url'));
      callback.search = search;
      assert.equal((await fetch(callback)).status, 200);
    };
    await assert.rejects(connectOpenRouter({ onUrl, limitUsd: 1 }, deps), { code: 'login_cancelled' });
  }
});
