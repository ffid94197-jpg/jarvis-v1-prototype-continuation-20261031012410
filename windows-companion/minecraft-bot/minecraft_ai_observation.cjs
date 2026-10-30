'use strict';
/** Read-only compact game facts for LAYA-guided Minecraft decisions.
 * No model calls, network effects or game mutations. Derives solely from a
 * Mineflayer digest and optional loaded block positions.
 */
const INTERESTING=/^(?:[a-z_]+_log|stone|cobblestone|deepslate|cobbled_deepslate|iron_ore|deepslate_iron_ore|diamond_ore|deepslate_diamond_ore|crafting_table|furnace|smithing_table|nether_portal|end_portal_frame)$/;
const {diggableObserved,MINABLE_STONE}=require('./mining_navigation.cjs');
function loadedTargets(bot){
  if(typeof bot?.findBlocks!=='function'||typeof bot?.blockAt!=='function')return [];
  let coords=[];
  try{coords=bot.findBlocks({matching:b=>!!b?.name&&INTERESTING.test(b.name),maxDistance:12,count:96})||[];}catch{return [];}
  const p=bot.entity?.position;
  const arr=[];
  for(const x of coords){
    if(!x || ![x.x,x.y,x.z].every(Number.isFinite))continue;
    if(p && Math.max(Math.abs(x.x-p.x),Math.abs(x.y-p.y),Math.abs(x.z-p.z))>14)continue;
    try{const b=bot.blockAt(x);if(b?.name&&INTERESTING.test(b.name) && (!MINABLE_STONE.has(b.name) || diggableObserved(bot,{x:Math.floor(x.x),y:Math.floor(x.y),z:Math.floor(x.z)},b)))arr.push({name:b.name,x:Math.floor(x.x),y:Math.floor(x.y),z:Math.floor(x.z)});}catch{}
  }
  return arr.sort((a,b)=>Number(MINABLE_STONE.has(b.name))-Number(MINABLE_STONE.has(a.name))).slice(0,12);
}
function projectWorld(world,nearby=[],lastAction='',mode='stay'){
  if(!world || !world.position)throw Error('No observed Minecraft player position');
  const raw=world.inventory?.raw||{};
  const ordered=Object.entries(raw).filter(([k,n])=>/^[a-z0-9_]{1,64}$/.test(k)&&Number.isFinite(n)&&n>0).slice(0,32);
  const slim={
    joined:world.joined===true,position:world.position,dimension:world.dimension,
    busy:['collect_wood','navigate','dig_block','come','auto'].includes(mode),
    health:world.health,hunger:world.hunger,
    ownerVisible:world.ownerVisible===true,ownerDistance:world.ownerDistance,
    inventory:{logs:world.inventory?.logs||0,woodenPickaxe:world.inventory?.woodenPickaxe||0,raw:Object.fromEntries(ordered)},
    wornNetherite:world.wornNetherite===true,dragonDeadObserved:world.dragonDeadObserved===true,
    exitPortalPresent:world.exitPortalPresent===true,dragonPresent:world.dragonPresent===true,
    threats:Array.isArray(world.threats)?world.threats.slice(0,2):[],
    nearbyBlocks:Array.isArray(nearby)?nearby.slice(0,12):[],lastAction:String(lastAction).slice(0,100)
  };
  let result=JSON.stringify(slim);
  // Keep beneath companion transport's 1900-character ACK cap. NEVER cut JSON;
  // trim optional facts first so evidence remains well-formed.
  while(result.length>1750 && slim.nearbyBlocks.length){slim.nearbyBlocks.pop();result=JSON.stringify(slim);}
  while(result.length>1750 && ordered.length>8){ordered.pop();slim.inventory.raw=Object.fromEntries(ordered);result=JSON.stringify(slim);}
  if(result.length>1750){slim.threats=[];slim.lastAction='';result=JSON.stringify(slim);}
  if(result.length>1750)throw Error('Minecraft observation too large to attest');
  return result;
}
module.exports={loadedTargets,projectWorld};
