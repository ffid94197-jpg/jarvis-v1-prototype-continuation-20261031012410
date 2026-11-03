'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/lib/agent/core/minecraftAiGate.ts'),'utf8');
const transpile=(file,text)=>{
 const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,file+' must parse without TypeScript syntax errors');
 checks++;
 return result.outputText;
};
let checks=0;
const js=transpile('minecraftAiGate.ts',source);
const promptSource=fs.readFileSync(path.join(root,'src/lib/agent/core/prompts.ts'),'utf8');
transpile('prompts.ts',promptSource);
assert.ok(promptSource.includes('Minecraft natural-language tasks'),'main tool catalog documents natural language');
checks++;
const out={};vm.runInNewContext(js,{exports:out,console,JSON,Number,Object,Array,Math,Set,String,RegExp});
const {isMinecraftAiObjective,isMinecraftObservationOnlyObjective,MinecraftAiGate,MINECRAFT_AI_INSTRUCTIONS}=out;
const ok=(v,label)=>{assert.equal(v,true,label);checks++;};
const no=(v,label)=>{assert.equal(v,false,label);checks++;};
for(const s of [
 'Jarvis, can you mine diamonds in Minecraft?','Please build a small house in Minecraft',
 'Follow me and protect me in Minecraft','Collect 16 cobblestone using my wooden pickaxe',
 'I want to farm wheat in Minecraft','Find diamond ore in Minecraft','Trade with villagers in Minecraft',
 'Jarvis, explore Minecraft caves','Can you gather ender pearls in Minecraft?','Can you guard me in Minecraft?','Stop the Minecraft companion'
])ok(isMinecraftAiObjective(s),'natural language route: '+s);
for(const s of [
 'Explain how to mine diamonds in Minecraft','How do I craft a sword in Minecraft?','Do not mine diamonds in Minecraft',
 'Build me a house','Minecraft','Tell me about Ender pearls','What is the best Minecraft sword?','Do not stop the Minecraft companion'
])no(isMinecraftAiObjective(s),'do not dispatch: '+s);
ok(isMinecraftObservationOnlyObjective('Observe my Minecraft inventory'),'read-only observation objective');
no(isMinecraftObservationOnlyObjective('Observe and follow me in Minecraft'),'follow is an effect');
no(isMinecraftObservationOnlyObjective('Observe Minecraft and mine diamonds'),'mining is an effect');
const {singleInventoryResourceGoal}=out;
const expected=[
 ['Collect 2 logs in Minecraft',{resource:'logs',quantity:2}],
 ['Mine six diamonds in Minecraft',{resource:'diamond',quantity:6}],
 ['Get 3 iron ingots in Minecraft',{resource:'iron_ingot',quantity:3}],
 ['Collect obsidian in Minecraft',{resource:'obsidian',quantity:1}],
 ['Gather 65 diamonds in Minecraft',null],
 ['Collect 3 diamonds and make a sword in Minecraft',null],
 ['Get 4 diamonds and 5 iron ingots in Minecraft',null],
 ['Mine a stack of diamonds in Minecraft',null],
 ['Build a diamond house in Minecraft',null]
];
for(const [objective,wanted] of expected){
 const actual=singleInventoryResourceGoal(objective);
 ok(JSON.stringify(actual)===JSON.stringify(wanted),'bounded single-resource predicate '+objective);
}
const resourceGate=new MinecraftAiGate('Mine six diamonds in Minecraft');
const resourceScene={joined:true,busy:false,position:{x:0,y:64,z:0},health:20,hunger:20,
 inventory:{logs:0,raw:{diamond:5}},nearbyBlocks:[]};
const observeResource=world=>resourceGate.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(world)}});
observeResource(resourceScene);
no(resourceGate.proof('Mine six diamonds in Minecraft').verified,'five diamonds cannot satisfy six');
observeResource({...resourceScene,inventory:{...resourceScene.inventory,raw:{diamond:6}}});
ok(resourceGate.proof('Mine six diamonds in Minecraft').verified,'six actual inventory diamonds satisfy six');
no(resourceGate.proof('Collect 3 diamonds and make a sword in Minecraft').verified,
 'Compound objective cannot be proven from just an item count');
const logGate=new MinecraftAiGate('Collect 2 logs in Minecraft');
logGate.record('minecraft_companion_command',{command:'observe'},{ok:true,detail:{
 botAcknowledged:true,command:'observe',status:JSON.stringify({...resourceScene,
 inventory:{logs:2,raw:{}}})}});
ok(logGate.proof('Collect 2 logs in Minecraft').verified,'aggregate server log count is valid even if raw inventory trimmed');

const gate=new MinecraftAiGate('Follow me and protect me in Minecraft');
ok(gate.check('minecraft_companion_command',{command:'auto_stop'}).ok,'safety stop without observation');
no(gate.check('minecraft_companion_command',{command:'follow'}).ok,'follow requires fresh observation');
ok(gate.check('minecraft_companion_command',{command:'observe'}).ok,'first observe allowed');
const observation={joined:true,busy:false,position:{x:0,y:64,z:0},health:20,hunger:20,
 inventory:{woodenPickaxe:1,raw:{wooden_pickaxe:1}},nearbyBlocks:[{name:'stone',x:2,y:63,z:0}]};
