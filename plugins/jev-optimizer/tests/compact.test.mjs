import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openSettings, configure, workspace } from '../src/settings.mjs';
import { retentionPlan, recover, purge, codexContinuity, scoreConversation } from '../src/compaction.mjs';
import { execFileSync } from 'node:child_process';
import { ProviderError, normalizeAnswers, wireQuestions } from '../src/provider/model.mjs';

test('local and remote compaction preserve exact, workspace-scoped read output before replacement', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-compact-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'state'), project = path.join(root,'project');
  await mkdir(project);
  const scope = workspace(project);
  const db = openSettings(dir);
  t.after(() => db.close());
  const file = path.join(project,'old.ts'), text = 'export const x = 3;\n'.repeat(300);
  await writeFile(file,text);
  const input = { goal:'Fix the CSS.', visible: text.length+1000, items:[{ index:2,path:file,text }] };
  const base = { db, dir, scope, input };
  const config = configure(db, scope.id, { enabled:['compact'], auto:['compact'] });
  assert.deepEqual(await retentionPlan({ ...base, config:{...config,auto:[]} }),[]);
  const local = await retentionPlan({ ...base, config });
  const alias = path.join(project,'linked.ts');
  await symlink(file,alias);
  assert.deepEqual(await retentionPlan({...base,config,input:{...input,items:[{...input.items[0],path:alias}]}}),[]);
  assert.equal(await recover(db, scope, local[0].id),text);
  await assert.rejects(recover(db, {...scope,id:'another-project'},local[0].id));
  const remote = configure(db, scope.id, { provider:'typesafe', remote:['compact'], capUsd:0.1 });
  const request = async ({state,questions,capUsd}) => {
    assert.equal(capUsd,0.1);
    assert.ok(!JSON.stringify(state).includes('export const'));
    assert.equal(questions.r2.type,'noul');
    return { answers:{r2:{noul:0.91}} };
  };
  assert.deepEqual(await retentionPlan({...base,config:remote,decideFn:request}),local);
  const uncertain = async () => ({ answers:{ r2:{ noul:0.5 } } });
  assert.deepEqual(await retentionPlan({...base,config:remote,decideFn:uncertain}),[]);
  const lastMethod = () => db.prepare('SELECT method FROM runs ORDER BY rowid DESC LIMIT 1').get().method;
  assert.equal(lastMethod(),'native-jev-abstained');
  const split = {...input,visible:30000,items:[input.items[0],{...input.items[0],index:3}]};
  assert.deepEqual(await retentionPlan({...base,input:split,config:remote,decideFn:async () => ({answers:{r2:{noul:0.98},r3:{noul:0.5}}})}),[]);
  assert.equal(lastMethod(),'native-jev-insufficient-reduction');
  const malformed = async () => { throw new ProviderError('invalid_response','do not record this message'); };
  assert.deepEqual(await retentionPlan({...base,config:remote,decideFn:malformed}),[]);
  assert.equal(lastMethod(),'native-provider-invalid_response');
  assert.deepEqual(await retentionPlan({...base,config,input:{...input,visible:text.length*8}}),[]);
  assert.equal(lastMethod(),'native-insufficient-reduction');
  assert.deepEqual(await retentionPlan({...base,config:remote,input:{...input,goal:'password=privatevalue'},decideFn:() => assert.fail('secret sent')}),[]);
  assert.deepEqual(await retentionPlan({...base,config:remote,input:{...input,goal:' '},decideFn:() => assert.fail('empty goal sent')}),[]);
  assert.equal(lastMethod(),'native-remote-input-ineligible');
  await writeFile(file,'// updated\n');
  assert.equal(await recover(db,scope,local[0].id),text);
  await writeFile(file,'authorization: Basic private-value');
  await assert.rejects(recover(db,scope,local[0].id));
  await rm(file);
  await assert.rejects(recover(db,scope,local[0].id));
  purge(db,scope.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM compact_archive').get().n,0);
});

test('TypeSafe OpenAPI Noul wire example normalizes to a numeric yes probability', () => {
  const q = wireQuestions({billing:{type:'noul',instructions:'Is this about billing?'}});
  const answer = normalizeAnswers(q,{answers:{billing:{type:'noul',noul:0.98}}});
  assert.deepEqual(answer,{billing:{type:'noul',noul:0.98}});
  assert.throws(() => normalizeAnswers(q,{answers:{billing:{type:'noul',noul:'0.98'}}}),{code:'invalid_response'});
});

test('conversation scoring requires separate transcript consent and excludes sensitive tool inputs', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jev-consent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = openSettings(dir), scope = workspace(dir);
  t.after(() => db.close());
  const config = configure(db, scope.id, { enabled: ['compact'], auto: ['compact'], provider: 'typesafe',
    remote: ['compact'], capUsd: 0.10 });
  const state = { history: [{ text: 'Determine which source file handles cleanup.' }] };
  const questions = { call_t1: { type: 'noul', instructions: 'Should the call be retained?' } };
  const input = { state, questions };
  const noCall = () => assert.fail('Ineligible transcript sent');
  await assert.rejects(scoreConversation({ db, dir, scope, config, input, decideFn: noCall }), /disabled/);
  const enabled = { ...config, conversationCompaction: true };
  for (const candidate of [
    { history: [{ text: 'api_key="made-up-secret"' }] },
    { history: [{ tool_calls: [{ input: JSON.stringify({ password: 'private-value' }) }] }] },
  ]) {
    await assert.rejects(scoreConversation({ db, dir, scope, config: enabled,
      input: { ...input, state: candidate }, decideFn: noCall }), {code: 'sensitive_input'});
  }
  const result = await scoreConversation({ db, dir, scope, config: enabled, input, decideFn: async options => {
    assert.equal(options.provider,'typesafe');
    assert.equal(options.capUsd,0.10);
    assert.equal(options.state,state);
    return { answers: { call_t1: { type: 'noul', noul: 0.9 } } };
  }});
  assert.equal(result.answers.call_t1.noul,0.9);
  assert.equal(db.prepare('SELECT method FROM runs').get().method, 'jev-conversation-decisions');
});

test('Codex compact callback returns bounded pending files and ignores ordinary session startup', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-continuity-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const dir = path.join(root,'state'), project = path.join(root,'project');
  await mkdir(project);
  execFileSync('git',['-C',project,'init','-q']);
  await mkdir(path.join(project,'new-feature'));
  await writeFile(path.join(project,'new-feature','parser.py'),'print(1)');
  await writeFile(path.join(project,'.env'),'private');
  const scope = workspace(project);
  assert.equal(await codexContinuity(scope),'Workspace files with pending changes after native compaction: "new-feature/parser.py".');
  const db = openSettings(dir);
  configure(db,scope.id,{ enabled:['compact'],auto:['compact'] });
  db.close();
  const run = source => execFileSync(process.execPath,[new URL('../bin/compact.mjs',import.meta.url).pathname,'codex'],{
    input:JSON.stringify({hook_event_name:'SessionStart',cwd:project,source}), encoding:'utf8',env:{...process.env,JEV_OPTIMIZER_HOME:dir}
  });
  assert.equal(run('startup'),'');
  assert.ok(JSON.parse(run('compact')).hookSpecificOutput.additionalContext.includes('parser.py'));
});
