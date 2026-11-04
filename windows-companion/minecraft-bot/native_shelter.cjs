'use strict';
/**
 * Pick a *physically observed* local footprint for the one-instruction
 * 3x3x2 cobblestone shelter. No world edit, player-input synthesis, arbitrary
 * script execution, creative blocks, or guessed/unloaded coordinates.
 *
 * Selection is not proof of construction. Every required floor, doorway-wall
 * and roof block still passes the existing build_volume planner, Guardian
 * boundary and server block + survival item-consumption receipt.
 */
const {roofedRoomSteps}=require('./structure_goal.cjs');
const HAZARD=/lava|water|fire|magma|cactus|powder_snow|campfire|berry_bush/;
const HOSTILES=new Set(['zombie','husk','drowned','skeleton','stray','spider',
 'cave_spider','witch','pillager','blaze','endermite','silverfish','slime',
 'magma_cube','zoglin','hoglin','phantom','wither_skeleton',
 'creeper','wither','ender_dragon','piglin_brute','ghast']);
const OFFSETS=[[2,0],[0,2],[-4,0],[0,-4],[2,-2],[-4,-2],[-2,2],[2,2]];
function chooseNativeShelterSite(bot,Vec3){
 const origin=bot?.entity?.position;
 if(!origin||typeof bot.blockAt!=='function'||typeof Vec3!=='function'||
    ![origin.x,origin.y,origin.z].every(Number.isFinite))return null;
 const x=Math.floor(origin.x),y=Math.floor(origin.y),z=Math.floor(origin.z);
 if(y < -60 || y > 314 || Math.abs(x)>29999980 || Math.abs(z)>29999980)return null;
 const threats=Object.values(bot.entities||{}).filter(e=>
  HOSTILES.has(e?.name) && e.position &&
  [e.position.x,e.position.y,e.position.z].every(Number.isFinite));
 for(const [dx,dz] of OFFSETS){
  const p={x:x+dx,y,z:z+dz};
  if(Math.hypot(p.x-origin.x,p.y-origin.y,p.z-origin.z)>4.5)continue;
  const steps=roofedRoomSteps({position:p,block:'cobblestone',width:3,depth:3,wallHeight:2});
  if(!steps)continue;
  let safe=true;
  for(let rx=0;rx<3 && safe;rx++)for(let rz=0;rz<3 && safe;rz++){
   const wx=p.x+rx,wz=p.z+rz;
   // Require actual stable ground and an unoccupied, nonhazardous future
   // structure envelope. Do not move or replace an owner/player's blocks.
   const ground=bot.blockAt(new Vec3(wx,y-1,wz));
   if(!ground||ground.boundingBox!=='block'||HAZARD.test(String(ground.name||''))){
    safe=false;break;
   }
   for(let dy=0;dy<=3;dy++){
    const at=bot.blockAt(new Vec3(wx,y+dy,wz));
    if(!at || at.boundingBox!=='empty' || HAZARD.test(String(at.name||''))){
     safe=false;break;
    }
   }
   if(threats.some(e=>Math.hypot(e.position.x-(wx+.5),
      e.position.y-(y+1),e.position.z-(wz+.5))<9))safe=false;
  }
  if(safe)return {position:p,block:'cobblestone',width:3,depth:3,
    wallHeight:2,steps};
 }
 return null;
}
module.exports={chooseNativeShelterSite};
