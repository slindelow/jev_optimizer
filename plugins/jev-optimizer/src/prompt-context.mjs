import { inventory as workspaceInventory, secretLike } from "./features/workspace.mjs";
import { terms } from "./features/ranking.mjs";
import { skillInventory } from "./features/skill-inventory.mjs";

const engineering = /\b(?:code(?:base)?|repo(?:sitory)?|source|implement(?:ation)?|file|module|class|method|symbol|function|component|endpoint|schema|bug|stack\s?trace|parser|parsing|constructor|identifier|normaliz\w+|package|regression|tests?|lint|build|exception|crash|UI|API)\b/i;
const discovery = /\b(?:where|which|locate|find|show|inspect|trace|track down|debug|diagnose|investigate|fix|correct|implement|refactor|repair|change|update|add|rename|remove|explain|review|fails?|failing|broken)\b/i;
const testing = /\b(?:tests?|assertions?|coverage|tested|covers?)\b/i;
function safeFile(file) {
  if (typeof file !== "string" || file.length > 300 || !/^[\p{L}\p{M}\p{N} _.$@+()[\]/-]+$/u.test(file)) return false;
  return file.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}
const safeSkill = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}(?:[:/][a-zA-Z0-9][a-zA-Z0-9_-]{0,63})?$/;

function specificFile(prompt) {
  // Quoting makes paths with spaces unambiguous; route groups and [param] are
  // common unquoted names in Next.js and filesystem-based routers.
  const paths = new Set();
  const pattern = /(?:^|\s)(?:`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'|((?:\.\/)?(?:[\p{L}\p{M}\p{N}_.$@+()[\]-]+\/)*[\p{L}\p{M}\p{N}_.$@+()[\]-]+\.[a-z][\w]{0,8}))(?=$|[\s,:?!)]|\.(?:\s|$))/giu;
  for (const match of prompt.matchAll(pattern)) {
    const file = (match[1] ?? match[2] ?? match[3] ?? match[4]).replace(/^\.\//,"");
    if (safeFile(file) && /\.[a-z][\w]{0,8}$/i.test(file)) paths.add(file);
  }
  return paths.size === 1 ? [...paths][0] : null;
}

export async function promptFeatures({ prompt, config, scope, host, signal, env }) {
  const text = prompt.trim();
  if (!text || text.length > 4096 || secretLike(text)) return [];
  const auto = (f) => config.enabled.includes(f) && config.auto.includes(f);
  const command = /^jev\s+(search|match)\s+([^\n]{1,2000})$/i.exec(text);
  if (command) {
    const feature = command[1].toLowerCase();
    if (!auto(feature) && !(config.enabled.includes(feature) && config.legacyExplicit?.includes(feature))) return [];
    return [{ feature, input: feature === "search" ? { query: command[2] } : { criteria: [command[2]] } }];
  }
  // Other slash commands are handled by the host. Ordinary conversational
  // messages leave immediately without inventory reads or provider traffic.
  if (text.startsWith("/") || /^jev\s/i.test(text)) return [];
  const file = specificFile(text);
  const codeRef = file || /\b[a-z]+[A-Z][a-zA-Z0-9]*\b|\b[a-z]+_[a-z]+\b/.test(text);
  let asksAboutCode = Boolean(codeRef || engineering.test(text));
  // "Fix checkout totals" has no programming keyword. Match the user's
  // project vocabulary locally before admitting this class of prompts.
  if (!asksAboutCode && (auto("search") || auto("route")) &&
      /\b(?:fix|debug|implement|refactor|repair|investigate)\b/i.test(text)) {
    const intentWords = new Set(terms(text).filter(t => t.length > 2 &&
      !["fix","debug","implement","refactor","repair","investigate","please","help","work","issue","problem"].includes(t)));
    if (intentWords.size) {
      const { paths } = await workspaceInventory(scope.root, { signal });
      asksAboutCode = paths.some(file => terms(file).some(w => intentWords.has(w)));
    }
  }
  const needsFiles = (discovery.test(text) || (file && /\b(?:read|open|summarize|understand)\b/i.test(text))) && asksAboutCode;
  const needsTests = testing.test(text) && (needsFiles || /\b(?:cover|check|verify|matching|missing|exist|exercise|mapped|assert)\w*\b/i.test(text));
  const jobs = [];
  if (auto("route") && (asksAboutCode || /\bskill\b|\$[a-z][a-z0-9-]+/i.test(text))) {
    const inventory = await skillInventory(scope.root, host, env, signal);
    const explicit = text.match(/(?:^|\s)\$([a-zA-Z0-9_-]+(?:[:/][a-zA-Z0-9_-]+)?)(?=$|[\s.,!?])/u)?.[1];
    if (inventory.length && (explicit || terms(text).length >= 2))
      jobs.push({ feature: "route", input: { task: text, inventory, explicit, preferredIds: config.preferredSkills ?? [] } });
  }
  if (auto("search") && needsFiles) jobs.push({ feature: "search", input: { query: file || text } });
  if (auto("match") && needsTests) jobs.push({ feature: "match", input: { criteria: [text] } });
  return jobs;
}

function locations(refs, max) {
  const paths = new Set();
  const out = [];
  for (const ref of refs) {
    if (!ref || !safeFile(ref.path) || paths.has(ref.path) || !Number.isSafeInteger(ref.startLine) || ref.startLine < 1) continue;
    out.push({ path: ref.path, line: ref.startLine });
    paths.add(ref.path);
    if (out.length === max) break;
  }
  return out;
}

export function hookContext(out) {
  const r = out.result;
  let packet;
  if (out.feature === "route") {
    const selected = r.selected && safeSkill.test(r.selected) ? r.selected : null;
    const alternatives = r.alternatives.map(a => a.id).filter(id => safeSkill.test(id)).slice(0, 3);
    if (!selected && !alternatives.length) return null;
    packet = { selected, alternatives, availability: "Check against this session’s active skills before use." };
  } else if (out.feature === "search") {
    const files = locations(r.results, 4);
    packet = files.length ? { candidateFiles: files } : null;
    if (packet && r.fileResult && safeFile(r.fileResult.path)) {
      packet.fileResult = { ...r.fileResult, tool: "prepared_file", arguments: { invocation: out.id },
        recoveryTool: "recover_file", recoveryArguments: { digest: r.fileResult.digest } };
      packet.usage = "Read the prepared passage with the Jev Optimizer prepared_file tool. Full text is available through recover_file.";
    }
  } else {
    const refs = r.matches.flatMap(m => m.candidates.map(c => c.assertion ?? c.caseRef));
    const files = locations(refs, 3);
    packet = files.length ? { candidateTests: files, execution: "unverified" } : null;
  }
  if (!packet) return null;
  return `Jev Optimizer completed ${out.feature}; invocation ${out.id}. ${JSON.stringify(packet)}`;
}
