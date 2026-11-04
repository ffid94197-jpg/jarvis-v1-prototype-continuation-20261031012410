'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const languageGoal=require(path.join(root,'windows-companion/minecraft-bot/language_goal.cjs'));
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
const {isMinecraftAiObjective,isMinecraftObservationOnlyObjective,MinecraftAiGate,MINECRAFT_AI_INSTRUCTIONS,mayStartNativeMinecraftGoal}=out;
const ok=(v,label)=>{assert.equal(v,true,label);checks++;};
const botSource=fs.readFileSync(path.join(root,'windows-companion/minecraft-bot/bot.cjs'),'utf8');
ok(botSource.includes("const match=/^(?:hey\\s+)?jarvis(?:buddy)?"),'owner command parser accepts Hey Jarvis wake prefix');
ok(botSource.includes("const natural=/^(?:hey\\s+)?jarvis(?:buddy)?"),'free-form owner chat accepts Hey Jarvis wake prefix');
ok(botSource.includes('if(username!==leader || !spawned'),'wake-name chat remains restricted to the enrolled owner');
const chatWake=/^(?:hey\\s+)?jarvis(?:buddy)?[,: ]+(.+)$/i;
for(const message of ['jarvis complete it fully','hey jarvis, complete it fully','jarvisbuddy: gather 16 cobblestone','hey jarvisbuddy, explore the cave'])
 ok(chatWake.test(message),'owner Minecraft chat wake prefix: '+message);
const no=(v,label)=>{assert.equal(v,false,label);checks++;};
for(const phrase of ['continue','resume the previous mission','continue the current Netherite run','keep going from the latest checkpoint','can you resume the previous mission?']){
 const intent=languageGoal.directIntent(phrase);
 ok(intent?.ok===true && intent.command.command==='auto_resume','Minecraft continuation maps to saved-mission resume: '+phrase);
}
no(languageGoal.directIntent('continue to build a house')?.command?.command==='auto_resume',
 'a new gameplay objective is not misread as resuming a saved mission');
for(const s of [
 'Jarvis, can you mine diamonds in Minecraft?','Please build a small house in Minecraft',
 'Follow me and protect me in Minecraft','Collect 16 cobblestone using my wooden pickaxe',
 'I want to farm wheat in Minecraft','Find diamond ore in Minecraft','Trade with villagers in Minecraft',
 'Jarvis, explore Minecraft caves','Can you gather ender pearls in Minecraft?','Can you guard me in Minecraft?','In Minecraft, wear an iron helmet','Stop the Minecraft companion'
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
const resumeGate=new MinecraftAiGate('Continue the current Netherite run');
const resumeWorld={joined:true,busy:false,position:{x:0,y:64,z:0},health:20,hunger:20,
 inventory:{logs:0,raw:{wooden_pickaxe:1}},nearbyBlocks:[]};
resumeGate.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(resumeWorld)}});
ok(resumeGate.check('minecraft_companion_command',{command:'auto_resume'}).ok,
 'owner continuation permits bounded saved-mission resume after fresh observation');
no(resumeGate.check('minecraft_companion_command',{command:'auto_resume',goal:'dragon_run'}).ok,
 'model cannot override saved mission goal during resume');
resumeGate.record('minecraft_companion_command',{command:'auto_resume'},{ok:true});
no(resumeGate.check('minecraft_companion_command',{command:'auto_resume'}).ok,
 'resume consumes freshness and requires a new observation');
const unrelatedResumeGate=new MinecraftAiGate('Open Chrome');
unrelatedResumeGate.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(resumeWorld)}});
no(unrelatedResumeGate.check('minecraft_companion_command',{command:'auto_resume'}).ok,
 'unrelated objective cannot invoke Minecraft mission resume');
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
const injured=new MinecraftAiGate('In Minecraft, gather 5 diamonds');
injured.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',
 status:JSON.stringify({...nativeWorld,health:5})}});
no(injured.check('minecraft_companion_command',validNative).ok,
 'Low health must deny non-defensive long-running mining');
const survival=new MinecraftAiGate('In Minecraft, survive');
survival.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',
 status:JSON.stringify({...nativeWorld,health:5})}});
