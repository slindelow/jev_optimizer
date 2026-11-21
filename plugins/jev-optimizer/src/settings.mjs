import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

export const promptFeatures = ["search", "route", "match"];
export const features = [...promptFeatures, "compact"];
export const providers = ["openrouter", "vercel", "typesafe"];
const compressionPermissions = ["conversationCompaction", "fileResultCompression"];
export const defaultDir = () =>
  process.env.JEV_OPTIMIZER_HOME ||
  path.join(homedir(), ".local", "state", "jev-optimizer");
export function workspace(cwd) {
  let root = realpathSync(cwd);
  try {
    root = realpathSync(
      execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      }).trimEnd(),
    );
  } catch {
    /* Plain directories are scoped to cwd. */
  }
  return { root, id: createHash("sha256").update(root).digest("hex") };
}
export function openSettings(dir = defaultDir(), create = true) {
  if (!path.isAbsolute(dir))
    throw new Error("Use an absolute private state directory.");
  const filename = path.join(dir, "settings.sqlite");
  if (!create && !existsSync(filename)) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec("PRAGMA busy_timeout=1200");
  try {
    db.exec("BEGIN IMMEDIATE");
    const schema = db.prepare("PRAGMA user_version").get().user_version;
    if (schema > 2) throw new Error("Settings require a newer plugin.");
    if (schema === 0) db.exec(`CREATE TABLE IF NOT EXISTS settings (workspace TEXT PRIMARY KEY, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS caps (provider TEXT PRIMARY KEY, usd REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, feature TEXT NOT NULL,
      method TEXT NOT NULL, elapsed REAL NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS run_scope ON runs(workspace,created);
    CREATE TABLE IF NOT EXISTS hooks (workspace TEXT, host TEXT, seen INTEGER, PRIMARY KEY(workspace,host));
    CREATE TABLE IF NOT EXISTS checks (provider TEXT PRIMARY KEY, checked INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hook_results (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, expires INTEGER NOT NULL, result TEXT NOT NULL);
    `);
    if (schema === 1) {
      // Old automatic permissions applied only after an explicit "jev" prefix.
      db.exec(`UPDATE settings SET config=json_set(config,
        '$.legacyExplicit', json_extract(config,'$.auto'), '$.auto', json('[]'))
        WHERE json_array_length(config,'$.auto') > 0`);
    }
    db.exec("PRAGMA user_version=2");
    db.prepare("DELETE FROM hook_results WHERE expires<=?").run(Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
export function readSettings(db, id) {
  const row = db
    ?.prepare("SELECT config FROM settings WHERE workspace=?")
    .get(id);
  return row
    ? JSON.parse(row.config)
    : { provider: null, enabled: [], remote: [], auto: [] };
}
export function configure(db, id, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected an object.");
  if (
    Object.keys(input).some(
      (k) => !["provider", "enabled", "auto", "remote", "capUsd", "preferredSkills", ...compressionPermissions].includes(k),
    )
  )
    throw new Error("Unknown settings field.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const next = readSettings(db, id);
    const previousRemoteCompact = next.remote.includes("compact");
    if ("provider" in input) {
      if (input.provider !== null && !providers.includes(input.provider))
        throw new Error("Unknown provider.");
      if (input.provider !== next.provider) {
        next.remote = [];
        for (const key of compressionPermissions) delete next[key];
      }
      next.provider = input.provider;
    }
    for (const k of ["enabled", "remote", "auto"]) {
      if (!(k in input)) continue;
      if (
        !Array.isArray(input[k]) ||
        !input[k].every((v) => features.includes(v))
      )
        throw new Error("Unknown feature in " + k);
      next[k] = [...new Set(input[k])];
    }
    for (const k of ["remote", "auto"]) {
      if ("enabled" in input && !(k in input))
        next[k] = next[k].filter((v) => next.enabled.includes(v));
      if (next[k].some((v) => !next.enabled.includes(v)))
        throw new Error("Only enabled features may use " + k);
    }
    if ("auto" in input) delete next.legacyExplicit;
    if (next.legacyExplicit) {
      next.legacyExplicit = next.legacyExplicit.filter(v => next.enabled.includes(v));
      if (!next.legacyExplicit.length) delete next.legacyExplicit;
    }
    if (!next.provider && next.remote.length)
      throw new Error("Select a provider.");
    for (const key of compressionPermissions) {
      if (key in input) {
        if (typeof input[key] !== "boolean") throw new Error(key + " must be a boolean.");
        if (input[key] && key === "conversationCompaction" && !next.remote.includes("compact"))
          throw new Error(key + " requires remote compact permission.");
        if (input[key] && key === "fileResultCompression" && !["search","compact"].every(f => next.enabled.includes(f)))
          throw new Error("File-result compression requires enabled search and compact.");
        next[key] = input[key];
      } else if (previousRemoteCompact !== next.remote.includes("compact") ||
                 !next.enabled.includes("compact") || (key === "fileResultCompression" && !next.enabled.includes("search"))) {
        delete next[key];
      }
    }
    if ("preferredSkills" in input) {
      const ids = input.preferredSkills;
      if (!Array.isArray(ids) || ids.length > 32 || ids.some(id =>
        typeof id !== "string" || id.length > 256 || !/^[a-z0-9][a-z0-9._-]*(?:[:/][a-z0-9][a-z0-9._-]*)*$/i.test(id)
      )) throw new Error("preferredSkills must contain up to 32 qualified skill names.");
      next.preferredSkills = [...new Set(ids)];
    }
    if ("capUsd" in input) {
      if (!next.provider || !Number.isFinite(input.capUsd) || input.capUsd < 0)
        throw new Error("Invalid monthly cap or missing provider.");
      db.prepare("INSERT OR REPLACE INTO caps VALUES (?,?)").run(
        next.provider,
        input.capUsd,
      );
    }
    db.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(
      id,
      JSON.stringify(next),
    );
    db.prepare("DELETE FROM hook_results WHERE workspace=?").run(id);
    db.exec("COMMIT");
    return next;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export const capFor = (db, p) =>
  (p && db?.prepare("SELECT usd FROM caps WHERE provider=?").get(p)?.usd) || 0;
