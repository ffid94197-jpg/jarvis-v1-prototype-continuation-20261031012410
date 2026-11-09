'use strict';
/** Targeted pure offline tests. No model, filesystem effects or Minecraft victory. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const cp=require('node:child_process');
let ts;try{ts=require('typescript')}catch{
  const bin=fs.realpathSync(cp.execFileSync('which',['tsc'],{encoding:'utf8'}).trim());
  ts=require(path.join(path.dirname(bin),'..','lib','typescript.js'));
}
const root=path.resolve(__dirname,'..');
function loadModule(rel){
 const file=path.join(root,rel);
 const src=fs.readFileSync(file,'utf8');
 const out=ts.transpileModule(src,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,strict:true}});
 assert.equal((out.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,'TS parser errors');
 const ex={};vm.runInNewContext(out.outputText,{exports:ex,console,require},{timeout:3000});return ex;
}
const {parseGoalPlan,validateGoalPlan,goalPlanContext,requiresGoalPlan,requiresExternalActionEvidence,GoalProgressWatchdog,goalPlanRequest,hasMaterialPlanRevision}=loadModule('src/lib/agent/core/goalPlanner.ts');
let count=0;function check(name,fn){fn();count++;console.log('PASS',name)}
const simple={schemaVersion:1,milestones:[{id:'gather',description:'Collect wood',dependsOn:[],evidence:'Observed inventory contains logs'},{id:'craft',description:'Craft tools',dependsOn:['gather'],evidence:'Observed actual tool inventory'}]};
check('valid milestone graph',()=>assert.equal(validateGoalPlan(simple).milestones.length,2));
check('parse raw JSON',()=>assert.equal(parseGoalPlan(JSON.stringify(simple)).milestones[1].id,'craft'));
check('parse fenced JSON',()=>assert.ok(parseGoalPlan('```json\n'+JSON.stringify(simple)+'\n```')));
check('dependency cannot reference unknown',()=>assert.equal(validateGoalPlan({...simple,milestones:[simple.milestones[0],{...simple.milestones[1],dependsOn:['fake']}]}),null));
check('cannot reference future dependency',()=>assert.equal(validateGoalPlan({...simple,milestones:[{...simple.milestones[0],dependsOn:['craft']},simple.milestones[1]]}),null));
check('duplicate IDs blocked',()=>assert.equal(validateGoalPlan({...simple,milestones:[simple.milestones[0],{...simple.milestones[1],id:'gather'}]}),null));
check('too many goals blocked',()=>assert.equal(validateGoalPlan({...simple,milestones:Array.from({length:9},(_,i)=>({id:'s'+i,description:'a',dependsOn:[],evidence:'b'}))}),null));
check('missing evidence rejected',()=>assert.equal(validateGoalPlan({...simple,milestones:[simple.milestones[0],{...simple.milestones[1],evidence:''}]}),null));
check('cycles via backward references rejected',()=>assert.equal(validateGoalPlan({...simple,milestones:[{...simple.milestones[0],dependsOn:['craft']},simple.milestones[1]]}),null));
check('reject non-JSON',()=>assert.equal(parseGoalPlan('not json'),null));
check('reject huge model output',()=>assert.equal(parseGoalPlan('x'.repeat(12001)),null));
check('sanitize extra untrusted fields',()=>assert.ok(!('tool' in validateGoalPlan({...simple,milestones:[{...simple.milestones[0],tool:'run_command'},simple.milestones[1]]}).milestones[0])));
check('a renamed or reordered plan is not a materially different strategy',()=>{
  const renamed={schemaVersion:1,milestones:[
    {id:'first',description:'Collect wood',dependsOn:[],evidence:'Readback A'},
    {id:'second',description:'Craft tools',dependsOn:['first'],evidence:'Readback B'}
  ]};
  assert.equal(hasMaterialPlanRevision(simple,renamed),false);
});
check('a substantively different approach is allowed for a bounded replan',()=>{
  const alternative={schemaVersion:1,milestones:[
    {...simple.milestones[0],description:'Inspect existing inventory and reuse available logs'},
    simple.milestones[1]
  ]};
  assert.equal(hasMaterialPlanRevision(simple,alternative),true);
});
check('long-horizon gaming goal detected',()=>assert.ok(requiresGoalPlan('From scratch get full Netherite and defeat Ender Dragon in Minecraft')));
check('ordinary request not unnecessarily planned',()=>assert.ok(!requiresGoalPlan('Hi')));
check('educational question not planned',()=>assert.ok(!requiresGoalPlan('How to defeat the Ender Dragon?')));
for (const [prompt,expected] of [
  ['Research the repository, implement tests, run CI and deploy the new service',true],
  ['Complete three tasks: setup the environment, test the server, and report results',true],
  ['Install this app and verify it launches',true],
  ['Autonomously defeat the Ender Dragon in Minecraft',true],
  ['Fix the failing unit tests and deploy the patch',true],
  ['Research the vendor and submit a report',true],
  ['Create a folder and save the results',true],
  ['Write a poem',false],
  ['Draft an email to my friend',false],
  ['Explain how to deploy the new service',false],
  ['What is the Nether portal?',false],
  ['Tell me about autonomous agents',false],
]) check('action intent '+prompt,()=>assert.equal(requiresExternalActionEvidence(prompt),expected));
check('multistep research needs plan',()=>assert.ok(requiresGoalPlan('Research the repository, implement tests, run CI and deploy the new service')));
check('multistep numbered tasks need plan',()=>assert.ok(requiresGoalPlan('Complete three tasks: setup the environment, test the server, and report the results')));
check('watchdog state survives serialized restart',()=>{
  const w=new GoalProgressWatchdog();const receipt={ok:false,error:'inaccessible'};
  w.observe('mine',{x:2},receipt);w.observe('mine',{x:2},receipt);
  const copy=new GoalProgressWatchdog(JSON.parse(JSON.stringify(w.snapshot())));
  assert.equal(copy.observe('mine',{x:2},receipt),'replan');
  assert.equal(copy.isReplanPending,true);
  const afterCrash=new GoalProgressWatchdog(copy.snapshot());
  assert.equal(afterCrash.isReplanPending,true);
  afterCrash.acknowledgeReplan();
  assert.equal(afterCrash.snapshot().pendingReplan,false);
});
check('reject corrupted watchdog state',()=>assert.throws(()=>new GoalProgressWatchdog({schemaVersion:1,lastFailureHash:'raw-secret',failures:999,revisions:0,pendingReplan:false})));
check('interleaved repeated failures force a replan and survive restart',()=>{
  const w=new GoalProgressWatchdog();
  const f={ok:false,error:'separate failure'};
  assert.equal(w.observe('write_file',{path:'a'},f),'continue');
  assert.equal(w.observe('read_file',{path:'b'},f),'continue');
  assert.equal(w.observe('write_file',{path:'a'},f),'continue');
  const snap=JSON.parse(JSON.stringify(w.snapshot()));
  assert.equal(snap.failureHistory.length,2);
  const resumed=new GoalProgressWatchdog(snap);
  assert.equal(resumed.observe('read_file',{path:'b'},f),'continue');
  assert.equal(resumed.observe('write_file',{path:'a'},f),'replan');
});
check('success of a different tool does not erase failed write attempts',()=>{
  const w=new GoalProgressWatchdog(),f={ok:false};
  assert.equal(w.observe('write_file',{path:'a'},f),'continue');
  assert.equal(w.observe('observe',{}, {ok:true}),'continue');
  assert.equal(w.observe('write_file',{path:'a'},f),'continue');
  assert.equal(w.observe('write_file',{path:'a'},f),'replan');
});
check('corrupt persisted failure history is denied',()=>{
  const state=new GoalProgressWatchdog().snapshot();
  assert.throws(()=>new GoalProgressWatchdog({...state,
    failureHistory:[{key:'not-a-hash',count:9}]}));
});
check('stored watchdog snapshot omits arguments and error',()=>{
  const w=new GoalProgressWatchdog();w.observe('tool',{secret:'PERSONAL_KEY_123'}, {ok:false,error:'internal secret'});
  assert.ok(!JSON.stringify(w.snapshot()).includes('PERSONAL_KEY_123'));
  assert.ok(!JSON.stringify(w.snapshot()).includes('internal secret'));
});
check('plan context states no authorization',()=>assert.match(goalPlanContext(simple),/NOT authorization/));
check('planning request insists on real proof',()=>assert.match(goalPlanRequest('Build full Netherite in Minecraft'),/independently checkable real state/));
check('replanning data bounded',()=>assert.ok(goalPlanRequest('Build full Netherite in Minecraft',simple,'bad'.repeat(1000)).length<5000));
const watchdog=new GoalProgressWatchdog();
const f={ok:false,error:'Block inaccessible'};
check('first failure does not replan',()=>assert.equal(watchdog.observe('mine',{x:1},f),'continue'));
check('second failure does not replan',()=>assert.equal(watchdog.observe('mine',{x:1},f),'continue'));
check('third identical failure asks for revision',()=>assert.equal(watchdog.observe('mine',{x:1},f),'replan'));
check('different failing action resets repeat count',()=>assert.equal(watchdog.observe('mine',{x:2},f),'continue'));
check('second revision after three repetitions',()=>{watchdog.observe('mine',{x:1},f);watchdog.observe('mine',{x:1},f);assert.equal(watchdog.observe('mine',{x:1},f),'replan')});
check('after two revisions watchdog halts',()=>{watchdog.observe('mine',{x:1},f);watchdog.observe('mine',{x:1},f);assert.equal(watchdog.observe('mine',{x:1},f),'blocked')});
check('successful receipt resets failure streak',()=>{const w=new GoalProgressWatchdog();w.observe('mine',{},f);w.observe('mine',{}, {ok:true});assert.equal(w.observe('mine',{},f),'continue')});
const loop=fs.readFileSync(path.join(root,'src/lib/agent/core/loop.ts'),'utf8');
check('persistent planning before tool loop',()=>assert.ok(loop.indexOf('kind:"goal_plan"')<loop.indexOf('for (;;)')));
check('durable watchdog checkpoint preserved',()=>assert.ok(loop.includes('kind:"goal_watchdog"')));
check('durable plan loaded on resume',()=>assert.ok(loop.includes('Missing persisted long-horizon goal plan on resume.')));
check('guardian execution path retained',()=>assert.ok(loop.includes('authorizeToolCall({ taskId, ownerId: opts.ownerId }')));
check('effect admission path retained',()=>assert.ok(loop.includes('await admitEffect(taskId, planRevision')));
check('real completion arbitration retained',()=>assert.ok(loop.includes('await arbitrateCompletion({ taskId, objective, toolAssisted: true })')));
console.log(`GOAL_PLANNER_OFFLINE ${count}/${count} PASS (source + pure unit tests; NOT Windows/live-game proof)`);
