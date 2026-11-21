import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const bin = fileURLToPath(new URL("../bin/", import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jev-file-result-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "work");
  await mkdir(cwd);
  const stub = path.join(root, "transport.mjs");
  const receipt = path.join(root, "calls");
  await writeFile(stub, [
    'import { appendFileSync } from "node:fs";',
    'globalThis.fetch = async function(url, init) {',
    '  const body = JSON.parse(init.body), state = JSON.parse(body.state);',
    '  if (url !== "https://api.typesafe.ai/v1/systemone" || !body.questions.passage || !state.passages) throw Error("unexpected decision");',
    '  const chosen = state.passages.find(p => p.text.includes("calculateSpecialShipping"));',
    '  appendFileSync(process.env.TEST_JEV_CALLS, JSON.stringify({chosen:chosen?.id, bytes:Buffer.byteLength(init.body)})+"\\n");',
    '  return Response.json({answers:{passage:{type:"choice",choice:chosen?.id ?? "__none__"}},usage:{input_tokens:20,output_tokens:1}});',
    '};',
  ].join("\n"));
  const file = path.join(cwd, "rates.js");
  const lines = Array.from({length:180}, (_,i) => "// café 🚚 fixed row "+i+" "+ "sample ".repeat(4));
  lines[103]="export function calculateSpecialShipping(order) { return order.weight * 2; }";
  const original = "\uFEFF"+lines.join("\r\n")+"\r\n";
  await writeFile(file, original);
  const env = { ...process.env, HOME: root, JEV_OPTIMIZER_HOME:path.join(root,"state"), PLUGIN_ROOT:bin,
    TEST_JEV_CALLS:receipt, TYPESAFE_API_KEY:"test-fixture-only" };
  function cmd(name, args, input, work = cwd) {
    const proc = spawnSync(process.execPath, ["--import",stub,path.join(bin,name),...args],
      {cwd:work,env,input,encoding:"utf8",timeout:12000});
    assert.equal(proc.status,0,proc.stderr);
    return proc.stdout.trim() ? JSON.parse(proc.stdout) : null;
  }
  const setup = opt => cmd("jev.mjs",["configure","--json"],JSON.stringify({
    enabled:["compact","search"],auto:["compact","search"],remote:["compact"],provider:"typesafe",capUsd:0.05,...opt,
  }));
  const thread = randomUUID(), otherThread = randomUUID();
  const hook = () => {
    const prompt = "Explain how rates.js calculates special shipping.";
    const output = cmd("hook.mjs",[],JSON.stringify({hook_event_name:"UserPromptSubmit",session_id:thread,cwd,prompt}));
    return output?.hookSpecificOutput?.additionalContext;
  };
  // Codex resolves the stdio working directory against the installed package
  // and passes args literally. Exercise that manifest contract and thread metadata.
  const pluginRoot=path.dirname(path.resolve(bin));
  const manifest=JSON.parse(await readFile(path.join(pluginRoot,".codex-plugin/plugin.json"),"utf8"));
  const mcpConfig=JSON.parse(await readFile(path.join(pluginRoot,manifest.mcpServers),"utf8")).mcpServers.jev_files;
  assert.equal(mcpConfig.command,"node");
  const mcp = (method, params, threadId = thread) => {
    const proc=spawnSync(process.execPath,mcpConfig.args,{cwd:path.resolve(pluginRoot,mcpConfig.cwd),env,
      input:JSON.stringify({jsonrpc:"2.0",id:1,method,params:{...params,_meta:{threadId}}})+"\n",encoding:"utf8"});
    assert.equal(proc.status,0,proc.stderr);
    return JSON.parse(proc.stdout).result;
  };
  return {file,original,otherThread,receipt,setup,hook,mcp,cwd,dbPath:path.join(root,"state","settings.sqlite")};
}

test("ordinary Codex prompt compresses with a provider decision and returns exact content through workspace-bound tools",async t=>{
  const f=await fixture(t);
  f.setup({fileResultCompression:true});
  const context=f.hook(), ref=JSON.parse(context.slice(context.indexOf("{"))).fileResult;
  assert.equal(ref.method,"jev");
  assert.equal(ref.tool,"prepared_file");
  assert.equal(ref.path,"rates.js");
  assert.equal(ref.digest,createHash("sha256").update(f.original).digest("hex"));
  assert.ok(ref.excerptBytes<ref.originalBytes/4);
  assert.doesNotMatch(context,/order\.weight/);
  assert.match(await readFile(f.receipt,"utf8"),/"chosen":"p\d+"/);
  assert.deepEqual(f.mcp("tools/list",{}).tools.map(t=>t.name),["prepared_file","recover_file"]);
  const passage=f.mcp("tools/call",{name:ref.tool,arguments:ref.arguments});
  assert.equal(passage.isError,undefined);
  assert.match(passage.content[1].text,/calculateSpecialShipping/);
  assert.equal(Buffer.byteLength(passage.content[1].text),ref.excerptBytes);
  assert.equal(f.mcp("tools/call",{name:ref.tool,arguments:ref.arguments},f.otherThread).isError,true);
  await writeFile(f.file,"// source changed\n");
  assert.equal(f.mcp("tools/call",{name:ref.tool,arguments:ref.arguments}).isError,true);
  let recovered="", offset=0;
  do {
    const page=f.mcp("tools/call",{name:ref.recoveryTool,arguments:{...ref.recoveryArguments,offset}});
    const metadata=JSON.parse(page.content[0].text);
    assert.equal(metadata.offset,offset);
    recovered+=page.content[1].text;
    offset=metadata.nextOffset;
  } while(offset!==null);
  assert.equal(recovered,f.original);
  await writeFile(path.join(f.cwd,".gitignore"),"rates.js\n");
  assert.equal(f.mcp("tools/call",{name:ref.recoveryTool,arguments:ref.recoveryArguments}).isError,true);
});

test("old compact consent cannot send file passages and sensitive files never produce a snapshot",async t=>{
  const f=await fixture(t);
  f.setup({});
  assert.doesNotMatch(f.hook(),/fileResult/);
  await assert.rejects(readFile(f.receipt),{code:"ENOENT"});
  f.setup({fileResultCompression:true});
  await writeFile(f.file,f.original+'password = "fixture-only-password"\n');
  assert.equal(f.hook(),undefined);
  for (const prefix of ["jv_live_", "jv_test_", "sk-or-v1-", "vck_", "vcp_"]) {
    await writeFile(f.file,f.original+'connect("'+prefix+"example_not_a_real_credential"+'");\n');
    assert.equal(f.hook(),undefined);
  }
  await assert.rejects(readFile(f.receipt),{code:"ENOENT"});
  const db=new DatabaseSync(f.dbPath);
  try {
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='compact_archive'").get(),undefined);
  } finally { db.close(); }
});
