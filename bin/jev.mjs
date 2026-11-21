#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import {
  openSettings,
  configure,
  readSettings,
  workspace,
  capFor,
  providers,
  defaultDir,
  promptFeatures,
} from "../src/settings.mjs";
import { runFeature } from "../src/app.mjs";
import {
  credentialStatus,
  connectOpenRouter,
  forgetCredential,
  decide,
  usageReport,
} from "../src/provider/index.mjs";

const help = `jev-optimizer • Node 22.13+ and ripgrep
demo | status | report | verify | disconnect | forget PROVIDER | show INVOCATION_ID
login openrouter [--headless]       authenticate using a browser
login typesafe                      enter a direct API key in a masked macOS dialog
configure --json                    read workspace settings as JSON on stdin
search WORDS | match CRITERION       run an enabled feature
search|match|route --json            read {query}, {criteria}, or {task,inventory} from stdin
verify-match TEST_PATH --json        explicitly execute a trusted local Node test to verify matching assertions
compare search|match|route           read the same JSON and run local and configured ranking
configure example: {"enabled":["search","match"],"provider":"openrouter","remote":["search"],"auto":[],"capUsd":1}
Set enabled, remote and auto independently. The monthly provider cap is shared across workspaces.
Use {"enabled":[]} to disable. Disconnect removes this workspace's provider. Forget removes an OS-stored credential globally.
Local automatic setup: {"enabled":["route","search","match","compact"],"auto":["route","search","match","compact"]}
Ordinary coding prompts can trigger routing, source search and test matching. Explicit jev search and jev match are also supported.
Compaction uses the available host lifecycle. See docs/compaction.md for host-specific support.
A manual route requires qualified IDs and actual session availability. Enter secrets only through a provider sign-in or secure user environment.`;
async function inputJson() {
  if (stdin.isTTY) throw new Error("Expected JSON on stdin.");
  let size = 0;
  const parts = [];
  for await (const part of stdin) {
    size += part.length;
    if (size > 250000) throw new Error("Input exceeds 250 KB.");
    parts.push(part);
  }
  const input = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected a JSON object.");
  return input;
}
const print = (value) => console.log(JSON.stringify(value, null, 2));
async function main() {
  const [cmd = "help", ...args] = process.argv.slice(2);
  if (cmd === "help" || cmd === "--help") {
    console.log(help);
    return;
  }
  if (cmd === "demo") {
    const root = fileURLToPath(
      new URL("../fixtures/checkout/", import.meta.url),
    );
    const context = {
      scope: { root, id: "bundled-demo" },
      config: { enabled: promptFeatures, remote: [] },
      local: true,
    };
    const search = await runFeature({
      ...context,
      feature: "search",
      input: { query: "setShippingAddress" },
    });
    const match = await runFeature({
      ...context,
      feature: "match",
      input: {
        criteria: [
          {
            id: "rate-reset",
            precondition: "selected shipping rate",
            action: "change address",
            expected: "selected rate resets",
          },
        ],
      },
    });
    print({
      mode: "offline demo",
      providerCalls: 0,
      search: search.result,
      match: match.result,
    });
    return;
  }
  const scope = workspace(process.cwd()),
    dir = defaultDir(),
    db = openSettings(dir);
  try {
    const config = readSettings(db, scope.id),
      provider = config.provider;
    const cap = capFor(db, provider);
    if (cmd === "status") {
      const connections = {};
      for (const p of providers)
        connections[p] = {
          ...(await credentialStatus(p)),
          historicalProviderCheckAt:
            db.prepare("SELECT checked FROM checks WHERE provider=?").get(p)
              ?.checked ?? null,
        };
      print({
        workspace: scope.root,
        settings: config,
        monthlyCapUsd: cap,
        connections,
        hooks: db
          .prepare(
            "SELECT host, seen AS lastObserved FROM hooks WHERE workspace=?",
          )
          .all(scope.id),
      });
    } else if (cmd === "configure") {
      if (args[0] !== "--json")
        throw new Error("configure requires --json on stdin.");
      print(configure(db, scope.id, await inputJson()));
    } else if (cmd === "disconnect")
      print(configure(db, scope.id, { provider: null, remote: [] }));
    else if (cmd === "forget") {
      if (!providers.includes(args[0])) throw new Error("Unknown provider.");
      const active = await forgetCredential(args[0]);
      db.prepare("DELETE FROM checks WHERE provider=?").run(args[0]);
      print({ provider: args[0], connection: active });
    } else if (cmd === "login") {
      if (args[0] === "typesafe") {
        const { connectTypeSafe } = await import("../src/provider/key-prompt.mjs");
        const connection = await connectTypeSafe();
        db.prepare("DELETE FROM checks WHERE provider=?").run("typesafe");
        print(connection);
        return;
      }
      if (args[0] !== "openrouter")
        throw new Error("Browser login is available for OpenRouter.");
      const headless = args.includes("--headless");
      if (headless && !stdin.isTTY)
        throw new Error("Headless login needs a private interactive terminal.");
      const onUrl = async (url) => {
        stderr.write(
          "Authorize this connection in your browser:\n" + url + "\n",
        );
        if (!headless) {
          const app =
            process.platform === "darwin"
              ? "open"
              : process.platform === "linux"
                ? "xdg-open"
                : null;
          if (app) {
            const child = spawn(app, [url], {
              stdio: "ignore",
              detached: true,
            });
            child.on("error", () =>
              stderr.write("Open the authorization URL shown above.\n"),
            );
            child.unref();
          }
        }
      };
      const headlessCode = headless
        ? async () => {
            const rl = createInterface({ input: stdin, output: stderr });
            try {
              return await rl.question("Single-use authorization code: ");
            } finally {
              rl.close();
            }
          }
        : undefined;
      await connectOpenRouter({
        onUrl,
        headlessCode,
        limitUsd: capFor(db, "openrouter") || 1,
      });
      db.prepare("DELETE FROM checks WHERE provider=?").run("openrouter");
      print({
        configured: "openrouter",
        next: "Select the connection in workspace settings.",
      });
    } else if (cmd === "verify") {
      if (!provider || !cap)
        throw new Error(
          "Select a provider and a positive cap before a paid check.",
        );
      const r = await decide({
        provider,
        feature: "verify",
        workspaceId: scope.id,
        dataDir: dir,
        capUsd: cap,
        state: "The sample color is blue.",
        questions: {
          color: {
            type: "choice",
            instructions: "Choose the color named in the sample.",
            options: ["blue", "red"],
          },
        },
      });
      if (r.answers.color.choice !== "blue")
        throw new Error(
          "The synthetic decision returned an unexpected answer.",
        );
      db.prepare("INSERT OR REPLACE INTO checks VALUES (?,?)").run(
        provider,
        Date.now(),
      );
      print({ verified: true, provider, model: r.model, usage: r.usage });
    } else if (cmd === "verify-match") {
      if (!config.enabled.includes("match"))
        throw new Error("Feature is disabled: match");
      if (!args[0] || args[1] !== "--json")
        throw new Error(
          "Supply an explicit workspace test path and criteria JSON.",
        );
      const input = await inputJson();
      if (
        !Array.isArray(input.criteria) ||
        !input.criteria.length ||
        input.criteria.length > 20
      )
        throw new Error("Supply 1–20 acceptance criteria.");
      const { matchAndVerify } = await import("../src/features/index.mjs");
      print(
        await matchAndVerify({
          root: scope.root,
          criteria: input.criteria,
          testPath: args[0],
          signal: AbortSignal.timeout(30000),
        }),
      );
    } else if (cmd === "show") {
      const { readHookResult } = await import("../src/hook-result.mjs");
      print(await readHookResult(db, scope, config, args[0] || ""));
    } else if (cmd === "report") {
      print({
        billing: await usageReport({ dataDir: dir, workspaceId: scope.id }),
        activity: db
          .prepare(
            "SELECT feature,method,count(*) AS runs,round(avg(elapsed),2) AS meanMs FROM runs WHERE workspace=? AND created>=? GROUP BY feature,method",
          )
          .all(scope.id, Date.now() - 30 * 86400000),
        activityWindow: "last 30 days",
      });
    } else {
      const feature = cmd === "compare" ? args[0] : cmd;
      if (!promptFeatures.includes(feature))
        throw new Error("Unknown command. See help.");
      const input =
        args[0] === "--json" || cmd === "compare"
          ? await inputJson()
          : feature === "search"
            ? { query: args.join(" ") }
            : feature === "match"
              ? { criteria: [args.join(" ")] }
              : {};
      const context = { scope, config, dir, db, feature, input };
      if (cmd === "compare") {
        const baseline = await runFeature({ ...context, local: true });
        const configured = await runFeature(context);
        print({
          baseline,
          configured,
          snapshotEquivalence: "unverified",
          interpretation:
            "Sequential runs over a mutable workspace, local run first. Inspect returned source digests and apply relevance labels before attributing a difference to Jev.",
        });
      } else print(await runFeature(context));
    }
  } finally {
    db.close();
  }
}
main().catch((error) => {
  stderr.write((error.code ? error.code + ": " : "") + error.message + "\n");
  process.exitCode = 1;
});
