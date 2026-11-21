import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { saveCredential } from './credentials.mjs';
import { ProviderError } from './model.mjs';

export async function connectOpenRouter({ onUrl, headlessCode, limitUsd, signal }, dependencies = {}) {
  if (typeof onUrl !== 'function' || !Number.isFinite(limitUsd) || limitUsd < 0.01 || limitUsd >= 1e6) {
    throw new ProviderError(
      'invalid_login',
      'Choose a positive spending limit and an authorization URL handler.',
    );
  }
  const deadline = AbortSignal.timeout(600_000);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  abort.throwIfAborted();
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('https://openrouter.ai/auth');
  url.search = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 'S256',
    key_label: 'Jev Optimizer',
    limit: limitUsd.toFixed(2),
  }).toString();
  let server;
  let onAbort;
  try {
    let receive;
    if (headlessCode) {
      receive = async () => {
        await onUrl(url.href);
        return headlessCode();
      };
    } else {
      let accept, deny;
      let consumed = false;
      const callbackPath = '/callback/' + randomBytes(20).toString('hex');
      const callback = new Promise((resolve, reject) => {
        accept = resolve;
        deny = reject;
      });
      callback.catch(() => {}); // Denial can arrive while a browser is opening.
      server = createServer((request, response) => {
        if (request.url !== callbackPath && !request.url?.startsWith(callbackPath + '?')) {
          response.writeHead(404).end();
          return;
        }
        const target = new URL(request.url, 'http://localhost');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        if (
          request.method !== 'GET' ||
          request.headers.host !== `127.0.0.1:${server.address()?.port}` ||
          target.pathname !== callbackPath
        ) {
          response.writeHead(404).end();
          return;
        }
        if (consumed) {
          response.writeHead(409).end('This authorization has already finished.');
          return;
        }
        // OpenRouter omits state on denial. The unguessable loopback path scopes the
        // cancellation; only a successful callback with matching state can exchange a key.
        if (!target.searchParams.has('code') && !target.searchParams.has('state')) {
          consumed = true;
          response.end('Authorization was cancelled.');
          deny(new ProviderError('login_cancelled', 'Authorization was cancelled.'));
          return;
        }
        const supplied = Buffer.from(target.searchParams.get('state') ?? '');
        if (supplied.length !== state.length || !timingSafeEqual(supplied, Buffer.from(state))) {
          response.writeHead(400).end('Invalid authorization state.');
          return;
        }
        consumed = true;
        const code = target.searchParams.get('code');
        if (!code) {
          response.writeHead(400).end('Authorization was cancelled.');
          deny(new ProviderError('login_cancelled', 'Authorization was cancelled.'));
          return;
        }
        response.end('Authorization received. Return to Jev Optimizer.');
        accept(code);
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      url.searchParams.set('state', state);
      url.searchParams.set('callback_url', `http://127.0.0.1:${server.address().port}${callbackPath}`);
      receive = async () => {
        await onUrl(url.href);
        return callback;
      };
    }
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(new ProviderError('login_cancelled', 'Authorization was cancelled or expired.'));
      abort.addEventListener('abort', onAbort, { once: true });
      if (abort.aborted) onAbort();
    });
    const code = await Promise.race([receive(), cancelled]);
    if (typeof code !== 'string' || !code.trim() || code.length > 8192)
      throw new ProviderError('invalid_login', 'The authorization code is invalid.');
    const res = await (dependencies.fetchImpl ?? fetch)('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      redirect: 'error',
      signal: abort,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), code_verifier: verifier, code_challenge_method: 'S256' }),
    });
    if (!res.ok) throw new ProviderError('invalid_login', 'OpenRouter rejected the authorization exchange.');
    const payload = await res.json();
    if (typeof payload.key !== 'string' || !payload.key)
      throw new ProviderError('invalid_login', 'OpenRouter returned an invalid authorization response.');
    return await (dependencies.save ?? saveCredential)('openrouter', payload.key);
  } finally {
    if (onAbort) abort.removeEventListener('abort', onAbort);
    if (server) {
      server.close();
      server.closeAllConnections();
    }
  }
}