ok(survival.check('minecraft_companion_command',
 {command:'auto_goal',goal:'survive'}).ok,'Owner-authorized survival recovery permitted when injured');

const wearable=new MinecraftAiGate('In Minecraft, wear an iron helmet');
wearable.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
ok(wearable.check('minecraft_companion_command',{command:'auto_goal',goal:'equip',
 item:'iron_helmet',destinationSlot:'head'}).ok,'wear phrasing maps to owner-requested equip goal');

const tooMany=new MinecraftAiGate('In Minecraft, gather 65 diamonds');
tooMany.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
no(tooMany.check('minecraft_companion_command',{command:'auto_goal',
 goal:'gather',resource:'diamond',targetCount:64}).ok,
 'Model must not silently reduce a request for 65 diamonds to 64');
const crafting=new MinecraftAiGate('In Minecraft, craft two chests');
crafting.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
ok(crafting.check('minecraft_companion_command',{command:'auto_goal',goal:'craft',
 item:'chest',targetCount:2}).ok,'Spoken two-chest count preserved');
no(crafting.check('minecraft_companion_command',{command:'auto_goal',goal:'craft',
 item:'chest',targetCount:1}).ok,'Model must not silently undercraft the owner request');

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
no(lineBuild.check('minecraft_companion_command',{command:'auto_goal',goal:'build',
 block:'cobblestone',axis:'x+',length:3,position:{x:200,y:64,z:200}}).ok,
 'Model must not invent distant building origin');
const wheat=new MinecraftAiGate('In Minecraft, farm wheat');
wheat.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
ok(wheat.check('minecraft_companion_command',{command:'auto_goal',goal:'farm_wheat',
 position:{x:2,y:64,z:2},width:2,depth:2,targetCount:2}).ok,
 'Nearby owner-requested bounded wheat skill admitted');
no(wheat.check('minecraft_companion_command',{command:'auto_goal',goal:'farm_wheat',
 position:{x:3000,y:64,z:3000},width:2,depth:2,targetCount:2}).ok,
 'Remote wheat field cannot be invented by model');

const house=new MinecraftAiGate('In Minecraft, build me a complete castle');
house.record('minecraft_companion_command',{command:'observe'},
 {ok:true,detail:{botAcknowledged:true,command:'observe',status:JSON.stringify(nativeWorld)}});
no(house.check('minecraft_companion_command',{command:'auto_goal',goal:'build',
 block:'cobblestone',axis:'x+',length:3,position:{x:1,y:64,z:1}}).ok,
 'One short line may not be reported as a complete castle');

// Independent Core goal/target integrity: one accepted action is not a
// substitute for the user's entire ordered Dragon + Netherite mission.
const combinedObjective='In Minecraft, defeat the Ender Dragon then get full Netherite armor';
const reverseObjective='In Minecraft, get full Netherite armor then defeat the Ender Dragon';
const sameWorld={...nativeWorld,nearbyBlocks:[
 {name:'chest',x:2,y:64,z:2},
 {name:'oak_door',x:3,y:64,z:2},
 {name:'lever',x:4,y:64,z:2}
]};
const nativeGoal=goal=>({command:'auto_goal',goal,durationSeconds:21600});
no(mayStartNativeMinecraftGoal(combinedObjective,nativeGoal('dragon_run'),sameWorld),
 'Core must not reduce combined Dragon+Netherite mission to Dragon only');
ok(mayStartNativeMinecraftGoal(combinedObjective,nativeGoal('dragon_then_netherite_run'),sameWorld),
 'Core retains explicit Dragon-then-Netherite ordering');
no(mayStartNativeMinecraftGoal(combinedObjective,nativeGoal('netherite_dragon_run'),sameWorld),
 'Core rejects reverse ordering for Dragon-first mission');
ok(mayStartNativeMinecraftGoal(reverseObjective,nativeGoal('netherite_dragon_run'),sameWorld),
 'Core retains explicit Netherite-then-Dragon ordering');
no(mayStartNativeMinecraftGoal(reverseObjective,nativeGoal('dragon_then_netherite_run'),sameWorld),
 'Core rejects reverse ordering for Netherite-first mission');
