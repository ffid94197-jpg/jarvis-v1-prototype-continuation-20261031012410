'use strict';
/** Safe finite in-world construction: only blocks the owner already owns or
 * verified cobblestone gathered through the normal survival progression.
 * No commands, creative inventory, arbitrary mining or remote build sites.
 */
const BLOCKS=new Set(['cobblestone','dirt','oak_planks','spruce_planks',
 'birch_planks','stone_bricks','netherrack']);
const AXES=Object.freeze({'x+':[1,0],'x-':[-1,0],
 'z+':[0,1],'z-':[0,-1]});
const DANGER=/lava|water|fire|magma|cactus|powder_snow|campfire/;
function validBuildSpec(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||
    Object.keys(s).some(k=>!['goal','position','length','axis','block'].includes(k))||
    !BLOCKS.has(s.block)||!Object.hasOwn(AXES,s.axis)||
    !Number.isInteger(s.length)||s.length<1||s.length>8)return false;
 const p=s.position;
 if(!p||typeof p!=='object'||Array.isArray(p)||
    Object.keys(p).some(k=>!['x','y','z'].includes(k))||
    !['x','y','z'].every(k=>Number.isInteger(p[k])))return false;
 const [dx,dz]=AXES[s.axis];
 const endX=p.x+dx*(s.length-1),endZ=p.z+dz*(s.length-1);
 return p.y>=-62&&p.y<=318&&
   [p.x,p.z,endX,endZ].every(n=>Math.abs(n)<=29999984);
}
function buildPositions(spec){
 if(!validBuildSpec(spec))throw Error('Invalid bounded construction goal');
 const [dx,dz]=AXES[spec.axis];
 return Array.from({length:spec.length},(_,i)=>({
   x:spec.position.x+dx*i,y:spec.position.y,z:spec.position.z+dz*i
 }));
}
function observeBuild(bot,spec,Vec3){
 if(!validBuildSpec(spec)||!bot?.entity?.position||!bot.blockAt||!Vec3)return null;
 return buildPositions(spec).map(position=>{
   const p=new Vec3(position.x,position.y,position.z);
   const block=bot.blockAt(p),below=bot.blockAt(p.offset(0,-1,0));
   let state='unloaded';
   if(block&&below){
     if(block.name===spec.block)state='matched';
     else if(block.boundingBox!=='empty'||DANGER.test(block.name))state='blocked';
     else if(below.boundingBox!=='block'||DANGER.test(below.name))state='unsupported';
     else state='ready';
   }
   return {position,state};
 });
}
function buildPlan(world,progress={},delegate){
 if(!validBuildSpec(progress))return {kind:'blocked',why:'Invalid owner-authorized construction goal'};
 const cells=world?.buildCells;
 if(!Array.isArray(cells)||cells.length!==progress.length)
   return {kind:'blocked',why:'Missing server-observed construction cell states'};
 const targets=buildPositions(progress);
 for(let i=0;i<cells.length;i++){
   const c=cells[i],p=targets[i];
   if(!c||!c.position||!['x','y','z'].every(k=>c.position[k]===p[k]) ||
      !['matched','ready','blocked','unsupported','unloaded'].includes(c.state))
     return {kind:'blocked',why:'Invalid construction observation'};
   if(c.state==='matched')continue;
   if(c.state!=='ready')return {kind:'blocked',why:'Target '+i+' is '+c.state+'; never overwrite existing world'};
   if((world.inventory?.raw?.[progress.block]||0)>=1)
     return {kind:'place_build_block',block:progress.block,position:p,
       why:'Place one owner-authorized block; verify real block change and material consumption'};
   if(progress.block==='cobblestone'&&typeof delegate==='function'){
     const sub=delegate('gather',{resource:'cobblestone',targetCount:1});
     if(sub?.kind&&sub.kind!=='complete')return sub;
   }
   return {kind:'blocked',why:'No verified '+progress.block+' inventory; cannot fabricate building material'};
 }
 return {kind:'complete',why:'All '+cells.length+' requested blocks observed in live Minecraft world'};
}
/**
 * Geometry-only finite build. Uses the exact same owner-owned survival
 * material policy, loaded-cell observations and block-placement receipts
 * as existing line builds. Floors, open walls and solids are not "houses":
 * roofs, doors and decorations require separately authorized goals.
 */
