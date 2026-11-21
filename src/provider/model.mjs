export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}
export const providers = Object.freeze({
  openrouter: {
    url: 'https://openrouter.ai/api/alpha/decisions',
    model: 'typesafe/jev-1.14',
    env: ['OPENROUTER_API_KEY'],
  },
  vercel: {
    url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
    model: 'typesafe-ai/jev-1.14.0',
    env: ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'],
  },
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.14.0', env: ['TYPESAFE_API_KEY'] },
});
export const providerIds = Object.freeze(Object.keys(providers));
export function definition(provider) {
  if (!Object.hasOwn(providers, provider))
    throw new ProviderError('invalid_provider', 'Choose a supported Jev provider.');
  return providers[provider];
}
export function wireQuestions(questions) {
  const entries = Object.entries(questions ?? {});
  if (!entries.length || entries.length > 64)
    throw new ProviderError('invalid_question', 'Supply one to 64 questions.');
  return Object.fromEntries(
    entries.map(([id, q]) => {
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        !q ||
        typeof q.instructions !== 'string' ||
        !q.instructions.trim()
      ) {
        throw new ProviderError('invalid_question', 'Invalid question identifier or instructions.');
      }
      const result = { type: q.type, instructions: q.instructions };
      if (q.type === 'choice' || q.type === 'score') {
        const values = q.type === 'choice' ? q.options : q.levels;
        const max = q.type === 'choice' ? 255 : 10;
        if (
          !Array.isArray(values) ||
          values.length < 2 ||
          values.length > max ||
          new Set(values).size !== values.length ||
          !values.every((x) => typeof x === 'string' && x.trim())
        ) {
          throw new ProviderError('invalid_question', 'Invalid or duplicate choice options or score levels.');
        }
        result.criteria = q.type === 'score' ? values : Object.fromEntries(values.map((x) => [x, x]));
      } else if (q.type !== 'noul')
        throw new ProviderError(
          'unsupported_question',
          'Only textual choice, score and yes/no questions are supported.',
        );
      return [id, result];
    }),
  );
}
function between(value, high) {
  return Number.isFinite(value) && value >= 0 && value <= high;
}
export function normalizeAnswers(questions, response) {
  const malformed = () =>
    new ProviderError('invalid_response', 'Provider returned unexpected decision data.');
  if (!response?.answers || Object.keys(response.answers).length !== Object.keys(questions).length)
    throw malformed();
  return Object.fromEntries(
    Object.entries(questions).map(([id, q]) => {
      if (!Object.hasOwn(response.answers, id)) throw malformed();
      const a = response.answers[id];
      if (a?.type !== q.type) throw malformed();
      if (q.type === 'choice' && (typeof a.choice !== 'string' || !Object.hasOwn(q.criteria, a.choice)))
        throw malformed();
      if (q.type === 'noul' && !between(a.noul, 1)) throw malformed();
      if (q.type === 'score' && !between(a.score, q.criteria.length - 1)) throw malformed();
      const out = { type: q.type, [q.type]: a[q.type] };
      if (a.confidence !== undefined) {
        if (!between(a.confidence, 1)) throw malformed();
        out.confidence = a.confidence;
      }
      return [id, out];
    }),
  );
}
