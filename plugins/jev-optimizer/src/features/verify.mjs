import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inventory, readDocument } from "./workspace.mjs";
import { matchTests } from "./test-matching.mjs";

const escapePattern = (text) => text.replace(/[.*+?|^$()\[\]{}\\]/g, "\\$&");
async function runCase(root, candidate, signal) {
  const ref = candidate.assertion;
  const file = path.resolve(root, ref.path);
  const reporter = fileURLToPath(
    new URL("./node-reporter.mjs", import.meta.url),
  );
  const deadline = AbortSignal.timeout(20_000);
  const abort = signal ? AbortSignal.any([deadline, signal]) : deadline;
  abort.throwIfAborted();
  const method = ref.excerpt.match(
    /^\s*assert\.(equal|strictEqual|deepEqual|deepStrictEqual)\(/,
  )?.[1];
  if (!method) return { outcome: "unverified" };
  const dir = await mkdtemp(path.join(tmpdir(), "jev-receipt-"));
  const receiptPath = path.join(dir, "observations");
  const args = [
    "--test",
    "--import=" + new URL("./node-observe.mjs", import.meta.url).href,
    "--test-name-pattern=^" + escapePattern(candidate.caseName) + "$",
    "--test-reporter=" + reporter,
    file,
  ];
  const proc = spawn(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
    shell: false,
    detached: process.platform !== "win32",
    env: {
      PATH: process.env.PATH ?? "",
      JEV_VERIFY_FILE: file,
      JEV_VERIFY_LINE: String(ref.startLine),
      JEV_VERIFY_RECEIPTS: receiptPath,
      JEV_VERIFY_METHOD: method,
    },
  });
  let text = "",
    size = 0;
  const kill = () => {
    try {
      if (process.platform !== "win32" && proc.pid)
        process.kill(-proc.pid, "SIGKILL");
      else proc.kill("SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  abort.addEventListener("abort", kill, { once: true });
  if (abort.aborted) kill();
  try {
    const exit = await new Promise((resolve, reject) => {
      proc.once("error", reject);
      proc.once("close", resolve);
      proc.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > 32000) kill();
        else text += chunk.toString();
      });
    });
    signal?.throwIfAborted();
    if (deadline.aborted || size > 32000)
      return { outcome: "runner-unavailable" };
    let records;
    try {
      records = text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s));
    } catch {
      return { outcome: "runner-unavailable" };
    }
    const cases = records.filter(
      (e) =>
        ["test:pass", "test:fail"].includes(e.type) &&
        e.name === candidate.caseName &&
        !e.skip,
    );
    let observation;
    try {
      if ((await stat(receiptPath)).size > 1024)
        return { outcome: "unverified" };
      observation = JSON.parse(await readFile(receiptPath, "utf8"));
    } catch {
      return { outcome: "unverified" };
    }
    if (
      cases.length !== 1 ||
      cases[0].line !== candidate.caseStart ||
      observation.method !== method ||
      observation.line !== ref.startLine
    )
      return { outcome: "unverified" };
    const result = cases[0];
    if (
      result.type === "test:pass" &&
      exit === 0 &&
      observation.outcome === "passed"
    )
      return { outcome: "passed" };
    // The observer recorded ERR_ASSERTION from this precise call. A failure elsewhere produces no matching failed observation.
    if (
      result.type === "test:fail" &&
      observation.outcome === "failed" &&
      exit !== 0
    )
      return { outcome: "failed" };
    return { outcome: "unverified" };
  } finally {
    abort.removeEventListener("abort", kill);
    await rm(dir, { recursive: true, force: true });
  }
}

// Call only from an explicitly authorized manual host action. This executes repository test code.
export async function matchAndVerify({
  root,
  criteria,
  testPath,
  choose,
  signal,
}) {
  if (
    typeof testPath !== "string" ||
    path.isAbsolute(testPath) ||
    testPath.split(/[\\/]/).includes("..") ||
    !/\.(?:c?js|mjs)$/.test(testPath)
  )
    throw new TypeError(
      "Expected a workspace-relative JavaScript Node test file",
    );
  const assessment = await matchTests({ root, criteria, choose, signal });
  assessment.scope.verification =
    "Observed Node test run; revision bound to the selected test file. Dependency and environment revisions are not pinned.";
  const runs = new Map();
  for (const row of assessment.matches) {
    const c = row.candidates.find(
      (x) => x.sourceSupported && !x.skipped && x.assertion.path === testPath,
    );
    if (!c) continue;
    const { base, paths, scope } = await inventory(root, { signal });
    if (!paths.includes(testPath)) continue;
    const doc = await readDocument(base, testPath, scope, true, signal);
    if (
      doc?.digest !== c.assertion.digest ||
      !doc.lines.some((l) =>
        /^\s*import\s+(?:assert|strict\s+as\s+assert)\s+from\s+['"]node:assert(?:\/strict)?['"]/.test(
          l,
        ),
      )
    )
      continue;
    const key = [testPath, c.caseStart, c.assertion.startLine].join(":");
    if (!runs.has(key) && runs.size < 4)
      runs.set(key, { ...(await runCase(base, c, signal)), id: randomUUID() });
    const run = runs.get(key);
    if (!run || !["passed", "failed"].includes(run.outcome)) {
      row.execution = run?.outcome ?? "case-limit";
      continue;
    }
    row.status = "verified-" + run.outcome;
    row.execution = run.outcome;
    row.runId = run.id;
    row.evidence = {
      caseName: c.caseName,
      caseStart: c.caseStart,
      assertion: c.assertion,
      snapshot: c.assertion.digest,
    };
  }
  const { base, paths, scope } = await inventory(root, { signal });
  const final = paths.includes(testPath)
    ? await readDocument(base, testPath, scope, true, signal)
    : null;
  for (const row of assessment.matches)
    if (row.runId && row.evidence.snapshot !== final?.digest) {
      assessment.scope.limits.push("test-source-changed-during-run");
      row.status = "source-supported";
      row.execution = "stale-run";
      row.runId = null;
      delete row.evidence;
    }
  return assessment;
}
