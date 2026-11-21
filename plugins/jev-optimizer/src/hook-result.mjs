import { inventory, readDocument } from "./features/workspace.mjs";

// A cached verdict can be historical. Never disclose excerpts that the current
// workspace rules exclude, or that now refer to different source.
export async function readHookResult(db, scope, config, id) {
  const row = db
    .prepare(
      "SELECT result, expires FROM hook_results WHERE id=? AND workspace=? AND expires>?",
    )
    .get(id, scope.id, Date.now());
  const unavailable = () =>
    new Error("Hook result unavailable or expired for this workspace.");
  if (!row) throw unavailable();
  const saved = JSON.parse(row.result);
  if (
    !config.enabled.includes(saved.feature) ||
    !(config.auto.includes(saved.feature) || config.legacyExplicit?.includes(saved.feature))
  )
    throw unavailable();
  const refs = new Map();
  function collect(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.path === "string" && typeof value.digest === "string")
      refs.set(value.path, value.digest);
    for (const child of Object.values(value)) collect(child);
  }
  collect(saved.result);
  if (refs.size) {
    const current = await inventory(scope.root);
    const eligible = new Set(current.paths);
    for (const [path, digest] of refs) {
      if (
        !eligible.has(path) ||
        (await readDocument(current.base, path, current.scope, true))
          ?.digest !== digest
      ) {
        throw unavailable();
      }
    }
  }
  return {
    ...saved,
    historical: true,
    capturedAt: new Date(row.expires - 300000).toISOString(),
  };
}
