import {
  inventory,
  readDocument,
  boundedQuery,
  evidence,
  limits,
} from "./workspace.mjs";
import { terms, pick } from "./ranking.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

function ordered(a, b) {
  return (
    b.score - a.score ||
    a.ref.path.localeCompare(b.ref.path, "en") ||
    a.ref.startLine - b.ref.startLine
  );
}
function hit(doc, i, score) {
  return {
    score,
    ref: evidence(doc, i),
    symbol: doc.lines[i].match(
      /(?:function|class|def|interface|type|fn|struct|func)\s+([\p{L}\p{N}_$]+)/u,
    )?.[1],
  };
}
const inflections = new Map([
  ["parsing", "parse"], ["parsed", "parse"], ["parser", "parse"],
  ["validation", "validate"], ["validating", "validate"], ["validator", "validate"],
  ["normalized", "normalize"], ["normalization", "normalize"], ["normalizing", "normalize"],
  ["constructing", "construct"], ["constructor", "construct"], ["construction", "construct"],
  ["rendering", "render"], ["renderer", "render"], ["rendered", "render"],
]);
function keywords(text) {
  return new Set(terms(text).map(t => inflections.get(t) ?? t));
}
function overlap(queryWords, found) {
  return queryWords.length ? queryWords.filter(t => found.has(t)).length / queryWords.length : 0;
}
function implementationFile(file) {
  return /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|rb|c|h|cpp|cs|php|vue|svelte)$/i.test(file) &&
    !/(?:^|\/)(?:tests?|__tests__|specs?|fixtures?|examples?)\/|(?:^|\/)test_|[._-](?:test|spec)[._-]/i.test(file);
}

