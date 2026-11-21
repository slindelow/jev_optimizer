import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { searchFiles, routeSkill, matchTests } from "../src/features/index.mjs";

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), "jev-features-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  return root;
}
const noRemote = () => assert.fail("Unexpected provider invocation");

test("exact path and symbol lookup are local and outputs resolve to verbatim source", async (t) => {
  const root = await fixture(t, {
    "src/café.js":
      "// café\nexport function updateAddress() { return true; }\n",
    "pkg/shipping.js": "export function updateAddress() { return false; }\n",
  });
  assert.equal(
    (await searchFiles({ root, query: "src/café.js", choose: noRemote }))
      .results[0].excerpt,
    "// café",
  );
  const r = await searchFiles({
    root,
    query: "updateAddress",
    choose: noRemote,
  });
  assert.equal(r.method, "exact-text");
  assert.equal(r.results.length, 2);
  assert.deepEqual(
    r.results.map((v) => [v.path, v.startLine, v.symbol]),
    [
      ["pkg/shipping.js", 1, "updateAddress"],
      ["src/café.js", 2, "updateAddress"],
    ],
  );
  assert.match(r.results[0].digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    (await searchFiles({ root, query: "reticulate splines" })).results,
    [],
  );
});

test("search respects gitignore, hidden paths, symlinks, binary, credential and vendor exclusions", async (t) => {
  const outside = await fixture(t, { "external.js": "NEEDLE_EXTERNAL" });
  const root = await fixture(t, {
    ".gitignore": "ignored/\n",
    "ignored/thing.js": "NEEDLE_IGNORED",
    "node_modules/v/thing.js": "NEEDLE_VENDOR",
    "secrets/config.json": "NEEDLE_CONFIG",
    ".shadow.js": "NEEDLE_HIDDEN",
    "binary.js": Buffer.from([78, 69, 69, 68, 76, 69, 0]),
    "creds.js": 'const password = "DO_NOT_DISCLOSE"; // NEEDLE',
  });
  await symlink(
    path.join(outside, "external.js"),
    path.join(root, "outside.js"),
  );
  for (const q of [
    "NEEDLE",
    "ignored/thing.js",
    "../external.js",
    "outside.js",
  ])
    assert.deepEqual((await searchFiles({ root, query: q })).results, []);
});

test("natural fixes return diverse implementation candidates alongside relevant tests", async t => {
  const root = await fixture(t, {
    "src/renderer.ts": "export class InvoiceRenderer {\n  // Render totals\n  // Preserve currency when rounded.\n}\n",
    "tests/renderer.test.ts": "// Check rendering an invoice total with currency.\n// Check rendering another invoice total with currency.\n",
    "docs/tests.md": "Add a regression test. Preserve support for all previously valid behavior.\n",
  });
  const {results} = await searchFiles({root, query:"Fix invoice rendering when rounding currency. Add a regression test. Preserve support for all previously valid behavior."});
  const paths = results.map(r => r.path);
  assert.ok(paths.includes("src/renderer.ts"));
  assert.equal(new Set(paths).size, paths.length);
  assert.notEqual(paths[0], "docs/tests.md");
});

test("reranking cannot add locations and mutated evidence cannot survive", async (t) => {
  const root = await fixture(t, {
    "a.js": "// product cart calculation\n",
    "b.js": "// cart calculation helper\n",
  });
  const r = await searchFiles({
    root,
    query: "cart price calculation",
    choose: async ({ candidates }) => {
      assert.ok(candidates.length >= 2);
      await writeFile(path.join(root, "a.js"), "// changed on disk\n");
      return "../../elsewhere";
    },
  });
  assert.equal(r.method, "local-invalid-choice");
  assert.ok(r.scope.limits.includes("stale-result"));
  assert.deepEqual(
    r.results.map((v) => v.path),
    ["b.js"],
  );
});

test("routing handles qualification, unavailable inventory, ambiguous names, provider fallback and no match", async () => {
  const inventory = [
    {
      id: "repo:check",
      source: "repo",
      description: "test checkout",
      available: true,
    },
    { id: "global:check", description: "test checkout", available: null },
    { id: "disabled:check", description: "checkout", available: false },
  ];
  assert.equal(
    (
      await routeSkill({
        task: "checkout",
        explicit: "repo:check",
        inventory,
        choose: noRemote,
      })
    ).selected,
    "repo:check",
  );
  assert.equal(
    (
      await routeSkill({
        task: "checkout",
        explicit: "check",
        inventory,
        choose: noRemote,
      })
    ).selected,
    null,
  );
  assert.equal(
    (
      await routeSkill({
        task: "checkout",
        explicit: "disabled:check",
        inventory,
        choose: noRemote,
      })
    ).method,
    "unavailable",
  );
  assert.equal(
    (
      await routeSkill({
        task: "checkout",
        explicit: "global:check",
        inventory,
      })
    ).availability,
    "requires-host-check",
  );
  const weak = await routeSkill({
    task: "test checkout",
    inventory,
    choose: async () => {
      throw new Error("deadline");
    },
  });
  assert.equal(weak.selected, null);
  assert.equal(weak.method, "local-unavailable");
  const picked = await routeSkill({
    task: "test checkout",
    inventory,
    choose: async () => "repo:check",
  });
  assert.equal(picked.selected, "repo:check");
  assert.equal(
    (
      await routeSkill({
        task: "rainbow unicorns",
        inventory,
        choose: noRemote,
      })
    ).selected,
    null,
  );
});

