'use strict';
// Read-only geometry checks for bounded, owner-authorized Minecraft digging.
// This does not move the bot, dig, or imply that Pathfinder can reach a stance.
const {Vec3}=require('vec3');
const HAZARD=/(?:lava|water|fire|campfire|magma|cactus|powder_snow|sweet_berry_bush)/;
const MINABLE_STONE = new Set(['stone','cobblestone','deepslate','cobbled_deepslate']);
const OFFSETS = Object.freeze([
  [1,0],[-1,0],[0,1],[0,-1],
  [1,1],[-1,1],[1,-1],[-1,-1],
  [2,0],[-2,0],[0,2],[0,-2],
]);
function valid(p){return !!p && [p.x,p.y,p.z].every(n=>Number.isInteger(n));}
function air(b){return !!b && b.boundingBox==='empty' && !HAZARD.test(String(b.name||''));}
function floor(b){return !!b && b.boundingBox==='block' && !HAZARD.test(String(b.name||''));}
function at(bot,x,y,z){
 try{return bot.blockAt(new Vec3(x,y,z));}catch{return null;}
}
function stances(bot, target, {max=8,maxVertical=3}={}){
 if(!bot?.entity?.position||typeof bot.blockAt!=='function'||!valid(target))return [];
 const origin=bot.entity.position;
 const out=[],seen=new Set();
 for(const dy of [0,1,2,-1]){
  const y=target.y+dy;
  if(Math.abs(y-Math.floor(origin.y))>maxVertical)continue;
  for(const [dx,dz] of OFFSETS){
   const x=target.x+dx,z=target.z+dz;
   const key=`${x},${y},${z}`;
   if(seen.has(key))continue;
   const center={x:x+.5,y:y+1.62,z:z+.5};
   const blockCenter={x:target.x+.5,y:target.y+.5,z:target.z+.5};
   const reach=Math.hypot(center.x-blockCenter.x,center.y-blockCenter.y,center.z-blockCenter.z);
   if(reach>4.3)continue;
   if(!air(at(bot,x,y,z))||!air(at(bot,x,y+1,z))||!floor(at(bot,x,y-1,z)))continue;
   seen.add(key);
   out.push({x,y,z,distance:Math.hypot(x+.5-origin.x,y-origin.y,z+.5-origin.z),reach});
  }
 }
 // Prefer same-level, nearby standable positions. Pathfinder still independently verifies arrival.
 return out.sort((a,b)=>a.distance-b.distance||a.reach-b.reach).slice(0,max);
}
function isExposed(bot,p){
 if(!valid(p))return false;
 for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]){
  if(air(at(bot,p.x+dx,p.y+dy,p.z+dz)))return true;
 }
 return false;
}
function diggableObserved(bot,position,block){
 return !!block && MINABLE_STONE.has(block.name) && isExposed(bot,position) && stances(bot,position).length>0;
}

/** Read-only path proof: a standable block is NOT necessarily reachable.
 * Only accept a fully solved GoalBlock route. Partial/timeout/noPath is never
 * evidence of reachability. Limit computation to four candidate stances and
 * <=100ms of Pathfinder thought each to avoid stalling packet processing.
 * The goal factory is supplied by the already-loaded companion (no new deps).
 */
function reachableStances(bot,target,goalBlock,{maxCandidates=4,routeTimeoutMs=90}={}){
 const out=[];
 if(typeof goalBlock!=='function' || !bot?.pathfinder?.movements ||
    typeof bot.pathfinder.getPathTo!=='function')return out;
 const origin=bot.entity?.position;
 if(!origin)return out;
 for(const stance of stances(bot,target,{max:Math.min(8,maxCandidates)})){
   // Mineflayer reports player feet at this integer block. Already there is
   // independent route proof, as long as geometry was confirmed by stances().
   if(Math.floor(origin.x)===stance.x && Math.floor(origin.y)===stance.y && Math.floor(origin.z)===stance.z){
     out.push({...stance,route:'already_there'});continue;
   }
   try{
     const route=bot.pathfinder.getPathTo(bot.pathfinder.movements,
       new goalBlock(stance.x,stance.y,stance.z),Math.max(20,Math.min(100,routeTimeoutMs)));
     if(route?.status==='success' && Array.isArray(route.path)){
       out.push({...stance,route:'success'});
     }
   }catch{ /* A thrown or inconclusive route is never proof. */ }
 }
 return out;
}

function rawCount(bot,item){
 return (bot?.inventory?.items?.()||[]).filter(x=>x?.name===item).reduce((n,x)=>n+(Number(x.count)||0),0);
}
module.exports={stances,reachableStances,isExposed,diggableObserved,rawCount,MINABLE_STONE};
