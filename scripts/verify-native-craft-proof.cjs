'use strict';
// Source-isolated contract for native PlayerEngine craft receipts.
// No Fabric server, Windows companion, network or Minecraft world is launched.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const helperPath=path.join(root,'src/lib/agent/core/minecraftCraftProof.ts');
const raw=fs.readFileSync(helperPath,'utf8');
const compiled=ts.transpileModule(raw,{reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require},{filename:helperPath,timeout:5000});
const verify=mod.exports.verifyNativeCraftReceipt;
assert.equal(typeof verify,'function');
const expected={item:'oak_planks',count:4,inventoryBefore:2,inventoryAfter:6};
const valid={goal:'craft',status:'complete',item:'oak_planks',targetCount:4,
  milestones:{craftDone:true,initialCount:2,currentCount:6,
    craftProofCount:4,craftedCount:4}};
let checks=0;
function yes(value,label){assert.equal(value,true,label);checks++}
function no(value,label){assert.equal(value,false,label);checks++}
yes(verify(valid,expected),'same-task craft stat and inventory deltas pass');
no(verify({...valid,milestones:{...valid.milestones,craftDone:false}},expected),'missing craft completion flag denied');
no(verify({...valid,status:'running'},expected),'running task denied');
no(verify({...valid,item:'spruce_planks'},expected),'wrong item denied');
no(verify({...valid,targetCount:3},expected),'wrong requested quantity denied');
no(verify({...valid,milestones:{...valid.milestones,initialCount:1}},expected),'wrong initial inventory denied');
no(verify({...valid,milestones:{...valid.milestones,currentCount:7}},expected),'wrong current inventory denied');
no(verify({...valid,milestones:{...valid.milestones,craftProofCount:3,craftedCount:3}},expected),'insufficient craft-task output proof denied');
no(verify({...valid,milestones:{...valid.milestones,craftedCount:5}},expected),'crafted count inconsistent with task-witness delta denied');
no(verify({...valid,milestones:{...valid.milestones,currentCount:5}},expected),'inventory delta below target denied');
no(verify({goal:'craft',status:'complete',item:'oak_planks',targetCount:4},expected),'missing milestones denied');
no(verify(valid,{...expected,count:0}),'invalid target count denied');
no(verify(null,expected),'missing receipt denied');
const java=fs.readFileSync(path.join(root,'integrations/ai-companion-bridge/overlay/com/neovetta/aicompanion/jarvis/JarvisBridgeServer.java'),'utf8');
const bridge=fs.readFileSync(path.join(root,'src/lib/agent/windows/playerEngineBridge.ts'),'utf8');
assert.match(java,/new JarvisCraftInInventoryTask\(/);
assert.match(java,/new JarvisCraftInTableTask\(/);
assert.match(java,/verified-craft-task-not-supported/);
assert.match(java,/int before=countItem\(run\.entity,run\.item\)/);
assert.match(java,/int after=countItem\(run\.entity,run\.item\)/);
assert.doesNotMatch(java,/Stats\.CRAFTED/);
assert.match(java,/run\.craftGoal="craft"/);
assert.match(java,/boolean crafted=run\.craftGoal!=null && added &&/);
assert.match(java,/summary\.addProperty\("craftedCount",craftedCount\)/);
assert.match(java,/milestones\.addProperty\("craftProofCount",candidate\.craftProofCount\)/);
assert.match(java,/Run statusRun=tasks\.get\(taskId\)/);
assert.match(java,/java\.util\.Collections\.singletonList\(statusRun\)/);
assert.match(bridge,/verifyNativeCraftReceipt\(nativeCraft/);
assert.doesNotMatch(bridge,/crafting-method proof not yet available/);
checks+=14;
console.log('Native PlayerEngine craft method proof: '+checks+'/'+checks+' PASS (source-isolated; no Fabric/game acceptance)');
