/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/** Deterministic, locally executable Minecraft decision layer.
 * This layer proposes bounded actions. It does NOT execute Minecraft packets,
 * run shell commands, trust other players' chat, or claim task completion.
 */
const {lateGamePlan} = require('./late_game.cjs');
const {RESOURCES,SAFE_GENERIC_RESOURCES,ORE_RESOURCE_RULES,resourceCount,resourcePlan}=require('./resource_goal.cjs');
const {validSequence,canonicalSequence}=require('./mission_sequence.cjs');
const {validBuildSpec,buildPlan,validVolumeSpec,volumePlan}=require('./structure_goal.cjs');
const {validFarmSpec,wheatPlan}=require('./wheat_goal.cjs');
const {validCropSpec,cropPlan}=require('./crop_goal.cjs');
const {validCraftSpec,validEquipSpec,generalPlan}=require('./general_goal.cjs');
const {validSmeltSpec,smeltPlan}=require('./smelt_goal.cjs');
const {validTransferSpec,transferPlan}=require('./container_goal.cjs');
const {ALLOWED_HOSTILES}=require('./native_combat.cjs');
// An owner-issued long mission has a finite authority lease across all renewals.
const MAX_MISSION_LIFETIME_MS=12*60*60*1000;
const GOALS = new Set(['companion','netherite_dragon_run','dragon_then_netherite_run','netherite_armor_run','netherite_gear_run','shelter','defeat_hostile','survive','wood','tools','explore','follow','guard','stone_age','iron_age','dragon_run','gather','travel','build','build_volume','farm_wheat','farm_crop','sequence','craft','equip','smelt','transfer']);
// Perception must include EVERY already-authorized hostile; otherwise the
// planner never sees cave spiders, slimes or phantoms that the native combat
// controller can safely handle. Add explicitly disallowed hazards for
// avoidance/retreat only, not combat permission.
const HOSTILES = new Set([...ALLOWED_HOSTILES,
  'creeper','ghast','piglin_brute','ender_dragon','wither']);
