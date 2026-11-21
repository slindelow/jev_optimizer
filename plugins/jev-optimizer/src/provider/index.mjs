import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { definition, wireQuestions, normalizeAnswers, ProviderError } from './model.mjs';
import { credential } from './credentials.mjs';
import { reserve, settle, defaultDataDir, rateNanoUsdPerToken, maximumChargeNano } from './ledger.mjs';

export { providerIds, ProviderError } from './model.mjs';
export { credentialStatus, saveCredential, forgetCredential } from './credentials.mjs';
export { connectOpenRouter } from './oauth.mjs';
export { usageReport } from './ledger.mjs';

const integerCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

function fromHttp(status) {
  const codes = {
    400: 'invalid_request',
    401: 'auth_expired',
    402: 'quota_rejected',
    403: 'access_denied',
    404: 'unsupported_model',
    413: 'request_too_large',
    429: 'rate_limited',
  };
  return new ProviderError(
    codes[status] ?? 'provider_unavailable',
    `The selected provider returned HTTP ${status}.`,
  );
}

// Dependencies are process-local test seams. User configuration never overrides the destination.
export async function decide(
  {
    provider,
    feature,
    workspaceId,
    state,
    questions,
    capUsd,
    workspaceCapUsd,
    signal,
    invocationId = randomUUID(),
    dataDir = defaultDataDir(),
  },
  dependencies = {},
) {
  const spec = definition(provider);
  if (
    typeof workspaceId !== 'string' ||
    !workspaceId ||
    !/^[a-z][a-z0-9_-]{0,63}$/i.test(feature ?? '') ||
    typeof invocationId !== 'string' ||
    !/^[\w.-]{1,128}$/.test(invocationId)
  ) {
    throw new ProviderError('invalid_request', 'Invalid workspace, invocation or feature identifier.');
  }
  if (state == null) throw new ProviderError('invalid_request', 'Supply text or a JSON state.');
  const wire = wireQuestions(questions);
  // A single text state prevents image fetches or externally resolved attachments in every adapter.
  const textState = typeof state === 'string' ? state : JSON.stringify(state);
  const body = JSON.stringify({ model: spec.model, state: textState, questions: wire });
  if (Buffer.byteLength(body) > 30_000)
    throw new ProviderError('request_too_large', 'Reduce the selected excerpts before sending.');
  const timeout = AbortSignal.timeout(10_000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const auth = await (dependencies.getCredential ?? credential)(provider);
  if (!auth?.secret)
    throw new ProviderError('unconfigured', 'Connect the selected provider before enabling live decisions.');
  if (deadline.aborted) throw new ProviderError('cancelled', 'The decision was cancelled before dispatch.');
  reserve({ dataDir, invocationId, provider, feature, workspaceId, capUsd, workspaceCapUsd });
  if (deadline.aborted) {
    settle(dataDir, invocationId, 'cancelled', 0);
    throw new ProviderError('cancelled', 'The decision was cancelled before dispatch.');
  }
  const start = performance.now();
  let response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(spec.url, {
      method: 'POST',
      redirect: 'error',
      signal: deadline,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.secret },
      body,
    });
  } catch {
    throw new ProviderError(
      deadline.aborted ? 'cancelled' : 'network_error',
      'No decision received. The possible charge remains reserved.',
    );
  }
  if (!response.ok) {
    // These statuses indicate a rejected request. For ambiguous 5xx retain the reservation.
    if ([400, 401, 402, 403, 404, 413, 429].includes(response.status)) {
      settle(dataDir, invocationId, 'rejected', 0, null, null, Math.round(performance.now() - start));
    }
    throw fromHttp(response.status);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderError(
      'invalid_response',
      'The provider returned an unreadable response. The possible charge remains reserved.',
    );
  }
  const usage = payload?.usage ?? {};
  const input = integerCount(usage.input_tokens ?? usage.prompt_tokens);
  const output = integerCount(usage.output_tokens ?? usage.completion_tokens);
  const suppliedCost = usage.cost;
  const hasCost =
    typeof suppliedCost === 'number' &&
    suppliedCost >= 0 &&
    Number.isSafeInteger(Math.ceil(suppliedCost * 1e9));
  const charge = hasCost
    ? Math.ceil(suppliedCost * 1e9)
    : input === null
      ? maximumChargeNano
      : input * rateNanoUsdPerToken;
  const latencyMs = Math.round(performance.now() - start);
  settle(dataDir, invocationId, hasCost ? 'confirmed' : 'estimated', charge, input, output, latencyMs);
  // Gateways can return the upstream model name or their versioned catalog identifier.
  const allowedModels = new Set([spec.model, 'jev-1.14.0']);
  if (provider === 'openrouter') allowedModels.add('typesafe/jev-1.14-20261014');
  if (payload?.model !== undefined && !allowedModels.has(payload.model)) {
    throw new ProviderError(
      'invalid_response',
      'The provider reported a different model from the pinned Jev release.',
    );
  }
  const answers = normalizeAnswers(wire, payload);
  return {
    answers,
    model: payload.model || spec.model,
    usage: {
      inputTokens: input,
      outputTokens: output,
      costUsd: charge / 1e9,
      costBasis: hasCost ? 'confirmed' : 'estimated',
    },
    latencyMs,
    invocationId,
  };
}