ok(mayStartNativeMinecraftGoal('In Minecraft, defeat the Ender Dragon',
 nativeGoal('dragon_run'),sameWorld),'Standalone Dragon goal remains valid');
ok(mayStartNativeMinecraftGoal('In Minecraft, craft a chest',
 {command:'auto_goal',goal:'craft',item:'chest',targetCount:1},sameWorld),
 'Core admits an unambiguous single chest');
no(mayStartNativeMinecraftGoal('In Minecraft, craft several chests',
 {command:'auto_goal',goal:'craft',item:'chest',targetCount:1},sameWorld),
 'Core rejects unsupported vague quantity rather than undercrafting');
no(mayStartNativeMinecraftGoal('In Minecraft, craft a chest',
 {command:'auto_goal',goal:'craft',item:'chest',targetCount:16},sameWorld),
 'Core cannot invent a quantity of sixteen for a single requested item');

// Multi-step Core must preserve each stage and quantity; the companion will
// separately validate validSequence before executing any stage.
const sequenceOwner='In Minecraft gather four logs then craft a chest';
const requiredStages=[
 {goal:'gather',resource:'logs',targetCount:4},
 {goal:'craft',item:'chest',targetCount:1}
];
const sequenceArgs=steps=>({command:'auto_goal',goal:'sequence',steps,durationSeconds:21600});
ok(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs(requiredStages),sameWorld),
 'Core admits owner-requested bounded gather-then-craft sequence');
for(const conjunction of ['and craft','and then craft','next craft','after that craft']){
 const owner='In Minecraft gather four logs '+conjunction+' a chest';
 ok(mayStartNativeMinecraftGoal(owner,sequenceArgs(requiredStages),sameWorld),
  'Core preserves two authorized stages for '+conjunction);
 no(mayStartNativeMinecraftGoal(owner,sequenceArgs(requiredStages.slice(0,1)),sameWorld),
  'Core refuses silent second-stage omission for '+conjunction);
 no(mayStartNativeMinecraftGoal(owner,sequenceArgs([...requiredStages].reverse()),sameWorld),
  'Core refuses altered stage order for '+conjunction);
}
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs([...requiredStages].reverse()),sameWorld),
 'Core cannot reorder the owner goal sequence');
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs([
 {...requiredStages[0],targetCount:40},requiredStages[1]]),sameWorld),
 'Core cannot inflate a sequence-stage inventory quantity');
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs([
 requiredStages[0],{goal:'craft',item:'torch',targetCount:1}]),sameWorld),
 'Core cannot replace the requested craft item in a sequence');
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs([
 requiredStages[0],{goal:'dragon_run'}]),sameWorld),
 'Core sequence rejects unsupported unrequested Dragon-stage injection');
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs([
 {...requiredStages[0],shell:'cmd'},requiredStages[1]]),sameWorld),
 'Core sequence rejects extra stage parameters');
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs([requiredStages[0]]),sameWorld),
 'Core refuses a model that silently drops the second stage');
no(mayStartNativeMinecraftGoal(sequenceOwner,sequenceArgs(Array(9).fill(requiredStages[0])),sameWorld),
 'Core rejects overlong sequences');
no(mayStartNativeMinecraftGoal('In Minecraft get Netherite after defeating the Dragon',
 nativeGoal('netherite_dragon_run'),sameWorld),
 'Core refuses ambiguous after-clause rather than reversing mission order');
const travelStages=[
 {goal:'travel',destination:{x:1,y:64,z:2},arrivalRange:2},
 {goal:'craft',item:'chest',targetCount:1}
];
ok(mayStartNativeMinecraftGoal('In Minecraft travel to 1 64 2 then craft a chest',
 sequenceArgs(travelStages),sameWorld),
 'Core admits literal owner-specified travel stage before craft');
no(mayStartNativeMinecraftGoal('In Minecraft travel to 1 64 2 then craft a chest',
 sequenceArgs([{...travelStages[0],destination:{...travelStages[0].destination,admin:true}},
  travelStages[1]]),sameWorld),
 'Core rejects injected nested position metadata');
const equipStages=[{goal:'equip',item:'iron_helmet',destination:'head'},
 {goal:'craft',item:'chest',targetCount:1}];
