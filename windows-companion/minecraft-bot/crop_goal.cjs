'use strict';
/** Native two-crop farmland goal.
 * Actual loaded farmland, crop ages, newly harvested inventory deltas and
 * owner-specified tiny field bounds are mandatory. No growth acceleration,
 * creative inventory, bone-meal scripts or model-selected coordinates.
 */
const CROPS=Object.freeze({carrots:'carrot',potatoes:'potato'});
const MAX=29999984;
function validCropSpec(s){
 if(!s||typeof s!=='object'||Array.isArray(s) || s.goal!=='farm_crop'||
    Object.keys(s).some(k=>!['goal','crop','position','width','depth','targetCount'].includes(k))||
    !Object.hasOwn(CROPS,s.crop))return false;
 const p=s.position;
 return !!p&&typeof p==='object'&&!Array.isArray(p) &&
   Object.keys(p).length===3&&['x','y','z'].every(k=>Number.isInteger(p[k]))&&
   Number.isInteger(s.width)&&s.width>=1&&s.width<=4 &&
   Number.isInteger(s.depth)&&s.depth>=1&&s.depth<=4 &&
   Number.isInteger(s.targetCount)&&s.targetCount>=1&&s.targetCount<=16 &&
   p.y>=-62&&p.y<=317&&p.x>=-MAX&&p.z>=-MAX&&
   p.x+s.width-1<=MAX&&p.z+s.depth-1<=MAX;
}
function cropPositions(s){
 if(!validCropSpec(s))throw Error('Invalid owner crop field specification');
 const out=[];
 for(let dx=0;dx<s.width;dx++)for(let dz=0;dz<s.depth;dz++)
  out.push({x:s.position.x+dx,y:s.position.y,z:s.position.z+dz});
 return out;
}
function observeCrop(bot,s,Vec3){
 if(!validCropSpec(s)||!bot?.entity?.position||!Vec3 ||
    typeof bot.blockAt!=='function')return null;
 return cropPositions(s).map(position=>{
  const p=new Vec3(position.x,position.y,position.z);
  const block=bot.blockAt(p),floor=bot.blockAt(p.offset(0,-1,0));
  let state='unloaded';
  if(block&&floor){
   if(floor.name!=='farmland')state='blocked';
   else if(block.name===s.crop){
    const age=Number(block.getProperties?.().age);
    state=Number.isInteger(age)&&age>=0&&age<=7?
      (age===7?'mature':'growing'):'unloaded';
   }else if(['air','cave_air'].includes(block.name))state='empty';
   else state='blocked';
  }
  return {position,state};
 });
}
function cropPlan(world,progress){
 if(!validCropSpec({...progress,goal:'farm_crop'}))
   return {kind:'blocked',why:'Owner crop field not valid'};
 const expected=cropPositions({...progress,goal:'farm_crop'});
 const cells=world?.cropCells;
 if(!Array.isArray(cells)||cells.length!==expected.length)
  return {kind:'blocked',why:'Missing real loaded crop-field observation'};
 for(let n=0;n<cells.length;n++){
  const c=cells[n],p=expected[n];
  if(!c||!c.position||!['x','y','z'].every(k=>c.position[k]===p[k])||
     !['mature','growing','empty','blocked','unloaded'].includes(c.state))
   return {kind:'blocked',why:'Crop observation mismatched requested field'};
  if(['blocked','unloaded'].includes(c.state))
   return {kind:'blocked',why:'Crop field has unobserved or occupied farmland'};
 }
 const item=CROPS[progress.crop],inventory=world?.inventory?.raw||{};
 const count=Number.isSafeInteger(inventory[item])?inventory[item]:0;
 const produced=Number.isSafeInteger(progress?.milestones?.harvestedCropCount)?
   progress.milestones.harvestedCropCount:0;
 if(produced>=progress.targetCount && count>=progress.targetCount)
  return {kind:'complete',why:'Current mission verified '+produced+
    ' harvested '+item+' and survival inventory still contains requested '+count};
 if(produced>=progress.targetCount && count<progress.targetCount)
  return {kind:'blocked',why:'Harvested crops were spent or lost before final physical readback'};
 const ripe=cells.find(c=>c.state==='mature');
 if(ripe)return {kind:'harvest_crop',crop:progress.crop,position:ripe.position,
   why:'Harvest one mature owner-authorized crop; count only physical inventory increase'};
 const empty=cells.find(c=>c.state==='empty');
 if(empty&&count>0)return {kind:'plant_crop',crop:progress.crop,position:empty.position,
   why:'Replant verified owned '+item+' on observed tilled farmland'};
 if(cells.some(c=>c.state==='growing'))
  return {kind:'wait',why:'Crop observed still growing; no instant harvest or cheat'};
 return {kind:'blocked',why:'No mature crop or owned seed vegetable on owner-approved farmland'};
}
module.exports={CROPS,validCropSpec,cropPositions,observeCrop,cropPlan};
