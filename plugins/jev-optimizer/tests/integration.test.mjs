import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
test("bundled command, independent switches, scope, hook and reporting", (t) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "jev-e2e-"));
  t.after(() => rmSync(tmp, { force: true, recursive: true }));
  const cwd = path.join(tmp, "checkout");
  cpSync(path.join(root, "fixtures/checkout"), cwd, { recursive: true });
  const run = (entry, args, input, expect = 0, override = {}) => {
    const env = {
      ...process.env,
      JEV_OPTIMIZER_HOME: path.join(tmp, "user-state"),
      ...override,
    };
    const r = spawnSync(
      process.execPath,
      [path.join(root, "bin", entry), ...args],
      {
        cwd,
        env,
        input: input === undefined ? "" : JSON.stringify(input),
        encoding: "utf8",
      },
    );
    assert.equal(r.status, expect, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const cli = (args, input, expect) => run("jev.mjs", args, input, expect);
  assert.equal(cli(["demo"]).providerCalls, 0);
  cli(["search", "shipping"], null, 1);
  cli(["configure", "--json"], {
    enabled: ["search", "match"],
    auto: ["search"],
  });
  const found = cli(["search", "setShippingAddress"]);
  assert.ok(found.result.results.length);
  cli(["route", "--json"], { task: "test", inventory: [] }, 1);
  const comparison = cli(["compare", "search"], {
    query: "setShippingAddress",
  });
  assert.deepEqual(
    comparison.baseline.result.results,
    comparison.configured.result.results,
  );
  assert.equal(
    run("hook.mjs", [], {
      hook_event_name: "UserPromptSubmit",
      cwd,
      prompt: "ordinary request",
    }),
    null,
  );
  const hook = run("hook.mjs", [], {
    hook_event_name: "UserPromptSubmit",
    cwd,
    prompt: "jev search setShippingAddress",
  });
  assert.match(hook.hookSpecificOutput.additionalContext, /completed search/);
  const id = hook.hookSpecificOutput.additionalContext.match(
    /invocation ([a-f0-9-]+)\./,
  )[1];
  const saved = cli(["show", id]);
  assert.ok(saved.result.results.length);
  assert.equal(saved.historical, true);
  writeFileSync(path.join(cwd, ".ignore"), "shipping.mjs\n");
  cli(["show", id], null, 1);
  rmSync(path.join(cwd, ".ignore"));
  const sample = [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('change address after selecting rate', () => {",
    "  const checkout = { selectedRate: null, selectRate(v){ this.selectedRate=v; }, changeAddress(v){ this.selectedRate=null; } };",
    "  checkout.selectRate('express');",
    "  checkout.changeAddress('new');",
    "  assert.equal(checkout.selectedRate, null);",
    "});",
  ].join("\n");
  const target = "rate.test.mjs";
  const spec = {
    criteria: [
      {
        id: "reset",
        precondition: "select rate",
        action: "change address",
        expected: "selected rate resets",
      },
    ],
  };
  writeFileSync(path.join(cwd, target), sample);
  assert.equal(
    cli(["verify-match", target, "--json"], spec).matches[0].status,
    "verified-passed",
  );
  writeFileSync(
    path.join(cwd, target),
    sample.replace(
      "changeAddress(v){ this.selectedRate=null; }",
      "changeAddress(v){}",
    ),
  );
  assert.equal(
    cli(["verify-match", target, "--json"], spec).matches[0].status,
    "verified-failed",
  );
  for (const provider of ["openrouter", "vercel", "typesafe"]) {
    cli(["configure", "--json"], {
      provider,
      enabled: ["search"],
      remote: ["search"],
      capUsd: 0,
    });
    const remote = cli(["search", "shipping.mjs"]);
    assert.ok(remote.result.results.length);
  }
  cli(["configure", "--json"], { enabled: [] });
  cli(["show", id], null, 1);
  assert.equal(cli(["disconnect"]).provider, null);
  assert.ok(cli(["report"]).activity.length);
});
test("both host manifests declare the installed plugin", () => {
  const read = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
  for (const f of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"])
    assert.equal(read(f).name, "jev-optimizer");
});
