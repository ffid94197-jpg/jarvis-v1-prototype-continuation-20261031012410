'use strict';
/**
 * Read-only vanilla Java crafting table placement search.
 * Minecraft player feet are not necessarily centered at an integer
 * block position. Select safe nearby air above solid ground; NEVER choose
 * water, lava, occupied blocks, dangerous plants or out-of-reach targets.
 * Does not place blocks or claim that any placement succeeded.
 */
const {Vec3}=require('vec3');
const UNSAFE=/(?:lava|water|fire|magma|cactus|powder_snow|campfire)/;
const REPLACEABLE=new Set(['air','cave_air','void_air','short_grass','fern','dead_bush']);
const COORDS=[
 [1,0],[-1,0],[0,1],[0,-1],
 [1,1],[-1,1],[1,-1],[-1,-1],
 [2,0],[-2,0],[0,2],[0,-2],
 [2,1],[2,-1],[-2,1],[-2,-1],
 [1,2],[1,-2],[-1,2],[-1,-2],
 [2,2],[2,-2],[-2,2],[-2,-2],
 [3,0],[-3,0],[0,3],[0,-3]
];
function findCraftingSite(bot,{maxReach=4.2}={}){
 const p=bot?.entity?.position;
 if(!p||typeof bot.blockAt!=='function')return null;
 const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z);
 for(const dy of [0,-1,1,-2,2]){
  for(const [dx,dz] of COORDS){
   const target=new Vec3(x+dx,y+dy,z+dz);
   const ground=bot.blockAt(target.offset(0,-1,0));
   const legs=bot.blockAt(target),head=bot.blockAt(target.offset(0,1,0));
   if(!ground || ground.boundingBox!=='block' || UNSAFE.test(ground.name||'') ||
      !legs || !head || legs.boundingBox!=='empty' ||
      head.boundingBox!=='empty' || !REPLACEABLE.has(legs.name) ||
      UNSAFE.test(head.name||''))continue;
   const center=target.offset(.5,.5,.5);
   const distance=p.distanceTo(center);
   if(distance>maxReach)continue;
   return {ground:ground.position.clone(),target,distance};
  }
 }
 return null;
}
module.exports={findCraftingSite};