// On large repositories, filename ordering can spend the entire document
// budget before reaching the definition. Probe the already-approved paths for
// literal terms first. Only matched query terms and filenames enter memory.
async function contentPriority(base, paths, queryWords, signal, scope) {
  const hits = new Map();
  if (paths.length < 64) return hits;
  const words = queryWords.filter(w => w.length >= 3 &&
    !/^(?:fix|change|file|code|please|broken|debug|implement|issue|project|repository)$/.test(w)).slice(0,12);
  if (!words.length) return hits;
  // Keep each invocation below OS argument limits, including Windows.
  const batches = [];
  let batch = [], bytes = 0;
  for (const rel of paths) {
    const size = Buffer.byteLength(rel) + 3;
    if (batch.length && bytes + size > 20000) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(rel); bytes += size;
  }
  if (batch.length) batches.push(batch);
  const timeout = AbortSignal.timeout(600);
  const deadline = signal ? AbortSignal.any([signal,timeout]) : timeout;
  const args = ["--no-config","--fixed-strings","--ignore-case","--only-matching","--with-filename","--null",
    "--no-heading","--no-line-number","--color","never","--max-count","3","--max-filesize",String(limits.fileBytes)];
  for (const w of words) args.push("-e",w);
  const counts = new Map();
  for (const files of batches) {
    let output;
    try {
      ({stdout:output} = await exec("rg", [...args,"--",...files], {cwd:base,signal:deadline,maxBuffer:2*1024*1024,encoding:"utf8"}));
    } catch (error) {
      signal?.throwIfAborted();
      if (error.code === 1) continue;
      scope.limits.push("content-discovery-partial");
      break;
    }
    for (const line of output.split("\n")) {
      const sep = line.indexOf("\0");
      if (sep < 1) continue;
      const file = line.slice(0,sep), word = line.slice(sep+1).trim().toLowerCase();
      if (!words.includes(word)) continue;
      if (!hits.has(file)) hits.set(file,new Set());
      const matches = hits.get(file);
      if (!matches.has(word)) counts.set(word,(counts.get(word) ?? 0)+1);
      matches.add(word);
    }
  }
  // Rare terms (error names, feature terms, identifiers) carry more weight
  // than generic words that occur in almost every source file.
  return new Map([...hits].map(([file,matches]) => [file,
    [...matches].reduce((sum,w) => sum+Math.log1p(paths.length/counts.get(w)),0)]));
}
export async function searchFiles({
  root,
  query,
  limit = 5,
  choose,
  pathPrefix,
  extensions,
  signal,
}) {
  signal?.throwIfAborted();
  query = boundedQuery(query);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new TypeError("Expected a result limit between 1 and 20");
  const { base, paths, scope } = await inventory(root, {
    pathPrefix,
    extensions,
    signal,
  });
  const literal = query.replace(/^\.\//, "");
  if (paths.includes(literal)) {
    const doc = await readDocument(base, literal, scope, false, signal);
    const ref = doc && evidence(doc, 0);
    const results = ref ? [ref] : [];
    if (ref?.excerpt.length > 600) {
      ref.excerpt = ref.excerpt.slice(0, 600);
      ref.endColumn = 600;
    }
    return { method: "exact-path", scope, results };
  }
  // A reproduction or an error often follows a short opening sentence.
  // Omit generic verification instructions while keeping that evidence.
  const sentences = query.split(/[.!?](?:\s+|$)/).map(s => s.trim()).filter(Boolean);
  const primary = sentences.filter((s,i) => i === 0 ||
    !/^(?:(?:please\s+)?(?:add|run|write|update)\b.{0,35}\btests?\b|(?:preserve|ensure|maintain)\s+(?:support|compatibility|backward)|(?:please\s+)?do not\b)/i.test(s)).join(" ") || query;
  const words = [...keywords(primary)];
  const seekImplementation = /\b(?:fix|repair|implement|debug|correct|refactor|where|implementation)\b/i.test(primary) &&
    !/\b(?:test|tests|documentation)\b/i.test(primary);
  const phrase = query.toLowerCase();
  const identifiers = /^[\w$]+$/u.test(query);
  const identifierMatcher = identifiers
    ? new RegExp(
        "(?:^|[^a-zA-Z0-9_$])" +
          query.replace(/\$/g, "\\$") +
          "(?:$|[^a-zA-Z0-9_$])",
      )
    : null;
  const candidates = [];
  const priorities = await contentPriority(base, paths, identifiers ? [query.toLowerCase()] : words, signal, scope);
  const sorted = paths
    .map(p => ({ p, score: overlap(words, keywords(p)), source: seekImplementation && implementationFile(p) }))
    .sort((a, b) => ((priorities.get(b.p) ?? 0) + b.score * 2) - ((priorities.get(a.p) ?? 0) + a.score * 2) ||
      Number(b.source) - Number(a.source) || a.p.localeCompare(b.p, "en"));
  for (const file of sorted) {
    if (scope.scanned >= limits.files || scope.bytes >= limits.totalBytes) {
      scope.limits.push("scan-budget");
      break;
    }
    const doc = await readDocument(base, file.p, scope, false, signal);
    if (!doc) continue;
    let best = null;
    const matched = new Set();
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i];
      if (!line.trim() || line.length > 600) continue;
      const exact = identifierMatcher
        ? identifierMatcher.test(line)
        : line.toLowerCase().includes(phrase);
      const inLine = keywords(line);
      const found = words.filter(t => inLine.has(t));
      for (const t of found) matched.add(t);
      if (!exact && !found.length && (file.score === 0 || best || i > 0))
        continue;
      const candidate = hit(
        doc,
        i,
        (exact ? 10 : 0) +
          (found.length / Math.max(1, words.length)) * 3 +
          file.score * 2 +
          (exact && /\b(class|function|def|fn|const|func)\b/.test(line)
            ? 0.3
            : 0),
      );
      if (!best || ordered(candidate, best) < 0) best = candidate;
    }
    if (!best) continue;
    if (!identifiers && best.score < 10) {
      // A useful implementation often mentions different parts of the request
      // on separate lines. Rank one anchored passage per file to keep diversity.
      best.score += overlap(words, matched) * 2 + (file.source ? 0.7 : 0);
    }
    candidates.push(best);
    candidates.sort(ordered);
    candidates.length = Math.min(candidates.length, limits.candidates);
  }
  const localExact = candidates[0]?.score >= 10;
  const selectable = candidates.map((c, i) => ({
    id: "s" + i,
    description: c.ref.path + ":" + c.ref.startLine + " " + c.ref.excerpt,
  }));
  const decision = localExact
    ? { method: "exact-text", choice: null }
    : await pick({ feature: "search", query, candidates: selectable, choose });
  const chosen = selectable.findIndex((c) => c.id === decision.choice);
  if (chosen > 0) candidates.unshift(...candidates.splice(chosen, 1));
  const results = [];
  const checked = new Map();
  for (const c of candidates) {
    if (results.length >= limit) break;
    if (!checked.has(c.ref.path))
      checked.set(
        c.ref.path,
        await readDocument(base, c.ref.path, scope, true, signal),
      );
    if (checked.get(c.ref.path)?.digest !== c.ref.digest) {
      if (!scope.limits.includes("stale-result"))
        scope.limits.push("stale-result");
      continue;
    }
    results.push({ ...c.ref, ...(c.symbol ? { symbol: c.symbol } : {}) });
  }
  return { method: decision.method, scope, results };
}