const initial = [
  "test('checkout renders initial shipping rate', () => {",
  "  const checkout = createCheckout();",
  "  assert.equal(checkout.selectedRate, null);",
  "});",
].join("\n");
const reset = [
  "test('checkout changes address after selecting shipping rate', () => {",
  "  const checkout = createCheckout();",
  '  checkout.selectRate("express");',
  '  checkout.changeAddress("elsewhere");',
  "  assert.equal(checkout.selectedRate, null);",
  "});",
].join("\n");
const criterion = {
  id: "reset",
  precondition: "select rate",
  action: "change address",
  expected: "selected rate resets",
};
test("matcher requires ordered action plus matching assertion, and revalidates observations", async (t) => {
  const root = await fixture(t, { "checkout.test.js": initial });
  const options = { root, criteria: [criterion] };
  let row = (await matchTests(options)).matches[0];
  assert.equal(row.status, "candidate");
  await writeFile(path.join(root, "checkout.test.js"), reset);
  row = (await matchTests(options)).matches[0];
  assert.equal(row.status, "source-supported");
  assert.deepEqual(
    row.candidates[0].setup.map((s) => s.startLine),
    [3, 4],
  );
  assert.equal(row.candidates[0].assertion.startLine, 5);
  const receipt = {
    snapshot: "s1",
    path: "checkout.test.js",
    digest: row.candidates[0].assertion.digest,
    line: 5,
    caseName: row.candidates[0].caseName,
    caseStart: 1,
    executed: true,
    runId: "run-01",
    outcome: "passed",
  };
  for (const [override, expected] of [
    [{}, "verified-passed"],
    [{ outcome: "failed" }, "verified-failed"],
    [{ snapshot: "stale" }, "source-supported"],
    [{ executed: false }, "source-supported"],
    [{ caseStart: 9 }, "source-supported"],
    [{ outcome: "skipped" }, "source-supported"],
  ]) {
    const result = await matchTests({
      ...options,
      getCurrentSnapshot: () => "s1",
      getObservation: () => ({ ...receipt, ...override }),
    });
    assert.equal(result.matches[0].status, expected);
  }
  await writeFile(
    path.join(root, "checkout.test.js"),
    reset.replace("test(", "test.skip("),
  );
  row = (
    await matchTests({
      ...options,
      getCurrentSnapshot: () => "s1",
      getObservation: noRemote,
    })
  ).matches[0];
  assert.equal(row.execution, "skipped");
  await writeFile(
    path.join(root, "checkout.test.js"),
    reset.replace("assert.equal", "assert.notEqual"),
  );
  assert.equal((await matchTests(options)).matches[0].status, "candidate");
  await writeFile(
    path.join(root, "checkout.test.js"),
    reset.replace(
      '  checkout.changeAddress("elsewhere");',
      '  // checkout.changeAddress("elsewhere");',
    ),
  );
  assert.equal((await matchTests(options)).matches[0].status, "candidate");
});

test("property references, actions on another subject and skipped Python cases lack execution evidence", async (t) => {
  const root = await fixture(t, {
    "checkout.test.js": reset.replace(
      'checkout.changeAddress("elsewhere");',
      "checkout.changeAddress;",
    ),
  });
  const row = async () =>
    (await matchTests({ root, criteria: [criterion] })).matches[0];
  assert.equal((await row()).status, "candidate");
  await writeFile(
    path.join(root, "checkout.test.js"),
    reset.replace("checkout.selectRate", "another.selectRate"),
  );
  assert.equal((await row()).status, "candidate");
  await writeFile(
    path.join(root, "checkout.test.js"),
    reset.replace(
      '  checkout.changeAddress("elsewhere");',
      '  if (false) checkout.changeAddress("elsewhere");',
    ),
  );
  assert.equal((await row()).status, "candidate");
  const py = await fixture(t, {
    "test_checkout.py":
      "@pytest.mark.skip\ndef test_clear_rate():\n    checkout.select_rate()\n    checkout.change_address()\n    assert checkout.selected_rate is None\n",
  });
  const caseRow = (await matchTests({ root: py, criteria: [criterion] }))
    .matches[0];
  assert.equal(caseRow.candidates[0].skipped, true);
  assert.notEqual(caseRow.status, "verified-passed");
});

test("manual verification runs a real isolated Node test and identifies the assertion", async (t) => {
  const { matchAndVerify } = await import("../src/features/index.mjs");
  const imports =
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\n";
  const create =
    'const createCheckout=()=>({selectedRate:"express",selectRate(){},changeAddress(){this.selectedRate=null;}});\n';
  const root = await fixture(t, {
    "checkout.test.mjs": imports + create + reset,
    "logo.png": Buffer.from([137, 80, 78, 71, 0]),
  });
  const verify = async () =>
    (
      await matchAndVerify({
        root,
        criteria: [criterion],
        testPath: "checkout.test.mjs",
      })
    ).matches[0];
  const result = await verify();
  assert.equal(result.status, "verified-passed", JSON.stringify(result));
  await writeFile(
    path.join(root, "checkout.test.mjs"),
    imports + create.replace("this.selectedRate=null;", "") + reset,
  );
  assert.equal((await verify()).status, "verified-failed");
  await writeFile(
    path.join(root, "checkout.test.mjs"),
    imports +
      create +
      reset.replace(
        "  assert.equal",
        '  throw Error("earlier failure");\n  assert.equal',
      ),
  );
  assert.notEqual((await verify()).status, "verified-failed");
});

test("abort stops preflight and an active file discovery", async (t) => {
  const root = await fixture(t, { "checkout.test.mjs": reset });
  const early = AbortSignal.abort(new Error("cancelled preflight"));
  await assert.rejects(
    searchFiles({ root, query: "address", signal: early }),
    /cancelled preflight/,
  );
  const controller = new AbortController();
  const pending = matchTests({
    root,
    criteria: [criterion],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new Error("cancelled scanning")), 1);
  await assert.rejects(pending, /cancelled scanning/);
});
