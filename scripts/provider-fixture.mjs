// Loaded only in a disposable smoke-test child. Every HTTP request terminates here.
const routes = {
  "https://openrouter.ai/api/alpha/decisions": "typesafe/jev-1.14",
  "https://ai-gateway.vercel.sh/typesafe/v1/systemone":
    "typesafe-ai/jev-1.14.0",
  "https://api.typesafe.ai/v1/systemone": "jev-1.14.0",
};
globalThis.fetch = async (url, request) => {
  const body = JSON.parse(request.body);
  if (
    routes[url] !== body.model ||
    !Object.hasOwn(body.questions.pick.criteria, "review-b")
  )
    throw Error("Unexpected fixture request.");
  return Response.json({
    model: body.model,
    answers: { pick: { type: "choice", choice: "review-b" } },
    usage: { input_tokens: 64, output_tokens: 1 },
  });
};
