#!/usr/bin/env node
'use strict';
/** Offline executable tests for the real Core/Guardian/LAYA TypeScript modules.
 * Mocks stop at the filesystem/DB/network boundaries; no real credential,
 * provider network call or live OS effect is used. NOT Windows certification.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
let passed = 0;
async function check(name, test) {
  await test(); ++passed; console.log('PASS',name);
}
// An explicit mock always wins. An UNMOCKED relative import is a real sibling
// module, so resolve it against the importing file's directory and transpile it
// instead of falling through to a host require() that cannot see TypeScript
// sources. loop.ts gained ./minecraftIntent, ./minecraftAiGate and
// ./goalPlanner after this harness was written; all three are dependency-free,
// so loading the real code raises fidelity instead of touching DB or network.
const siblingCache=new Map();
function load(relative, mocks) {
  const source = path.join(root, relative);
  if (siblingCache.has(source)) return siblingCache.get(source);
  const js = ts.transpileModule(fs.readFileSync(source,'utf8'),{
    fileName:source, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  const mod={exports:{}};
  siblingCache.set(source, mod.exports); // set before eval: safe for cycles
  const mocked=(id)=>{
    if(Object.prototype.hasOwnProperty.call(mocks,id))return mocks[id];
    if(typeof id==='string' && id.startsWith('.')){
      const sibling=path.join(path.dirname(source), id.endsWith('.ts')?id:id+'.ts');
      if(fs.existsSync(sibling))return load(path.relative(root,sibling),{});
    }
    return require(id);
  };
  new Function('require','module','exports','process','Buffer','URL','AbortSignal','fetch', js)
    (mocked,mod,mod.exports,process,Buffer,URL,AbortSignal,()=>{throw Error('unexpected network')});
  return mod.exports;
}
async function main() {
  const audits=[];
  let auditDown=false;
  const fakeDb={auditLog:{create:async ({data})=> {if(auditDown)throw Error('disk unavailable'); audits.push(data);return {id:'audit-1'};}}};
  const guardian=load('src/lib/agent/guardian/guardian.ts',{
    '@/lib/db':{db:fakeDb},
    '../guardian/policy':{resolveScopedPath:()=>({ok:true,abs:'/tmp/sandbox/a',rel:'a'}),assertWithinRoot:async()=>({ok:true}),MAX_WRITE_BYTES:100000,WORKSPACE_ROOT:'/tmp/sandbox',validateCommand:async()=>({ok:true,command:'cat',args:[]})},
    './policy':{resolveScopedPath:()=>({ok:true,abs:'/tmp/sandbox/a',rel:'a'}),assertWithinRoot:async()=>({ok:true}),MAX_WRITE_BYTES:100000,WORKSPACE_ROOT:'/tmp/sandbox',validateCommand:async()=>({ok:true,command:'cat',args:[]})},
    '../windows/policy':{validateDesktopTool:()=>({ok:true,prepared:{}})},
  });
  await check('Guardian allows scoped file operation after audit',async()=>{
    const result=await guardian.authorizeToolCall({taskId:'t',ownerId:'owner'},'write_file',{
      path:'a',content:'sk-demo-SECRET-A',token:'SECRET-B',nested:{password:'SECRET-C'}
    });
    assert.equal(result.verdict,'allow'); assert.equal(result.prepared.content,'sk-demo-SECRET-A');
    const rec=audits.at(-1);
    assert.equal(rec.verdict,'ALLOW');
    for (const secret of ['SECRET-A','SECRET-B','SECRET-C']) assert.ok(!JSON.stringify(rec).includes(secret));
    assert.deepEqual(JSON.parse(rec.argsJson),{redacted:true,fields:['content','nested','path','token']});
  });
  await check('Guardian denial audit never stores raw secrets',async()=>{
    const r=await guardian.authorizeToolCall({taskId:'t'},'unknown_password_request', {apiKey:'SECRET-D',freeText:'SECRET-E'});
    assert.equal(r.verdict,'deny');
    for (const secret of ['SECRET-D','SECRET-E']) assert.ok(!JSON.stringify(audits.at(-1)).includes(secret));
  });
  await check('Guardian refuses effects when audit is unavailable',async()=>{
    auditDown=true;
    const r=await guardian.authorizeToolCall({taskId:'t'},'write_file',{path:'a',content:'secret'});
    assert.equal(r.verdict,'deny'); assert.match(r.reason,/audit trail unavailable/);
    auditDown=false;
  });
  await check('Guardian audit key list bounded',async()=>{
    const raw={};for(let i=0;i<70;i++)raw['field_'+i]='value';
    await guardian.authorizeToolCall({taskId:'t'},'unknown_tool',raw);
    assert.equal(JSON.parse(audits.at(-1).argsJson).fields.length,32);
  });

  let profile={id:'modelA',location:'api',enabled:true,updatedAt:'v1'};
  let privacy='local-only'; let constructed=0;
  const deadline=load('src/lib/agent/core/modelDeadline.ts',{});
  const provider=load('src/lib/agent/core/modelProvider.ts',{
    './modelDeadline': deadline,
    '../models/vault':{
      getModel:async()=>profile,
      routingSnapshot:async()=>({routing:{privacy}}),
      selectedModel:async()=>profile,
    },
    '../models/bridge':{createProfileBridge:(p)=>{constructed++;return {identity:p.id}}},
  });
  const pinned=()=>provider.createModelBridge('owner','modelA|v1');
  await check('Core denies cloud task resume after local-only policy change',async()=>{
    await assert.rejects(pinned(),/local-only privacy policy/);assert.equal(constructed,0);
  });
  await check('Core permits unchanged cloud pin when policy explicitly allows',async()=>{
    privacy='cloud-allowed';assert.deepEqual(await pinned(),{identity:'modelA'});assert.equal(constructed,1);
  });
  await check('Core denies a pinned provider disabled after pause',async()=>{
    profile={...profile,enabled:false}; await assert.rejects(pinned(),/now disabled/);assert.equal(constructed,1);
    profile={...profile,enabled:true};
  });
  await check('Core denies version change before constructing model bridge',async()=>{
    profile={...profile,updatedAt:'v2'};await assert.rejects(pinned(),/removed or changed/);assert.equal(constructed,1);
    profile={...profile,updatedAt:'v1'};
  });
  await check('Core permits local pin under local-only privacy',async()=>{
    profile={...profile,location:'local'};privacy='local-only';
    assert.deepEqual(await pinned(),{identity:'modelA'}); assert.equal(constructed,2);
  });
  await check('Core blocks legacy cloud provider after local-only policy change',async()=>{
    const previous=process.env.JARVIS_MODEL_BACKEND;
    process.env.JARVIS_MODEL_BACKEND='openai-compatible';
    try { await assert.rejects(provider.createModelBridge('owner','legacy-env'),/local-only privacy policy/); }
    finally { if(previous===undefined) delete process.env.JARVIS_MODEL_BACKEND; else process.env.JARVIS_MODEL_BACKEND=previous; }
  });

  const settings={mode:'auto',privacy:'cloud-allowed',layaEnabled:true,layaUrl:'invalid: url',weights:{quality:5,speed:3,cost:2}};
  const profiles=[{id:'A',enabled:true,location:'api',ratings:{reasoning:4,coding:4,vision:3,speed:4,cost:3}},
    {id:'B',enabled:true,location:'api',ratings:{reasoning:3,coding:3,vision:3,speed:3,cost:3}}];
  const laya=load('src/lib/agent/models/layaRouter.ts',{
    './vault':{routingSnapshot:async()=>({profiles,activeId:'A',routing:settings})},
    './contracts':{defaultRatings:()=>({reasoning:3,coding:3,vision:3,speed:3,cost:3})}
  });
  await check('LAYA malformed advisory URL falls back without network calls',async()=>{
    let requested=0;
    const result=await laya.inferLayaChoice('code task',profiles,settings,'coding','light',()=>{requested++;throw Error('unwanted');});
    assert.equal(result,null);assert.equal(requested,0);
  });
  await check('LAYA routing survives damaged advisory endpoint',async()=>{
    const d=await laya.selectTaskModel('owner','code task',{fetcher:()=>{throw Error('network');}});
    assert.equal(d.modelId,'A');assert.equal(d.source,'deterministic-fallback');
  });
  await check('LAYA rejects remote advisory endpoint without fetching',async()=>{
    settings.layaUrl='https://example.org/';let called=0;
    assert.equal(await laya.inferLayaChoice('code',profiles,settings,'coding','light',()=>{called++;}),null);
    assert.equal(called,0);
  });

  let bridgeUsed=0, effectsUsed=0;
  const events=[];
  const core=load('src/lib/agent/core/loop.ts',{
    './modelProvider':{createModelBridge:async()=>{bridgeUsed++;return {}; }},
    './laya':{adviseTask:()=>({classification:'conversation',privacy:'ordinary',urgency:'normal',candidateCapabilities:[],provenance:'deterministic_local_v1'})},
    './windowsIntent':{directWindowsLaunch:()=>null},
    './capabilityIntent':{directCapabilityDiscovery:()=>null},
    './modelErrors':{classifyModelFailure:()=>({code:'MODEL_CONFIGURATION_ERROR',publicMessage:'Configured task model is unavailable.'})},
    '@/lib/db':{db:{agentStep:{findFirst:async()=>null,create:async()=>({})}}},
    '../guardian/guardian':{authorizeToolCall:()=>{throw Error('must not reach Guardian');}},
    '../guardian/policy':{ensureWorkspace:async()=>{}},
    '../tools/executor':{executeTool:()=>{effectsUsed++;throw Error('must not execute');}},
    './prompts':{PLANNER_SYSTEM_PROMPT:'SYSTEM',plannerUserPrompt:()=>'',FINAL_REPORT_INSTRUCTION:'',sanitizeFinalReport:(v)=>v},
    './taskState':{transitionTask:async()=>({ok:true})},
    './effects':{EFFECTFUL_TOOLS:new Set(),STEP_SCOPED_EFFECTS:new Set(),admitEffect:()=>{},canonicalKey:()=>'',isEffectfulToolInvocation:()=>false,
      // loop.ts also imports these. The replay-refusal path must return before
      // any effect is reconciled or settled, so fail loudly rather than let a
      // future change reach the settlement path silently.
      reconcileEffect:()=>{throw Error('must not reconcile an effect');},
      settleEffect:()=>{throw Error('must not settle an effect');}},
    './verifier':{arbitrateCompletion:()=>({verdict:'conversational'})},
    './autonomyGate':{AutonomyGate:class{pendingGuiVerification=0;},REPEATABLE_INPUT_TOOLS:new Set(),desktopObjectiveRequiresActions:()=>false},
    './observation':{compactToolObservation:()=>''},
  });
  await check('Core refuses replay with missing durable model pin',async()=>{
    await core.runTask({taskId:'task1',ownerId:'owner',objective:'do task',budget:2,replay:'previous steps',stepsUsedOffset:1,emit:(e)=>events.push(e),isCancelled:()=>false});
    assert.equal(bridgeUsed,0);assert.equal(effectsUsed,0);
    const last=events.filter(x=>x.type==='final').at(-1);
    assert.equal(last.status,'failed');
  });
  console.log(`CORE_GUARDIAN_LAYA_BOUNDARIES ${passed}/${passed} PASS (offline/mocked boundaries)`);
}
main().catch(error=>{console.error(error.stack || error);process.exitCode=1;});
