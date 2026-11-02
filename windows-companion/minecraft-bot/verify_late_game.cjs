'use strict';
const assert=require('node:assert/strict');
const {lateGamePlan,NETHERITE,DIAMOND}=require('./late_game.cjs');
const {decide,createController}=require('./autonomy_engine.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
let checks=0;const check=(truth,label)=>{assert.ok(truth,label);checks++;};
const inv=raw=>({raw,...raw});
const state=(raw={},other={})=>({joined:true,health:20,hunger:20,threats:[],dimension:'minecraft:overworld',workbenchNearby:true,furnaceNearby:true,smithingTableNearby:true,netherPortalNearby:true,inventory:inv(raw),...other});
const gear=Object.fromEntries(NETHERITE.map(n=>[n,1]));
const flightReady={...gear,bow:1,arrow:64};
const realEyes={ender_eye:16};
const readyForEnd={...Object.fromEntries(DIAMOND.map(n=>[n,1])),bow:1,arrow:64};
// Canonical Java item and historical alias must be equivalent without
// counting an inventory alias as a second physical stack.
const {eyeCount}=require('./late_game.cjs');
check(eyeCount({raw:{ender_eye:3},eye_of_ender:3})===3,
  'Real ender_eye and digest alias are one physical inventory stack');
check(eyeCount({raw:{ender_eye:3,eye_of_ender:1}})===4,
  'When both distinct real IDs are supplied, preserve each raw quantity');
check(eyeCount({eye_of_ender:7})===7,'Historical normalized snapshots still supported');

const diamond=Object.fromEntries(DIAMOND.map(n=>[n,1]));
const actual=({raw={},world={},milestones={}})=>lateGamePlan(state(raw,{wornNetherite:milestones.netheriteEquipped===true,
 heldNetheriteSword:milestones.netheriteEquipped===true && raw.netherite_sword>0,...world}),{milestones});
const expect=(params,kind)=>{const a=actual(params);check(a.kind===kind,`expected ${kind}, got ${JSON.stringify(a)}`);};
const expectDragonFirst=(params,kind)=>{
 const a=lateGamePlan(state(params.raw,params.world),{goal:'dragon_then_netherite_run',milestones:{}});
 check(a.kind===kind,`dragon-first expected ${kind}, got ${JSON.stringify(a)}`);
};
check(validateCommand({command:'auto_goal',goal:'netherite_dragon_run',durationSeconds:21600})===null,'six-hour goal');
check(validateCommand({command:'auto_goal',goal:'netherite_dragon_run',durationSeconds:43201})!==null,'bounded mission time');
expect({raw:diamond,world:{netherPortalNearby:false}},'mine_obsidian');
expect({raw:{...diamond,obsidian:14},world:{netherPortalNearby:false}},'collect_flint');
expect({raw:{...diamond,obsidian:14,flint:1,iron_ingot:1},world:{netherPortalNearby:false}},'craft_flint_steel');
expect({raw:{...diamond,obsidian:14,flint_and_steel:1},world:{netherPortalNearby:false}},'build_nether_portal');
expect({raw:diamond},'enter_nether');
// Dragon-first archery must provision the table and sticks before crafting.
expectDragonFirst({raw:{...readyForEnd,ender_eye:16,arrow:0,bow:0,string:3,stick:3,crafting_table:1},
 world:{netherPortalNearby:true,workbenchNearby:false}},'place_table');
expectDragonFirst({raw:{...readyForEnd,ender_eye:16,arrow:0,bow:0,string:3,stick:3,planks:4},
 world:{netherPortalNearby:true,workbenchNearby:false}},'craft_table');
expectDragonFirst({raw:{...readyForEnd,ender_eye:16,arrow:0,bow:0,string:3,stick:0,planks:2},
 world:{netherPortalNearby:true}},'craft_sticks');

// The Dragon-first path MUST continue using Java's actual ender_eye ID.
expectDragonFirst({raw:{...readyForEnd,...realEyes},
  world:{netherPortalNearby:true}},'track_stronghold');
expectDragonFirst({raw:{...readyForEnd,ender_eye:3,ender_pearl:4,blaze_powder:4},
  world:{netherPortalNearby:true,strongholdPortalFrameNearby:true,strongholdMissingEyes:7}},'craft_eyes');
expectDragonFirst({raw:{...readyForEnd,ender_eye:3},
  world:{netherPortalNearby:true,strongholdPortalFrameNearby:true,strongholdMissingEyes:3}},'activate_end_portal');
expectDragonFirst({raw:readyForEnd,
  world:{netherPortalNearby:true,endPortalPresent:true,endPortalActivated:true}},'enter_end');

expect({raw:diamond,world:{dimension:'minecraft:the_nether'}},'loot_bastion_template');
const temp={...diamond,netherite_upgrade_smithing_template:1,netherrack:4};
expect({raw:temp,world:{dimension:'minecraft:the_nether'}},'mine_ancient_debris');
expect({raw:{...temp,ancient_debris:20},world:{dimension:'minecraft:the_nether'}},'collect_gold');
expect({raw:{...temp,ancient_debris:20,gold_ingot:20},world:{dimension:'minecraft:the_nether'}},'hunt_blazes');
const goldFromOre={...temp,ancient_debris:20,raw_gold:20,
 blaze_rod:8,ender_pearl:16,netherrack:4};
expect({raw:goldFromOre,world:{dimension:'minecraft:the_nether'}},'enter_overworld');
const goldFromNuggets={...temp,ancient_debris:20,gold_nugget:180,
 blaze_rod:8,ender_pearl:16,netherrack:4};
expect({raw:goldFromNuggets,world:{dimension:'minecraft:the_nether'}},'enter_overworld');
const refineMaterials={...temp,ancient_debris:0,netherite_scrap:20,
 raw_gold:20,blaze_rod:8,ender_pearl:16,netherrack:4,coal:1};
expect({raw:{...refineMaterials,coal:0}},'collect_wood');
const refine=actual({raw:refineMaterials});
check(refine.kind==='smelt_resource' &&
 refine.input==='raw_gold' && refine.output==='gold_ingot',
 'Observed raw gold must be refined in Overworld, not sent back into Nether');
expect({raw:{...refineMaterials,raw_gold:0,gold_nugget:180}},'collect_gold');

const almostDone=Object.fromEntries(NETHERITE.slice(0,4).map(name=>[name,1]));
const postDragonNether={...almostDone,netherite_upgrade_smithing_template:1,
 netherite_ingot:1,netherrack:4};
const postDragonMilestones={dragonKilled:true,exitPortalObserved:true};
const postDragonState=state(postDragonNether,{dimension:'minecraft:the_nether'});
const postDragonAction=lateGamePlan(postDragonState,{goal:'dragon_then_netherite_run',milestones:postDragonMilestones});
check(postDragonAction.kind==='enter_overworld',
 'Four upgraded pieces and last ingot must return home, not require another 20 Ancient Debris');
const completedDragonMilestones={dragonKilled:true,exitPortalObserved:true,
 netheriteEquipped:true};
const unprovenReturn=lateGamePlan(state(gear,{wornNetherite:true}),
 {goal:'dragon_then_netherite_run',milestones:completedDragonMilestones});
check(unprovenReturn.kind==='blocked',
 'Dragon-first full victory must reject missing real End-to-Overworld return receipt');
const provenReturn=lateGamePlan(state(gear,{wornNetherite:true,heldNetheriteSword:true}),
 {goal:'dragon_then_netherite_run',
  milestones:{...completedDragonMilestones,endReturned:true}});
check(provenReturn.kind==='complete',
 'Dragon death, observed End return and currently worn armor prove the required order');
const legacyGoal=lateGamePlan(state(gear,{dimension:'minecraft:the_end',wornNetherite:true,heldNetheriteSword:true}),
 {goal:'netherite_dragon_run',milestones:completedDragonMilestones});
check(legacyGoal.kind==='complete',
 'Gear-first legacy Dragon victory may still settle in the End, without spoofed post-Dragon return');
const swordSwitched=lateGamePlan(state(gear,{dimension:'minecraft:the_end',wornNetherite:true,
 heldNetheriteSword:false}),{goal:'netherite_dragon_run',milestones:completedDragonMilestones});
check(swordSwitched.kind==='equip_netherite',
 'Victory refuses previously equipped but no-longer-held Netherite sword');
const helmetStillWorn=lateGamePlan(state(gear,{wornNetherite:true,heldNetheriteSword:false}),
 {goal:'dragon_then_netherite_run',
  milestones:{...completedDragonMilestones,endReturned:true}});
check(helmetStillWorn.kind==='equip_netherite',
 'Dragon-first final state also requires physically held Netherite sword');

const partCrafted={...temp,netherite_scrap:16,gold_ingot:16,netherite_ingot:1};
const partlyProvisioned=lateGamePlan(state(partCrafted,{dimension:'minecraft:the_nether'}),{milestones:{}});
check(partlyProvisioned.kind==='hunt_blazes',
 'One prepared ingot plus 16 scraps and gold satisfies remaining four upgrades');

expect({raw:{...temp,ancient_debris:20,gold_ingot:20,blaze_rod:8},world:{dimension:'minecraft:the_nether'}},'hunt_endermen');
expect({raw:{...temp,ancient_debris:20,gold_ingot:20,blaze_rod:8,ender_pearl:16},world:{dimension:'minecraft:the_nether'}},'enter_overworld');
const cargo={...temp,ancient_debris:20,gold_ingot:20,blaze_rod:8,ender_pearl:16,coal:8};
expect({raw:cargo},'smelt_resource');
expect({raw:{...cargo,ancient_debris:0,netherite_scrap:20}},'craft_netherite_ingot');
const readyMaterials={...cargo,ancient_debris:0,netherite_scrap:20,gold_ingot:20};
expect({raw:{...readyMaterials,crafting_table:1},
 world:{workbenchNearby:false}},'place_table');
expect({raw:{...readyMaterials,planks:4},
 world:{workbenchNearby:false}},'craft_table');
const netherGold=state({...temp,ancient_debris:20,gold_nugget:9,crafting_table:1},
 {dimension:'minecraft:the_nether',workbenchNearby:false});
check(lateGamePlan(netherGold,{milestones:{}}).kind==='collect_gold',
 'One ingot worth of gold nuggets is insufficient; gather raw loot rather than crafting dangerously in Nether');

expect({raw:{...cargo,ancient_debris:0,netherite_scrap:0,netherite_ingot:5,diamond:0}},'mine_diamond');
expect({raw:{...cargo,ancient_debris:0,netherite_ingot:5,diamond:7,netherrack:1}},'duplicate_template');
expect({raw:{...cargo,ancient_debris:0,netherite_ingot:5,diamond:7,netherrack:1,netherite_upgrade_smithing_template:5}},'smith_netherite');
expect({raw:{...cargo,...gear,ancient_debris:0,netherite_upgrade_smithing_template:0}},'equip_netherite');
expect({raw:{...flightReady,blaze_rod:8,ender_pearl:16},milestones:{netheriteEquipped:true}},'craft_blaze_powder');
expect({raw:{...flightReady,blaze_powder:16,ender_pearl:16},milestones:{netheriteEquipped:true}},'craft_eyes');
expect({raw:{...flightReady,eye_of_ender:16},milestones:{netheriteEquipped:true}},'track_stronghold');
expect({raw:{...flightReady,ender_eye:16},milestones:{netheriteEquipped:true}},'track_stronghold');
expect({raw:{...gear,eye_of_ender:16,string:3,stick:3,crafting_table:1},
  milestones:{netheriteEquipped:true},
  world:{workbenchNearby:false}},'place_table');
expect({raw:{...gear,eye_of_ender:16,bow:1,arrow:4,flint:3,feather:3,stick:3,crafting_table:1},
  milestones:{netheriteEquipped:true},
  world:{workbenchNearby:false}},'place_table');
expect({raw:{...flightReady,ender_eye:6,blaze_powder:6,ender_pearl:6},
 milestones:{netheriteEquipped:true}},'craft_eyes');
expect({raw:{...flightReady,eye_of_ender:16},milestones:{netheriteEquipped:true},world:{strongholdPortalFrameNearby:true}},'activate_end_portal');
expect({raw:{...flightReady,eye_of_ender:16},milestones:{netheriteEquipped:true},world:{endPortalPresent:true,endPortalActivated:true}},'enter_end');
// Gear-first with an already-open End portal does NOT need another Eye.
expect({raw:flightReady,milestones:{netheriteEquipped:true},
 world:{endPortalPresent:true,endPortalActivated:true}},'enter_end');
expect({raw:{...flightReady,ender_eye:3},milestones:{netheriteEquipped:true},
 world:{strongholdPortalFrameNearby:true,strongholdMissingEyes:3}},'activate_end_portal');
expect({raw:{...flightReady,ender_eye:1,blaze_powder:2,ender_pearl:2},
 milestones:{netheriteEquipped:true},
 world:{strongholdPortalFrameNearby:true,strongholdMissingEyes:3}},'craft_eyes');
const end={dimension:'minecraft:the_end',dragonPresent:true,dragonId:23,crystalsNearby:12};
expect({raw:gear,world:end},'equip_netherite');
expect({raw:gear,world:end,milestones:{netheriteEquipped:true}},'observe_dragon');
expect({raw:gear,world:end,milestones:{netheriteEquipped:true,dragonSeen:true}},'destroy_end_crystal');
expect({raw:gear,world:{...end,crystalsNearby:0},milestones:{netheriteEquipped:true,dragonSeen:true}},'fight_dragon');
expect({raw:gear,world:{...end,dragonPresent:false,dragonDeadObserved:true,exitPortalPresent:true},milestones:{netheriteEquipped:true,dragonSeen:true}},'verify_dragon');
expect({raw:gear,world:{...end,dragonPresent:false,dragonDeadObserved:false,exitPortalPresent:true},milestones:{netheriteEquipped:true,dragonSeen:true}},'search_dragon');
expect({raw:gear,world:{...end,dragonPresent:false,dragonDeadObserved:true,exitPortalPresent:true},milestones:{netheriteEquipped:true,dragonSeen:true,dragonKilled:true,exitPortalObserved:true}},'complete');
// Previously verified armor is not enough if the server no longer shows it worn.
expect({raw:gear,world:{...end,wornNetherite:false,dragonPresent:false,dragonDeadObserved:true,exitPortalPresent:true},milestones:{netheriteEquipped:true,dragonSeen:true,dragonKilled:true,exitPortalObserved:true}},'equip_netherite');
// World snapshot only, inventory claims and a dead-entity disappearance must
// never imply Ender Dragon victory without verified events.
let rand=911;const next=()=>((rand=Math.imul(rand,1664525)+1013904223>>>0)/4294967296);
const actionNames=new Set(['mine_obsidian','collect_flint','collect_iron','craft_flint_steel','build_nether_portal','enter_nether','mine_ancient_debris','collect_gold','hunt_blazes','hunt_endermen','enter_overworld','loot_bastion_template','smelt_resource','craft_netherite_ingot','mine_diamond','duplicate_template','smith_netherite','equip_netherite','craft_blaze_powder','craft_eyes','track_stronghold','activate_end_portal','enter_end','observe_dragon','destroy_end_crystal','fight_dragon','verify_dragon','search_dragon','blocked','complete','craft_furnace','place_furnace','mine_cobblestone','place_table','craft_table','collect_wood','craft_smithing_table','place_smithing_table','prepare_archery','mine_netherrack']);
for(let i=0;i<100000;i++){
  const dimension=['minecraft:overworld','minecraft:the_nether','minecraft:the_end'][Math.floor(next()*3)];
  const randomInv={...gear};
  for(const name of ['obsidian','flint','flint_and_steel','iron_ingot','ancient_debris','netherite_scrap','netherite_ingot','gold_ingot','netherite_upgrade_smithing_template','blaze_rod','ender_pearl','eye_of_ender','blaze_powder','diamond','netherrack'])randomInv[name]=Math.floor(next()*25);
  const w=state(randomInv,{dimension,dragonPresent:next()<.5,crystalsNearby:Math.floor(next()*15),endPortalPresent:next()<.1,netherPortalNearby:next()<.4});
  const d=lateGamePlan(w,{milestones:{netheriteEquipped:next()<.5,dragonSeen:next()<.5}});
  check(actionNames.has(d.kind),'recognized action '+i);
  check(d.kind!=='complete','no false final success '+i);
}
// Long missions renew only after their window actually expires; never revive
// owner-stopped, blocked, or short single-goal sessions.
let tick=1000;
const renewal=createController({clock:()=>tick,maxSeconds:43200,maxSteps:20000});
renewal.start('netherite_dragon_run',10);
tick+=11000;
check(renewal.next(state(gear)).kind==='idle' && renewal.status().status==='expired','mission first lease expired');
check(renewal.renewMission(21600) && renewal.status().status==='running','long mission transparently renews');
renewal.stop('Owner stopped');
check(!renewal.renewMission(21600),'stopped mission cannot auto-renew');
const shortGoal=createController({clock:()=>tick,maxSeconds:43200});
shortGoal.start('follow',10);tick+=11000;shortGoal.next(state(gear));
check(!shortGoal.renewMission(21600),'short goal expiry cannot auto-renew');
const c=createController({maxSeconds:43200});
c.start('netherite_dragon_run',21600);
const bad={kind:'verify_dragon'};c.record(bad,{ok:true,verified:false,proof:'end_exit_portal'});
check(!c.status().milestones.dragonKilled,'unverified dragon proof rejected');
c.record(bad,{ok:true,verified:true,proof:'end_exit_portal'});
check(!c.status().milestones.dragonKilled && c.status().milestones.exitPortalObserved,
  'a verified End portal alone never proves that the Dragon died');
c.record({kind:'collect_wood'},{ok:true,verified:true,proof:'dragon_death'});
check(!c.status().milestones.dragonKilled,'forged death proof from unrelated wood action denied');
c.record(bad,{ok:true,verified:true,proof:'dragon_victory'});
check(!c.status().milestones.dragonKilled,'dragon victory cannot precede witnessed dragon entity');
c.record({kind:'observe_dragon'},{ok:true,verified:true,proof:'dragon_seen'});
c.record(bad,{ok:true,verified:true,proof:'dragon_victory'});
check(c.status().milestones.dragonKilled && c.status().milestones.exitPortalObserved,
  'combined live dragon death and End exit portal proof recorded');
const c2=createController({maxSeconds:43200});c2.start('netherite_dragon_run',21600);
c2.record({kind:'explore'},{ok:true,verified:true,proof:'dragon_victory'});
check(!c2.status().milestones.dragonKilled,'unrelated action cannot grant dragon victory');
// Stronghold portal blocks must never be counted as End exit portal evidence.
const {digest}=require('./autonomy_engine.cjs');
const dummy={entity:{position:{x:0,y:60,z:0}},game:{dimension:'minecraft:overworld'},players:{},entities:{},inventory:{items:()=>[]},
  findBlock:({matching})=>{const block={name:'end_portal'};return matching(block)?block:null;},health:20,food:20};
const ow=digest(dummy,'Owner');
check(ow.endPortalActivated && !ow.exitPortalPresent,'Overworld portal not classified as End exit portal');
dummy.game.dimension='minecraft:the_end';
const endWorld=digest(dummy,'Owner');
check(endWorld.exitPortalPresent && !endWorld.endPortalActivated && !endWorld.endPortalPresent,
  'End exit portal distinct from stronghold portal');
// A partly loaded portal ring does not establish the missing-eye budget.
dummy.game.dimension='minecraft:overworld';
dummy.findBlock=({matching})=>{const b={name:'end_portal_frame'};return matching(b)?b:null;};
const pos=Array.from({length:12},(_,idx)=>({idx}));
dummy.findBlocks=()=>pos.slice(0,4);
dummy.blockAt=p=>({name:'end_portal_frame',getProperties:()=>({eye:p.idx<10})});
const partialRing=digest(dummy,'Owner');
check(partialRing.strongholdPortalFrameNearby && partialRing.strongholdMissingEyes===null,
 'Only four observed frames do not prove the remaining Eye count');
dummy.findBlocks=()=>pos;
const fullRing=digest(dummy,'Owner');
check(fullRing.strongholdMissingEyes===2,
 'Exactly twelve server-observed frames can prove two missing Eyes');
console.log(`LATE_GAME_PLANNER ${checks}/${checks} PASS (100,000 offline randomized snapshots; NOT 100,000 playthroughs)`);
