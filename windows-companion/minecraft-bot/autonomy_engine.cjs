/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/** Deterministic, locally executable Minecraft decision layer.
 * This layer proposes bounded actions. It does NOT execute Minecraft packets,
 * run shell commands, trust other players' chat, or claim task completion.
 */
const {lateGamePlan} = require('./late_game.cjs');
const GOALS = new Set(['companion','netherite_dragon_run','dragon_then_netherite_run','survive','wood','tools','explore','follow','guard','stone_age','iron_age','dragon_run']);
const HOSTILES = new Set(['zombie','husk','drowned','skeleton','stray','spider','creeper','witch','pillager','endermite','silverfish']);
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
      if(frames.length)strongholdMissingEyes=frames.reduce((n,p)=>{
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
    wornNetherite,wornDiamond,exitPortalPresent, dragonPresent:dragons.length>0,dragonId:dragons[0]?.id||null,
    dragonDeadObserved:dragonDead,crystalsNearby:crystals.length,
    health:number(bot.health,20),hunger:number(bot.food,20),workbenchNearby,
     // Only the native Mineflayer runtime advertises physical workstation
     // recovery; modeled worlds never claim this capability implicitly.
     workbenchRecoverySupported,
     furnaceNearby,
    position:p?{x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)}:null,
    ownerVisible:!!owner,ownerDistance:p&&owner?Math.round(p.distanceTo(owner)):null,
    ownerPosition:owner?{x:Math.floor(owner.x),y:Math.floor(owner.y),z:Math.floor(owner.z)}:null,
    threats:threats.slice(0,6),inventory, timeOfDay:bot.time?.timeOfDay??null};
}
function decide(goal, world, failures={}, progress={}) {
  if(!GOALS.has(goal)) return {kind:'idle',why:'No autonomous goal'};
  if(!world?.joined)return {kind:'wait',why:'Bot not spawned'};
  const inv=world.inventory||{}, threats=world.threats||[];
  const closest=threats[0];
  if(world.health<=8 && closest?.distance<=10)return {kind:'retreat',why:'Critical health near hostile entity'};
  if(world.hunger<=12 && (inv.food||0)>0)return {kind:'eat',why:'Hunger low; edible inventory item detected'};
  if(['dragon_run','netherite_dragon_run','dragon_then_netherite_run'].includes(goal) && world.hunger<=9 && (inv.food||0)===0)return {kind:'obtain_food',why:'Obtain safe food before autonomous survival progression'};
  if(closest?.name==='creeper' && closest.distance<=7)return {kind:'retreat',why:'Avoid nearby creeper explosion'};
  if(goal==='survive' && world.hunger<=7 && (inv.food||0)===0)
    return {kind:'blocked',why:'Critically hungry with no edible supplies; autonomous food procurement not implemented'};
  if(closest?.distance<=6 && world.health>=12 && ['guard','survive'].includes(goal)) {
    if(closest.name==='creeper')return {kind:'retreat',why:'Creeper explosion risk'};
    return {kind:'defend',why:'Hostile within defensive range',targetId:closest.id};
  }
  // An owner can give ONE high-level instruction to play together. This
  // mission remains alive until stopped; it chooses and verifies its own
  // survival, crafting and movement actions instead of requiring commands.
  if(goal==='companion') {
    if(closest?.distance<=6 && world.health>=12 && closest.name!=='creeper')
      return {kind:'defend',why:'Defend against observed hostile',targetId:closest.id};
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
  if(goal==='wood') {
    if(inv.logs>=4)return {kind:'complete',why:'Four logs verified in inventory'};
    return failures.collect_wood>=3?{kind:'blocked',why:'Wood unavailable after three attempts'}:{kind:'collect_wood',why:'Need four logs'};
  }
  if(goal==='dragon_run' || goal==='netherite_dragon_run' || goal==='dragon_then_netherite_run'){
    if((world.dimension && !String(world.dimension).includes('overworld')) || progress.milestones?.netherPortalBuilt)
      return lateGamePlan(world,{...progress,goal});
  }
  if(goal==='stone_age' || goal==='iron_age' || goal==='dragon_run' || goal==='netherite_dragon_run' || goal==='dragon_then_netherite_run') {
    if(inv.stonePickaxe && inv.stoneSword) {
      if(goal==='stone_age')return {kind:'complete',why:'Stone pickaxe and stone sword verified in inventory'};
      if(inv.ironPickaxe){
        if(goal==='iron_age')return {kind:'complete',why:'Iron pickaxe verified in inventory'};
        if(inv.diamondPickaxe && inv.diamondSword && inv.diamondHelmet && inv.diamondChestplate && inv.diamondLeggings && inv.diamondBoots)
          return lateGamePlan(world,{...progress,goal});
        // Total: pickaxe 3, sword 2, helmet 5, chestplate 8, leggings 7, boots 4 = 29 diamonds.
        const gear=[['diamond_pickaxe','diamondPickaxe',3],['diamond_sword','diamondSword',2],['diamond_chestplate','diamondChestplate',8],['diamond_leggings','diamondLeggings',7],['diamond_helmet','diamondHelmet',5],['diamond_boots','diamondBoots',4]];
        for(const [name,key,cost] of gear){
          if(inv[key])continue;
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
       if(!inv.ironPickaxe && !inv.rawIron && inv.ironIngot<3){
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
    if(!world.ownerVisible)return {kind:'wait',why:'Owner not visible; exploration stays nearby'};
    if(world.ownerDistance>20)return {kind:'follow',range:5,why:'Stay within 20 blocks of owner'};
    return {kind:'explore',why:'Survey a safe waypoint near owner',index:number(progress.steps)};
  }
  return {kind:'idle',why:'No plan'};
}
function createController({clock=()=>Date.now(),maxSeconds=600,maxSteps=120}={}) {
  let state={milestones:{},goal:null,status:'idle',since:0,deadline:0,steps:0,successes:0,failures:{},lastDecision:null,lastResult:null,why:null};
  function start(goal,seconds=300){
    if(!GOALS.has(goal))throw Error('Unsupported autonomous gameplay goal');
    if(!Number.isInteger(seconds)||seconds<10||seconds>maxSeconds)throw Error('Duration out of bounds');
    const t=clock();state={milestones:{},goal,status:'running',since:t,deadline:t+seconds*1000,steps:0,successes:0,failures:{},lastDecision:null,lastResult:null,why:null};return status();
  }
  function stop(why='Owner paused autonomous gameplay'){state.status='paused';state.why=why;return status();}
  // A long-running owner-authorized mission may continue in bounded 6-hour
  // windows. This is NOT a completion, and never resumes a blocked, cancelled,
  // or owner-paused task. The next decision is recomputed from live world state.
  function renewMission(seconds=21600){
    if(state.status!=='expired' || !['netherite_dragon_run','dragon_then_netherite_run','dragon_run','companion'].includes(state.goal))return false;
    if(!Number.isInteger(seconds)||seconds<10||seconds>maxSeconds)return false;
    const t=clock();
    state.status='running';state.deadline=t+seconds*1000;state.steps=0;
    state.failures={};state.why='Continued authorized gameplay; goal not yet complete';
    state.lastDecision=null;state.lastResult=null;
    return true;
  }
  function resumeAfterRespawn(){
    if(state.status!=='paused'||!GOALS.has(state.goal)||clock()>=state.deadline)return false;
    state.status='running';state.why='Restarted after respawn; no inventory or completion proof assumed';
    state.failures={};state.milestones={};state.steps=0;state.lastDecision=null;state.lastResult=null;
    return true;
  }
  function status(){return JSON.parse(JSON.stringify(state));}
  function next(world){
    if(state.status!=='running')return {kind:'idle',why:'Automation not running'};
    if(clock()>=state.deadline||state.steps>=maxSteps){state.status='expired';state.why='Goal time/step budget exhausted';return {kind:'idle',why:state.why};}
    const d=decide(state.goal,world,state.failures,state);state.lastDecision=d;
    if(d.kind==='complete'){state.status='complete';state.why=d.why;}
    if(d.kind==='blocked'){state.status='blocked';state.why=d.why;}
    if(!['wait','idle','complete','blocked'].includes(d.kind))state.steps++;
    return d;
  }
  function record(decision, outcome){
    if(state.status!=='running' || !decision)return;
    const ok=outcome?.ok===true && outcome?.verified===true;
    if(ok){state.successes++;
      if(outcome.proof==='nether_portal')state.milestones.netherPortalBuilt=true;
      if(outcome.proof==='dragon_seen')state.milestones.dragonSeen=true;
      // A portal observation alone never proves a dragon death. The combined
      // victory proof is emitted only by the live skill after seeing the dragon,
      // observing its entityDead event and finding an End exit portal.
      if((decision.kind==='fight_dragon' && outcome.proof==='dragon_death' && state.milestones.dragonSeen===true) ||
         (decision.kind==='verify_dragon' && outcome.proof==='dragon_victory' && state.milestones.dragonSeen===true))
        state.milestones.dragonKilled=true;
      if(outcome.proof==='end_exit_portal' ||
         (decision.kind==='verify_dragon' && outcome.proof==='dragon_victory'))
        state.milestones.exitPortalObserved=true;
      if(decision.kind==='track_stronghold')state.milestones.strongholdSearchStarted=true;
      if(outcome.proof==='netherite_equipped')state.milestones.netheriteEquipped=true;
      if(decision.kind==='survey_ore'){state.failures[decision.ore==='iron'?'mine_iron':'mine_diamond']=0;}}
    else state.failures[decision.kind]=(state.failures[decision.kind]||0)+1;
    state.lastResult={kind:decision.kind,verified:ok,detail:String(outcome?.detail||'unverified').slice(0,140)};
    if(!ok && !['mine_iron','mine_diamond','mine_obsidian','mine_ancient_debris','hunt_blazes','hunt_endermen','track_stronghold','search_dragon','collect_flint','collect_gold','loot_bastion_template','prepare_archery','obtain_food','mine_netherrack','survey_ore'].includes(decision.kind) && (state.failures[decision.kind]||0)>=3){
      state.status='blocked';state.why='Repeated unverified or failing action: '+decision.kind;
    }
  }
  return {start,stop,renewMission,resumeAfterRespawn,status,next,record};
}
module.exports={GOALS,HOSTILES,FOOD,digest,decide,createController,itemsFrom,resolveOwnerEntity};
