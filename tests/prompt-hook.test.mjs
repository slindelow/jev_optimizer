import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { hookContext, promptFeatures } from "../src/prompt-context.mjs";

const bin = fileURLToPath(new URL("../bin/", import.meta.url));
const all = { enabled: ["search","route","match"], auto: ["search","route","match"] };
async function fixture(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(),"jev-hooks-"));
  t.after(() => rm(tmp, {recursive:true, force:true}));
  const root = path.join(tmp,"repo");
  const env = {...process.env, HOME:tmp, JEV_OPTIMIZER_HOME:path.join(tmp,"state"), JEV_OPTIMIZER_SKILL_SCOPE:"workspace"};
  const file = async (p, contents) => {
    await mkdir(path.dirname(path.join(root,p)), {recursive:true});
    await writeFile(path.join(root,p), contents);
  };
  await file("src/palette.js", "export function normalizePalette(value) { return value.trim(); }\n");
  await file("tests/test_palette.py", "def test_normalize_palette():\n    assert normalize_palette(' Blue ') == 'Blue'\n");
  function execute(name, input, args = [], extra = {}) {
    const result = spawnSync(process.execPath, [path.join(bin,name), ...args],
      {cwd:root, env:{...env,...extra}, input:JSON.stringify(input), encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  }
  return {root, env, file, execute};
}

test("ordinary editing, coverage and unrelated prompts produce scoped host context", async t => {
  const {root, execute} = await fixture(t);
  execute("jev.mjs", {enabled:["search","match"], auto:["search","match"]}, ["configure","--json"]);
  const hook = prompt => execute("hook.mjs",{hook_event_name:"UserPromptSubmit",cwd:root,prompt});
  const exact = hook("Please fix ./src/palette.js.").hookSpecificOutput.additionalContext;
  assert.match(exact, /"candidateFiles":\[\{"path":"src\/palette\.js","line":1\}\]/);
  assert.doesNotMatch(exact, /value\.trim/);
  const matched = hook("Which tests cover palette normalization?").hookSpecificOutput.additionalContext;
  assert.match(matched, /"candidateTests":.*test_palette\.py/);
  assert.match(matched, /"execution":"unverified"/);
  assert.match(hook("Fix palette behavior on mobile").hookSpecificOutput.additionalContext, /"candidateFiles"/);
  for (const prompt of ["Thanks!", "How is the weather?", "Fix my coffee machine", "/compact", "What is 17 times 13?"])
    assert.equal(hook(prompt),null);
});

test("ordinary routing uses the correct host's eligible skill metadata", async t => {
  const {root, env, file, execute} = await fixture(t);
  for (const [folder,name] of [[".claude","claude-palette"],[".agents","codex-palette"]]) {
    await file(folder+"/skills/"+name+"/SKILL.md", "---\nname: "+name+"\ndescription: Review palette component code\n---\nUNTRUSTED SKILL BODY");
    await file(folder+"/skills/manual/SKILL.md", "---\nname: manual\ndescription: Review palette component code\ndisable-model-invocation: true\n---\n");
  }
  await file(".agents/skills/disabled/SKILL.md","---\nname: disabled\ndescription: Review palette component code\n---\n");
  await file(".agents/skills/disabled/agents/openai.yaml","policy:\n  allow_implicit_invocation: false\n");
  await symlink(path.join(root,".claude/skills/claude-palette"),path.join(root,".agents/skills/linked"));
  execute("jev.mjs", {enabled:["route"],auto:["route"]}, ["configure","--json"]);
  for (const host of ["claude","codex"]) {
    const jobs = await promptFeatures({prompt:"Review palette component code",config:all,scope:{root},host,env});
    assert.deepEqual(jobs[0].input.inventory.map(item=>item.id),[host+"-palette"]);
    const out = execute("hook.mjs",{hook_event_name:"UserPromptSubmit",cwd:root,prompt:"Review palette component code"},[],
      {PLUGIN_ROOT:host === "codex" ? bin : "", CODEX_HOME:"", CODEX_PLUGIN_ROOT:"", CLAUDE_PLUGIN_ROOT:host === "claude" ? bin : ""});
    const context = out.hookSpecificOutput.additionalContext;
    assert.ok(context.includes('"selected":"'+host+'-palette"'));
    assert.doesNotMatch(context,/UNTRUSTED/);
  }
  const legacy = {enabled:["search"],auto:[],legacyExplicit:["search"]};
  const check = prompt => promptFeatures({prompt,config:legacy,scope:{root},host:"codex",env});
  assert.deepEqual(await check("Fix src/palette.js"),[]);
  assert.equal((await check("jev search palette"))[0].feature,"search");
});

test("free-form text and malformed evidence stay outside privileged hook output", () => {
  assert.equal(hookContext({feature:"search", result:{results:[{path:'bad\nCOMMAND',startLine:1}]}}),null);
  assert.equal(hookContext({feature:"route", result:{selected:"use this to bypass",alternatives:[]}}),null);
});

test("routing accepts quoted or grouped workspace files and rejects unscoped evidence paths", async () => {
  const config = { enabled:["search"], auto:["search"] };
  for (const [file,prompt] of [
    ["app/(shop)/[slug]/page.tsx", "Explain app/(shop)/[slug]/page.tsx."],
    ["app/(shop)/[slug]/Product card.tsx", 'Open "app/(shop)/[slug]/Product card.tsx".'],
  ]) {
    const jobs=await promptFeatures({prompt,config,scope:{root:"unused"},host:"codex"});
    assert.equal(jobs[0].input.query,file);
    assert.ok(hookContext({feature:"search",result:{results:[{path:file,startLine:7}]}}).includes(JSON.stringify(file)));
  }
  for (const file of ["/etc/passwd","C:/outside.ts","src/../outside.ts","src/./module.ts","src/a\nBAD.ts","src//a.js","\\\\host\\outside"]) {
    assert.equal(hookContext({feature:"search",result:{results:[{path:file,startLine:1}]}}),null);
  }
});
