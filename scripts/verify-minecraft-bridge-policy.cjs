'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const catalogSource=fs.readFileSync(path.join(root,'src/lib/agent/core/minecraftResources.ts'),'utf8');
const catalogCompiled=ts.transpileModule(catalogSource,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const catalogErrors=(catalogCompiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
assert.equal(catalogErrors.length,0,'shared Minecraft resource catalog must parse');
const catalogExports={};
vm.runInNewContext(catalogCompiled.outputText,{exports:catalogExports,Object,Array,Set});
const safeGatherResources=catalogExports.MINECRAFT_SAFE_GATHER_RESOURCES;
const safeBuildMaterials=catalogExports.MINECRAFT_SAFE_BUILD_MATERIALS;
const resourceGoal=require('../windows-companion/minecraft-bot/resource_goal.cjs');
const structureGoal=require('../windows-companion/minecraft-bot/structure_goal.cjs');
assert.deepEqual([...safeBuildMaterials].sort(),[...structureGoal.BLOCKS].sort(),
  'Core/Guardian/PlayerEngine build catalog must exactly match the native companion structure allowlist');
assert.equal(new Set(safeBuildMaterials).size,safeBuildMaterials.length,'build material catalog has no duplicates');
assert.deepEqual([...safeGatherResources].sort(),[...resourceGoal.RESOURCES].sort(),
  'Core/Guardian/PlayerEngine catalog must exactly match the native companion resource allowlist');
assert.equal(new Set(safeGatherResources).size,safeGatherResources.length,'resource catalog has no duplicates');
const coreGateSource=fs.readFileSync(path.join(root,'src/lib/agent/core/minecraftAiGate.ts'),'utf8');
for(const resource of safeGatherResources)assert.ok(coreGateSource.includes(resource+':'),
  'Core AI gate knows the safe resource '+resource);
assert.ok(coreGateSource.includes('shared safe vanilla resource catalog'),
  'Core Minecraft instructions describe the shared safe resource catalog');
const playerEngineSource=fs.readFileSync(path.join(root,'src/lib/agent/windows/playerEngineBridge.ts'),'utf8');
assert.ok(playerEngineSource.includes('new Set<string>(MINECRAFT_SAFE_GATHER_RESOURCES)'),
  'PlayerEngine uses the shared resource catalog');
assert.ok(playerEngineSource.includes('new Set<string>(MINECRAFT_SAFE_BUILD_MATERIALS)'),
  'PlayerEngine uses the shared build-material catalog');
assert.ok(coreGateSource.includes('!SAFE_BUILD_MATERIALS.has(String(args.block))'),
  'Core AI goal gate enforces the safe build-material catalog');
for(const block of safeBuildMaterials)assert.ok(coreGateSource.includes("'"+block+"'"),
  'Core AI gate knows safe build material '+block);
const javaBridgeSource=fs.readFileSync(path.join(root,'integrations/ai-companion-bridge/overlay/com/neovetta/aicompanion/jarvis/JarvisBridgeServer.java'),'utf8');
const javaBuildMatch=javaBridgeSource.match(/BUILD_BLOCKS=java\.util\.Set\.of\(([\s\S]*?)\);/);
assert.ok(javaBuildMatch,'Java PlayerEngine bridge has a bounded BUILD_BLOCKS allowlist');
for(const block of safeBuildMaterials)assert.ok(javaBuildMatch[1].includes('"'+block+'"'),
  'Java PlayerEngine bridge allows safe build material '+block);
const sequenceSource=fs.readFileSync(path.join(root,'integrations/ai-companion-bridge/overlay/com/neovetta/aicompanion/jarvis/JarvisNativeSequenceTask.java'),'utf8');
const sequenceBuildMatch=sequenceSource.match(/BUILD_BLOCKS=Set\.of\(([\s\S]*?)\);/);
const sequenceGatherMatch=sequenceSource.match(/GATHER=Set\.of\(([\s\S]*?)\);/);
assert.ok(sequenceBuildMatch,'native sequence has a bounded BUILD_BLOCKS allowlist');
assert.ok(sequenceGatherMatch,'native sequence has a bounded GATHER allowlist');
for(const block of safeBuildMaterials)assert.ok(sequenceBuildMatch[1].includes('"'+block+'"'),
  'native sequence allows safe build material '+block);
for(const resource of safeGatherResources)assert.ok(sequenceGatherMatch[1].includes('"'+resource+'"'),
  'native sequence allows safe gather resource '+resource);
assert.ok(sequenceSource.includes('item-stage-fields')&&sequenceSource.includes('equip-stage-fields')&&sequenceSource.includes('travel-stage-fields'),
  'native sequence rejects extra fields on item, equip and travel stages');
const overlaySource=fs.readFileSync(path.join(root,'integrations/ai-companion-bridge/apply-overlay.cjs'),'utf8');
assert.ok(overlaySource.includes('mud')&&overlaySource.includes('moss_block'),
  'pinned AltoClef TaskCatalogue overlay registers the two additional native gather resources');
const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/agent/windows/policy.ts'),'utf8'),{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
assert.equal(errors.length,0,'Windows Guardian TypeScript must parse without syntax errors');
const code=compiled.outputText;
const outputs={};
const policyRequire=id=>id==='../core/minecraftResources'?catalogExports:require(id);
vm.runInNewContext(code,{exports:outputs,URL,process:{platform:'win32',env:{JARVIS_WINDOWS_AGENT_ENABLED:'1',JARVIS_LOCAL_DEV_NO_LOGIN:'1',JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_WINDOWS_COMPANION_TOKEN:'a'.repeat(64),JARVIS_MINECRAFT_LAN_ENABLED:'1'},cwd:()=>root},require:policyRequire});
const validate=outputs.validateDesktopTool;let ok=0;
const run=(args,accepted)=>{const r=validate('minecraft_companion_command',args);assert.equal(r.ok,accepted,JSON.stringify({args,r}));ok++;return r;};
const p={x:1,y:64,z:3};
for(const goal of ['stone_age','iron_age','dragon_run','netherite_dragon_run']){
  const r=run({command:'auto_goal',goal,durationSeconds:21600},true);
  assert.equal(r.prepared.durationSeconds,21600);assert.equal(r.prepared.goal,goal);ok+=2;
}
for(const durationSeconds of [-1,0,43201,999999,5.25,'21600'])run({command:'auto_goal',goal:'netherite_dragon_run',durationSeconds},false);
run({command:'auto_goal',goal:'attack_players',durationSeconds:60},false);
const accepted=[
 {command:'navigate',position:p,range:3},
 {command:'inspect_block',position:p},
 {command:'dig_block',position:p},
 {command:'interact_block',position:p},
 {command:'equip_item',item:'diamond_sword',destination:'hand'},
 {command:'craft_item',item:'ender_eye',count:1},
 {command:'place_block',item:'obsidian',reference:p,face:{x:0,y:1,z:0}},
 {command:'interact_entity',entityId:30},
 {command:'use_item',hand:'off-hand'}
];
for(const x of accepted){const r=run(x,true);for(const [k,v] of Object.entries(x)){assert.equal(JSON.stringify(r.prepared[k]),JSON.stringify(v),`forward ${k}`);ok++;}}
for(const x of [
 {command:'navigate',position:{x:3,y:NaN,z:0}},
 {command:'navigate',position:p,range:100},
 {command:'place_block',item:'obsidian',reference:p,face:{x:1,y:1,z:0}},
 {command:'place_block',item:'obsidian;rm',reference:p,face:{x:0,y:1,z:0}},
 {command:'craft_item',item:'dragon_egg',count:0},
 {command:'equip_item',item:'iron_pickaxe',destination:'strange_slot'},
 {command:'interact_entity',entityId:-100},
 {command:'use_item',hand:'both'},
 {command:'attack_player'}])run(x,false);

const authorized=[
 {command:'auto_goal',goal:'gather',resource:'diamond',targetCount:4,durationSeconds:300},
 {command:'auto_goal',goal:'travel',destination:{x:12,y:64,z:-5},arrivalRange:2},
 {command:'auto_goal',goal:'craft',item:'chest',targetCount:2},
 {command:'auto_goal',goal:'equip',item:'iron_helmet',destinationSlot:'head'},
 {command:'auto_goal',goal:'build',position:{x:1,y:64,z:1},axis:'x+',length:4,block:'cobblestone'},
 {command:'auto_goal',goal:'farm_wheat',position:{x:2,y:63,z:2},width:2,depth:2,targetCount:4},
 {command:'auto_goal',goal:'sequence',steps:[
    {goal:'gather',resource:'logs',targetCount:3},
    {goal:'craft',item:'chest',targetCount:1},
    {goal:'equip',item:'iron_helmet',destination:'head'}]},
 {command:'auto_goal',goal:'dragon_then_netherite_run',durationSeconds:21600}
];
const {validateCommand:validateBot}=require('../windows-companion/minecraft-bot/friend_protocol.cjs');
for(const resource of safeGatherResources){
 const input={command:'auto_goal',goal:'gather',resource,targetCount:4,durationSeconds:300};
 assert.equal(validateBot(input),null,'Companion accepts safe resource '+resource);ok++;
 const r=run(input,true);
 assert.equal(r.prepared.resource,resource,'Guardian forwards safe resource '+resource);ok++;
}
for(const block of safeBuildMaterials){
 const input={command:'auto_goal',goal:'build_volume',position:{x:1,y:64,z:3},
  block,width:2,depth:2,height:1,shape:'floor',durationSeconds:300};
 assert.equal(validateBot(input),null,'Companion accepts safe build material '+block);ok++;
 const r=run(input,true);
 assert.equal(r.prepared.block,block,'Guardian forwards safe build material '+block);ok++;
}
for(const input of authorized){
 assert.equal(validateBot(input),null,'Bot accepts '+JSON.stringify(input));ok++;
 const r=run(input,true);
 for(const [k,v] of Object.entries(input)){
   if(k==='command')continue;
   assert.equal(JSON.stringify(r.prepared[k]),JSON.stringify(v),'Guardian forwards '+k);ok++;
 }
}
for(const input of [
 {command:'auto_goal',goal:'gather',resource:'command_block',targetCount:1},
 {command:'auto_goal',goal:'gather',resource:'bedrock',targetCount:1},
 {command:'auto_goal',goal:'gather',resource:'barrier',targetCount:1},
 {command:'auto_goal',goal:'gather',resource:'tnt',targetCount:1},
 {command:'auto_goal',goal:'build_volume',position:{x:1,y:64,z:3},block:'tnt',width:2,depth:2,height:1,shape:'floor'},
 {command:'auto_goal',goal:'build_volume',position:{x:1,y:64,z:3},block:'bedrock',width:2,depth:2,height:1,shape:'floor'},
 {command:'auto_goal',goal:'build_volume',position:{x:1,y:64,z:3},block:'barrier',width:2,depth:2,height:1,shape:'floor'},
 {command:'auto_goal',goal:'build_volume',position:{x:1,y:64,z:3},block:'lava',width:2,depth:2,height:1,shape:'floor'},
 {command:'auto_goal',goal:'gather',resource:'diamond',targetCount:100},
 {command:'auto_goal',goal:'craft',item:'dragon_egg',targetCount:1},
 {command:'auto_goal',goal:'equip',item:'diamond_sword',destinationSlot:'head'},
 {command:'auto_goal',goal:'travel',destination:{x:30000001,y:64,z:0},arrivalRange:2},
 {command:'auto_goal',goal:'build',position:{x:1,y:64,z:1},length:10,axis:'x+',block:'cobblestone'},
 {command:'auto_goal',goal:'farm_wheat',position:{x:1,y:64,z:1},width:100,depth:2,targetCount:4},
 {command:'auto_goal',goal:'sequence',steps:[{goal:'sequence',steps:[{goal:'tools'}]}]},
 {command:'auto_goal',goal:'sequence',steps:[{goal:'equip',item:'iron_helmet',destinationSlot:'head'}]},
 {command:'auto_goal',goal:'survive',script:'process.exit(1)'},
 {command:'auto_goal',goal:'constructor'},
 {command:'auto_goal',goal:'__proto__'},
 {command:'auto_goal',goal:'equip',item:'iron_helmet',destinationSlot:'constructor'},
 {command:'auto_goal',goal:'gather',resource:'logs',targetCount:1,durationSeconds:43201},
 {command:'natural_goal',text:'mine stones',script:'evil'},
 {command:'natural_goal',text:'hi\nbad'}
])run(input,false);
run({command:'natural_goal',text:'Jarvis, help me collect some diamonds'},true);
run({command:'auto_checkpoint'},true);
run({command:'auto_resume'},true);

console.log(`MINECRAFT_TYPESCRIPT_BRIDGE ${ok}/${ok} PASS (policy only, not live gameplay)`);
