import { boundedQuery, secretLike } from "./workspace.mjs";

const common = new Set(
  "a an the of to is in at by or on as be and for with this that from after before should does use where which when then are please find how its it can will has have js ts test tests spec specs function const let var return expect assert strict equal tobe tohave tohavebeen describe true false async await".split(
    " ",
  ),
);
const aliases = new Map([
  ["changed", "change"],
  ["changing", "change"],
  ["changes", "change"],
  ["selected", "select"],
  ["selecting", "select"],
  ["selection", "select"],
  ["chosen", "select"],
  ["choose", "select"],
  ["cleared", "clear"],
  ["clears", "clear"],
  ["reset", "clear"],
  ["resets", "clear"],
  ["empty", "clear"],
  ["null", "clear"],
  ["updated", "change"],
  ["updates", "change"],
  ["update", "change"],
  ["addresses", "address"],
  ["shipping", "ship"],
  ["returns", "return"],
]);
export function terms(input) {
  const split =
    input
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [
    ...new Set(
      split
        .map(
          (w) =>
            aliases.get(w) ??
            (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w),
        )
        .filter((w) => !common.has(w) && w.length > 1),
    ),
  ];
}
export function coverage(required, text) {
  const inText = new Set(terms(text));
  return required.length
    ? required.filter((t) => inText.has(t)).length / required.length
    : 0;
}
export async function pick({ feature, query, candidates, choose }) {
  boundedQuery(query);
  if (!choose || candidates.length < 2)
    return { method: "local", choice: null };
  if ([query, ...candidates.map((c) => c.description)].some(secretLike))
    return { method: "local-sensitive", choice: null };
  try {
    const id = await choose({
      feature,
      query: query.slice(0, 1500),
      candidates: candidates.map(({ id, description }) => ({
        id,
        description: description.slice(0, 600),
      })),
    });
    if (id === null) return { method: "abstained", choice: null };
    if (typeof id === "string" && candidates.some((c) => c.id === id))
      return { method: "provider", choice: id };
    return { method: "local-invalid-choice", choice: null };
  } catch {
    return { method: "local-unavailable", choice: null };
  }
}
