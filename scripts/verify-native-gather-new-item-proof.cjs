'use strict';
// Deferred local regression for current-task native gather evidence.
// No Fabric, Minecraft, network, or provider dependency; NOT a live acceptance test.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(p,imports={}) {
  const raw=fs.readFileSync(path.join(root,p),'utf8');
  const compiled=ts.transpileModule(raw,{reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(compiled.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
  const module={exports:{}};
  vm.runInNewContext(compiled.outputText,{
    module,exports:module.exports,
    require(name){if(Object.hasOwn(imports,name))return imports[name];throw Error(name);}
  },{filename:p,timeout:5000});
  return module.exports;
}
const intent=load('src/lib/agent/core/minecraftIntent.ts');
const {MinecraftAiGate}=load('src/lib/agent/core/minecraftAiGate.ts',
  {'./minecraftIntent':intent});
const now=Date.now();
const observed=(raw,nativeGoal='gather')=>({
  joined:true,busy:false,position:{x:1,y:65,z:1},health:20,hunger:20,
  nativeGoal,inventory:{raw,logs:0},nearbyBlocks:[]
});
const receipt=(resource,count,initial,current,newItems,done=true,goal='gather')=>({
  goal,status:'complete',since:now,resource,targetCount:count,
  milestones:{initialCount:initial,currentCount:current,newItems,gatherDone:done}
});
function feed(g,command,status) {
 g.record('minecraft_companion_command',{command},{
   ok:true,detail:{botAcknowledged:true,command,status:JSON.stringify(status)}
 });
}
function caseRun({objective='Mine three diamonds in Minecraft',resource='diamond',
  count=3,raw={diamond:7},initial=4,current=7,newItems=3,
  done=true,goal='gather',receiptResource=resource,receiptCount=count,
  observeGoal='gather',omitStatus=false,omitAdmission=false
}={}){
 const g=new MinecraftAiGate(objective);
 feed(g,'observe',observed(raw,observeGoal));
 if(!omitAdmission)g.record('minecraft_companion_command',{
   command:'auto_goal',goal:'gather',resource,targetCount:count,durationSeconds:3600
 },{ok:true,detail:{botAcknowledged:true,command:'auto_goal'}});
 feed(g,'observe',observed(raw,observeGoal));
 if(!omitStatus)feed(g,'auto_status',
   receipt(receiptResource,receiptCount,initial,current,newItems,done,goal));
 return g.proof(objective);
}
let n=0;
const yes=(c,name)=>{assert.equal(caseRun(c).verified,true,name);n++;};
const no=(c,name)=>{assert.equal(caseRun(c).verified,false,name);n++;};
yes({},'Signed same-task newly acquired diamonds and fresh owned inventory');
no({initial:7,current:7,newItems:0},'Preexisting diamonds are not new acquisitions');
no({initial:4,current:7,newItems:0},'No newly acquired items proof');
no({initial:4,current:7,newItems:2},'Too few new items');
no({initial:7,current:7,newItems:3},'Forged increment inconsistent with baseline');
no({initial:4,current:7,newItems:3,done:false},'Native gather did not confirm completion');
no({initial:4,current:7,newItems:3,receiptResource:'iron_ingot'},'Wrong material receipt');
no({initial:4,current:7,newItems:3,receiptCount:2},'Wrong owner requested count');
no({initial:4,current:7,newItems:3,observeGoal:'smelt'},'Wrong observed world mission');
no({initial:4,current:7,newItems:3,omitStatus:true},'Inventory without native signed status');
no({initial:4,current:7,newItems:3,omitAdmission:true},'Inventory without authorized start');
no({initial:4,current:7,newItems:3,current:8},'Mismatch between signed current count and world');
yes({objective:'In Minecraft collect twenty-one diamonds',
  resource:'diamond',count:21,raw:{diamond:25},
  initial:4,current:25,newItems:21},'Large word quantity proof');
yes({objective:'Collect two logs in Minecraft',resource:'logs',count:2,
  raw:{oak_log:5,birch_log:2},initial:5,current:7,newItems:2},
  'Server-aggregated logs from real wood variants');
yes({objective:'Gather three planks in Minecraft',resource:'planks',count:3,
  raw:{oak_planks:2,spruce_planks:3},initial:2,current:5,newItems:3},
  'Mixed plank types in physical inventory');
console.log('Task-bound native Minecraft gather proof: '+n+' deferred checks PASS');
