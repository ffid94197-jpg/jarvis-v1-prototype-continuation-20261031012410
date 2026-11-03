'use strict';
/**
 * Minecraft Java SURVIVAL RULE MODEL — not the Mojang engine and NOT a real LAN
 * server. Drives production autonomy_engine.decide + createController and
 * late_game.lateGamePlan against a separate, stateful world with genuine
 * inventory transfers, recipe costs, ore/mining tiers, survival hazards,
 * portal dimensions, crystals, Dragon HP/death+exit event and slot equipment.
 *
 * Acceptance is fail-closed: beginning empty inventory; Dragon death EVENT
 * while in End followed by observed End EXIT; return to Overworld; only THEN
 * acquire/WEAR all four netherite armor pieces (and hold netherite sword).
 * Forbids free resources, creative mode, fabricated milestones or silent skips.
 * This is a playable MECHANICAL APPROXIMATION, not 1:1 Minecraft Java.
 */
const assert = require('node:assert/strict');
const {createController,decide}=require('./autonomy_engine.cjs');
const {NETHERITE,DIAMOND}=require('./late_game.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const GOAL='dragon_then_netherite_run';
const ALLOWED=new Set(['collect_wood','craft_planks','craft_sticks','craft_table','place_table',
 'craft_pickaxe','mine_cobblestone','craft_stone_pickaxe','craft_stone_sword',
 'mine_iron','smelt_iron','craft_furnace','place_furnace','craft_iron_pickaxe',
 'mine_diamond','survey_ore','craft_diamond_gear','mine_obsidian','collect_flint',
 'collect_iron','craft_flint_steel','build_nether_portal','enter_nether','hunt_blazes',
 'hunt_endermen','enter_overworld','prepare_archery','craft_blaze_powder',
 'craft_eyes','track_stronghold','activate_end_portal','enter_end',
 'equip_diamond','observe_dragon','destroy_end_crystal','fight_dragon','verify_dragon','exit_end',
 'loot_bastion_template','mine_ancient_debris','collect_gold','mine_netherrack',
 'smelt_resource','craft_netherite_ingot','duplicate_template','craft_smithing_table',
 'place_smithing_table','smith_netherite','equip_netherite','obtain_food',
 'explore','search_dragon','complete','blocked','wait','idle']);
function rng(seed){let s=seed>>>0;return ()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);}
const RECIPES={
 crafting_table:{oak_planks:4},
 wooden_pickaxe:{oak_planks:3,stick:2},
 stone_pickaxe:{cobblestone:3,stick:2},
 stone_sword:{cobblestone:2,stick:1},
 furnace:{cobblestone:8},
 iron_pickaxe:{iron_ingot:3,stick:2},
 diamond_pickaxe:{diamond:3,stick:2},diamond_sword:{diamond:2,stick:1},
 diamond_helmet:{diamond:5},diamond_chestplate:{diamond:8},
 diamond_leggings:{diamond:7},diamond_boots:{diamond:4},
 flint_and_steel:{flint:1,iron_ingot:1},
 smithing_table:{iron_ingot:2,oak_planks:4},
 netherite_ingot:{netherite_scrap:4,gold_ingot:4},
 netherite_upgrade_smithing_template:{netherite_upgrade_smithing_template:1,diamond:7,netherrack:1},
 blaze_powder:{blaze_rod:1},eye_of_ender:{ender_pearl:1,blaze_powder:1}
};
const GEAR_SLOTS={netherite_helmet:'head',netherite_chestplate:'torso',
 netherite_leggings:'legs',netherite_boots:'feet'};
