import { boundedQuery, limits } from "./workspace.mjs";
import { pick, terms, coverage } from "./ranking.mjs";

export async function routeSkill({
  task,
  inventory,
  explicit,
  preferredIds = [],
  choose,
  signal,
}) {
  signal?.throwIfAborted();
  task = boundedQuery(task);
  if (
    !Array.isArray(inventory) ||
    inventory.length > 5000 ||
    !Array.isArray(preferredIds)
  )
    throw new TypeError(
      "Expected a bounded capability inventory and preferences",
    );
  const entries = new Map();
  const duplicates = new Set();
  for (const item of inventory) {
    if (
      !item ||
      typeof item.id !== "string" ||
      item.id.length > 256 ||
      /[\x00-\x1f\x7f]/.test(item.id)
    )
      continue;
    if (entries.has(item.id)) duplicates.add(item.id);
    entries.set(item.id, item);
  }
  const eligible = [...entries.values()].filter(
    (i) =>
      !duplicates.has(i.id) &&
      i.available !== false &&
      i.enabled !== false &&
      i.compatible !== false,
  );
  const summary = (i) => ({
    id: i.id,
    description: String(i.description ?? "").slice(0, 600),
    available: i.available === true,
    source: String(i.source ?? "unspecified").slice(0, 120),
  });
  const result = (method, item, candidates, reason) => ({
    method,
    selected: item?.id ?? null,
    availability: item
      ? item.available === true
        ? "callable"
        : "requires-host-check"
      : "unselected",
    alternatives: candidates.slice(0, 8).map(summary),
    reason,
  });
  if (explicit) {
    const direct = eligible.find((i) => i.id === explicit);
    if (direct) return result("explicit", direct, [], "qualified-request");
    const siblings = eligible.filter(
      (i) => i.id.split(/[:/]/).at(-1) === explicit,
    );
    if (siblings.length === 1 && !entries.has(explicit))
      return result("explicit", siblings[0], [], "unique-short-name");
    return result(
      "unavailable",
      null,
      siblings,
      siblings.length > 1
        ? "ambiguous-name"
        : "explicit-capability-unavailable",
    );
  }
  const wanted = terms(task);
  const scored = eligible
    .map((item) => ({
      item,
      score: coverage(wanted, (item.description ?? "") + " " + item.id),
    }))
    .filter((i) => i.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id, "en"),
    );
  const ranked = scored.slice(0, limits.candidates);
  const options = ranked.map((r) => r.item);
  const favored = preferredIds
    .map((id) => scored.find(({item}) => item.id === id)?.item)
    .find(Boolean);
  if (favored)
    return result("preference", favored, options, "trusted-preference-matched");
  if (!ranked.length) return result("local", null, [], "no-local-match");
  if (
    ranked[0].score >= 0.5 &&
    (ranked.length === 1 || ranked[0].score > ranked[1].score + 0.25)
  )
    return result(
      "local",
      options[0],
      options.slice(1),
      "unambiguous-local-match",
    );
  const decision = await pick({
    feature: "routing",
    query: task,
    candidates: options.map(summary),
    choose,
  });
  signal?.throwIfAborted();
  return result(
    decision.method,
    options.find((i) => i.id === decision.choice),
    options,
    decision.choice ? "provider-selected" : "ambiguous-or-weak-match",
  );
}
