import {
  boundedQuery,
  evidence,
  inventory,
  limits,
  readDocument,
} from "./workspace.mjs";
import { terms, coverage, pick } from "./ranking.mjs";

const isTest = (p) =>
  /(?:^|\/)(?:__tests__|tests?|specs?)\/|(?:\.|_)(?:test|spec)\.|(?:^|\/)test_/.test(
    p,
  );
const supported = (p) => /\.(?:[cm]?[jt]sx?|py)$/.test(p);
const testHeader =
  /^\s*(?:await\s+)?(?:test|it)(?:\.(skip|only|todo))?\s*\(\s*(["'\x60])((?:(?!\2).)+?)\2\s*,\s*(?:async\s*)?(?:function\s*\([^)]*\)|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)\s*\{\s*$/;
const assertLine = /^\s*(?:await\s+)?(?:assert(?:\.|\s|\()|expect\s*\()/;
const jsCloser = /^\s*\}\s*\)\s*;?\s*$/;

function parseCases(doc, scope) {
  const py = doc.path.endsWith(".py");
  const ambiguousLiterals = doc.lines.some((line) =>
    /\/\*|\*\/|`|'''|"""/.test(line),
  );
  const cases = [];
  let current = null;
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    const head = py
      ? /^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(.*\).*:\s*$/.exec(line)
      : testHeader.exec(line);
    if (head) {
      if (current && py) current.end = i;
      current = {
        name: py ? head[2] : head[3],
        start: i,
        end: i + 1,
        indent: line.search(/\S/),
        skipped: py ? false : ["todo", "skip"].includes(head[1]),
        body: [],
        assertions: [],
        complete: false,
      };
      let decorator = i - 1;
      while (py && decorator >= 0 && /^\s*@/.test(doc.lines[decorator])) {
        current.skipped ||= /\b(?:skip|skipif|xfail)\b/i.test(
          doc.lines[decorator],
        );
        decorator--;
      }
      current.unanalysed = ambiguousLiterals || (py && decorator !== i - 1);
      cases.push(current);
      if (cases.length >= 100) {
        scope.limits.push("case-count-limit");
        break;
      }
      continue;
    }
    if (!current) continue;
    if (!py && jsCloser.test(line) && line.search(/\S/) <= current.indent) {
      current.end = i;
      current.complete = true;
      current = null;
      continue;
    }
    if (py && line.trim() && line.search(/\S/) <= current.indent) {
      current.complete = true;
      current = null;
      continue;
    }
    if (current.body.length + current.assertions.length >= 100) {
      current.unanalysed = true;
      continue;
    }
    if (line.length > 600) {
      current.unanalysed = true;
      continue;
    }
    if (!line.trim() || /^\s*(?:\/\/|#|\/\*|\*)/.test(line)) continue;
    if (
      /\b(?:if|else|switch|while|for|try|catch|return|skip|xfail|not|never|unless|def|lambda|class|function)\b|=>|&&|\|\|/.test(
        line,
      )
    )
      current.unanalysed = true;
    if (assertLine.test(line)) current.assertions.push(i);
    else current.body.push(i);
    current.end = i + 1;
  }
  if (py) for (const c of cases) c.complete = true;
  return cases;
}
function criterionFor(c, i) {
  if (typeof c === "string") {
    const text = boundedQuery(c);
    // Unstructured prose is useful for discovery. Source support requires a concrete action and expected observation.
    return {
      id: "c" + (i + 1),
      text,
      action: "",
      expected: "",
      precondition: "",
    };
  }
  if (!c || typeof c !== "object")
    throw new TypeError("Expected a criterion object or text");
  const action = boundedQuery(c.action),
    expected = boundedQuery(c.expected),
    precondition = c.precondition ? boundedQuery(c.precondition) : "";
  const id = c.id ?? "c" + (i + 1);
  if (typeof id !== "string" || !id || id.length > 128)
    throw new TypeError("Invalid criterion ID");
  return {
    id,
    text: boundedQuery(
      [precondition, action, expected].filter(Boolean).join(" "),
    ),
    action,
    expected,
    precondition,
  };
}
function observationMatches(expected, line) {
  if (!expected) return false;
  if (line.trim().replace(/;$/, "") === expected.trim().replace(/;$/, ""))
    return true;
  // Restrict semantic confirmation to a small set of positive, literal assertions with known polarity.
  if (/\b(?:not|notEqual|notStrictEqual|toBeTruthy|isNot)\b|!=|!==/.test(line))
    return false;
  if (/\b(?:not|never|unchanged|retain|keep|still)\b/i.test(expected))
    return false;
  const lhs =
    /^\s*(?:await\s+)?(?:assert\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\(\s*([\w.]+)\s*,\s*(null|true|false|undefined)\s*(?:,\s*["'][^"']*["'])?\s*\)|expect\(\s*([\w.]+)\s*\)\.(?:toBe|toEqual)\(\s*(null|true|false|undefined)\s*\)|expect\(\s*([\w.]+)\s*\)\.toBeNull\(\s*\)|assert\s+([\w.]+)\s+is\s+(None|True|False))\s*;?\s*$/.exec(
      line,
    );
  if (!lhs) return false;
  const target = lhs[1] ?? lhs[3] ?? lhs[5] ?? lhs[6];
  const value = (lhs[2] ?? lhs[4] ?? lhs[7] ?? "null").toLowerCase();
  const desired = /\b(?:reset(?:s)?|clear(?:s|ed)?|null|none)\b/i.test(expected)
    ? "null"
    : /\btrue\b/i.test(expected)
      ? "true"
      : /\bfalse\b/i.test(expected)
        ? "false"
        : /\bundefined\b/i.test(expected)
          ? "undefined"
          : null;
  if (desired !== (value === "none" ? "null" : value)) return false;
  const relevant = terms(expected).filter(
    (t) =>
      !["clear", "none", "undefined", "become", "equal", "value"].includes(t),
  );
  return relevant.length > 0 && coverage(relevant, target) >= 0.66;
}
function bestStep(doc, indices, required) {
  const words = terms(required);
  if (!words.length) return null;
  let candidate = null;
  for (const i of indices) {
    const line = doc.lines[i];
    // Restrict proof of setup/action to code expressions, excluding literals, comments and declarations of test titles.
    const expression = line
      .replace(/(["'\x60])(?:\\.|(?!\1).)*\1/g, " ")
      .replace(/(?:\/\/|#).*$/, "");
    const call = /^\s*(?:await\s+)?[\w$]+\.([\w$]+)\s*\([^;]*\)\s*;?\s*$/.exec(
      expression,
    );
    if (
      !call ||
      /\b(?:dont|ignore|disable|skip|avoid|prevent|never|not)\b/.test(
        terms(call[1]).join(" "),
      )
    )
      continue;
    const score = coverage(words, call[1]);
    if (score >= 0.66 && (!candidate || score > candidate.score))
      candidate = { i, score };
  }
  return candidate;
}
function evaluate(doc, c, criterion) {
  const titleScore = coverage(terms(criterion.text), c.name + " " + doc.path);
  let best = null;
  for (const i of c.assertions) {
    const line = doc.lines[i],
      assertion = evidence(doc, i);
    const action = bestStep(
      doc,
      c.body.filter((j) => j < i),
      criterion.action,
    );
    const pre =
      action && criterion.precondition
        ? bestStep(
            doc,
            c.body.filter((j) => j < action.i),
            criterion.precondition,
          )
        : null;
    // The conservative static path only confirms ordered actions on the asserted object.
    const subject = line.match(
      /(?:assert\.\w+\(|expect\(|assert\s+)\s*([\w$]+)\./,
    )?.[1];
    const sameSubject =
      subject &&
      [pre, action].filter(Boolean).every((s) =>
        doc.lines[s.i]
          .trim()
          .replace(/^await\s+/, "")
          .startsWith(subject + "."),
      );
    const supported = Boolean(
      c.complete &&
      !c.unanalysed &&
      sameSubject &&
      action &&
      (!criterion.precondition || pre) &&
      observationMatches(criterion.expected, line),
    );
    const score =
      (supported ? 10 : 0) +
      titleScore +
      coverage(terms(criterion.text), line) +
      (action?.score ?? 0) +
      (pre?.score ?? 0);
    if (score === 0 || (best && best.score >= score)) continue;
    best = {
      score,
      sourceSupported: supported,
      caseName: c.name,
      caseStart: c.start + 1,
      skipped: c.skipped,
      assertion,
      setup: [pre, action].filter(Boolean).map((s) => evidence(doc, s.i)),
    };
  }
  if (!best && titleScore > 0)
    best = {
      score: titleScore,
      sourceSupported: false,
      caseName: c.name,
      caseStart: c.start + 1,
      skipped: c.skipped,
      assertion: null,
      setup: [],
      caseRef: evidence(doc, c.start),
    };
  return best;
}

// A trusted host adapter may supply an assertion-level observation for a snapshot it owns.
// No shell runner is invoked, and data read from the repository cannot declare a passing run.
export async function matchTests({
  root,
  criteria,
  choose,
  getCurrentSnapshot,
  getObservation,
  signal,
}) {
  signal?.throwIfAborted();
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 16)
    throw new TypeError("Expected 1–16 acceptance criteria");
  const specs = criteria.map(criterionFor);
  if (new Set(specs.map((c) => c.id)).size !== specs.length)
    throw new TypeError("Duplicate criterion ID");
  const { paths, base, scope } = await inventory(root, { signal });
  const rows = specs.map((criterion) => ({ criterion, candidates: [] }));
  scope.discovery =
    "JavaScript/TypeScript test or it with block callbacks and Python test functions";
  scope.unsupportedFiles = 0;
  scope.unparsedTestFiles = 0;
  const snapshot = getCurrentSnapshot ? await getCurrentSnapshot() : null;
  for (const rel of paths.filter(isTest)) {
    if (!supported(rel)) {
      scope.unsupportedFiles++;
      continue;
    }
    if (scope.scanned >= limits.files || scope.bytes >= limits.totalBytes) {
      scope.limits.push("scan-budget");
      break;
    }
    const doc = await readDocument(base, rel, scope, false, signal);
    if (!doc) continue;
    const cases = parseCases(doc, scope);
    if (!cases.length) scope.unparsedTestFiles++;
    for (const row of rows)
      for (const c of cases) {
        signal?.throwIfAborted();
        const hit = evaluate(doc, c, row.criterion);
        if (hit) {
          row.candidates.push(hit);
          row.candidates.sort((a, b) => b.score - a.score);
          if (row.candidates.length > 8) row.candidates.pop();
        }
      }
  }
  const matches = [];
  for (const row of rows) {
    let candidates = row.candidates;
    const weak = candidates.filter((c) => !c.sourceSupported);
    if (candidates.length > 1 && candidates.length === weak.length) {
      const decision = await pick({
        feature: "test-matching",
        query: row.criterion.text,
        choose,
        candidates: weak.map((c, i) => ({
          id: "t" + i,
          description: c.caseName + " " + (c.assertion?.excerpt ?? ""),
        })),
      });
      if (decision.choice)
        weak.unshift(...weak.splice(Number(decision.choice.slice(1)), 1));
      candidates = weak;
    }
    const current = [];
    const checked = new Map();
    for (const candidate of candidates) {
      const { score, ...c } = candidate;
      const ref = c.assertion ?? c.caseRef;
      if (!checked.has(ref.path))
        checked.set(
          ref.path,
          await readDocument(base, ref.path, scope, true, signal),
        );
      if (checked.get(ref.path)?.digest !== ref.digest) {
        if (!scope.limits.includes("stale-result"))
          scope.limits.push("stale-result");
        continue;
      }
      current.push(c);
    }
    const primary = current[0];
    let status = primary?.sourceSupported
      ? "source-supported"
      : primary
        ? "candidate"
        : "no-candidate-in-scope";
    let execution = primary?.skipped ? "skipped" : "unverified";
    let runId = null;
    if (
      primary?.sourceSupported &&
      !primary.skipped &&
      getObservation &&
      typeof snapshot === "string" &&
      snapshot
    ) {
      const receipt = await getObservation({
        caseName: primary.caseName,
        caseStart: primary.caseStart,
        assertion: primary.assertion,
        snapshot,
        criterion: row.criterion.id,
      });
      const ref = primary.assertion;
      if (
        receipt &&
        receipt.snapshot === snapshot &&
        (await getCurrentSnapshot()) === snapshot &&
        receipt.path === ref.path &&
        receipt.digest === ref.digest &&
        receipt.line === ref.startLine &&
        receipt.caseName === primary.caseName &&
        receipt.caseStart === primary.caseStart &&
        receipt.executed === true &&
        ["passed", "failed"].includes(receipt.outcome) &&
        typeof receipt.runId === "string" &&
        receipt.runId
      ) {
        status = "verified-" + receipt.outcome;
        execution = receipt.outcome;
        runId = receipt.runId;
      }
    }
    matches.push({
      criterion: row.criterion,
      status,
      execution,
      runId,
      candidates: current,
    });
  }
  return { matches, scope };
}
