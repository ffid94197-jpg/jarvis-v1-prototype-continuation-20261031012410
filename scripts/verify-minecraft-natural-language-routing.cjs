'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/lib/agent/core/minecraftAiGate.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const out={};vm.runInNewContext(js,{exports:out,console,JSON,Number,Object,Array,Math,Set,String,RegExp});
const {isMinecraftAiObjective,isMinecraftObservationOnlyObjective,MinecraftAiGate,MINECRAFT_AI_INSTRUCTIONS}=out;
let checks=0;const ok=(v,label)=>{assert.equal(v,true,label);checks++;};
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
console.log('MINECRAFT_NATURAL_LANGUAGE '+checks+'/'+checks+' PASS (offline gate/prompt tests; no live game)');
