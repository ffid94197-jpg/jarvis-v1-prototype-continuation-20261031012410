#!/usr/bin/env node
'use strict';
// Bounded simulated/instrumented code tests ONLY. NO real Minecraft
// server, world, combat, or third-party commands are executed here.
const assert=require('node:assert/strict');
const {validCraftSpec,validEquipSpec,RECIPES,EQUIPMENT}=require('./general_goal.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {createController,decide,digest}=require('./autonomy_engine.cjs');
let tests=0;
const ok=(x,m)=>{assert.ok(x,m);tests++;};
const state=(raw={},extra={})=>({joined:true,health:20,hunger:20,workbenchNearby:true,
 threats:[],equipped:{hand:null,head:null,torso:null,legs:null,feet:null,'off-hand':null},
 inventory:{raw,logs:raw.oak_log||0,planks:raw.oak_planks||0,
 sticks:raw.stick||0,table:raw.crafting_table||0,
 cobblestone:raw.cobblestone||0,rawIron:raw.raw_iron||0,
 ironIngot:raw.iron_ingot||0,stonePickaxe:raw.stone_pickaxe||0,
 woodenPickaxe:raw.wooden_pickaxe||0},...extra});
const craft=(item,targetCount=1)=>({command:'auto_goal',goal:'craft',item,targetCount,durationSeconds:300});
const equip=(item,destinationSlot)=>({command:'auto_goal',goal:'equip',item,destinationSlot,durationSeconds:300});
for(const item of Object.keys(RECIPES)){
 ok(validCraftSpec({goal:'craft',item,targetCount:1}),item+' allowed crafting recipe');
 ok(validateCommand(craft(item))===null,item+' authorized via protocol');
 ok(decide('craft',state({[item]:1}),{}, {item,targetCount:1}).kind==='complete',
    item+' requires physical inventory before completion');
 ok(decide('craft',state(),{}, {item,targetCount:1}).kind!=='complete',
    item+' never completes without resource');
}
for(const [destination,items] of Object.entries(EQUIPMENT)){
 for(const item of items){
  ok(validEquipSpec({goal:'equip',item,destination}),item+' allowed equipment');
  ok(validateCommand(equip(item,destination))===null,item+' allowed owner command');
  const equipped={hand:null,head:null,torso:null,legs:null,feet:null,'off-hand':null};
  ok(decide('equip',state({[item]:1},{equipped}),{}, {item,destination}).kind==='equip_general',
    item+' does not imply equipped from backpack');
  equipped[destination]=item;
  ok(decide('equip',state({[item]:1},{equipped}),{}, {item,destination}).kind==='complete',
    item+' physical slot proves success');
 }
}
for(const bad of [
 {goal:'craft',item:'command_block',targetCount:1},
 {goal:'craft',item:'chest',targetCount:0},
 {goal:'craft',item:'chest',targetCount:17},
 {goal:'craft',item:'chest',targetCount:1,code:'eval'},
 {goal:'equip',item:'iron_helmet',destination:'torso'},
 {goal:'equip',item:'netherite_sword',destination:'head'},
 {goal:'equip',item:'shield',destination:'head'},
 {goal:'equip',item:'iron_helmet',destination:'head',script:'rm -rf'}
]){
 ok(!validCraftSpec(bad)&&!validEquipSpec(bad),
 'Strictly reject unsupported untrusted goal '+JSON.stringify(bad));
}
ok(validateCommand({...craft('chest'),extra:'malicious'})!==null,'Reject injected command keys');
ok(validateCommand({...equip('iron_helmet','head'),targetCount:2})!==null,'Reject equip unrelated quantity');
ok(validateCommand({...craft('chest'),destinationSlot:'head'})!==null,'Reject craft unrelated destination');
ok(validSequence([{goal:'craft',item:'torch',targetCount:4},
 {goal:'equip',item:'torch',destination:'hand'}]),'Composed craft-and-equip accepted');
ok(!validSequence([{goal:'equip',item:'command_block',destination:'hand'}]),
 'No arbitrary multi-step items');
let clock=5000;
const controller=createController({clock:()=>clock,maxSteps:50,maxSeconds:1000});
controller.start('sequence',400,{steps:[
 {goal:'craft',item:'torch',targetCount:4},
 {goal:'equip',item:'torch',destination:'hand'}]});
const ingredients=state({torch:0,stick:1,coal:1});
ok(controller.next(ingredients).kind==='craft_general','Sequence initially crafts real torch');
controller.record({kind:'craft_general'},{ok:true,verified:false,detail:'Packet sent, no inventory delta'});
ok(controller.next(ingredients).kind==='craft_general',
 'An unverified craft does not advance the sequence');
ok(controller.next(state({torch:4})).kind==='equip_general',
 'Only real crafted inventory advances sequence');
ok(controller.next(state({torch:4})).kind==='equip_general',
 'An unequipped backpack item cannot satisfy equip stage');
ok(controller.next(state({torch:4},{equipped:{hand:'torch'}})).kind==='complete',
 'Both stages complete from independently observed inventory and hand slot');
ok(controller.status().status==='complete','Sequence settles after all proofs');
const consecutive=createController({clock:()=>clock,maxSteps:40,maxSeconds:1000});
consecutive.start('craft',300,{item:'chest',targetCount:2});
const action={kind:'craft_general'};
for(let n=0;n<2;n++)consecutive.record(action,{ok:true,verified:false,detail:'Unsettled receipt'});
ok(consecutive.status().status==='running','Two consecutive misses preserve retry budget');
consecutive.record(action,{ok:true,verified:true,detail:'Server inventory increased'});
ok(consecutive.status().failures.craft_general===0,
 'Verified successful craft resets previously accumulated failures');
for(let n=0;n<2;n++)consecutive.record(action,{ok:false,verified:false});
ok(consecutive.status().status==='running',
 'Two new misses after verified success are not three consecutive failures');
consecutive.record(action,{ok:false,verified:false});
ok(consecutive.status().status==='blocked',
 'Third genuinely consecutive failed craft must fail closed');
const paused=createController({clock:()=>clock,maxSteps:40,maxSeconds:1000});
paused.start('equip',300,{item:'diamond_helmet',destination:'head'});
paused.stop('Owner emergency stop');
ok(paused.next(state({diamond_helmet:1})).kind==='idle','Owner E-stop is final');
ok(!paused.renewMission(21600),'E-stop cannot renew goal lease');
const inventory={items:()=>[{name:'iron_helmet',count:1}],slots:{17:{name:'iron_helmet'}}};
const mock={entity:{position:{x:0,y:64,z:0}},inventory,
 getEquipmentDestSlot:s=>s==='head'?17:undefined,
 heldItem:{name:'stone_sword'},players:{},entities:{},health:20,food:20,
 game:{dimension:'minecraft:overworld'},findBlock:()=>null};
const observed=digest(mock,'owner');
ok(observed.equipped?.head==='iron_helmet' &&
 observed.equipped?.hand==='stone_sword','Only actual Mineflayer slots count as equipped');

const receiptBinding=createController({clock:()=>clock,maxSteps:60,maxSeconds:1000});
receiptBinding.start('dragon_then_netherite_run',400);
for(const proof of ['nether_portal','dragon_seen','end_exit_portal','netherite_equipped'])
 receiptBinding.record({kind:'collect_wood'},{ok:true,verified:true,proof});
ok(Object.values(receiptBinding.status().milestones).every(v=>v!==true),
 'Unrelated successful wood receipt cannot forge portal, Dragon or Netherite milestones');
receiptBinding.record({kind:'observe_dragon'},{ok:true,verified:true,proof:'dragon_seen'});
ok(receiptBinding.status().milestones.dragonSeen===true,
 'Real dragon observation retains milestone');
receiptBinding.record({kind:'equip_general'},{ok:true,verified:true,proof:'netherite_equipped'});
ok(receiptBinding.status().milestones.netheriteEquipped!==true,
 'An unrelated equipment action cannot forge the full Netherite equipment proof');
receiptBinding.record({kind:'verify_dragon'},{ok:true,verified:true,proof:'dragon_victory'});
ok(receiptBinding.status().milestones.dragonKilled===true &&
   receiptBinding.status().milestones.exitPortalObserved===true,
 'Real witnessed Dragon victory still establishes the legitimate two milestones');
receiptBinding.record({kind:'build_nether_portal'},{ok:true,verified:true,proof:'nether_portal'});
ok(receiptBinding.status().milestones.netherPortalBuilt===true,
 'Real portal action retains portal milestone');
receiptBinding.record({kind:'equip_netherite'},{ok:true,verified:false,proof:'netherite_equipped'});
ok(receiptBinding.status().milestones.netheriteEquipped!==true,
 'Unverified equipment may not prove Netherite completion');
receiptBinding.record({kind:'equip_netherite'},{ok:true,verified:true,proof:'netherite_equipped'});
ok(receiptBinding.status().milestones.netheriteEquipped===true,
 'Verified dedicated Netherite equipment action retains genuine proof');
receiptBinding.record({kind:'exit_end'},{ok:true,verified:true,proof:'end_return'});
ok(receiptBinding.status().milestones.endReturned===true,
 'Verified End-return action retains milestone');
console.log('GENERAL_GOAL '+tests+'/'+tests+
 ' PASS (offline source and mocked state; NOT live Minecraft Java)');
