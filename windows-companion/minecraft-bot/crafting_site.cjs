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
const NATURAL_DIGGABLE=new Set(['stone','cobblestone','dirt','grass_block',
 'coarse_dirt','rooted_dirt','gravel','sand','granite','andesite',
 'diorite','tuff','deepslate','cobbled_deepslate']);
function findCarvableCraftingAlcove(bot){
 const p=bot?.entity?.position;
 if(!p||typeof bot?.blockAt!=='function'||typeof bot?.canDigBlock!=='function')return null;
 const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z);
 // Adjacent cells only. Never hollow the block supporting the bot itself.
 for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const target=new Vec3(x+dx,y,z+dz);
   const ground=bot.blockAt(target.offset(0,-1,0));
   const legs=bot.blockAt(target),head=bot.blockAt(target.offset(0,1,0));
   if(!ground||ground.boundingBox!=='block'||UNSAFE.test(ground.name)||
      !legs||!head || UNSAFE.test(legs.name+' '+head.name))continue;
   const around=[target.offset(1,0,0),target.offset(-1,0,0),
     target.offset(0,0,1),target.offset(0,0,-1),
     target.offset(0,1,0)];
   if(around.some(pos=>{const b=bot.blockAt(pos);return !b||UNSAFE.test(b.name||'')}))continue;
   const blocks=[head,legs].filter(b=>b.boundingBox!=='empty');
   if(!blocks.length)continue;
   if(!blocks.every(b=>NATURAL_DIGGABLE.has(b.name)&&bot.canDigBlock(b)))continue;
   return {target,blocks:blocks.map(b=>b.position.clone())};
 }
 return null;
}
module.exports={findCraftingSite,findCarvableCraftingAlcove};
