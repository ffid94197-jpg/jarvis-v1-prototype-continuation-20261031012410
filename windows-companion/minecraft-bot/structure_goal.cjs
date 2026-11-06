'use strict';
/** Safe finite in-world construction: only blocks the owner already owns or
 * verified cobblestone gathered through the normal survival progression.
 * No commands, creative inventory, arbitrary mining or remote build sites.
 */
const BLOCKS=new Set(['cobblestone','cobbled_deepslate','stone','dirt',
 'oak_planks','spruce_planks','birch_planks','stone_bricks',
 'oak_log','glass','sandstone','netherrack']);
const AXES=Object.freeze({'x+':[1,0],'x-':[-1,0],
 'z+':[0,1],'z-':[0,-1]});
const DANGER=/lava|water|fire|magma|cactus|powder_snow|campfire/;
const PLACEMENT_FACES=Object.freeze([
 [[0,-1,0],[0,1,0]], // supporting block below target
 [[-1,0,0],[1,0,0]],[[1,0,0],[-1,0,0]],
 [[0,0,-1],[0,0,1]],[[0,0,1],[0,0,-1]]
]);
function placementReference(bot,point,Vec3){
 if(!bot?.blockAt||!point?.offset||typeof Vec3!=='function')return null;
 for(const [offset,face] of PLACEMENT_FACES){
  const ref=bot.blockAt(point.offset(...offset));
  if(ref?.boundingBox==='block'&&!DANGER.test(String(ref.name||'')))
   return {block:ref,face:new Vec3(...face)};
 }
 return null;
}
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
   const block=bot.blockAt(p);
   let state='unloaded';
   if(block){
     if(block.name===spec.block)state='matched';
     else if(block.boundingBox!=='empty'||DANGER.test(block.name))state='blocked';
     else state=placementReference(bot,p,Vec3)?'ready':'unsupported';
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
const VOLUME_SHAPES=new Set(['floor','walls','solid','roof','entrance_walls']);
function validVolumeSpec(spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||
    Object.keys(spec).some(k=>!['goal','position','block','width','depth','height','shape'].includes(k))||
    spec.goal!=='build_volume'||!BLOCKS.has(spec.block)||!VOLUME_SHAPES.has(spec.shape)||
    !Number.isInteger(spec.width)||spec.width<1||spec.width>5||
    !Number.isInteger(spec.depth)||spec.depth<1||spec.depth>5||
    !Number.isInteger(spec.height)||spec.height<1||spec.height>3||
    spec.width*spec.depth*spec.height>64||
    (['floor','roof'].includes(spec.shape)&&spec.height!==1)||
    (spec.shape==='entrance_walls'&&
      (spec.width<3||spec.depth<3||spec.height<2)))return false;
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
    if(['walls','entrance_walls'].includes(spec.shape) && dx!==0&&dz!==0&&
       dx!==spec.width-1&&dz!==spec.depth-1)continue;
    // Reserve a two-high entry opening in the center of the front wall.
    // No magical door item or claim of a furnished house is implied.
    if(spec.shape==='entrance_walls' && dz===0 &&
       dx===Math.floor(spec.width/2) && dy<2)continue;
    arr.push({x:p.x+dx,y:p.y+dy,z:p.z+dz});
   }
 return arr;
}
function observeVolume(bot,spec,Vec3){
 if(!validVolumeSpec(spec)||!bot?.entity?.position||!bot.blockAt||!Vec3)return null;
 return volumePositions(spec).map(position=>{
  const point=new Vec3(position.x,position.y,position.z);
  const block=bot.blockAt(point);
  let state='unloaded';
  if(block){
   if(block.name===spec.block)state='matched';
   else if(block.boundingBox!=='empty'||DANGER.test(block.name))state='blocked';
   else state=placementReference(bot,point,Vec3)?'ready':'unsupported';
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
 // First validate the ENTIRE target shape before selecting a placement.
 // A roof tile may not have support until its adjacent edge tile is placed.
 // 'unsupported' is therefore a dependency, not an automatic fatal error.
 // Existing blocks and unloaded targets remain hard stops: never replace
 // someone else's structure or guess unseen world state.
 let ready=null,unsupported=0,matched=0;
 for(let i=0;i<positions.length;i++){
  const cell=observed[i],target=positions[i];
  if(!cell?.position||
     !['x','y','z'].every(k=>cell.position[k]===target[k])||
     !['matched','ready','blocked','unsupported','unloaded'].includes(cell.state))
   return {kind:'blocked',why:'Invalid or mismatched structure observation'};
  if(cell.state==='matched'){matched++;continue;}
  if(cell.state==='blocked'||cell.state==='unloaded')
   return {kind:'blocked',why:'Structure cell '+i+' is '+cell.state+
     '; refusing to overwrite an existing or unobserved block'};
  if(cell.state==='unsupported'){unsupported++;continue;}
  if(ready===null)ready=target;
 }
 if(ready!==null){
  if((world.inventory?.raw?.[progress.block]||0)>0)
   return {kind:'place_build_block',block:progress.block,position:ready,
     why:'Place one currently supported, owner-approved structure cell and verify both receipts'};
  if(progress.block==='cobblestone'&&typeof delegate==='function'){
   const plan=delegate('gather',{resource:'cobblestone',targetCount:1});
   if(plan?.kind&&plan.kind!=='complete')return plan;
  }
  return {kind:'blocked',why:'No real survival inventory of requested '+progress.block};
 }
 if(unsupported>0)
  return {kind:'blocked',why:unsupported+
    ' remaining structure cells have no real support face; no unsafe floating placement'};
 return matched===positions.length?
  {kind:'complete',why:'Every structure cell matches the intended block in the loaded server world'}:
  {kind:'blocked',why:'Structure observations cannot prove completion'};
}
// Deterministic single-instruction composition: reuse existing finite
// floor, verified doorway walls and side-supported roof plans. No script,
 // invented world coordinates, new agent, or permission escalation.
function roofedRoomSteps(spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||
   Object.keys(spec).some(k=>!['position','block','width','depth','wallHeight'].includes(k))||
   !Number.isInteger(spec.width)||spec.width<3||spec.width>5||
   !Number.isInteger(spec.depth)||spec.depth<3||spec.depth>5||
   !Number.isInteger(spec.wallHeight)||spec.wallHeight<2||spec.wallHeight>3 ||
   !spec.position||typeof spec.position!=='object')return null;
 const {position,block,width,depth,wallHeight}=spec;
 const at=y=>({x:position.x,y,z:position.z});
 const list=[
  {goal:'build_volume',position:at(position.y),block,width,depth,height:1,shape:'floor'},
  {goal:'build_volume',position:at(position.y+1),block,width,depth,height:wallHeight,shape:'entrance_walls'},
  {goal:'build_volume',position:at(position.y+1+wallHeight),block,width,depth,height:1,shape:'roof'}
 ];
 if(!list.every(validVolumeSpec))return null;
 const blocks=list.reduce((sum,part)=>sum+volumePositions(part).length,0);
 return blocks<=64?list:null;
}
module.exports={BLOCKS,AXES,validBuildSpec,buildPositions,observeBuild,buildPlan,
 VOLUME_SHAPES,validVolumeSpec,volumePositions,observeVolume,volumePlan,
 placementReference,roofedRoomSteps};
