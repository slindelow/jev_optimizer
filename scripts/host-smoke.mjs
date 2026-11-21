// Exercise local marketplace installation in disposable host configurations.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), "jev-host-smoke-"));
function run(binary, args, env, cwd = scratch, input = "") {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    cwd,
    env,
    input,
    timeout: 45000,
    maxBuffer: 2_000_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      binary +
        " " +
        args[0] +
        " failed: " +
        (result.error?.message || result.stderr || result.stdout),
    );
  return result.stdout;
}
function locate(directory) {
  const found = [];
  for (const e of readdirSync(directory, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== ".git")
      found.push(...locate(path.join(directory, e.name)));
    if (e.name === "jev.mjs" && e.isFile())
      found.push(path.join(directory, e.name));
  }
  return found;
}
const options = process.argv.slice(2);
const github = options.includes("--github");
const selected = options.filter(o => o !== "--github");
if (!selected.length) selected.push("claude", "codex");
try {
  for (const host of selected) {
    assert.ok(["claude", "codex"].includes(host));
    const conf = path.join(scratch, host);
    mkdirSync(conf);
    const env = {
      PATH: process.env.PATH,
      HOME: homedir(),
      TERM: "dumb",
      CI: "1",
      LANG: "C",
      JEV_OPTIMIZER_HOME: path.join(scratch, "engine"),
      CLAUDE_CONFIG_DIR: conf,
      CODEX_HOME: conf,
    };
    const source = github ? "https://github.com/slindelow/jev_optimizer.git" : root;
    run(host, ["plugin", "marketplace", "add", source], env);
    run(
      host,
      [
        "plugin",
        host === "claude" ? "install" : "add",
        "jev-optimizer@jev-tools",
      ],
      env,
    );
    const installed = locate(conf).filter((p) =>
      p.includes(path.sep + "cache" + path.sep),
    );
    assert.ok(
      installed.length,
      host +
        " has no copied plugin under cache; installed files: " +
        locate(conf).join(","),
    );
    const demo = JSON.parse(run(process.execPath, [installed[0], "demo"], env));
    assert.equal(demo.providerCalls, 0);
    assert.ok(demo.search.results.length);
    console.log(
      host +
        ": installed from " + (github ? "GitHub" : "local marketplace") + "; cached plugin executed checkout demo",
    );
    for (const provider of ["openrouter", "vercel", "typesafe"]) {
      const cli = (args, input) =>
        JSON.parse(
          run(
            process.execPath,
            [installed[0], ...args],
            {
              ...env,
              OPENROUTER_API_KEY: "synthetic-fixture",
              AI_GATEWAY_API_KEY: "synthetic-fixture",
              TYPESAFE_API_KEY: "synthetic-fixture",
              NODE_OPTIONS:
                "--import=" +
                new URL("./provider-fixture.mjs", import.meta.url).href,
            },
            scratch,
            JSON.stringify(input),
          ),
        );
      cli(["configure", "--json"], {
        provider,
        enabled: ["route"],
        remote: ["route"],
        capUsd: 1,
      });
      const routed = cli(["route", "--json"], {
        task: "review code",
        inventory: [
          { id: "review-a", available: true, description: "review code" },
          { id: "review-b", available: true, description: "review code" },
        ],
      });
      assert.equal(routed.result.selected, "review-b", JSON.stringify(routed));
      assert.equal(routed.measurement.decisionAttempts, 1);
      assert.deepEqual(routed.decisionWarnings, []);
      console.log(
        host +
          " / " +
          provider +
          ": installed CLI selected expected tool via synthetic HTTP response",
      );
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
