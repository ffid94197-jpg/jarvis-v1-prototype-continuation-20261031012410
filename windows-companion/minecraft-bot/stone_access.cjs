'use strict';
/**
 * Conservative source of real stone targets for empty-survival Java play.
 * Never infer accessibility from findBlock alone: it returns buried stone
 * for which Pathfinder has no path. All proposals are checked again against
 * actual server blocks before a dig; this module never moves or edits world.
 */
const {isExposed,reachableStances}=require('./mining_navigation.cjs');
const STONE=new Set(['stone','cobblestone']);
const SOIL=new Set(['grass_block','dirt','coarse_dirt','rooted_dirt','podzol','mycelium','gravel','sand']);
const DANGER=/lava|water|fire|magma|powder_snow|cactus/;
const OFFSETS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],
 [2,0],[-2,0],[0,2],[0,-2]];
const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function stoneProposal(bot,GoalBlock,{radius=15,maxCandidates=192}={}){
 const origin=bot?.entity?.position;
 if(!origin||!bot.findBlocks||!bot.blockAt)return null;
 const candidates=bot.findBlocks({matching:b=>!!b&&STONE.has(b.name),
   maxDistance:radius,count:maxCandidates})||[];
 for(const pos of candidates) {
   const b=bot.blockAt(pos);
   if(!b||!STONE.has(b.name)||!isExposed(bot,b.position)||
     !bot.canDigBlock?.(b))continue;
   // Already in physical interaction range: no A* route needed.
   if(near(origin,{x:pos.x+.5,y:pos.y+.5,z:pos.z+.5})<=4.25)
     return {position:b.position,stance:null,reason:'direct_reach'};
   const stances=reachableStances(bot,b.position,GoalBlock,
     {maxCandidates:2,routeTimeoutMs:90});
   if(stances.length)return {position:b.position,stance:stances[0],reason:'route_proved'};
 }
 return null;
}
function excavationProposal(bot) {
 const pos=bot?.entity?.position;
 if(!pos||!bot.blockAt||!bot.canDigBlock)return null;
 const x=Math.floor(pos.x),y=Math.floor(pos.y),z=Math.floor(pos.z);
 // Only excavate adjacent topsoil; never mine under the bot's own feet.
 // Up to three levels down are within the player interaction envelope.
 for(const dy of [-1,-2,-3]){
   for(const [dx,dz] of OFFSETS){
     const p={x:x+dx,y:y+dy,z:z+dz};
     const block=bot.blockAt(p);
     if(!block||!SOIL.has(block.name)||!bot.canDigBlock(block))continue;
     if(near(pos,{x:p.x+.5,y:p.y+.5,z:p.z+.5})>4.15)continue;
     const above=bot.blockAt({x:p.x,y:p.y+1,z:p.z});
     const below=bot.blockAt({x:p.x,y:p.y-1,z:p.z});
     // For the surface, air is already exposed. At deeper levels the same
     // column must have been opened by previous verified excavation.
     if(!above||above.boundingBox!=='empty'||!below||
       DANGER.test(above.name)||DANGER.test(below.name))continue;
     return {position:block.position,reason:'safe_adjacent_soil',
       potentialStone:STONE.has(below.name)};
   }
 }
 return null;
}
module.exports={stoneProposal,excavationProposal};