const FOOD = /^(bread|baked_potato|cooked_.*|apple|golden_apple|carrot|potato|melon_slice|pumpkin_pie|beetroot|mushroom_stew|rabbit_stew|suspicious_stew|sweet_berries)$/;
function number(v, fallback=0) { return Number.isFinite(v)?v:fallback; }
function itemsFrom(bot) {
  const a = [...(bot.inventory?.items?.() || [])];
  // Inventory.items() excludes equipment slots in many Mineflayer versions;
  // goals must recognize armor currently worn by the player.
  for(const slot of ['head','torso','legs','feet','off-hand']){
    const idx=bot.getEquipmentDestSlot?.(slot);
    if(Number.isInteger(idx)){
      const eq=bot.inventory?.slots?.[idx];
      if(eq && !a.some(item=>item===eq))a.push(eq);
    }
  }
  const out={}; for(const item of a){if(typeof item?.name==='string' && Number.isFinite(item.count))out[item.name]=(out[item.name]||0)+item.count;}
  return out;
}
function countLike(items, pred) { return Object.entries(items).reduce((v,[name,n])=>v+(pred(name)?n:0),0); }
function resolveOwnerEntity(bot, ownerName) {
  const target=String(ownerName||'').toLowerCase();
  if(!target || target===String(bot.username||'').toLowerCase())return null;
  // Mineflayer's players map and the configured owner can differ by case.
  // Use one resolver for both manual status and the autonomous planner.
  const name=Object.keys(bot.players||{}).find(k=>k.toLowerCase()===target);
  const entity=name?bot.players[name]?.entity:null;
  if(!entity || entity.username && entity.username.toLowerCase()!==target)return null;
  return entity||null;
}
function digest(bot, ownerName, {dragonDead=false}={}) {
  const p=bot.entity?.position;
  const owner=resolveOwnerEntity(bot,ownerName)?.position;
  const inv=itemsFrom(bot);
  const threats=[];
  for(const e of Object.values(bot.entities||{})){
    if(!e?.position || !HOSTILES.has(e.name) || !p)continue;
    const d=number(e.position.distanceTo(p),1e9);
    if(d<=16)threats.push({id:e.id,name:e.name,distance:Math.round(d*10)/10,
      position:{x:Math.floor(e.position.x),y:Math.floor(e.position.y),z:Math.floor(e.position.z)}});
  }
  threats.sort((a,b)=>a.distance-b.distance);
  const villagers=[];
  for(const e of Object.values(bot.entities||{})){
    if(e?.name!=='villager'||!e.position||!p||
       !Number.isInteger(e.id))continue;
    const d=number(e.position.distanceTo(p),1e9);
    if(d<=10)villagers.push({id:e.id,name:'villager',distance:Math.round(d*10)/10});
  }
  villagers.sort((a,b)=>a.distance-b.distance);
  const inventory={logs:countLike(inv,n=>/(?:^|_)log$/.test(n)),planks:countLike(inv,n=>/_planks$/.test(n)),sticks:inv.stick||0,
    table:inv.crafting_table||0,woodenPickaxe:inv.wooden_pickaxe||0,stonePickaxe:inv.stone_pickaxe||0,stoneSword:inv.stone_sword||0,cobblestone:inv.cobblestone||0,
    food:countLike(inv,n=>FOOD.test(n)),rawIron:inv.raw_iron||0,ironIngot:inv.iron_ingot||0,ironPickaxe:inv.iron_pickaxe||0,diamondPickaxe:inv.diamond_pickaxe||0,diamonds:inv.diamond||0,diamondSword:inv.diamond_sword||0,diamondHelmet:inv.diamond_helmet||0,diamondChestplate:inv.diamond_chestplate||0,diamondLeggings:inv.diamond_leggings||0,diamondBoots:inv.diamond_boots||0,furnace:inv.furnace||0,coal:inv.coal||0,obsidian:inv.obsidian||0,
    flint:inv.flint||0,flint_and_steel:inv.flint_and_steel||0,netherite_ingot:inv.netherite_ingot||0,
    netherite_scrap:inv.netherite_scrap||0,netherite_upgrade_smithing_template:inv.netherite_upgrade_smithing_template||0,
    ancient_debris:inv.ancient_debris||0,gold_ingot:inv.gold_ingot||0,blaze_rod:inv.blaze_rod||0,
    blaze_powder:inv.blaze_powder||0,ender_pearl:inv.ender_pearl||0,eye_of_ender:inv.ender_eye||inv.eye_of_ender||0,
    smithing_table:inv.smithing_table||0,diamond:inv.diamond||0,netherrack:inv.netherrack||0,
    netherite_helmet:inv.netherite_helmet||0,netherite_chestplate:inv.netherite_chestplate||0,
    netherite_leggings:inv.netherite_leggings||0,netherite_boots:inv.netherite_boots||0,
    netherite_sword:inv.netherite_sword||0,raw:inv};
  let workbenchNearby=false,furnaceNearby=false,smithingTableNearby=false;
  let netherPortalNearby=false, endPortalPresent=false,strongholdPortalFrameNearby=false;
  let endPortalActivated=false,exitPortalPresent=false;
  // Equipment proof is live slot state, never an earlier action receipt or an
  // inventory count (an armor piece in the backpack is not worn).
  const requiredArmor=[['head','netherite_helmet'],['torso','netherite_chestplate'],
    ['legs','netherite_leggings'],['feet','netherite_boots']];
  const wornNetherite=requiredArmor.every(([slot,name])=>{
    const idx=bot.getEquipmentDestSlot?.(slot);
    return Number.isInteger(idx) && bot.inventory?.slots?.[idx]?.name===name;
  });
  const heldNetheriteSword=bot.heldItem?.name==='netherite_sword';
  const equipped={hand:bot.heldItem?.name||null};
  for(const dest of ['head','torso','legs','feet','off-hand']){
    const slot=bot.getEquipmentDestSlot?.(dest);
    equipped[dest]=Number.isInteger(slot)?bot.inventory?.slots?.[slot]?.name||null:null;
  }
  const wornDiamond=[['head','diamond_helmet'],['torso','diamond_chestplate'],
    ['legs','diamond_leggings'],['feet','diamond_boots']].every(([slot,name])=>{
    const idx=bot.getEquipmentDestSlot?.(slot);
    return Number.isInteger(idx) && bot.inventory?.slots?.[idx]?.name===name;
  });
  let strongholdMissingEyes=null;
  const nearby=name=>!!bot.findBlock?.({matching:b=>b?.name===name,maxDistance:32});
  try{
    smithingTableNearby=nearby('smithing_table');netherPortalNearby=nearby('nether_portal');
    strongholdPortalFrameNearby=nearby('end_portal_frame');endPortalPresent=nearby('end_portal');
    if(strongholdPortalFrameNearby && typeof bot.findBlocks==='function'){
      const frames=bot.findBlocks({matching:b=>b?.name==='end_portal_frame',maxDistance:32,count:12}) || [];
      // A partially loaded frame ring cannot prove the total missing-Eye count.
      if(frames.length===12)strongholdMissingEyes=frames.reduce((n,p)=>{
        const frame=bot.blockAt?.(p);
        return n+(frame?.getProperties?.().eye===true?0:1);
      },0);
    }
    // End portals in Overworld strongholds are NOT End exit portals.
    // A visible end_portal block is not itself evidence of a Dragon kill.
    const dimension=String(bot.game?.dimension||'minecraft:overworld').replace(/^minecraft:/,'');
    endPortalActivated=dimension==='overworld' && endPortalPresent;
    exitPortalPresent=dimension==='the_end' && endPortalPresent;
    if(dimension!=='overworld'){endPortalPresent=false;strongholdPortalFrameNearby=false;}
  }catch{}
  try{workbenchNearby=!!bot.findBlock?.({matching:block=>block?.name==='crafting_table',maxDistance:5});furnaceNearby=!!bot.findBlock?.({matching:block=>block?.name==='furnace',maxDistance:5});}catch{}
  let workbenchRecoverySupported=false;
  try {
    const owned=bot.jarvisOwnedCraftingTablePos;
    workbenchRecoverySupported=!!owned && bot.blockAt?.(owned)?.name==='crafting_table' &&
      typeof bot.canDigBlock==='function';
  } catch { /* missing/unloaded workstation never becomes an authorization */ }
  const dragons=Object.values(bot.entities||{}).filter(e=>e?.name==='ender_dragon' && e?.position);
  const crystals=Object.values(bot.entities||{}).filter(e=>e?.name==='end_crystal' && e?.position);
  return {joined:!!p,dimension:bot.game?.dimension||'minecraft:overworld',
    smithingTableNearby,netherPortalNearby,strongholdPortalFrameNearby,strongholdMissingEyes,endPortalPresent,endPortalActivated,
    wornNetherite,wornDiamond,heldNetheriteSword,equipped,exitPortalPresent,
    dragonPresent:dragons.length>0,dragonId:dragons[0]?.id??null,
    dragonDistance:p&&dragons[0]?.position?
      Math.round(p.distanceTo(dragons[0].position)*10)/10:null,
    dragonDeadObserved:dragonDead,crystalsNearby:crystals.length,
    health:number(bot.health,20),hunger:number(bot.food,20),workbenchNearby,
     // Only the native Mineflayer runtime advertises physical workstation
     // recovery; modeled worlds never claim this capability implicitly.
     workbenchRecoverySupported,
     furnaceNearby,
    position:p?{x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)}:null,
    ownerVisible:!!owner,ownerDistance:p&&owner?Math.round(p.distanceTo(owner)):null,
    ownerPosition:owner?{x:Math.floor(owner.x),y:Math.floor(owner.y),z:Math.floor(owner.z)}:null,
    threats:threats.slice(0,6),villagers:villagers.slice(0,3),
    inventory,timeOfDay:bot.time?.timeOfDay??null};
}
function decide(goal, world, failures={}, progress={}) {
  if(!GOALS.has(goal)) return {kind:'idle',why:'No autonomous goal'};
  if(!world?.joined)return {kind:'wait',why:'Bot not spawned'};
  // The requested equipment may already be worn. Use direct live slot
  // observation and avoid mining extra diamond tools or attacking anything.
  if(goal==='defeat_hostile'&&progress.milestones?.defeatedId===progress.entityId &&
     progress.milestones?.defeatedMob===progress.mob)
    return {kind:'complete',why:'Authorized target-specific server death event observed'};
  if(goal==='netherite_armor_run'&&world.wornNetherite===true)
    return {kind:'complete',why:'Four server-observed Netherite armor slots are worn'};
  if(goal==='netherite_gear_run'&&world.wornNetherite===true&&world.heldNetheriteSword===true)
    return {kind:'complete',why:'Server-observed Netherite armor and sword are currently equipped'};
  const inv=world.inventory||{}, threats=world.threats||[];
  const closest=threats[0];
  // Never ask the guarded melee executor to attack outside its 3.4-block
  // admission range. Unsafe or multiple threats require distance, not an
  // endless sequence of rejected attack attempts.
  if(world.health<=8 && closest?.distance<=10)return {kind:'retreat',why:'Critical health near hostile entity'};
  const crowded=threats.filter(t=>t?.distance<=8).length>=2;
  if(closest?.distance<=7 && (crowded || (world.health<12 && closest.distance<=6)))
    return {kind:'retreat',why:'Multiple threats or low health: regain safe distance'};
  if(closest?.distance<=6 && !ALLOWED_HOSTILES.has(closest.name))
    return {kind:'retreat',why:'Observed threat is not an authorized generic melee target'};
  if(world.health<12 && closest?.distance<=12 &&
     ['ender_dragon','wither','ghast','piglin_brute','blaze','hoglin'].includes(closest.name))
    return {kind:'retreat',why:'Low health near major Nether/End hazard; keep physical separation'};
  // Low-health long-horizon survival MUST recover before taking an
  // optional Nether/Dragon fight. An already-sufficient food bar can
  // naturally regenerate health; require a server-observed health
  // increase rather than treating elapsed time as a success.
  const longSurvival=['survive','companion','stone_age','iron_age',
    'dragon_run','netherite_dragon_run','dragon_then_netherite_run',
    'netherite_armor_run','netherite_gear_run'].includes(goal);
  if(longSurvival && Number.isFinite(world.health) && world.health<12 &&
     !threats.some(t=>Number.isFinite(t?.distance)&&t.distance<=10)){
    if(world.hunger<18 && (inv.food||0)>0)
      return {kind:'eat',why:'Health low: eat observed food to enable natural recovery'};
    if(world.hunger<18){
      const where=String(world.dimension||'').replace(/^minecraft:/,'');
      if(where==='the_end'||where==='the_nether')
        return {kind:'blocked',why:'Health too low for safe combat to obtain food in '+where+
          '; no verified edible inventory or safe gathering route exists'};
      return {kind:'obtain_food',why:'Health low with insufficient hunger: obtain verified Overworld food before risky progression'};
    }
    return {kind:'recover_health',why:'Health low: remain still only while safe and verify actual server regeneration'};
  }
  if(world.hunger<=12 && (inv.food||0)>0)return {kind:'eat',why:'Hunger low; edible inventory item detected'};
  if(['dragon_run','netherite_dragon_run','dragon_then_netherite_run','netherite_armor_run','netherite_gear_run'].includes(goal) && world.hunger<=9 && (inv.food||0)===0)return {kind:'obtain_food',why:'Obtain safe food before autonomous survival progression'};
  if(closest?.name==='creeper' && closest.distance<=7)return {kind:'retreat',why:'Avoid nearby creeper explosion'};
  if(goal==='survive' && world.hunger<=9 && (inv.food||0)===0)
    return {kind:'obtain_food',why:'Seek actual safe food or livestock; verify inventory pickup before consumption'};
  if(closest?.distance<=6 && ['guard','survive'].includes(goal)) {
    if(closest.distance>3.4)return {kind:'retreat',
      why:'Hostile is outside verified melee reach; avoid failed blind attacks'};
    if(world.health>=12)return {kind:'defend',
      why:'Authorized hostile is within confirmed melee range',targetId:closest.id};
    return {kind:'retreat',why:'Health insufficient for melee defense'};
  }
  // An owner can give ONE high-level instruction to play together. This
  // mission remains alive until stopped; it chooses and verifies its own
  // survival, crafting and movement actions instead of requiring commands.
  if(goal==='defeat_hostile'){
    const target=threats.find(t=>t?.id===progress.entityId&&t?.name===progress.mob);
    if(!target)return {kind:'blocked',
      why:'Previously selected hostile is no longer observed; death NOT independently proven'};
    if(!ALLOWED_HOSTILES.has(target.name))
      return {kind:'blocked',why:'Selected entity no longer an authorized hostile'};
    if(target.distance>12)return {kind:'blocked',
      why:'Selected hostile moved beyond its authorized twelve-block pursuit envelope'};
    if(world.health<12)return {kind:'retreat',why:'Insufficient health for target-bound pursuit'};
    if(target.distance>3.4)return {kind:'approach_bound_hostile',targetId:progress.entityId,
      mob:progress.mob,why:'Move within bounded observed reach of the original allowed hostile'};

    if(world.health<12)return {kind:'retreat',why:'Insufficient health for bounded target-specific combat'};
    return {kind:'fight_bound_hostile',targetId:progress.entityId,mob:progress.mob,
      why:'Continue target-bound guarded melee only while same hostile is observed'};
  }
  if(goal==='transfer')return transferPlan(world,{...progress,goal});
  if(goal==='smelt')return smeltPlan(world,{...progress,goal},
    (needed,extra)=>decide(needed,world,failures,{...progress,...extra,goal:needed}));
  if(goal==='craft'||goal==='equip')return generalPlan(world,{...progress,goal},
    (needed,extra)=>decide(needed,world,failures,{...progress,...extra}));
  if(goal==='gather')return resourcePlan(world,failures,progress,needed=>decide(needed,world,failures,progress));
  if(goal==='farm_crop')return cropPlan(world,{...progress,goal});
  if(goal==='farm_wheat')return wheatPlan(world,{
    goal,position:progress.position,width:progress.width,
    depth:progress.depth,targetCount:progress.targetCount},
    progress.milestones?.wheatHarvested||0);
  if(goal==='build'){
    const spec={goal:'build',position:progress.position,block:progress.block,
      axis:progress.axis,length:progress.length};
    return buildPlan(world,spec,(needed,extra)=>decide(needed,world,failures,{...progress,...extra}));
  }
  if(goal==='build_volume')
    return volumePlan(world,{goal,position:progress.position,block:progress.block,
      width:progress.width,depth:progress.depth,height:progress.height,shape:progress.shape},
      (needed,extra)=>decide(needed,world,failures,{...progress,...extra}));
  if(goal==='travel'){
    const t=progress.destination,p=world.position;
    if(!t || !['x','y','z'].every(k=>Number.isInteger(t[k])) ||
       !Number.isInteger(progress.arrivalRange))
      return {kind:'blocked',why:'Missing validated travel destination'};
    if(p && ['x','y','z'].every(k=>Number.isFinite(p[k]))){
      const dist=Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z);
      if(dist<=progress.arrivalRange && progress.milestones?.travelArrivalVerified===true)
        return {kind:'complete',why:'Goal target reached with independently verified physical arrival'};
    }
    return {kind:'travel_target',destination:t,range:progress.arrivalRange,
      why:'Navigate to saved destination and verify actual position'};
  }
  if(goal==='companion') {
    if(closest?.distance<=6 && closest.distance>3.4)
      return {kind:'retreat',why:'Position outside allowed melee range; create safe separation'};
    if(closest?.distance<=3.4 && world.health>=12 &&
       ALLOWED_HOSTILES.has(closest.name))
      return {kind:'defend',why:'Defend against reachable authorized hostile',targetId:closest.id};
    if(!world.ownerVisible)return {kind:'wait',why:'Owner not tracked in loaded chunks; do not wander blindly'};
    if(world.ownerDistance>15)return {kind:'follow',range:4,why:'Keep up with teammate'};
    if(world.hunger<=13 && !(inv.food>0))return {kind:'obtain_food',why:'Find actual food for continued survival'};
    if(!inv.stonePickaxe || !inv.stoneSword) {
      const basic=decide('stone_age',world,failures,progress);
      if(basic.kind!=='complete')return basic;
    }
    if(!inv.ironPickaxe && world.hunger>13) {
      const upgrade=decide('iron_age',world,failures,progress);
      if(upgrade.kind!=='complete')return upgrade;
    }
    if(world.ownerDistance>6)return {kind:'follow',range:4,why:'Stay alongside teammate'};
    // Avoid silently marking collaborative play 'complete': it is open-ended.
    return {kind:'explore',why:'Scout a real nearby waypoint while playing beside owner'};
  }
  if(goal==='guard')return world.ownerVisible?{kind:'follow',range:4,why:'Guard positioning'}:{kind:'wait',why:'Owner is not visible'};
  if(goal==='follow')return world.ownerVisible?{kind:'follow',range:3,why:'Stay near owner'}:{kind:'wait',why:'Owner not visible'};
  if(goal==='survive'){
    // Independent survival is not the owner-following companion mode.
    // Advance through bounded real-game tool milestones, then scout safely;
    // never treat an absent owner as an instruction to stop thinking.
    const stone=decide('stone_age',world,failures,progress);
    if(stone.kind!=='complete')return stone;
    if(!inv.ironPickaxe){
      const iron=decide('iron_age',world,failures,progress);
      if(iron.kind!=='complete')return iron;
    }
    return {kind:'scout_survival',index:number(progress.steps),
      why:'Basic survival equipment verified; explore independent safe loaded ground'};
  }
  if(goal==='wood') {
    if(inv.logs>=4)return {kind:'complete',why:'Four logs verified in inventory'};
    return failures.collect_wood>=3?{kind:'blocked',why:'Wood unavailable after three attempts'}:{kind:'collect_wood',why:'Need four logs'};
  }
  if(goal==='dragon_run' || goal==='netherite_dragon_run' || goal==='dragon_then_netherite_run' ||
     goal==='netherite_armor_run' || goal==='netherite_gear_run'){
    // A verified trip through an existing portal is just as valid as
    // building a new portal. Do not replay the early wooden/diamond setup
    // when the native mission is already in Nether/End progression, or when
    // a Dragon death was witnessed and the bot returned to the Overworld.
    if((world.dimension && !String(world.dimension).includes('overworld')) ||
       progress.milestones?.netherPortalBuilt ||
       progress.milestones?.netherPortalUsed ||
       progress.milestones?.dragonKilled)
      return lateGamePlan(world,{...progress,goal});
  }
  if(goal==='stone_age' || goal==='iron_age' || goal==='dragon_run' || goal==='netherite_dragon_run' ||
     goal==='dragon_then_netherite_run' || goal==='netherite_armor_run' || goal==='netherite_gear_run') {
    if(inv.stonePickaxe && (goal==='netherite_armor_run'||inv.stoneSword)) {
      if(goal==='stone_age')return {kind:'complete',why:'Stone pickaxe and stone sword verified in inventory'};
      if(inv.ironPickaxe||inv.diamondPickaxe||(inv.raw?.netherite_pickaxe||0)>0){
        if(goal==='iron_age')return {kind:'complete',why:'Iron-tier or better pickaxe verified in inventory'};
        const armorOnly=goal==='netherite_armor_run';
        const canReuseUpgrades=['netherite_armor_run','netherite_gear_run'].includes(goal);
        const digestNames={
          diamond_pickaxe:'diamondPickaxe',diamond_sword:'diamondSword',
          diamond_helmet:'diamondHelmet',diamond_chestplate:'diamondChestplate',
          diamond_leggings:'diamondLeggings',diamond_boots:'diamondBoots'
        };
        const sufficient=name=>(inv.raw?.[name]||0)>0 ||
          (Object.hasOwn(digestNames,name)&&!!inv[digestNames[name]]) ||
          (canReuseUpgrades && name.startsWith('diamond_') &&
            (inv.raw?.[name.replace('diamond_','netherite_')]||0)>0);
        if((sufficient('diamond_pickaxe')||sufficient('netherite_pickaxe')) &&
           (armorOnly || sufficient('diamond_sword')) &&
           ['diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots'].every(sufficient))
          return lateGamePlan(world,{...progress,goal});
        // Armor-only goals must not craft an unrelated diamond sword.
        const gear=[['diamond_pickaxe','diamondPickaxe',3],
          ...(!armorOnly?[['diamond_sword','diamondSword',2]]:[]),
          ['diamond_chestplate','diamondChestplate',8],['diamond_leggings','diamondLeggings',7],
          ['diamond_helmet','diamondHelmet',5],['diamond_boots','diamondBoots',4]];
        for(const [name,key,cost] of gear){
          if(inv[key]||sufficient(name))continue;
          if((inv.diamonds||0)<cost)return failures.mine_diamond>=2?{kind:'survey_ore',ore:'diamond',index:number(progress.steps),why:'Explore new loaded terrain for diamond veins'}:{kind:'mine_diamond',why:'Find naturally generated diamond ore for '+name};
          if(!world.workbenchNearby)return inv.table?{kind:'place_table'}:{kind:'craft_table'};
          if((name==='diamond_pickaxe' && inv.sticks<2)||(name==='diamond_sword' && inv.sticks<1))
            return inv.planks>=2?{kind:'craft_sticks'}:inv.logs?{kind:'craft_planks'}:{kind:'collect_wood'};
          return {kind:'craft_diamond_gear',item:name,why:'Craft and verify '+name};
        }
        return {kind:'blocked',why:'Diamond gear state inconsistent'};
      }
      if(inv.ironIngot>=3){
        if(!world.workbenchNearby)return inv.table?{kind:'place_table'}:{kind:'craft_table'};
        if(inv.sticks<2)return inv.planks>=2?{kind:'craft_sticks'}:inv.logs?{kind:'craft_planks'}:{kind:'collect_wood'};
        return {kind:'craft_iron_pickaxe',why:'Craft and verify iron-tier mining tool'};
      }
      if(inv.rawIron>0){
        if(!world.furnaceNearby){
          if(inv.furnace)return {kind:'place_furnace',why:'Set up iron smelting'};
          if(inv.cobblestone<8)return {kind:'mine_cobblestone',why:'Eight cobblestone required for furnace'};
          if(!world.workbenchNearby)return inv.table?{kind:'place_table'}:{kind:'craft_table'};
          return {kind:'craft_furnace',why:'Create furnace for iron smelting'};
        }
        if(!inv.coal && !inv.planks && !inv.logs)return {kind:'collect_wood',why:'Acquire furnace fuel'};
        if(!inv.coal && !inv.planks)return {kind:'craft_planks',why:'Produce furnace fuel'};
        return {kind:'smelt_iron',why:'Smelt raw iron with verified fuel and furnace'};
      }
      if(!inv.table && world.workbenchNearby && world.workbenchRecoverySupported===true)
          return {kind:'recover_table',why:'Carry crafting table before searching for distant iron'};
       // Preflight the next long cave trip: two iron-pickaxe handles and
       // furnace fuel must travel down with the bot, not be sought at Y<0.
       if(!inv.ironPickaxe && !inv.rawIron && (inv.ironIngot||0)<3){
         if(inv.sticks<2){
           if(inv.planks>=2)return {kind:'craft_sticks',why:'Reserve iron handles before descending'};
           if(inv.logs>=1)return {kind:'craft_planks',why:'Make iron handles while surface wood is available'};
           return {kind:'collect_wood',why:'Acquire iron pickaxe handles before remote cave mining'};
         }
         if(!inv.coal && !inv.planks && !inv.logs)
           return {kind:'collect_wood',why:'Reserve furnace fuel before iron expedition'};
       }
       return failures.mine_iron>=2?{kind:'survey_ore',ore:'iron',index:number(progress.steps),why:'Scout for new iron-bearing terrain'}:{kind:'mine_iron',why:'Find exposed iron ore with stone pickaxe'};
    }
    // Reserve crafting handles BEFORE descending to mine stone. Wood can be
    // unreachable from underground; delaying the three sticks until after
    // collecting five cobblestone caused a real Java campaign to strand itself
    // at Y=59 with stone but without materials for the pickaxe and sword.
    if(inv.woodenPickaxe && !inv.stonePickaxe && inv.sticks<3){
      if(inv.planks>=2)return {kind:'craft_sticks',why:'Reserve three stone-tool sticks before underground excavation'};
      if(inv.logs>=1)return {kind:'craft_planks',why:'Create handle materials while wood is reachable at surface'};
      return {kind:'collect_wood',why:'Gather stone-tool handle wood BEFORE mining underground'};
    }
    // Never abandon the only crafting table when leaving its radius to mine
    // stone underground. Physically recover it while still in reach, then
    // place it near the crafting site after the cobblestone is collected.
    if(inv.woodenPickaxe && !inv.stonePickaxe && inv.cobblestone<5 &&
       !inv.table && world.workbenchNearby && world.workbenchRecoverySupported===true)
      return {kind:'recover_table',why:'Carry the actual crafting table before excavating for stone'};
    if(!inv.woodenPickaxe && !inv.stonePickaxe){
      const base=decide('tools',world,failures,progress);
      return base.kind==='complete'?{kind:'blocked',why:'Pickaxe state inconsistent'}:base;
    }
    // Before upgrading, reserve 3 blocks for the pickaxe and 2 for the
    // sword. After the pickaxe has been crafted, only two blocks are needed;
    // insisting on five causes unnecessary mining and remote table loss.
    const stoneNeeded=inv.stonePickaxe?2:5;
    if(inv.cobblestone<stoneNeeded)
      return {kind:'mine_cobblestone',why:'Collect '+stoneNeeded+' cobblestone required for remaining stone tools'};
    if(inv.sticks<3){
      if(inv.planks>=2)return {kind:'craft_sticks',why:'Need sticks for stone tools'};
      if(inv.logs>=1)return {kind:'craft_planks',why:'Need planks for sticks'};
      return {kind:'collect_wood',why:'Need wood for stone tool handles'};
    }
    if(!world.workbenchNearby){
      if(inv.table)return {kind:'place_table',why:'Need placed workstation for stone tools'};
      if(inv.planks>=4)return {kind:'craft_table',why:'Make stone tool workstation'};
      if(inv.logs>=1)return {kind:'craft_planks',why:'Create workstation planks'};
      return {kind:'collect_wood',why:'Gather workstation timber'};
    }
    if(!inv.stonePickaxe)return {kind:'craft_stone_pickaxe',why:'Upgrade mining tier'};
    return {kind:'craft_stone_sword',why:'Equip initial survival weapon'};
  }
  if(goal==='tools' || goal==='survive') {
    // Recipe prerequisites matter: sticks (2 planks), table (4 planks),
    // wooden pickaxe (3 planks, 2 sticks, placed table).
    if(goal==='tools') {
      if(inv.woodenPickaxe)return {kind:'complete',why:'Wooden pickaxe verified in inventory'};
      // Secure the TOTAL 2x2/3x3 recipe budget BEFORE consuming the first log:
      // 4 planks for table, 3 for pickaxe, 2 planks for sticks (unless already
      // owned). Converting a single log too early stranded the live bot atop
      // trees with planks/sticks but no new reachable wood.
      const requiredPlanks=3+(inv.sticks>=2?0:2)+((inv.table||world.workbenchNearby)?0:4);
      const availablePlanks=(inv.planks||0)+4*(inv.logs||0);
      if(availablePlanks<requiredPlanks)
        return failures.collect_wood>=3?{kind:'blocked',why:'Insufficient reachable wood for full wooden-tool recipe budget'}:
          {kind:'collect_wood',why:'Reserve wood for whole pickaxe/sticks/workstation recipe before crafting'};
      if(inv.sticks<2 && inv.planks>=2)return {kind:'craft_sticks',why:'Produce two pickaxe sticks'};
      if(!inv.table && !world.workbenchNearby && inv.planks>=4)return {kind:'craft_table',why:'Build crafting table'};
      if((inv.table || world.workbenchNearby) && inv.planks>=3 && inv.sticks>=2) {
        return world.workbenchNearby?{kind:'craft_pickaxe',why:'Craft pickaxe at nearby table'}:
          {kind:'place_table',why:'Place owned crafting table on safe nearby ground'};
      }
      if(inv.logs>=1)return {kind:'craft_planks',why:'Craft planks for missing recipes'};
      return failures.collect_wood>=3?{kind:'blocked',why:'No reachable wood to finish crafting'}:{kind:'collect_wood',why:'Acquire missing crafting wood'};
    }
    if((inv.logs||0)+(inv.planks||0)<4)
      return failures.collect_wood>=3?{kind:'blocked',why:'No reachable survival supplies'}:{kind:'collect_wood',why:'Obtain basic survival timber'};
    if(inv.logs>=1 && inv.planks<4)return {kind:'craft_planks',why:'Make survival building material'};
    if(world.ownerVisible && world.ownerDistance>14)return {kind:'follow',range:4,why:'Stay near owner'};
    if(!world.ownerVisible)return {kind:'wait',why:'Owner is out of loaded range'};
    return {kind:'explore',why:'Scout near owner after obtaining basic supplies'};
  }
  if(goal==='explore') {
    // The explicitly authorized explore goal is independent survival
    // scouting, unlike companion/follow/guard which remain owner-bounded.
    // Reuse the already observed, non-digging survival waypoint executor.
    return {kind:'scout_survival',reason:'explore',index:number(progress.steps),
      why:'Scout a new safe server-loaded region without requiring the owner in view'};
  }
  return {kind:'idle',why:'No plan'};
}
function createController({clock=()=>Date.now(),maxSeconds=600,maxSteps=120}={}) {
  let state={milestones:{},goal:null,status:'idle',since:0,deadline:0,steps:0,successes:0,failures:{},lastDecision:null,lastResult:null,why:null};
  function start(goal,seconds=300,spec={}){
    if(!GOALS.has(goal))throw Error('Unsupported autonomous gameplay goal');
    if(!Number.isInteger(seconds)||seconds<10||seconds>maxSeconds)throw Error('Duration out of bounds');
    if(goal==='shelter' &&
       !((spec?.width===undefined&&spec?.depth===undefined)||
         (Number.isInteger(spec?.width)&&spec.width>=3&&spec.width<=4&&
          Number.isInteger(spec?.depth)&&spec.depth>=3&&spec.depth<=4)))
      throw Error('Shelter width and depth must both be 3-4, or both omitted for default');
    if(goal==='defeat_hostile' && (!ALLOWED_HOSTILES.has(spec?.mob) ||
       !Number.isInteger(spec?.entityId)||spec.entityId<0||spec.entityId>200000))
      throw Error('Combat mission requires specific approved observed hostile ID');
    if(goal==='farm_wheat' && !validFarmSpec({goal,position:spec?.position,
      width:spec?.width,depth:spec?.depth,targetCount:spec?.targetCount}))
      throw Error('Invalid bounded wheat farming goal');
    if(goal==='farm_crop' && !validCropSpec({goal,crop:spec?.crop,
      position:spec?.position,width:spec?.width,
      depth:spec?.depth,targetCount:spec?.targetCount}))
      throw Error('Carrot/potato farm must have exact crop, 1-4 footprint and count 1-16');
    if(goal==='build' && !validBuildSpec({goal,position:spec?.position,block:spec?.block,
      axis:spec?.axis,length:spec?.length}))throw Error('Invalid bounded construction goal');
    if(goal==='build_volume'&&!validVolumeSpec({goal,position:spec?.position,
      block:spec?.block,width:spec?.width,depth:spec?.depth,
      height:spec?.height,shape:spec?.shape}))
      throw Error('Invalid bounded multi-layer construction goal');
    if(goal==='craft' && !validCraftSpec({goal,item:spec?.item,targetCount:spec?.targetCount}))
      throw Error('Unsupported general crafting recipe or target quantity');
    if(goal==='smelt' && !validSmeltSpec({goal,item:spec?.item,targetCount:spec?.targetCount}))
      throw Error('Unsupported furnace output or smelting quantity');
    if(goal==='transfer' && !validTransferSpec({goal,
         position:spec?.position,item:spec?.item,
         targetCount:spec?.targetCount,operation:spec?.operation}))
      throw Error('Container transfer requires exact position, item, 1-64 count and deposit/withdraw');
    if(goal==='equip' && !validEquipSpec({goal,item:spec?.item,destination:spec?.destination}))
      throw Error('Unsupported equipment item or slot');
    if(goal==='sequence' && !validSequence(spec?.steps))
      throw Error('Sequence requires one to sixteen typed valid subgoals');
    if(goal==='travel' && (!spec?.destination ||
       !['x','y','z'].every(k=>Number.isInteger(spec.destination[k]) &&
         Math.abs(spec.destination[k])<=30000000) ||
       !Number.isInteger(spec?.arrivalRange) || spec.arrivalRange<1 || spec.arrivalRange>8))
      throw Error('Travel requires integer destination and arrivalRange 1-8');
    if(goal==='gather' && (!RESOURCES.has(spec?.resource) ||
        !Number.isInteger(spec?.targetCount) || spec.targetCount<1 || spec.targetCount>64))
      throw Error('Gather requires supported resource and targetCount 1-64');
    const t=clock();state={milestones:{},goal,status:'running',since:t,deadline:t+seconds*1000,steps:0,successes:0,failures:{},lastDecision:null,lastResult:null,why:null,
      ...(goal==='gather'?{resource:spec.resource,targetCount:spec.targetCount}:{}),
      ...(goal==='defeat_hostile'?{mob:spec.mob,entityId:spec.entityId}:{}),
      ...(goal==='shelter'?{width:spec.width??3,depth:spec.depth??3}:{}),
      ...(goal==='craft'||goal==='smelt'?{item:spec.item,targetCount:spec.targetCount}:{}),
      ...(goal==='transfer'?{position:{...spec.position},item:spec.item,
        targetCount:spec.targetCount,operation:spec.operation}:{}),
      ...(goal==='equip'?{item:spec.item,destination:spec.destination}:{}),
      ...(goal==='build'?{position:{...spec.position},block:spec.block,axis:spec.axis,length:spec.length}:{}),
      ...(goal==='build_volume'?{position:{...spec.position},block:spec.block,
        width:spec.width,depth:spec.depth,height:spec.height,shape:spec.shape}:{}),
      ...(goal==='farm_wheat'?{position:{...spec.position},width:spec.width,
        depth:spec.depth,targetCount:spec.targetCount}:{}),
      ...(goal==='farm_crop'?{crop:spec.crop,position:{...spec.position},
        width:spec.width,depth:spec.depth,targetCount:spec.targetCount}:{}),
      ...(goal==='travel'?{destination:{...spec.destination},
        arrivalRange:spec.arrivalRange}:{}),
      ...(goal==='sequence'?{sequence:canonicalSequence(spec.steps),sequenceIndex:0}:{})};return status();
  }
  function stop(why='Owner paused autonomous gameplay'){state.status='paused';state.why=why;return status();}
  // A long-running owner-authorized mission may continue in bounded 6-hour
  // windows. This is NOT a completion, and never resumes a blocked, cancelled,
  // or owner-paused task. The next decision is recomputed from live world state.
  function renewMission(seconds=21600){
    if(state.status!=='expired' || !['netherite_dragon_run','dragon_then_netherite_run','dragon_run','netherite_armor_run','netherite_gear_run','shelter','companion'].includes(state.goal))return false;
    if(!Number.isInteger(seconds)||seconds<10||seconds>maxSeconds)return false;
    const t=clock();
    if(!Number.isSafeInteger(state.since)||t<state.since)return false;
    const remaining=Math.floor((state.since+MAX_MISSION_LIFETIME_MS-t)/1000);
    if(remaining<10)return false;
    const renewedSeconds=Math.min(seconds,remaining);
    state.status='running';state.deadline=t+renewedSeconds*1000;state.steps=0;
    state.failures={};state.why='Continued authorized gameplay; goal not yet complete';
    state.lastDecision=null;state.lastResult=null;
    return true;
  }
  function resumeAfterRespawn(){
    if(state.status!=='paused'||!GOALS.has(state.goal)||clock()>=state.deadline ||
       state.goal==='defeat_hostile')return false;
    state.status='running';state.why='Restarted after respawn; no inventory or completion proof assumed';
    state.failures={};state.milestones={};state.steps=0;state.lastDecision=null;state.lastResult=null;
    // Death may have destroyed inventory. Recheck earlier stages from live
    // state instead of blindly resuming a stale sequence checkpoint.
    if(state.goal==='sequence'||state.goal==='shelter')state.sequenceIndex=0;
    return true;
  }
  function status(){return JSON.parse(JSON.stringify(state));}
  // The first joined server inventory for EACH gather stage fixes the baseline.
  // No mutable model text or old milestone may set the start count.
  function gatherBaseline(world,resource,stageIndex){
    if(world?.joined!==true||!world.inventory||typeof world.inventory!=='object')
      return null;
    const observed=resourceCount(world,resource),m=state.milestones;
    if(!Number.isSafeInteger(observed)||observed<0)return null;
    if(m.gatherStageIndex!==stageIndex||m.gatherResource!==resource||
       !Number.isSafeInteger(m.gatherInitialCount)){
      m.gatherStageIndex=stageIndex;
      m.gatherResource=resource;
      m.gatherInitialCount=observed;
    }
    return m.gatherInitialCount;
  }
  function next(world){
    if(state.status!=='running')return {kind:'idle',why:'Automation not running'};
    if(clock()>=state.deadline||state.steps>=maxSteps){state.status='expired';state.why='Goal time/step budget exhausted';return {kind:'idle',why:state.why};}
    let d;
    if(state.goal==='shelter' && !Array.isArray(state.sequence)){
      // The shelter request chooses a fixed 3x3x2 cobblestone structure.
      // Coordinates are derived only from fresh safe local world blocks,
      // never supplied by an LLM or untrusted in-world chat.
      const approved=world?.shelterSite?.steps;
      if(Array.isArray(approved) && validSequence(approved) &&
         approved.length===3 &&
         approved[0]?.shape==='floor' &&
         approved[1]?.shape==='entrance_walls' &&
         approved[2]?.shape==='roof' &&
         approved.every(s=>s.goal==='build_volume' && s.block==='cobblestone' &&
           s.width===state.width&&s.depth===state.depth)){
        state.sequence=canonicalSequence(approved);
        state.sequenceIndex=0;
      }else if((state.milestones.shelterSiteTrips||0)>=6)
        d={kind:'blocked',why:'Six verified alternative areas lacked a safe shelter footprint'};
      else
        d={kind:'scout_survival',reason:'shelter_site',index:state.steps,
          why:'Locate real loaded, nonhazardous local ground for a 3x3 cobblestone shelter'};
    }
    if(!d && (state.goal==='sequence'||state.goal==='shelter')){
      // Do not mark a composed goal complete by merely issuing the steps.
      // Recompute every stage against the current server-backed world and
      // advance across at most sixteen already-proven stages in one tick.
      for(let n=0;n<=state.sequence.length;n++){
        if(state.sequenceIndex>=state.sequence.length){
          d={kind:'complete',why:'All authorized sequence stages independently verified'};
          break;
        }
        const stage=state.sequence[state.sequenceIndex];
        // autoTick compiles the LIVE Minecraft recipe catalog only for the
        // previously active craft/equip stage. When a stage has just been
        // proven and the sequence index advances during this same tick, the
        // next item may have a completely different versioned recipe.
        // Yield one observation tick rather than using stale recipe evidence
        // to falsely block a valid multi-stage owner instruction.
        if(n>0 && ['craft','equip'].includes(stage.goal) &&
           world.recipeCatalog?.root!==stage.item){
          d={kind:'wait',why:'Refresh live recipe catalog for next authorized sequence item'};
          break;
        }
        const stageWorld=stage.goal==='build'?
          {...world,buildCells:world.buildCellsByStage?.[state.sequenceIndex]}:
          stage.goal==='build_volume'?
          {...world,buildVolumeCells:world.buildVolumeCellsByStage?.[state.sequenceIndex]}:
          stage.goal==='farm_wheat'?
          {...world,wheatCells:world.wheatCellsByStage?.[state.sequenceIndex]}:
          stage.goal==='farm_crop'?
          {...world,cropCells:world.cropCellsByStage?.[state.sequenceIndex]}:world;
        const initial=stage.goal==='gather'?
          gatherBaseline(stageWorld,stage.resource,state.sequenceIndex):null;
        if(stage.goal==='gather'&&initial===null){
          d={kind:'wait',why:'Gather stage requires a fresh joined server inventory'};
          break;
        }
        d=decide(stage.goal,stageWorld,state.failures,
          {...state,...stage,...(initial!==null?{gatherInitialCount:initial}:{})});
        if(d.kind!=='complete')break;
        state.sequenceIndex++;
        // Each ordered furnace stage must earn its own actual verified
        // outputs; earlier stage receipts never satisfy a later request.
        state.milestones.smeltedOutput=0;
        state.milestones.craftedOutput=0;
        state.milestones.wheatHarvested=0;
        state.milestones.harvestedCropCount=0;
        delete state.milestones.gatherInitialCount;
        delete state.milestones.gatherStageIndex;
        delete state.milestones.gatherResource;
        state.failures={};
        // An arrival proof for a prior target must never prove the next one.
        state.milestones.travelArrivalVerified=false;
      }
      if(!d)d={kind:'blocked',why:'No valid stage decision'};
    }else if(!d){
      const initial=state.goal==='gather'?gatherBaseline(world,state.resource,-1):null;
      d=state.goal==='gather'&&initial===null?
        {kind:'wait',why:'Gather goal requires a fresh joined server inventory'}:
        decide(state.goal,world,state.failures,
          {...state,...(initial!==null?{gatherInitialCount:initial}:{})});
    }
    // Replan from a different *observed safe* travel waypoint after repeated
    // pathfinder failure. Never change the owner's destination or silently
    // declare arrival from a successful detour.
    if(state.goal==='travel' && d.kind==='travel_target' &&
       (state.failures.travel_target||0)>=2){
      d=(state.milestones.travelRecoveryTrips||0)>=4
       ?{kind:'blocked',why:'Four verified alternate travel approaches exhausted; destination not reached'}
       :{kind:'scout_survival',reason:'travel_recovery',index:state.steps,
         why:'Previous route failed; observe a new safe approach before retrying exact target'};
    }
    // A distant Dragon on the central island can be physically separated
    // by a short void gap. After TWO failed safe-land advances, try ONE
    // independently observed, non-creative block placement, never a
    // fabricated walk into unloaded terrain. Finite eight-tile budget.
    if(d.kind==='advance_dragon'&&
       (state.failures.advance_dragon||0)>=2){
      const placed=state.milestones.endBridgeTiles||0;
      d=placed>=8?
        {kind:'blocked',why:'Eight real End bridging tiles exhausted without confirmed island route'}:
        (state.failures.bridge_end_gap||0)>=2?
          {kind:'blocked',why:'Two failed safely observed End bridge placements; no route authorized'}:
          {kind:'bridge_end_gap',why:'Bridge only a supported observed short End void gap using survival blocks'};
    }
    // A repeated failure to collect real stone gets an alternate safe
    // observation site, never a fabricated inventory receipt.
    if(d.kind==='mine_cobblestone' && (state.failures.mine_cobblestone||0)>=2){
      d=(state.milestones.stoneSurveyTrips||0)>=8
        ?{kind:'blocked',why:'Eight verified alternate stone regions exhausted'}
        :{kind:'scout_survival',reason:'stone_recovery',index:state.steps,
          why:'Stone mining stalled; move to genuinely new safe loaded terrain'};
    }
    // Do not let a 3.6-second projectile flight destroy a 12-hour Dragon
    // mission. If a crystal survives two verified arrow attempts, change
    // the physical shooting angle using a finite safe waypoint search.
    if(d.kind==='destroy_end_crystal' && (state.failures.destroy_end_crystal||0)>=2)
      d=(state.milestones.crystalRecoveryTrips||0)>=6
        ?{kind:'blocked',why:'Six verified alternate crystal shooting regions exhausted'}
        :{kind:'scout_survival',reason:'crystal_recovery',index:state.steps,
          why:'Crystal survived ranged shots; seek a different verified safe stance'};
    if(d.kind==='survey_ore' && (state.failures.survey_ore||0)>=12)
      d={kind:'blocked',why:'Twelve failed physically observed ore surveys; manual reconciliation required'};
    if(d.kind==='scout_survival' && state.goal==='explore' &&
       (state.milestones.scoutTrips||0)>=24){
      state.status='expired';state.why='Bounded 24-site exploration session completed; no resources or structures claimed';
      return {kind:'idle',why:state.why};
    }
    // Autonomous wood recovery remains bounded. A successful scout must
    // observe real movement; it does not fake resource acquisition.
    if(d.kind==='collect_wood' && (state.failures.collect_wood||0)>=2){
      d=(state.milestones.woodSurveyTrips||0)>=8
        ?{kind:'blocked',why:'Eight proven alternate wood-search regions exhausted'}
        :{kind:'survey_wood',index:state.steps,
          why:'Two failed tree approaches: scout fresh safe ground before retrying wood'};
    }
    if(d.kind==='place_table'&&(state.failures.place_table||0)>=2){
      d=(state.milestones.workstationSurveyTrips||0)>=6?
        {kind:'blocked',why:'Six verified alternate crafting work areas exhausted; workstation cannot safely be placed'}:
        {kind:'survey_workstation',index:state.steps,
         why:'Failed workstation placement: search different safe loaded work area before retrying'};
    }
    // Bounded repair is not an endless success claim. Several late-game
    // skills legitimately explore multiple new regions, but once actual
    // failed attempts exhaust a finite budget, surface an owner-visible
    // BLOCKED outcome instead of burning time until a 12-hour lease ends.
    // Successful server-observed results still reset consecutive failures.
    const lateFailureBudgets={
      loot_bastion_template:12,mine_ancient_debris:12,
      hunt_blazes:12,hunt_endermen:12,collect_gold:12,
      track_stronghold:12,search_dragon:12,
      mine_obsidian:10,prepare_archery:10,
      obtain_food:10,enter_nether:8,enter_overworld:8,
      activate_end_portal:8,enter_end:8,exit_end:8,
      destroy_end_crystal:12,fight_dragon:12,advance_dragon:8,bridge_end_gap:2,
      collect_flint:10,mine_netherrack:10
    };
    if(Object.hasOwn(lateFailureBudgets,d.kind) &&
       (state.failures[d.kind]||0)>=lateFailureBudgets[d.kind])
      d={kind:'blocked',why:'Real-game '+d.kind+' exhausted '+
        lateFailureBudgets[d.kind]+
        ' consecutive unverified attempts; preserve receipts and require new observed conditions'};
    if(d.kind==='advance_dragon' &&
       (state.milestones.dragonApproachTrips||0)>=24)
      d={kind:'blocked',why:'Twenty-four proven safe Dragon approach regions failed to bring combat into range'};
    if(d.kind==='fight_dragon' &&
       (state.milestones.dragonRangedShots||0)>=48)
      d={kind:'blocked',why:'Forty-eight real arrows fired without confirmed Dragon death; do not invent a hit'};
    if(d.kind==='fight_dragon' &&
       (state.milestones.dragonRangedShots||0)>=8*
       ((state.milestones.dragonStanceTrips||0)+1)){
      d=(state.milestones.dragonStanceTrips||0)>=6?
        {kind:'blocked',why:'Six physically verified alternate Dragon bow positions exhausted'}:
        {kind:'scout_survival',reason:'dragon_stance',index:state.steps,
          why:'Eight real Dragon arrows without proven victory; seek a safe loaded shooting stance'};
    }
    if(d.kind==='fight_dragon' &&
       (state.milestones.dragonAttackInputs||0)>=96)
      d={kind:'blocked',why:'Ninety-six observed Dragon melee attempts did not prove the real Dragon death'};
    state.lastDecision=d;
    if(d.kind==='complete'){state.status='complete';state.why=d.why;}
    if(d.kind==='blocked'){state.status='blocked';state.why=d.why;}
    if(!['wait','idle','complete','blocked'].includes(d.kind))state.steps++;
    return d;
  }
  function record(decision, outcome){
    if(state.status!=='running' || !decision)return;
    const activeCrop=state.goal==='farm_crop'?state.crop:
      state.goal==='sequence'&&state.sequence?.[state.sequenceIndex]?.goal==='farm_crop'?
        state.sequence[state.sequenceIndex].crop:null;
    const ok=outcome?.ok===true && outcome?.verified===true &&
      (decision.kind!=='survey_generic'||(
        SAFE_GENERIC_RESOURCES.has(decision.resource)&&
        outcome.proof==='generic_survey_move')) &&
      (decision.kind!=='survey_workstation' ||
        outcome.proof==='workstation_scout_move') &&
      (decision.kind!=='scout_survival' ||
        outcome.proof==='safe_scout_move') &&
      (decision.kind!=='recover_health' ||
        outcome.proof==='health_regenerated') &&
      (decision.kind!=='harvest_wheat' ||
        (outcome.proof==='wheat_harvest'&&
          Number.isInteger(outcome.count)&&outcome.count>=1&&outcome.count<=64)) &&
      (decision.kind!=='harvest_crop' ||
        (outcome.proof==='crop_harvest'&&activeCrop!==null&&outcome.crop===activeCrop &&
          Number.isInteger(outcome.count)&&outcome.count>=1&&outcome.count<=64)) &&
      (decision.kind!=='plant_crop' ||
        (outcome.proof==='crop_planted'&&activeCrop!==null&&outcome.crop===activeCrop)) &&
      (decision.kind!=='approach_container' ||
        outcome.proof==='container_approach') &&
      (decision.kind!=='transfer_inventory' ||
        (outcome.proof==='container_transfer' &&
          outcome.item===state.item &&
          outcome.count===state.targetCount &&
          outcome.operation===state.operation &&
          ['x','y','z'].every(k=>outcome.position?.[k]===state.position?.[k]))) &&
      (decision.kind!=='survey_resource' ||
        (Object.hasOwn(ORE_RESOURCE_RULES,decision.resource)&&
          outcome.proof==='safe_scout_move')) &&
      (decision.kind!=='advance_dragon' ||
        outcome.proof==='dragon_approach') &&
      (decision.kind!=='bridge_end_gap' ||
        outcome.proof==='end_bridge_tile') &&
      (decision.kind!=='fight_dragon' ||
        ['dragon_seen','dragon_bow_fired','dragon_death'].includes(outcome.proof)) &&
      (decision.kind!=='smelt_resource' ||
        !['smelt','sequence'].includes(state.goal) ||
        outcome.proof==='smelt_output') &&
      (decision.kind!=='craft_general' || (
        outcome.proof==='craft_output'&&
        Number.isInteger(outcome.count)&&outcome.count>=1&&outcome.count<=64&&
        outcome.item===decision.item)) &&
      (decision.kind!=='fight_bound_hostile' ||
        (outcome.proof==='bound_hostile_death' &&
          outcome.targetId===state.entityId && outcome.mob===state.mob)) &&
      (decision.kind!=='approach_bound_hostile' ||
        (outcome.proof==='bound_hostile_approach' &&
          outcome.targetId===state.entityId && outcome.mob===state.mob));
    if(ok){
      // Only CONSECUTIVE unresolved attempts should exhaust an action's
      // bounded retry budget. Previously verified success left old failures
      // accumulated, falsely blocking long multi-recipe missions.
      state.failures[decision.kind]=0;
      state.successes++;
      // A verified receipt from the wrong action cannot grant a victory milestone.
      if(decision.kind==='harvest_wheat'&&outcome.proof==='wheat_harvest'){
        const current=state.goal==='farm_wheat'||
          (state.goal==='sequence'&&
           state.sequence?.[state.sequenceIndex]?.goal==='farm_wheat');
        if(current)state.milestones.wheatHarvested=Math.min(16,
          (state.milestones.wheatHarvested||0)+outcome.count);
      }
      if(decision.kind==='harvest_crop'&&outcome.proof==='crop_harvest' &&
         activeCrop!==null&&outcome.crop===activeCrop)
        state.milestones.harvestedCropCount=Math.min(16,
          (state.milestones.harvestedCropCount||0)+outcome.count);
      if(decision.kind==='transfer_inventory'&&outcome.proof==='container_transfer')
        state.milestones.transferDone=true;
      if(decision.kind==='craft_general'&&outcome.proof==='craft_output'){
        const target=state.goal==='craft'?state.item:
          state.goal==='sequence'&&state.sequence?.[state.sequenceIndex]?.goal==='craft'?
          state.sequence[state.sequenceIndex].item:null;
        if(target===outcome.item)
          state.milestones.craftedOutput=Math.min(16,
            (state.milestones.craftedOutput||0)+outcome.count);
      }
      if(decision.kind==='smelt_resource'&&outcome.proof==='smelt_output'){
        const pending=state.goal==='smelt'?state.item:
          state.goal==='sequence'&&state.sequence?.[state.sequenceIndex]?.goal==='smelt'?
            state.sequence[state.sequenceIndex].item:null;
        if(pending===decision.output)
          state.milestones.smeltedOutput=Math.min(16,
            (state.milestones.smeltedOutput||0)+1);
      }
      if(decision.kind==='advance_dragon'&&outcome.proof==='dragon_approach')
        state.milestones.dragonApproachTrips=Math.min(24,
          (state.milestones.dragonApproachTrips||0)+1);
      if(decision.kind==='fight_dragon'&&outcome.proof==='dragon_bow_fired')
        state.milestones.dragonRangedShots=Math.min(48,
          (state.milestones.dragonRangedShots||0)+1);
      if(decision.kind==='bridge_end_gap'&&outcome.proof==='end_bridge_tile'){
        state.milestones.endBridgeTiles=Math.min(8,
          (state.milestones.endBridgeTiles||0)+1);
        state.failures.advance_dragon=0;
      }
      if(decision.kind==='fight_bound_hostile'&&
         outcome.proof==='bound_hostile_death'&&
         outcome.targetId===state.entityId&&outcome.mob===state.mob){
        state.milestones.defeatedId=state.entityId;
        state.milestones.defeatedMob=state.mob;
      }
      if(decision.kind==='build_nether_portal' && outcome.proof==='nether_portal')
        state.milestones.netherPortalBuilt=true;
      if((decision.kind==='enter_nether'&&outcome.proof==='nether_entered') ||
         (decision.kind==='enter_overworld'&&outcome.proof==='overworld_return'))
        state.milestones.netherPortalUsed=true;
      if(['observe_dragon','search_dragon','fight_dragon'].includes(decision.kind) &&
         outcome.proof==='dragon_seen')
        state.milestones.dragonSeen=true;
      if(decision.kind==='fight_dragon' && outcome.proof==='dragon_seen' &&
         state.milestones.dragonKilled!==true)
        state.milestones.dragonAttackInputs=Math.min(96,
          (state.milestones.dragonAttackInputs||0)+1);
      // A portal observation alone never proves a dragon death. The combined
      // victory proof is emitted only by the live skill after seeing the dragon,
      // observing its entityDead event and finding an End exit portal.
      if((decision.kind==='fight_dragon' && outcome.proof==='dragon_death' && state.milestones.dragonSeen===true) ||
         (decision.kind==='verify_dragon' && outcome.proof==='dragon_victory' && state.milestones.dragonSeen===true))
        state.milestones.dragonKilled=true;
      if(decision.kind==='verify_dragon' &&
         ['end_exit_portal','dragon_victory'].includes(outcome.proof))
        state.milestones.exitPortalObserved=true;
      if(decision.kind==='track_stronghold')state.milestones.strongholdSearchStarted=true;
      if(outcome.proof==='end_return' && decision.kind==='exit_end')
        state.milestones.endReturned=true;
      if(decision.kind==='equip_netherite' && outcome.proof==='netherite_equipped')
        state.milestones.netheriteEquipped=true;
      if(decision.kind==='survey_ore'){state.failures[decision.ore==='iron'?'mine_iron':'mine_diamond']=0;}
      if(decision.kind==='travel_target' && outcome.proof==='travel_arrival')
        state.milestones.travelArrivalVerified=true;
      if(decision.kind==='survey_resource'){
        const trips=state.milestones.resourceOreTrips&&
          typeof state.milestones.resourceOreTrips==='object'?
          state.milestones.resourceOreTrips:{};
        const target=decision.resource;
        trips[target]=Math.min(8,(trips[target]||0)+1);
        state.milestones.resourceOreTrips=trips;
        state.failures.mine_resource_ore=0;
      }
      if(decision.kind==='survey_generic'){
        const trips=state.milestones.genericSurveyTrips &&
          typeof state.milestones.genericSurveyTrips==='object'?
          state.milestones.genericSurveyTrips:{};
        const material=decision.resource;
        trips[material]=Math.min(8,(Number.isInteger(trips[material])?trips[material]:0)+1);
        state.milestones.genericSurveyTrips=trips;
        state.failures.mine_generic=0;
      }
      if(decision.kind==='survey_workstation'){
        state.milestones.workstationSurveyTrips=Math.min(6,
          (Number.isInteger(state.milestones.workstationSurveyTrips)?
            state.milestones.workstationSurveyTrips:0)+1);
        state.failures.place_table=0;
      }
      if(decision.kind==='survey_wood'){
        state.milestones.woodSurveyTrips=(state.milestones.woodSurveyTrips||0)+1;
        state.failures.collect_wood=0;
      }
      if(decision.kind==='scout_survival'){
        state.milestones.scoutTrips=Math.min(24,(state.milestones.scoutTrips||0)+1);
        if(decision.reason==='stone_recovery'){
          state.milestones.stoneSurveyTrips=Math.min(8,(state.milestones.stoneSurveyTrips||0)+1);
          state.failures.mine_cobblestone=0;
        }
        if(decision.reason==='travel_recovery'){
          state.milestones.travelRecoveryTrips=Math.min(4,(state.milestones.travelRecoveryTrips||0)+1);
          state.failures.travel_target=0;
          state.milestones.travelArrivalVerified=false;
        }
        if(decision.reason==='shelter_site')
          state.milestones.shelterSiteTrips=Math.min(6,(state.milestones.shelterSiteTrips||0)+1);
        if(decision.reason==='crystal_recovery'){
          state.milestones.crystalRecoveryTrips=Math.min(6,(state.milestones.crystalRecoveryTrips||0)+1);
          state.failures.destroy_end_crystal=0;
        }
        if(decision.reason==='dragon_stance')
          state.milestones.dragonStanceTrips=Math.min(6,
            (state.milestones.dragonStanceTrips||0)+1);
      }}
    else{
      state.failures[decision.kind]=(state.failures[decision.kind]||0)+1;
      if(decision.kind==='transfer_inventory'){
        // A dispatched deposit/withdraw may have modified the remote chest
        // despite a missing dual-inventory ACK. NEVER retry this ambiguous
        // financial-style mutation automatically or after a restart.
        state.status='blocked';
        state.why='Container mutation unsettled; physically reconcile both inventories before new owner instruction';
      }
    }
    state.lastResult={kind:decision.kind,verified:ok,detail:String(outcome?.detail||'unverified').slice(0,140)};
    if(!ok && !['mine_iron','mine_diamond','mine_obsidian','mine_ancient_debris','hunt_blazes','hunt_endermen','track_stronghold','search_dragon','collect_flint','collect_gold','loot_bastion_template','prepare_archery','obtain_food','mine_netherrack','survey_ore','destroy_end_crystal','fight_dragon','advance_dragon'].includes(decision.kind) && (state.failures[decision.kind]||0)>=3){
      state.status='blocked';state.why='Repeated unverified or failing action: '+decision.kind;
    }
  }
  return {start,stop,renewMission,resumeAfterRespawn,status,next,record};
}
module.exports={GOALS,HOSTILES,FOOD,digest,decide,createController,itemsFrom,resolveOwnerEntity};
