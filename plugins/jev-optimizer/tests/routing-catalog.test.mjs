import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { skillInventory } from "../src/features/skill-inventory.mjs";
import { routeSkill } from "../src/features/routing.mjs";
import { searchFiles } from "../src/features/search.mjs";

async function fixture(t) {
  const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(),"jev-catalog-")));
  t.after(() => rm(tmp, { recursive:true, force:true }));
  const root = path.join(tmp,"repo");
  const home = path.join(tmp,"home");
  const bin = path.join(tmp,"bin");
  await Promise.all([root,home,bin].map(p => mkdir(p)));
  const env = {HOME:home,PATH:bin};
  async function put(file,text) {
    await mkdir(path.dirname(file), {recursive:true});
    await writeFile(file,text);
  }
  async function cli(name, code) {
    const file = path.join(bin,name);
    await put(file,"#!" + process.execPath + "\n" + code);
    await chmod(file,0o700);
  }
  function skill(dir,name,description) {
    return put(path.join(dir,"SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nPrivate instructions\n`);
  }
  return {root,tmp,home,env,put,cli,skill};
}

test("Codex uses enabled namespaced skills from skills/list and excludes manual-only skills",async t => {
  const {root,env,put,cli} = await fixture(t);
  const manual=path.join(root,"manual/SKILL.md");
  await put(path.join(path.dirname(manual),"agents/openai.yaml"),"policy:\n  allow_implicit_invocation: false\n");
  const skills=[
    {name:"kit:normalize",description:"Normalize Unicode titles",enabled:true,scope:"user",pluginId:"kit@store"},
    {name:"kit:disabled",description:"Disabled",enabled:false},
    {name:"kit:manual",description:"Manual only",enabled:true,path:manual},
  ];
  await cli("codex",`const readline=require("node:readline").createInterface({input:process.stdin});
    readline.on("line",line=>{
      const q=JSON.parse(line);
      if(q.method==="initialize") console.log(JSON.stringify({id:q.id,result:{}}));
      if(q.method==="skills/list") console.log(JSON.stringify({id:q.id,result:{data:[{cwd:q.params.cwds[0],skills:${JSON.stringify(skills)}}]}}));
    });`);
  assert.deepEqual(await skillInventory(root,"codex",env),[
    {id:"kit:normalize",description:"Normalize Unicode titles",source:"plugin",available:true},
  ]);
});

test("Claude scans enabled plugin skill paths, user links and bounded workspace links",async t => {
  const {root,tmp,home,env,put,cli,skill}=await fixture(t);
  const plugin=path.join(tmp,"installed-kit");
  const custom=path.join(plugin,"procedures/normalize");
  const project=path.join(root,".claude/skills");
  const homeSkills=path.join(home,".claude/skills");
  await put(path.join(plugin,".claude-plugin/plugin.json"),JSON.stringify({skills:["./procedures/normalize"]}));
  await skill(custom,"normalize","Normalize a product title");
  const personal=path.join(home,"my-tools/summary");
  await skill(personal,"summary","Summarize a public document");
  await mkdir(homeSkills,{recursive:true});
  await symlink(personal,path.join(homeSkills,"linked"));
  await skill(path.join(project,"review"),"review","Review a change");
  await symlink(path.join(project,"review"),path.join(project,"alias"));
  await symlink(personal,path.join(project,"escape"));
  await cli("claude",`console.log(JSON.stringify(${JSON.stringify([
    {id:"kit@store",enabled:true,installPath:plugin},
    {id:"disabled@store",enabled:false,installPath:plugin},
  ])}));`);
  const result=await skillInventory(root,"claude",env);
  assert.deepEqual(result.map(s=>s.id).sort(),["kit:normalize","review","summary"]);
  assert.equal(result.find(s=>s.id==="summary").source,"user");
  assert.ok(result.every(s=>!s.description.includes("Private instructions")));
  const match=await routeSkill({task:"use normalization",explicit:"kit:normalize",inventory:result});
  assert.equal(match.selected,"kit:normalize");
});

test("trusted relevant preference can select a qualified skill below the remote shortlist",async () => {
  const inventory=Array.from({length:30},(_,i)=>({id:"tool-"+i,description:"Review changes"}));
  inventory.push({id:"preferred:review",description:"Inspect changes"});
  const result=await routeSkill({task:"review changes",inventory,preferredIds:["preferred:review"],choose:assert.fail});
  assert.equal(result.selected,"preferred:review");
  assert.equal(result.method,"preference");
});

test("file discovery reaches an opaque implementation beyond the full-read budget",async t => {
  const {root,put}=await fixture(t);
  await mkdir(path.join(root,"src"));
  for(let offset=0; offset<520; offset+=40) {
    await Promise.all(Array.from({length:40},(_,i)=>put(path.join(root,"src","a"+(i+offset)+".js"),"export const receipt = true;")));
  }
  await put(path.join(root,"src/z.js"),"export function receiptReconciliation() { return null; }");
  const ordinary=await searchFiles({root,query:"Please investigate this. Why does receipt reconciliation fail?"});
  assert.equal(ordinary.results[0]?.path,"src/z.js");
  assert.ok(ordinary.scope.scanned<=500);
  const exact=await searchFiles({root,query:"receiptReconciliation",choose:assert.fail});
  assert.equal(exact.results[0]?.path,"src/z.js");
  assert.equal(exact.method,"exact-text");
});
