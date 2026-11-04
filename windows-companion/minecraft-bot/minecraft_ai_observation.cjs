'use strict';
/** Read-only compact game facts for LAYA-guided Minecraft decisions.
 * No model calls, network effects or game mutations. Derives solely from a
 * Mineflayer digest and optional loaded block positions.
 */
const INTERACTIVE=/^(?:chest|trapped_chest|barrel|lever|[a-z_]+_door|[a-z_]+_trapdoor|[a-z_]+_button|crafting_table|furnace|smithing_table|enchanting_table)$/;
const INTERESTING=/^(?:[a-z_]+_log|stone|cobblestone|deepslate|cobbled_deepslate|(?:deepslate_)?(?:iron|diamond|gold|copper|coal|redstone|lapis|emerald)_ore|ancient_debris|nether_gold_ore|nether_quartz_ore|crafting_table|furnace|smithing_table|enchanting_table|chest|trapped_chest|barrel|lever|[a-z_]+_door|[a-z_]+_trapdoor|[a-z_]+_button|nether_portal|end_portal_frame)$/;
// Small, deliberately bounded sample of everyday loaded blocks for
// general-purpose Minecraft tasks. Never mine blindly or infer world terrain.
const GENERAL=/^(?:dirt|grass_block|sand|red_sand|gravel|clay|netherrack|mud|coarse_dirt|rooted_dirt|snow|snow_block|cobblestone|[a-z_]+_planks|[a-z_]+_wool|[a-z_]+_log)$/;
const {diggableObserved,MINABLE_STONE,isExposed,stances}=require('./mining_navigation.cjs');
const ORES=/^(?:(?:deepslate_)?(?:iron|diamond|gold|copper|coal|redstone|lapis|emerald)_ore|ancient_debris|nether_gold_ore|nether_quartz_ore)$/;
// Preserve completion-relevant items when the compact ACK must trim inventory.
const CRITICAL_ITEMS=['cobblestone','diamond','iron_ingot','raw_iron','obsidian','flint',
 'netherrack','wooden_pickaxe','stone_pickaxe','iron_pickaxe','netherite_sword',
 'oak_log','spruce_log','birch_log','dark_oak_log','jungle_log','cherry_log'];
const itemRank=new Map(CRITICAL_ITEMS.map((n,i)=>[n,i]));
function loadedTargets(bot,{includeGeneral=false}={}){
  if(typeof bot?.findBlocks!=='function'||typeof bot?.blockAt!=='function')return [];
  let coords=[],general=[];
  try{coords=bot.findBlocks({matching:b=>!!b?.name&&INTERESTING.test(b.name),maxDistance:12,count:96})||[];}catch{return [];}
  if(includeGeneral){
    try{general=bot.findBlocks({matching:b=>!!b?.name&&GENERAL.test(b.name),
      maxDistance:10,count:48})||[];}catch{general=[];}
  }
  const p=bot.entity?.position;
  const arr=[];
  const seen=new Set();
  for(const x of [...coords,...general]){
    if(!x || ![x.x,x.y,x.z].every(Number.isFinite))continue;
    if(p && Math.max(Math.abs(x.x-p.x),Math.abs(x.y-p.y),Math.abs(x.z-p.z))>14)continue;
    try{const b=bot.blockAt(x);if(!b?.name||!(INTERESTING.test(b.name)||(includeGeneral&&GENERAL.test(b.name))))continue;
      const target={x:Math.floor(x.x),y:Math.floor(x.y),z:Math.floor(x.z)};
      const key=`${target.x},${target.y},${target.z}`;
      if(seen.has(key))continue;seen.add(key);
      // A buried ore in a loaded chunk is not an exposed mine target.
      // Reporting it as actionable causes the LLM to dispatch doomed digs.
      const accessible=MINABLE_STONE.has(b.name)?
        diggableObserved(bot,target,b): ORES.test(b.name)||GENERAL.test(b.name)?
        isExposed(bot,target)&&stances(bot,target).length>0:true;
      if(accessible)arr.push({name:b.name,...target});}catch{}
  }
  const ranked=arr.sort((a,b)=>Number(MINABLE_STONE.has(b.name))-Number(MINABLE_STONE.has(a.name)));
  if(!includeGeneral)return ranked.slice(0,12);
  // Preserve higher-value ore/stone context: a dirt-filled chunk must not
  // crowd every ore or workstation out of the observation.
  const primary=ranked.filter(b=>INTERESTING.test(b.name));
  const byPriority=[
    // Keep observed containers/doors visible to the same JARVIS planner.
    // Never infer a location or open a block from an unobserved name.
    ...primary.filter(b=>INTERACTIVE.test(b.name)).slice(0,3),
    ...primary.filter(b=>ORES.test(b.name)).slice(0,3),
    ...primary.filter(b=>MINABLE_STONE.has(b.name)).slice(0,2),
    ...primary.filter(b=>!INTERACTIVE.test(b.name)&&!ORES.test(b.name)&&!MINABLE_STONE.has(b.name))
  ];
  const core=byPriority.slice(0,8);
  const keys=new Set(core.map(b=>b.x+','+b.y+','+b.z));
  const extra=ranked.filter(b=>GENERAL.test(b.name)&&!keys.has(b.x+','+b.y+','+b.z)).slice(0,4);
  return [...core,...extra].slice(0,12);
}
function projectWorld(world,nearby=[],lastAction='',mode='stay'){
  if(!world || !world.position)throw Error('No observed Minecraft player position');
  const raw=world.inventory?.raw||{};
  const ordered=Object.entries(raw)
    .filter(([k,n])=>/^[a-z0-9_]{1,64}$/.test(k)&&Number.isFinite(n)&&n>0)
    .sort(([a],[b])=>(itemRank.get(a)??1000)-(itemRank.get(b)??1000))
    .slice(0,32);
  const slim={
    joined:world.joined===true,position:world.position,dimension:world.dimension,
    busy:['collect_wood','navigate','dig_block','come','auto'].includes(mode),
    health:world.health,hunger:world.hunger,
    ownerVisible:world.ownerVisible===true,ownerDistance:world.ownerDistance,
    inventory:{logs:world.inventory?.logs||0,woodenPickaxe:world.inventory?.woodenPickaxe||0,raw:Object.fromEntries(ordered)},
    wornNetherite:world.wornNetherite===true,heldNetheriteSword:world.heldNetheriteSword===true,
    dragonDeadObserved:world.dragonDeadObserved===true,
    exitPortalPresent:world.exitPortalPresent===true,dragonPresent:world.dragonPresent===true,
    threats:Array.isArray(world.threats)?world.threats.slice(0,2):[],
    villagers:Array.isArray(world.villagers)?world.villagers.slice(0,2):[],
    nearbyBlocks:Array.isArray(nearby)?nearby.slice(0,12):[],lastAction:String(lastAction).slice(0,100)
  };
  let result=JSON.stringify(slim);
  // Keep beneath companion transport's 1900-character ACK cap. NEVER cut JSON;
  // trim optional facts first so evidence remains well-formed.
  while(result.length>1750 && slim.nearbyBlocks.length){slim.nearbyBlocks.pop();result=JSON.stringify(slim);}
  while(result.length>1750 && ordered.length>8){ordered.pop();slim.inventory.raw=Object.fromEntries(ordered);result=JSON.stringify(slim);}
  if(result.length>1750){slim.villagers=[];result=JSON.stringify(slim);}
  if(result.length>1750){slim.threats=[];slim.lastAction='';result=JSON.stringify(slim);}
  if(result.length>1750)throw Error('Minecraft observation too large to attest');
  return result;
}
module.exports={loadedTargets,projectWorld};