const VOLUME_SHAPES=new Set(['floor','walls','solid']);
function validVolumeSpec(spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||
    Object.keys(spec).some(k=>!['goal','position','block','width','depth','height','shape'].includes(k))||
    spec.goal!=='build_volume'||!BLOCKS.has(spec.block)||!VOLUME_SHAPES.has(spec.shape)||
    !Number.isInteger(spec.width)||spec.width<1||spec.width>5||
    !Number.isInteger(spec.depth)||spec.depth<1||spec.depth>5||
    !Number.isInteger(spec.height)||spec.height<1||spec.height>3||
    spec.width*spec.depth*spec.height>64||
    (spec.shape==='floor'&&spec.height!==1))return false;
 const p=spec.position;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==3||
    !['x','y','z'].every(k=>Number.isInteger(p[k])))return false;
 return p.y>=-62 && p.y+spec.height<=319 &&
   [p.x,p.x+spec.width,p.z,p.z+spec.depth].every(n=>Math.abs(n)<=29999984);
}
function volumePositions(spec){
 if(!validVolumeSpec(spec))throw Error('Invalid owner-authorized bounded structure');
 const arr=[],p=spec.position;
 // Bottom-up ensures upper wall blocks have real verified support.
 for(let dy=0;dy<spec.height;dy++)
  for(let dz=0;dz<spec.depth;dz++)
   for(let dx=0;dx<spec.width;dx++){
    if(spec.shape==='walls' && dx!==0&&dz!==0&&
       dx!==spec.width-1&&dz!==spec.depth-1)continue;
    arr.push({x:p.x+dx,y:p.y+dy,z:p.z+dz});
   }
 return arr;
}
function observeVolume(bot,spec,Vec3){
 if(!validVolumeSpec(spec)||!bot?.entity?.position||!bot.blockAt||!Vec3)return null;
 return volumePositions(spec).map(position=>{
  const point=new Vec3(position.x,position.y,position.z);
  const block=bot.blockAt(point),floor=bot.blockAt(point.offset(0,-1,0));
  let state='unloaded';
  if(block&&floor){
   if(block.name===spec.block)state='matched';
   else if(block.boundingBox!=='empty'||DANGER.test(block.name))state='blocked';
   else if(floor.boundingBox!=='block'||DANGER.test(floor.name))state='unsupported';
   else state='ready';
  }
  return {position,state};
 });
}
function volumePlan(world,progress={},delegate){
 if(!validVolumeSpec(progress))
  return {kind:'blocked',why:'Invalid owner-authorized structure spec'};
 const positions=volumePositions(progress),observed=world?.buildVolumeCells;
 if(!Array.isArray(observed)||observed.length!==positions.length)
  return {kind:'blocked',why:'Structure cell state is not currently server-observed'};
 for(let i=0;i<positions.length;i++){
  const cell=observed[i],target=positions[i];
  if(!cell?.position||
     !['x','y','z'].every(k=>cell.position[k]===target[k])||
     !['matched','ready','blocked','unsupported','unloaded'].includes(cell.state))
   return {kind:'blocked',why:'Invalid or mismatched structure observation'};
  if(cell.state==='matched')continue;
  if(cell.state!=='ready')
   return {kind:'blocked',why:'Structure cell '+i+' is '+cell.state+'; do not overwrite or float blocks'};
  if((world.inventory?.raw?.[progress.block]||0)>0)
   return {kind:'place_build_block',block:progress.block,position:target,
    why:'Place one owner-approved structure cell; verify world and inventory'};
  if(progress.block==='cobblestone'&&typeof delegate==='function'){
   const plan=delegate('gather',{resource:'cobblestone',targetCount:1});
   if(plan?.kind&&plan.kind!=='complete')return plan;
  }
  return {kind:'blocked',why:'No real survival inventory of requested '+progress.block};
 }
 return {kind:'complete',why:'Every structure cell matches the intended block in the loaded server world'};
}
module.exports={BLOCKS,AXES,validBuildSpec,buildPositions,observeBuild,buildPlan,
 VOLUME_SHAPES,validVolumeSpec,volumePositions,observeVolume,volumePlan};
