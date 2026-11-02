'use strict';
/*
 * Vanilla 4x5 Nether frame geometry, read-only and fail-closed.
 * This finds *only* loaded, observed natural space with stable floor and
 * never alters world blocks or assumes a successful portal activation.
 */
const AIR=new Set(['air','cave_air','void_air']);
const HAZARD=/(?:lava|water|magma|fire|powder_snow|cactus|campfire)/;
const AXES=Object.freeze([{x:1,z:0},{x:0,z:1}]);
const OFFSETS=Object.freeze([[3,0],[-6,0],[0,3],[0,-6],
 [4,4],[-7,4],[4,-7],[-7,-7],[7,0],[0,7],[-10,0],[0,-10]]);
function pos(base,axis,x,y){return base.offset(axis.x*x,y,axis.z*x);}
function isClear(bot,base,axis){
 for(let x=0;x<=3;x++){
  const ground=bot.blockAt(pos(base,axis,x,-1));
  if(!ground||ground.boundingBox!=='block'||HAZARD.test(ground.name||''))
    return false;
  for(let y=0;y<=4;y++){
   const open=bot.blockAt(pos(base,axis,x,y));
   if(!open||!AIR.has(open.name))return false;
  }
 }
 // An unloaded/unsafe portal center is never an authorization to build.
 const center=bot.blockAt(pos(base,axis,1,1));
 return !!center&&AIR.has(center.name);
}
function findPortalLayout(bot,origin,Vec3){
 if(!bot||typeof bot.blockAt!=='function'||
    !origin||typeof Vec3!=='function')return null;
 const bx=Math.floor(origin.x),by=Math.floor(origin.y),bz=Math.floor(origin.z);
 for(const dy of [0,1,-1,2,-2]){
  for(const [dx,dz] of OFFSETS){
   for(const axis of AXES){
    const base=new Vec3(bx+dx,by+dy,bz+dz);
    if(isClear(bot,base,axis))
      return {base,axis,position:(x,y)=>pos(base,axis,x,y),
        portalInterior:pos(base,axis,1,1)};
   }
  }
 }
 return null;
}
module.exports={findPortalLayout,isClear,pos};
