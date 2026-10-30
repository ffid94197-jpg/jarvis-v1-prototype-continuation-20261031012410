'use strict';
/** Select an actually exposed, conservatively approachable ore face.
 * Loaded/chunk-known blocks alone are not proof of an accessible deposit.
 * Returns only a proposed stance; successful movement and digging still
 * require authoritative Mineflayer observations.
 */
const AIR=new Set(['air','cave_air']);
const DANGER=new Set(['lava','water','flowing_lava','flowing_water','fire','magma_block','campfire','soul_campfire']);
const SIDES=[[1,0],[-1,0],[0,1],[0,-1]];
const loc=(p,dx,dy,dz)=>typeof p.offset==='function' ? p.offset(dx,dy,dz) : ({x:p.x+dx,y:p.y+dy,z:p.z+dz});
const at=(bot,p)=>bot.blockAt(p);
function stanceFor(bot,position){
  if(!position||typeof bot?.blockAt!=='function')return null;
  // Side-face mining, then a safe top-face position *beside* a floor ore.
  // Never stand directly on a floor ore while digging it (fall hazard).
  for(const dy of [0,1]){
    if(dy===1 && !AIR.has(at(bot,loc(position,0,1,0))?.name))continue;
    for(const [dx,dz] of SIDES){
      const foot=loc(position,dx,dy,dz),head=loc(foot,0,1,0),floor=loc(foot,0,-1,0);
      const feetBlock=at(bot,foot),headBlock=at(bot,head),floorBlock=at(bot,floor);
      if(!feetBlock||!headBlock||!floorBlock)continue;
      if(!AIR.has(feetBlock.name)||!AIR.has(headBlock.name))continue;
      if(floorBlock.boundingBox==='empty'||AIR.has(floorBlock.name)||DANGER.has(floorBlock.name))continue;
      const neighborHazard=SIDES.some(([ox,oz])=>DANGER.has(at(bot,loc(foot,ox,0,oz))?.name));
      if(neighborHazard)continue;
      return foot;
    }
  }
  return null;
}
function findExposedOre(bot,names,range=26){
  if(!bot||!Array.isArray(names)||!names.length)return null;
  let candidates=[];
  if(typeof bot.findBlocks==='function'){
    const positions=bot.findBlocks({matching:b=>!!b&&names.includes(b.name),maxDistance:range,count:64})||[];
    candidates=positions.map(p=>bot.blockAt(p)).filter(Boolean);
  }else if(typeof bot.findBlock==='function'){
    const closest=bot.findBlock({matching:b=>!!b&&names.includes(b.name),maxDistance:range});
    if(closest)candidates=[closest];
  }
  for(const block of candidates){
    if(!names.includes(block.name)||!block.position)continue;
    const stance=stanceFor(bot,block.position);
    if(stance)return {block,stance};
  }
  return null;
}
module.exports={stanceFor,findExposedOre};