gate.record('minecraft_companion_command',{command:'observe'},{ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(observation)}});
ok(gate.check('minecraft_companion_command',{command:'follow'}).ok,'follow after observation');
gate.record('minecraft_companion_command',{command:'follow'},{ok:true});
no(gate.check('minecraft_companion_command',{command:'guard'}).ok,'fresh observe required after effect');
gate.record('minecraft_companion_command',{command:'observe'},{ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(observation)}});
ok(gate.check('minecraft_companion_command',{command:'guard'}).ok,'guard after fresh observation');
ok(gate.check('minecraft_companion_command',{command:'come'}).ok,'come after fresh observation');
no(gate.check('minecraft_companion_command',{command:'auto_goal',goal:'dragon_run'}).ok,'model cannot bypass planner with auto_goal');
ok(gate.check('minecraft_companion_command',{command:'dig_block',position:{x:2,y:63,z:0}}).ok,'dig observed block');
no(gate.check('minecraft_companion_command',{command:'dig_block',position:{x:3,y:63,z:0}}).ok,'dig unobserved block denied');
no(gate.check('minecraft_companion_command',{command:'dig_block',position:{x:30,y:63,z:0}}).ok,'far dig denied');
const low=new MinecraftAiGate('Protect me in Minecraft');
low.record('minecraft_companion_command',{command:'observe'},{ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify({...observation,health:5})}});
ok(low.check('minecraft_companion_command',{command:'guard'}).ok,'defensive guard allowed at critical health');
no(low.check('minecraft_companion_command',{command:'collect_wood'}).ok,'non-defensive action denied at critical health');
const mining=new MinecraftAiGate('Collect cobblestone in Minecraft');
mining.record('minecraft_companion_command',{command:'observe'},{ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(observation)}});
no(mining.check('minecraft_companion_command',{command:'collect_wood'}).ok,'do not substitute wood for cobblestone when pickaxe owned');
ok(MINECRAFT_AI_INSTRUCTIONS.includes('ordinary language'),'main JARVIS natural-language prompt');
ok(MINECRAFT_AI_INSTRUCTIONS.includes('same main JARVIS model'),'single JARVIS brain');
ok(MINECRAFT_AI_INSTRUCTIONS.includes('single Minecraft planning capability'),'one native JARVIS capability');
ok(MINECRAFT_AI_INSTRUCTIONS.includes('NEVER start a second bot'),'no second bot');

// Persistent native mission may start only after a REAL fresh observation,
// when the goal matches the owner instruction and both contract gates agree.
const native=new MinecraftAiGate('In Minecraft, gather 5 diamonds');
const nativeWorld={joined:true,busy:false,position:{x:0,y:64,z:0},health:20,hunger:20,
 inventory:{logs:0,raw:{wooden_pickaxe:1}},nearbyBlocks:[]};
const feedNative=world=>native.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(world)}});
const validNative={command:'auto_goal',goal:'gather',resource:'diamond',targetCount:5,durationSeconds:300};
no(native.check('minecraft_companion_command',validNative).ok,'native goal requires initial observe');
feedNative(nativeWorld);
ok(native.check('minecraft_companion_command',validNative).ok,'owner-requested gather admitted after fresh observe');
no(native.check('minecraft_companion_command',{...validNative,targetCount:50}).ok,
 'AI must not silently expand requested quantity');
no(native.check('minecraft_companion_command',{command:'auto_goal',goal:'dragon_then_netherite_run',durationSeconds:21600}).ok,
 'Do not promote ordinary diamond mining into dragon/Netherite mission');
no(native.check('minecraft_companion_command',{...validNative,shell:'cmd /c evil'}).ok,
 'No extra model-supplied tool parameters');
native.record('minecraft_companion_command',validNative,{ok:true,detail:{botAcknowledged:true}});
no(native.check('minecraft_companion_command',validNative).ok,'cannot repeat persistent mission without observing');
ok(native.check('minecraft_companion_command',{command:'auto_status'}).ok,'mission polling is always read-only');
const incoming=new MinecraftAiGate('Jarvis, can you defeat the Ender Dragon in Minecraft?');
incoming.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
ok(incoming.check('minecraft_companion_command',
 {command:'auto_goal',goal:'dragon_run',durationSeconds:21600}).ok,'explicit owner dragon mission allowed');
no(incoming.check('minecraft_companion_command',
 {command:'auto_goal',goal:'dragon_then_netherite_run',durationSeconds:21600}).ok,'dragon goal cannot add Netherite objective');
const coord=new MinecraftAiGate('In Minecraft, travel to 100 64 -50');
coord.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
ok(coord.check('minecraft_companion_command',{command:'auto_goal',goal:'travel',
 destination:{x:100,y:64,z:-50},arrivalRange:2}).ok,'literal requested travel coordinates permitted');
no(coord.check('minecraft_companion_command',{command:'auto_goal',goal:'travel',
 destination:{x:100,y:64,z:-51},arrivalRange:2}).ok,'model-invented coordinates refused');
const lineBuild=new MinecraftAiGate('In Minecraft, build a cobblestone wall');
lineBuild.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
ok(lineBuild.check('minecraft_companion_command',{command:'auto_goal',goal:'build',
 block:'cobblestone',axis:'x+',length:3,position:{x:1,y:64,z:1}}).ok,'bounded wall skill permitted');
no(lineBuild.check('minecraft_companion_command',{command:'auto_goal',goal:'build',
 block:'obsidian',axis:'x+',length:3,position:{x:1,y:64,z:1}}).ok,'unspecified build material refused');
const house=new MinecraftAiGate('In Minecraft, build me a complete castle');
house.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
no(house.check('minecraft_companion_command',{command:'auto_goal',goal:'build',
 block:'cobblestone',axis:'x+',length:3,position:{x:1,y:64,z:1}}).ok,
 'One short line may not be reported as a complete castle');

console.log('MINECRAFT_NATURAL_LANGUAGE '+checks+'/'+checks+' PASS (offline gate/prompt tests; no live game)');
