'use strict';
/** Gap-oriented Windows simulation. Explicitly does NOT claim a live LLM, GUI, or Minecraft server. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
let checks=0,seed=20261031;
function rnd(){ seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }
function ck(value,label){assert.ok(value,label); checks++;}
function transpile(rel){
 const p=path.join(__dirname,'..',rel), exports={};
 const compiled=ts.transpileModule(fs.readFileSync(p,'utf8'),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
 ck(!compiled.diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error),'parse '+rel);
 vm.runInNewContext(compiled.outputText,{exports,require,console,process},{timeout:5000,filename:rel});
 return exports;
}
const planner=transpile('src/lib/agent/core/goalPlanner.ts');
const topics=['a Markdown project','a TypeScript dashboard','a portfolio website','an image-annotation workflow','a customer CSV','a video-editing workflow','a privacy-safe report','a bug tracker','a test pipeline','a document processor'];
const templates=[
 t=>`Research ${t}, implement the design, test the output and deploy the result`,
 t=>`Jarvis, fix issues in ${t} and then verify the changes`,
 t=>`Install the app for ${t} and verify it launches`,
 t=>`Create a folder for ${t} and save the results`,
 t=>`Research the available tools for ${t} and submit a report`,
];
for(let i=0;i<2000;i++){
 const p=templates[i%templates.length](topics[Math.floor(rnd()*topics.length)]);
 ck(planner.requiresExternalActionEvidence(p),'action evidence '+i);
 ck(planner.requiresGoalPlan(p),'unfamiliar multi-step prompt requires goal plan '+i);
}
const conversational=['Why is the sky blue?','Explain what a data pipeline is','Write a poem','Draft an email to a friend','What is the Nether portal?'];
for(let i=0;i<1000;i++){const p=conversational[i%conversational.length];ck(!planner.requiresGoalPlan(p),'conversation does not invoke a goal graph '+i);}
for(let i=0;i<500;i++){
 const count=2+Math.floor(rnd()*7);
 const milestones=Array.from({length:count},(_,k)=>({id:'step'+k,description:'Observe and process task step '+k,dependsOn:k?['step'+(k-1)]:[],evidence:'Independent state readback '+k,tool:'arbitrary_shell'}));
 const valid=planner.validateGoalPlan({schemaVersion:1,milestones});
 ck(valid?.milestones?.length===count,'valid graph '+i);
 ck(!('tool' in valid.milestones[0]),'untrusted executable field stripped '+i);
 const wrong=milestones.map((v,k)=>k===count-1?{...v,dependsOn:['future_not_defined']}:v);
 ck(planner.validateGoalPlan({schemaVersion:1,milestones:wrong})===null,'unknown dependencies denied '+i);
}
const {lateGamePlan}=require('../windows-companion/minecraft-bot/late_game.cjs');
const {planAction,observedWorld}=require('../windows-companion/minecraft-bot/mine_ai_mcp_mission.cjs');
const ARMOR=['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots'];
function state(extra={}){return {dimension:'minecraft:the_end',wornNetherite:false,dragonPresent:true,crystalsNearby:1,inventory:{raw:{}},...extra};}
const flags=['dragonKilled','exitPortalObserved','netheriteEquipped'];
for(let i=0;i<1500;i++){
 const missing=i%4;const milestones={dragonKilled:true,exitPortalObserved:true,netheriteEquipped:true};
 if(missing<3)milestones[flags[missing]]=false;
 const decision=lateGamePlan(state({wornNetherite:missing!==3}),{milestones});
 ck(decision.kind!=='complete','never declare a false Minecraft victory '+i);
}
const valid=lateGamePlan(state({wornNetherite:true}),{milestones:{dragonKilled:true,exitPortalObserved:true,netheriteEquipped:true}});
ck(valid.kind==='complete','synthetic complete ONLY when full evidence is injected');
const sample={joined:true,dimension:'minecraft:overworld',position:{x:0,y:64,z:0},vitals:{health:20,food:20},inventory:{stacks:ARMOR.map(name=>({name,count:1,location:'main'}))},endFight:{dragons:[],crystals:[]},nearby:{players:[]}};
ck(observedWorld(sample).wornNetherite===false,'carried armor is not equipped');
const smith=planAction({kind:'smith_netherite',item:'netherite_helmet',base:'diamond_helmet'},sample);
ck(typeof smith.blocked==='string' && /does not advertise/i.test(smith.blocked),'Minecraft MCP full-progression smithing blocker detected');
const result={environment:'GitHub Actions Windows runner (when run by the workflow)',source:'JARVIS real planning contract + Minecraft simulated world planner',assertions:checks,seed,results:{
 unfamiliarPromptRouting:'PASS: deterministic actionable and planning gates (not live model-generated plans)',
 goalGraphValidation:'PASS: synthetic dependency/evidence contracts',
 minecraftFalseVictoryRejection:'PASS: simulated evidence invariants',
 minecraftFullRun:'BLOCKED: MCP smith_netherite lacks a verified smithing upgrade tool',
 liveLLM:'NOT_TESTED: no real provider credentials',
 realWindowsGUI:'NOT_TESTED: runner is noninteractive',
 realMinecraftServer:'NOT_TESTED: no world/server attached'}};
fs.writeFileSync('four-gap-autonomy-results.json',JSON.stringify(result,null,2));
console.log('FOUR_GAP_SIMULATION_CHECKS',checks,'PASS');
console.log('RELEASE_GAPS',JSON.stringify(result.results));
