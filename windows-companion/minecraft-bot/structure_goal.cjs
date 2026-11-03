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
module.exports={BLOCKS,AXES,validBuildSpec,buildPositions,observeBuild,buildPlan};
