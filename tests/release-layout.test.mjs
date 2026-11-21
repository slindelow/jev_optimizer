import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("both marketplaces distribute the same plugin subtree without mutable checkout files", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const read = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const claude = read(".claude-plugin/marketplace.json").plugins[0];
  const codex = read(".agents/plugins/marketplace.json").plugins[0];
  assert.equal(codex.source.path, "./plugins/jev-optimizer");
  assert.equal(claude.source, codex.source.path);
  for (const f of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "package.json"]) {
    const manifest = read(path.join(claude.source, f));
    assert.equal(manifest.name, claude.name);
    assert.equal(manifest.version, claude.version);
  }
  for (const mutable of [".git", ".codex-marketplace-install.json", ".claude-plugin/marketplace.json"])
    assert.equal(existsSync(path.join(root, claude.source, mutable)), false);
});
