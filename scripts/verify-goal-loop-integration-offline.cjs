'use strict';
/** Isolated Core interaction contract: no OS, provider, or world game state. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
let ts;try{ts=require('typescript')}catch{ts=require(path.join(path.dirname(fs.realpathSync(cp.execFileSync('which',['tsc'],{encoding:'utf8'}).trim())),'..','lib','typescript.js'))}
const root=path.resolve(__dirname,'..');
function compile(p){const file=path.join(root,p);const r=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});assert.equal(r.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);return r.outputText}
const planModule={};vm.runInNewContext(compile('src/lib/agent/core/goalPlanner.ts'),{exports:planModule,require},{timeout:3000});
const goal={schemaVersion:1,milestones:[{id:'one',description:'Check current game state',dependsOn:[],evidence:'Observed inventory and location'},{id:'two',description:'Progress toward game victory',dependsOn:['one'],evidence:'In-game equipment and dragon death'}]};
const data=[],events=[],task={id:'t',status:'planned'};
let toolCalls=0,modelCalls=0, authCalls=0;
const db={agentStep:{findFirst:async({where})=>{if(where?.kind==='model_pin')return null;const kind=where?.kind;return data.filter(x=>typeof kind==='object'?kind.in.includes(x.kind):x.kind===kind).sort((a,b)=>(b.seq??0)-(a.seq??0))[0]??null},create:async({data:row})=>{data.push(row);return row;}},agentTask:{findUnique:async()=>task}};
const mocks={
 './modelProvider':{modelIdentityContext:()=>'CURRENT ADVISORY PROVIDER: backend=test provider="fixture" (test metadata, NOT your identity)',createModelBridge:async()=>({identity:{backend:'test',provider:'fixture',modelId:'fixture',local:true},complete:async()=>{modelCalls++;return modelCalls===1?JSON.stringify(goal):modelCalls===2?JSON.stringify({action:'tool',tool:'list_dir',args:{path:'.'}}):JSON.stringify({action:'final',answer:'not yet won'});},report:async()=> 'Partial work; Dragon not defeated.'})},
 './laya':{adviseTask:()=>({route:'test'})},
 './windowsIntent':{directWindowsLaunch:()=>null},'./minecraftIntent':{minecraftMissionFromObjective:()=>null,directMinecraftMission:()=>null},'./capabilityIntent':{directCapabilityDiscovery:()=>null},
 './modelErrors':{classifyModelFailure:()=>({code:'MODEL_ERROR',publicMessage:'model unavailable'})},
 '@/lib/db':{db},'../guardian/guardian':{authorizeToolCall:async()=>{authCalls++;return {verdict:'allow'}}},
 '../guardian/policy':{ensureWorkspace:async()=>{}},
 '../tools/executor':{executeTool:async()=>{toolCalls++;return {ok:true,detail:{entries:['hi']},evidence:'Read-only directory list'}}},
 './prompts':{PLANNER_SYSTEM_PROMPT:'Only authorized tools',FINAL_REPORT_INSTRUCTION:'ground report',plannerUserPrompt:x=>x,sanitizeFinalReport:x=>x,enforceJarvisIdentity:t=>({text:t,corrected:false,detected:null}),JARVIS_IDENTITY_CONTRACT:'test contract'},
 './taskState':{transitionTask:async(id,to)=>{task.status=to;return {ok:true}}},
 './effects':{admitEffect:async()=>{throw Error('unexpected effect')},canonicalKey:()=>'',EFFECTFUL_TOOLS:new Set(),STEP_SCOPED_EFFECTS:new Set(),isEffectfulToolInvocation:()=>false},
 './verifier':{arbitrateCompletion:async()=>({verdict:'partial',predicateLines:['No live Minecraft win proof']})},
 './autonomyGate':{AutonomyGate:class {completionWarning(){return null}observe(){return {stalled:false,guidance:''}}},REPEATABLE_INPUT_TOOLS:new Set(),desktopObjectiveRequiresActions:()=>false},
 './observation':{compactToolObservation:()=>'{"ok":true}'},'./goalPlanner':planModule,
 '../models/layaRouter':{selectTaskModel:async()=>({pinnedId:'local-test',source:'unit',privacy:'local',category:'game',modelId:'fixture'})},
 '../adoption/registry.mjs':{list:async()=>[]},
};
// Resolve REAL sibling modules by default and apply `mocks` only at the
// boundaries this harness needs to control (db, model, Guardian, executor,
// verifier, effects, task state). The previous version threw on any unmocked
// specifier, so it rotted silently the moment loop.ts gained a dependency
// (./minecraftAiGate, ./requestIntent, ./autonomyPolicy) — and because it was
// never wired into package.json, no battery ever caught it.
const compiledCache=new Map();
function compileWith(rel,depth){
  if(compiledCache.has(rel))return compiledCache.get(rel);
  const mod={};compiledCache.set(rel,mod);
  const absDir=path.dirname(path.join(root,rel));
  const req=(name)=>{
    if(name in mocks)return mocks[name];
    if(name.startsWith('.')){
      const base=path.resolve(absDir,name);
      for(const cand of [base+'.ts',path.join(base,'index.ts'),base+'.mjs',base+'.js',base+'.cjs']){
        if(fs.existsSync(cand))return compileWith(path.relative(root,cand),depth+1);
      }
      return require(name);
    }
    if(name.startsWith('@/')){
      const base=path.join(root,'src',name.slice(2));
      for(const cand of [base+'.ts',path.join(base,'index.ts')]){
        if(fs.existsSync(cand))return compileWith(path.relative(root,cand),depth+1);
      }
    }
    return require(name);
  };
  vm.runInNewContext(compile(rel),{exports:mod,module:{exports:mod},console,req,require:req,
    process:{env:{JARVIS_GOAL_PLANNER_ENABLED:'1',JARVIS_WINDOWS_AGENT_ENABLED:'0'}},setTimeout,clearTimeout,
    URL,TextEncoder,TextDecoder,AbortSignal,Buffer},
    {filename:rel,timeout:10000});
  return mod;
}
const loaded=compileWith('src/lib/agent/core/loop.ts',0);
loaded.runTask({taskId:'t',ownerId:'owner',objective:'Autonomously complete full Netherite progression in Minecraft',budget:8,stepsUsedOffset:0,emit:x=>events.push(x),isCancelled:()=>false}).then(()=>{
 assert.equal(toolCalls,1,'exactly one authorized observation performed');
 assert.equal(authCalls,1,'every tool routed through Guardian');
 assert.equal(modelCalls,3,'plan + tool + final model calls');
 assert.equal(data.filter(x=>x.kind==='goal_plan').length,1,'advisory goal plan persisted once');
 assert.equal(task.status,'partial','no Minecraft victory fabricated');
 assert.ok(events.some(x=>x.type==='final'&&x.status==='partial'));
 console.log('GOAL_LOOP_INTEGRATION_OFFLINE 5/5 PASS (mock DB/model/Guardian, no real OS or Minecraft)');
}).catch(err=>{console.error(err.stack||err);process.exitCode=1;});
