/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/** Deterministic, locally executable Minecraft decision layer.
 * This layer proposes bounded actions. It does NOT execute Minecraft packets,
 * run shell commands, trust other players' chat, or claim task completion.
 */
const {lateGamePlan} = require('./late_game.cjs');
const {RESOURCES,SAFE_GENERIC_RESOURCES,ORE_RESOURCE_RULES,resourcePlan}=require('./resource_goal.cjs');
const {validSequence,canonicalSequence}=require('./mission_sequence.cjs');
const {validBuildSpec,buildPlan,validVolumeSpec,volumePlan}=require('./structure_goal.cjs');
const {validFarmSpec,wheatPlan}=require('./wheat_goal.cjs');
const {validCraftSpec,validEquipSpec,generalPlan}=require('./general_goal.cjs');
const {ALLOWED_HOSTILES}=require('./native_combat.cjs');
// An owner-issued long mission has a finite authority lease across all renewals.
const MAX_MISSION_LIFETIME_MS=12*60*60*1000;
const GOALS = new Set(['companion','netherite_dragon_run','dragon_then_netherite_run','netherite_armor_run','netherite_gear_run','shelter','defeat_hostile','survive','wood','tools','explore','follow','guard','stone_age','iron_age','dragon_run','gather','travel','build','build_volume','farm_wheat','sequence','craft','equip']);
const HOSTILES = new Set(['zombie','husk','drowned','skeleton','stray','spider','creeper','witch','pillager','endermite','silverfish','blaze','ghast','hoglin','zoglin','piglin_brute','wither_skeleton','magma_cube','ender_dragon','wither']);
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
    wornNetherite,wornDiamond,heldNetheriteSword,equipped,exitPortalPresent, dragonPresent:dragons.length>0,dragonId:dragons[0]?.id||null,
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
  if(goal==='craft'||goal==='equip')return generalPlan(world,{...progress,goal},
    (needed,extra)=>decide(needed,world,failures,{...progress,...extra}));
  if(goal==='gather')return resourcePlan(world,failures,progress,needed=>decide(needed,world,failures,progress));
  if(goal==='farm_wheat')return wheatPlan(world,{
    goal,position:progress.position,width:progress.width,
    depth:progress.depth,targetCount:progress.targetCount});
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
    if((world.dimension && !String(world.dimension).includes('overworld')) || progress.milestones?.netherPortalBuilt)
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
    if(goal==='defeat_hostile' && (!ALLOWED_HOSTILES.has(spec?.mob) ||
       !Number.isInteger(spec?.entityId)||spec.entityId<0||spec.entityId>200000))
      throw Error('Combat mission requires specific approved observed hostile ID');
    if(goal==='farm_wheat' && !validFarmSpec({goal,position:spec?.position,
      width:spec?.width,depth:spec?.depth,targetCount:spec?.targetCount}))
      throw Error('Invalid bounded wheat farming goal');
    if(goal==='build' && !validBuildSpec({goal,position:spec?.position,block:spec?.block,
      axis:spec?.axis,length:spec?.length}))throw Error('Invalid bounded construction goal');
    if(goal==='build_volume'&&!validVolumeSpec({goal,position:spec?.position,
      block:spec?.block,width:spec?.width,depth:spec?.depth,
      height:spec?.height,shape:spec?.shape}))
      throw Error('Invalid bounded multi-layer construction goal');
    if(goal==='craft' && !validCraftSpec({goal,item:spec?.item,targetCount:spec?.targetCount}))
      throw Error('Unsupported general crafting recipe or target quantity');
    if(goal==='equip' && !validEquipSpec({goal,item:spec?.item,destination:spec?.destination}))
      throw Error('Unsupported equipment item or slot');
    if(goal==='sequence' && !validSequence(spec?.steps))
      throw Error('Sequence requires one to eight typed valid subgoals');
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
      ...(goal==='craft'?{item:spec.item,targetCount:spec.targetCount}:{}),
      ...(goal==='equip'?{item:spec.item,destination:spec.destination}:{}),
      ...(goal==='build'?{position:{...spec.position},block:spec.block,axis:spec.axis,length:spec.length}:{}),
      ...(goal==='build_volume'?{position:{...spec.position},block:spec.block,
        width:spec.width,depth:spec.depth,height:spec.height,shape:spec.shape}:{}),
      ...(goal==='farm_wheat'?{position:{...spec.position},width:spec.width,
        depth:spec.depth,targetCount:spec.targetCount}:{}),
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
           s.width===3&&s.depth===3)){
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
      // advance across at most eight already-proven stages in one tick.
      for(let n=0;n<=state.sequence.length;n++){
        if(state.sequenceIndex>=state.sequence.length){
          d={kind:'complete',why:'All authorized sequence stages independently verified'};
          break;
        }
        const stage=state.sequence[state.sequenceIndex];
        const stageWorld=stage.goal==='build'?
          {...world,buildCells:world.buildCellsByStage?.[state.sequenceIndex]}:
          stage.goal==='build_volume'?
          {...world,buildVolumeCells:world.buildVolumeCellsByStage?.[state.sequenceIndex]}:
          stage.goal==='farm_wheat'?
          {...world,wheatCells:world.wheatCellsByStage?.[state.sequenceIndex]}:world;
        d=decide(stage.goal,stageWorld,state.failures,{...state,...stage});
        if(d.kind!=='complete')break;
        state.sequenceIndex++;
        state.failures={};
        // An arrival proof for a prior target must never prove the next one.
        state.milestones.travelArrivalVerified=false;
      }
      if(!d)d={kind:'blocked',why:'No valid stage decision'};
    }else if(!d) d=decide(state.goal,world,state.failures,state);
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
    // A repeated failure to collect real stone gets an alternate safe
    // observation site, never a fabricated inventory receipt.
    if(d.kind==='mine_cobblestone' && (state.failures.mine_cobblestone||0)>=2){
      d=(state.milestones.stoneSurveyTrips||0)>=8
        ?{kind:'blocked',why:'Eight verified alternate stone regions exhausted'}
        :{kind:'scout_survival',reason:'stone_recovery',index:state.steps,
          why:'Stone mining stalled; move to genuinely new safe loaded terrain'};
    }
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
    state.lastDecision=d;
    if(d.kind==='complete'){state.status='complete';state.why=d.why;}
    if(d.kind==='blocked'){state.status='blocked';state.why=d.why;}
    if(!['wait','idle','complete','blocked'].includes(d.kind))state.steps++;
    return d;
  }
  function record(decision, outcome){
    if(state.status!=='running' || !decision)return;
    const ok=outcome?.ok===true && outcome?.verified===true &&
      (decision.kind!=='survey_generic'||(
        SAFE_GENERIC_RESOURCES.has(decision.resource)&&
        outcome.proof==='generic_survey_move')) &&
      (decision.kind!=='survey_workstation' ||
        outcome.proof==='workstation_scout_move') &&
      (decision.kind!=='scout_survival' ||
        outcome.proof==='safe_scout_move') &&
      (decision.kind!=='survey_resource' ||
        (Object.hasOwn(ORE_RESOURCE_RULES,decision.resource)&&
          outcome.proof==='safe_scout_move')) &&
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
      if(decision.kind==='fight_bound_hostile'&&
         outcome.proof==='bound_hostile_death'&&
         outcome.targetId===state.entityId&&outcome.mob===state.mob){
        state.milestones.defeatedId=state.entityId;
        state.milestones.defeatedMob=state.mob;
      }
      if(decision.kind==='build_nether_portal' && outcome.proof==='nether_portal')
        state.milestones.netherPortalBuilt=true;
      if(['observe_dragon','search_dragon','fight_dragon'].includes(decision.kind) &&
         outcome.proof==='dragon_seen')
        state.milestones.dragonSeen=true;
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
      }}
    else state.failures[decision.kind]=(state.failures[decision.kind]||0)+1;
    state.lastResult={kind:decision.kind,verified:ok,detail:String(outcome?.detail||'unverified').slice(0,140)};
    if(!ok && !['mine_iron','mine_diamond','mine_obsidian','mine_ancient_debris','hunt_blazes','hunt_endermen','track_stronghold','search_dragon','collect_flint','collect_gold','loot_bastion_template','prepare_archery','obtain_food','mine_netherrack','survey_ore'].includes(decision.kind) && (state.failures[decision.kind]||0)>=3){
      state.status='blocked';state.why='Repeated unverified or failing action: '+decision.kind;
    }
  }
  return {start,stop,renewMission,resumeAfterRespawn,status,next,record};
}
module.exports={GOALS,HOSTILES,FOOD,digest,decide,createController,itemsFrom,resolveOwnerEntity};