const DIAMOND_BASE=Object.fromEntries(NETHERITE.map((x,j)=>[x,DIAMOND[j]]));
class World {
 constructor(seed,{hazards=true,failures=true}={}){
  this.random=rng(seed);this.seed=seed;this.hazards=hazards;this.failures=failures;
  this.inv=Object.create(null);this.equipment={};
  this.health=20;this.hunger=20;this.dimension='overworld';
  this.workbench=false;this.furnace=false;this.smith=false;
  this.netherPortal=false;this.stronghold=false;this.endPortal=false;
  this.dragonPresent=true;this.dragonDeathEvent=false;this.exitPortal=false;
  this.dragonHP=200;this.crystals=10;this.bastionScout=0;
  this.strongholdScout=0;this.oreExplore=0;this.ticks=0;this.events=[];
  this.ledger=[];this.failed=0;this.portalEyesInserted=0;
  this.dragonVictoryTick=-1;this.armorEquipTick=-1;
 }
 count(k){return this.inv[k]||0;}
 give(k,n=1){assert(Number.isSafeInteger(n)&&n>0,'positive item grant');this.inv[k]=this.count(k)+n;}
 take(k,n=1){assert(Number.isSafeInteger(n)&&n>0,'positive item cost');if(this.count(k)<n)throw Error('RESOURCE_MISSING '+k+' '+this.count(k)+'/'+n);this.inv[k]-=n;}
 recipe(name){
  const ingredients=RECIPES[name];if(!ingredients)throw Error('UNKNOWN_RECIPE '+name);
  if(!Object.entries(ingredients).every(([k,n])=>this.count(k)>=n))throw Error('RECIPE_INGREDIENTS_MISSING '+name);
  for(const [k,n] of Object.entries(ingredients))this.take(k,n);
  this.give(name,name==='blaze_powder'||name==='netherite_upgrade_smithing_template'?2:1);
 }
 world(){
  const i=this.inv;
  const copy=Object.assign({},i);
  return {joined:true,dimension:'minecraft:'+ (this.dimension==='end'?'the_end':this.dimension==='nether'?'the_nether':'overworld'),
   health:this.health,hunger:this.hunger,position:{x:this.ticks,y:64,z:0},
   ownerVisible:false,ownerDistance:null,threats:[],workbenchNearby:this.workbench,
   furnaceNearby:this.furnace,smithingTableNearby:this.smith,netherPortalNearby:this.netherPortal,
   endPortalPresent:this.endPortal && this.dimension==='overworld',
   endPortalActivated:this.endPortal && this.dimension==='overworld',
   strongholdPortalFrameNearby:this.stronghold && this.dimension==='overworld',
   // Match real Mineflayer digest: armor slots and held weapon are SEPARATE
   // independently observed predicates. Backpack ownership is not equipment.
   wornNetherite:Object.entries(GEAR_SLOTS).every(([gear,slot])=>this.equipment[slot]===gear),
   heldNetheriteSword:this.equipment.hand==='netherite_sword',
   wornDiamond:Object.values(GEAR_SLOTS).every(slot=>this.equipment[slot]==='diamond_'+
     (slot==='head'?'helmet':slot==='torso'?'chestplate':slot==='legs'?'leggings':'boots')),
   dragonPresent:this.dimension==='end'&&this.dragonPresent,
   dragonId:this.dimension==='end'&&this.dragonPresent?1001:null,
   dragonDeadObserved:this.dimension==='end'&&this.dragonDeathEvent,
   exitPortalPresent:this.dimension==='end'&&this.exitPortal,
   crystalsNearby:this.dimension==='end'?this.crystals:0,
   inventory:{raw:copy,...copy, logs:this.count('oak_log'),planks:this.count('oak_planks'),
    sticks:this.count('stick'),table:this.count('crafting_table'),
    woodenPickaxe:this.count('wooden_pickaxe'),stonePickaxe:this.count('stone_pickaxe'),
    stoneSword:this.count('stone_sword'),cobblestone:this.count('cobblestone'),
    rawIron:this.count('raw_iron'),ironIngot:this.count('iron_ingot'),
    ironPickaxe:this.count('iron_pickaxe'),diamondPickaxe:this.count('diamond_pickaxe'),
    diamondSword:this.count('diamond_sword'),diamondHelmet:this.count('diamond_helmet'),
    diamondChestplate:this.count('diamond_chestplate'),diamondLeggings:this.count('diamond_leggings'),
    diamondBoots:this.count('diamond_boots'),diamonds:this.count('diamond'),
    furnace:this.count('furnace'),coal:this.count('coal'),food:this.count('cooked_beef')}
  };
 }
 tick(){
  this.ticks++;
  if(this.hazards && this.ticks%18===0) {
   this.hunger=Math.max(1,this.hunger-1);
   if(this.hunger<=6 && this.count('cooked_beef')>0){this.take('cooked_beef');this.hunger=Math.min(20,this.hunger+8);}
  }
  if(this.hazards && this.dimension==='nether' && this.ticks%41===0)
    this.health=Math.max(6,this.health-1);
  if(this.health<=0)throw Error('SURVIVAL_DEATH: no respawn/rollback accepted');
 }
 // Resource gathering is constrained by mining tier, dimension and nether
 // formation. The model is generous about ore proximity but not recipes.
 execute(d,progress){
  const type=d.kind;assert(ALLOWED.has(type),'UNKNOWN_ACTION '+type);
  if(type==='complete')throw Error('COMPLETE_IS_NOT_A_WORLD_ACTION');
  this.tick();
  const req=(condition,why)=>{if(!condition)throw Error('WORLD_PRECONDITION '+type+': '+why);};
  const above=k=>this.count(k)>0;
  const dest=x=>req(this.dimension===x,'wrong dimension');
  const pick=()=>above('diamond_pickaxe')||above('netherite_pickaxe');
  const bench=()=>req(this.workbench,'no placed crafting table');
  const gain=(k,n=1)=>this.give(k,n);
  const evidence={ok:true,verified:true,detail:type,proof:undefined};
  switch(type){
   case 'collect_wood':dest('overworld');gain('oak_log',1);break;
   case 'craft_planks':req(above('oak_log'),'no log');this.take('oak_log');gain('oak_planks',4);break;
   case 'craft_sticks':req(this.count('oak_planks')>=2,'no planks');this.take('oak_planks',2);gain('stick',4);break;
   case 'craft_table':this.recipe('crafting_table');break;
   case 'place_table':req(above('crafting_table'),'no table');this.workbench=true;break;
   case 'craft_pickaxe':bench();this.recipe('wooden_pickaxe');break;
   case 'mine_cobblestone':req(above('wooden_pickaxe')||above('stone_pickaxe')||above('iron_pickaxe')||pick(),'no mining pick');gain('cobblestone',3);break;
   case 'craft_stone_pickaxe':bench();this.recipe('stone_pickaxe');break;
   case 'craft_stone_sword':bench();this.recipe('stone_sword');break;
   case 'mine_iron':dest('overworld');req(above('stone_pickaxe')||above('iron_pickaxe')||pick(),'iron pick tier');gain('raw_iron',1+Number(this.random()>.8));break;
   case 'smelt_iron':req(this.furnace && above('raw_iron'),'no furnace/raw iron');this.take('raw_iron');gain('iron_ingot');break;
   case 'craft_furnace':bench();this.recipe('furnace');break;
   case 'place_furnace':req(above('furnace'),'furnace absent');this.furnace=true;break;
   case 'craft_iron_pickaxe':bench();this.recipe('iron_pickaxe');break;
   case 'mine_diamond':dest('overworld');req(above('iron_pickaxe')||pick(),'iron+ pick required');gain('diamond',1+Number(this.random()>.74));break;
   case 'survey_ore':dest('overworld');this.oreExplore++;this.events.push(['survey',this.ticks]);break;
   case 'craft_diamond_gear':bench();this.recipe(d.item);break;
   case 'mine_obsidian':dest('overworld');req(pick(),'diamond pick required');gain('obsidian',1+Number(this.random()>.72));break;
   case 'collect_flint':dest('overworld');gain('flint');break;
   case 'collect_iron':
    if(above('raw_iron')){req(this.furnace,'furnace required');this.take('raw_iron');gain('iron_ingot');}
    else {dest('overworld');req(above('stone_pickaxe')||above('iron_pickaxe')||pick(),'iron-tier mining');gain('raw_iron');}
    break;
   case 'craft_flint_steel':this.recipe('flint_and_steel');break;
   case 'build_nether_portal':dest('overworld');req(this.count('obsidian')>=14 && above('flint_and_steel'),'obsidian and ignition');this.take('obsidian',14);this.netherPortal=true;evidence.proof='nether_portal';break;
   case 'enter_nether':dest('overworld');req(this.netherPortal,'no server-observed Nether portal');this.dimension='nether';this.furnace=false;this.workbench=false;this.smith=false;break;
   case 'hunt_blazes':dest('nether');req(above('stone_sword')||above('diamond_sword')||above('netherite_sword'),'no sword');gain('blaze_rod');break;
   case 'hunt_endermen':dest('nether');req(above('stone_sword')||above('diamond_sword')||above('netherite_sword'),'no weapon');gain('ender_pearl');break;
   case 'enter_overworld':dest('nether');req(this.netherPortal,'no return portal');this.dimension='overworld';this.furnace=above('furnace');this.workbench=above('crafting_table');this.smith=above('smithing_table');break;
   case 'prepare_archery':
    if(!above('bow'))gain('bow');else gain('arrow',4);break;
   case 'craft_blaze_powder':req(above('blaze_rod'),'no blaze rod');this.recipe('blaze_powder');break;
   case 'craft_eyes':this.recipe('eye_of_ender');break;
   case 'track_stronghold':dest('overworld');req(this.count('eye_of_ender')>=13,'not enough eyes to locate plus open portal');this.take('eye_of_ender');this.strongholdScout++;this.stronghold=this.strongholdScout>=3;break;
   case 'activate_end_portal':dest('overworld');req(this.stronghold && this.count('eye_of_ender')>=12,'12 actual eyes and stronghold frames');this.take('eye_of_ender',12);this.portalEyesInserted=12;this.endPortal=true;break;
   case 'enter_end':dest('overworld');req(this.endPortal && this.portalEyesInserted===12,'portal frames not verified');this.dimension='end';break;
   case 'equip_diamond':
    dest('end');req(['diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots'].every(above),'four actual diamond armor pieces missing');
    for(const [name,slot] of Object.entries(GEAR_SLOTS))this.equipment[slot]='diamond_'+name.split('_')[1];
    req(this.world().wornDiamond,'diamond armor slots failed live verification');
    this.events.push(['diamond_equipped',this.ticks]);break;
   case 'observe_dragon':dest('end');req(this.dragonPresent,'dragon not visible');evidence.proof='dragon_seen';break;
   case 'destroy_end_crystal':dest('end');req(this.dragonPresent && this.crystals>0 && above('bow') && this.count('arrow')>=1,'need observed crystal/bow/arrow');this.take('arrow');this.crystals--;break;
   case 'fight_dragon':
    dest('end');req(this.world().wornDiamond && this.dragonPresent && this.crystals===0 && above('bow') && above('arrow'),'dragon combat armor/shield/bow unavailable');
    this.take('arrow');this.dragonHP-=18+Math.floor(this.random()*11);
    if(this.dragonHP<=0){
      this.dragonHP=0;this.dragonPresent=false;this.dragonDeathEvent=true;this.exitPortal=true;
      this.events.push(['dragon_death_event',this.ticks]);
    }
    break;
   case 'verify_dragon':
    dest('end');req(!this.dragonPresent && this.dragonDeathEvent && this.exitPortal && progress.milestones.dragonSeen===true,'no actual dragon death AND End portal');
    evidence.proof='dragon_victory';this.dragonVictoryTick=this.ticks;break;
   case 'exit_end':
    dest('end');req(progress.milestones.dragonKilled===true && progress.milestones.exitPortalObserved===true && this.exitPortal,'not verified dragon win/exit portal');
    this.dimension='overworld';this.workbench=above('crafting_table');this.furnace=above('furnace');
    this.events.push(['end_exit',this.ticks]);
    // The simulated world, like the live skill, must return an explicit
    // VERIFIED End->Overworld transition receipt. Changing dimension alone
    // must never silently satisfy the Core's endReturned milestone.
    evidence.proof='end_return';break;
   case 'loot_bastion_template':
    dest('nether');this.bastionScout++;if(this.bastionScout>=2)gain('netherite_upgrade_smithing_template');break;
   case 'mine_ancient_debris':dest('nether');req(pick(),'diamond-grade pick required');gain('ancient_debris',1+Number(this.random()>.84));break;
   case 'collect_gold':dest('nether');gain('gold_ingot',1+Number(this.random()>.8));break;
   case 'mine_netherrack':dest('nether');gain('netherrack',4);break;
   case 'smelt_resource':dest('overworld');req(this.furnace && above('ancient_debris'),'furnace/debris needed');this.take('ancient_debris');gain('netherite_scrap');break;
   case 'craft_netherite_ingot':this.recipe('netherite_ingot');break;
   case 'duplicate_template':bench();this.recipe('netherite_upgrade_smithing_template');break;
   case 'craft_smithing_table':bench();this.recipe('smithing_table');break;
   case 'place_smithing_table':req(above('smithing_table'),'smithing table missing');this.smith=true;break;
   case 'smith_netherite':{
    dest('overworld');req(this.smith,'smithing table absent');req(DIAMOND_BASE[d.item]===d.base,'nonvanilla smithing recipe');req(this.count(d.base)>=1,'diamond base absent');
    req(this.count('netherite_upgrade_smithing_template')>=1 && above('netherite_ingot'),'upgrade template/ingot absent');
    this.take(d.base);this.take('netherite_upgrade_smithing_template');this.take('netherite_ingot');gain(d.item);break;
   }
   case 'equip_netherite':{
    req(NETHERITE.every(above),'all Netherite pieces required');
    for(const [name,slot] of Object.entries(GEAR_SLOTS))this.equipment[slot]=name;
    this.equipment.hand='netherite_sword';
    req(this.world().wornNetherite,'actual armor slots incomplete');
    this.armorEquipTick=this.ticks;evidence.proof='netherite_equipped';break;
   }
   case 'obtain_food':
    req(this.dimension!=='end','End island has no renewable food; carry sufficient supplies');
    req(above('stone_sword')||above('diamond_sword')||above('netherite_sword'),'no weapon to hunt livestock');
    if(this.dimension==='nether'){
      // Java Nether: kill a naturally spawned Hoglin for raw porkchops, eat
      // after a verified drop. It is edible raw, with less saturation.
      gain('porkchop',2);this.take('porkchop');this.hunger=Math.min(20,this.hunger+3);
      this.events.push(['hoglin_drop_and_eat',this.ticks]);
    }else{
      gain('beef',2);this.take('beef');this.hunger=Math.min(20,this.hunger+3);
      this.events.push(['overworld_livestock_drop_and_eat',this.ticks]);
    }
    break;
   case 'explore':this.events.push(['explored',this.ticks]);break;
   case 'search_dragon':dest('end');this.events.push(['end_scout',this.ticks]);break;
   case 'wait':case 'idle':case 'blocked':throw Error('NON_ACTION '+type);
   default:throw Error('NO_GAME_MECHANIC '+type);
  }
  this.ledger.push({tick:this.ticks,kind:type,dimension:this.dimension,verified:true,
   inventoryTotal:Object.values(this.inv).reduce((a,b)=>a+b,0)});
  return evidence;
 }
}
function run(seed,options={}){
 const w=new World(seed,options),controller=createController({clock:()=>w.ticks*1000,maxSeconds:43200,maxSteps:1600});
 controller.start(GOAL,43200);
 const initial=w.world();assert.equal(Object.values(initial.inventory.raw).reduce((a,b)=>a+b,0),0,'empty spawn inventory');
 let decisions=0,stalled=0;const trace=[];
 for(let n=0;n<1600;n++){
  const before=w.world(),d=controller.next(before);
  assert(ALLOWED.has(d.kind),'unmapped planner decision: '+JSON.stringify(d));
  if(d.kind==='complete')break;
  if(d.kind==='blocked')throw Error('PLANNER_BLOCKED '+JSON.stringify(d)+' SEED '+seed+' TRACE '+trace.slice(-12));
  if(d.kind==='wait'||d.kind==='idle')throw Error('PLANNER_IDLE '+JSON.stringify(d)+' SEED '+seed);
  decisions++;trace.push(d.kind);if(trace.length>30)trace.shift();
  let receipt;
  try{receipt=w.execute(d,controller.status());}catch(err){
   throw Error('ACTION_FAILED seed='+seed+' step='+n+' action='+JSON.stringify(d)+' error='+err.message+
     ' inv='+JSON.stringify(w.inv)+' milestones='+JSON.stringify(controller.status().milestones)+
     ' last='+JSON.stringify(trace.slice(-16)));
  }
  if(!receipt.ok || !receipt.verified)stalled++;
  controller.record(d,receipt);
  if(controller.status().status==='complete')break;
 }
 const s=controller.status();
 assert.equal(s.status,'complete','MISSION DID NOT COMPLETE seed '+seed+' '+JSON.stringify(s)+' TRACE '+trace.join(','));
 assert.equal(s.milestones.dragonKilled,true,'real simulated Dragon kill must be acknowledged');
 assert.equal(s.milestones.exitPortalObserved,true,'observed End exit required');
 assert.equal(s.milestones.endReturned,true,'explicit End-to-Overworld receipt required');
 assert.equal(s.milestones.netheriteEquipped,true,'equipped Netherite proof required');
 assert(w.dragonVictoryTick>0,'no witnessed Dragon death event');
 assert(w.armorEquipTick>w.dragonVictoryTick,'order violated: armor equipped before Dragon defeat');
 assert(w.events.some(e=>e[0]==='dragon_death_event'),'no simulated HP=0 Dragon death event');
 assert(w.events.some(e=>e[0]==='end_exit'),'no simulated return through End exit portal');
 assert.equal(w.dragonHP,0);assert.equal(w.crystals,0);
 assert.equal(w.world().wornNetherite,true,'all four current armor slots must be equipped');
 assert.equal(w.world().heldNetheriteSword,true,'Netherite sword must be actually held');
 assert.equal(w.dimension,'overworld','completed mission must return to Overworld');
 assert.equal(w.portalEyesInserted,12,'twelve actual Eyes inserted before End entry');
 assert(w.ledger.some(e=>e.kind==='smith_netherite'),'no actual recipe-backed netherite smithing');
 return {seed,steps:w.ticks,decisions,stalled,dragonTick:w.dragonVictoryTick,armorTick:w.armorEquipTick,ledger:w.ledger.length};
}
function negatives(){
 const w=new World(41),c=createController({clock:()=>w.ticks*1000,maxSeconds:43200});
 c.start(GOAL,43200);
 assert.throws(()=>w.execute({kind:'verify_dragon'},c.status()),/WORLD_PRECONDITION/);
 assert.throws(()=>w.execute({kind:'smith_netherite',item:'netherite_helmet',base:'diamond_helmet'},c.status()),/WORLD_PRECONDITION/);
 w.inv.netherite_helmet=1;w.inv.netherite_chestplate=1;w.inv.netherite_leggings=1;w.inv.netherite_boots=1;w.inv.netherite_sword=1;
 assert.equal(w.world().wornNetherite,false,'backpack armor is never worn');
 assert.equal(w.world().heldNetheriteSword,false,'backpack sword is never held');
 c.record({kind:'verify_dragon'},{ok:true,verified:false,proof:'dragon_victory'});
 assert.notEqual(c.status().milestones.dragonKilled,true,'unverified game event cannot kill dragon');
 c.record({kind:'exit_end'},{ok:true,verified:false,proof:'end_return'});
 assert.notEqual(c.status().milestones.endReturned,true,
  'unverified End-return claim cannot advance mission milestone');
 c.record({kind:'exit_end'},{ok:true,verified:true,proof:'not_an_end_return'});
 assert.notEqual(c.status().milestones.endReturned,true,
  'verified unrelated effect cannot forge Overworld return milestone');
 assert.equal(validateCommand({command:'auto_goal',goal:GOAL,durationSeconds:43200}),null,'new goal command accepted');
 assert.notEqual(validateCommand({command:'auto_goal',goal:GOAL,durationSeconds:43201}),null,'unbounded mission rejected');
}
negatives();
const seeds=Number(process.env.JARVIS_MC_SIM_SEEDS||40);
assert(Number.isInteger(seeds)&&seeds>=1&&seeds<=1000,'seeds must be 1..1000');
let slowest=0,slowSeed=0,stepsTotal=0;
for(let seed=1;seed<=seeds;seed++){
 const result=run(seed*8377+21);
 stepsTotal+=result.steps;
 if(result.steps>slowest){slowest=result.steps;slowSeed=seed;}
}
console.log('MINECRAFT_DRAGON_FIRST_NETHERITE_MODEL '+seeds+'/'+seeds+
 ' PASS; actual planner decisions with separate recipe/world model, maxSteps='+slowest+
 ' seed='+slowSeed+' totalSteps='+stepsTotal+
 '; NOT a real Minecraft Java server, Mineflayer live mission or owner LAN acceptance');