ok(mayStartNativeMinecraftGoal('In Minecraft equip iron helmet then craft a chest',
 sequenceArgs(equipStages),sameWorld),
 'Core admits owner-specified equipment then craft');
no(mayStartNativeMinecraftGoal('In Minecraft equip iron helmet then craft a chest',
 sequenceArgs([{...equipStages[0],destinationSlot:'head'},equipStages[1]]),sameWorld),
 'Core refuses extra equipment-stage parameters');

// One explicit dimensioned owner instruction may authorize only the exact
// deterministic floor -> two-high entrance walls -> roof sequence.
const roomObjective='In Minecraft, build a 3 by 3 by 2 cobblestone roofed room at 1 64 2';
const roomParsed=languageGoal.directIntent('build a 3 by 3 by 2 cobblestone roofed room at 1 64 2');
ok(roomParsed?.ok&&roomParsed.command.goal==='sequence'&&roomParsed.command.steps.length===3,
 'owner roofed-room instruction produces exactly three typed native structure steps');
const roomSteps=roomParsed.command.steps;
ok(mayStartNativeMinecraftGoal(roomObjective,sequenceArgs(roomSteps),sameWorld),
 'Core admits exactly owner-specified local roofed-room geometry');
no(mayStartNativeMinecraftGoal(roomObjective,sequenceArgs(roomSteps.slice(0,2)),sameWorld),
 'Core refuses silently omitting roof from requested room');
no(mayStartNativeMinecraftGoal(roomObjective,sequenceArgs([...roomSteps].reverse()),sameWorld),
 'Core refuses reordered floor, walls and roof');
no(mayStartNativeMinecraftGoal(roomObjective,sequenceArgs([
 {...roomSteps[0],block:'dirt'},roomSteps[1],roomSteps[2]]),sameWorld),
 'Core refuses unrequested construction material substitution');
no(mayStartNativeMinecraftGoal(roomObjective,sequenceArgs([
 {...roomSteps[0],position:{x:100,y:64,z:2}},roomSteps[1],roomSteps[2]]),sameWorld),
 'Core refuses model-invented distant room origin');
no(mayStartNativeMinecraftGoal(roomObjective,sequenceArgs([
 {...roomSteps[0],command:'run_shell'},roomSteps[1],roomSteps[2]]),sameWorld),
 'Core refuses unrelated instructions embedded in construction stage');
no(mayStartNativeMinecraftGoal(
 'In Minecraft, build a 5 by 5 by 2 cobblestone roofed room at 1 64 2',
 sequenceArgs(roomSteps),sameWorld),
 'Core refuses mismatched owner dimensions and unsafe total block budget');

const entry=(objective)=>{
 const gate=new MinecraftAiGate(objective);
 gate.record('minecraft_companion_command',{command:'observe'},{ok:true,detail:{
  botAcknowledged:true,command:'observe',status:JSON.stringify(sameWorld)
 }});
 return gate;
};
const chestGate=entry('Open the Minecraft chest');
ok(chestGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:2,y:64,z:2}}).ok,
 'Core may interact with freshly observed chest on explicit owner request');
no(chestGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:3,y:64,z:2}}).ok,
 'Core cannot open an observed door when owner asked for chest');
const doorGate=entry('Open the Minecraft door');
ok(doorGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:3,y:64,z:2}}).ok,
 'Core admits owner-requested door at observed coordinates');
no(doorGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:2,y:64,z:2}}).ok,
 'Core rejects nearby chest in place of owner-requested door');
no(doorGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:3,y:64,z:2,hidden:true}}).ok,
 'Core rejects noncanonical coordinate metadata');
no(doorGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:99,y:64,z:2}}).ok,
 'Core rejects unobserved block interaction target');
const mineGate=entry('Mine stone in Minecraft');
no(mineGate.check('minecraft_companion_command',
 {command:'interact_block',position:{x:2,y:64,z:2}}).ok,
 'A mining request cannot authorize a block activation');

console.log('MINECRAFT_NATURAL_LANGUAGE '+checks+'/'+checks+' PASS (offline gate/prompt tests; no live game)');
