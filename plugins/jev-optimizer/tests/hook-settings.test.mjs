import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openSettings, readSettings, configure } from "../src/settings.mjs";

test("expanded remote content permissions are explicit and scoped to the selected provider", t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "jev-permissions-"));
  const db = openSettings(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const flags = { conversationCompaction: true, fileResultCompression: true };
  const basic = configure(db, "one", { provider: "typesafe", enabled: ["search","compact"], remote: ["compact"] });
  assert.ok(!basic.conversationCompaction && !basic.fileResultCompression);
  assert.throws(() => configure(db, "two", flags));
  assert.equal(configure(db, "one", { ...flags, preferredSkills: ["team:review"] }).fileResultCompression, true);
  assert.throws(() => configure(db, "one", { preferredSkills: ["bad\nname"] }));
  assert.deepEqual(readSettings(db, "one").preferredSkills, ["team:review"]);
  assert.throws(() => configure(db, "one", { fileResultCompression: "yes" }));
  const changed = configure(db, "one", { provider: "vercel", remote: ["compact"] });
  assert.ok(!changed.conversationCompaction && !changed.fileResultCompression);
  configure(db, "one", flags);
  assert.ok(!configure(db, "one", { remote: [] }).fileResultCompression);
  assert.equal(configure(db, "one", { fileResultCompression: true }).fileResultCompression, true);
  assert.ok(!configure(db, "one", { remote: ["compact"] }).fileResultCompression);
});

test("legacy prefix permissions require explicit opt-in to ordinary prompt dispatch", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "jev-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seed = openSettings(dir);
  const old = { provider: "typesafe", enabled: ["search"], remote: ["search"], auto: ["search"] };
  seed.prepare("INSERT INTO settings VALUES (?, ?)").run("repo", JSON.stringify(old));
  seed.exec("PRAGMA user_version=1");
  seed.close();

  const db = openSettings(dir);
  t.after(() => db.close());
  assert.deepEqual(readSettings(db, "repo"), { ...old, auto: [], legacyExplicit: ["search"] });
  assert.deepEqual(configure(db, "repo", { capUsd: 0.10 }).legacyExplicit, ["search"]);
  const auto = ["search", "route", "compact"];
  const updated = configure(db, "repo", { enabled: auto, auto });
  assert.deepEqual(updated.auto, auto);
  assert.equal(updated.legacyExplicit, undefined);
  assert.deepEqual(updated.remote, ["search"]);
  assert.deepEqual(readSettings(db, "other").auto, []);
});
