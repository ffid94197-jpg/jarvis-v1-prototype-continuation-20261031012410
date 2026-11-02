'use strict';
/** Owner-bounded wheat farming. Read-only world observation and decision.
 * Does not certify a harvest without actual Java inventory observations.
 */
const MAX_COORD=29999984;
function validFarmSpec(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||s.goal!=='farm_wheat'||
    Object.keys(s).some(k=>!['goal','position','width','depth','targetCount'].includes(k)))return false;
 const p=s.position;
 return !!p&&typeof p==='object'&&!Array.isArray(p)&&
   Object.keys(p).length===3&&['x','y','z'].every(k=>Number.isInteger(p[k]))&&
   Number.isInteger(s.width)&&s.width>=1&&s.width<=4&&
   Number.isInteger(s.depth)&&s.depth>=1&&s.depth<=4&&
   Number.isInteger(s.targetCount)&&s.targetCount>=1&&s.targetCount<=16&&
   p.y>=-62&&p.y<=319&&p.x>=-MAX_COORD&&p.z>=-MAX_COORD&&
   p.x+s.width-1<=MAX_COORD&&p.z+s.depth-1<=MAX_COORD;
}
function farmPositions(s){
 if(!validFarmSpec(s))throw Error('Invalid bounded wheat field');
 const out=[];
 for(let dx=0;dx<s.width;dx++)for(let dz=0;dz<s.depth;dz++)
   out.push({x:s.position.x+dx,y:s.position.y,z:s.position.z+dz});
 return out;
}
function observeWheat(bot,s,Vec3){
 if(!validFarmSpec(s)||!bot?.entity?.position||typeof bot.blockAt!=='function'||!Vec3)return null;
 return farmPositions(s).map(position=>{
   const p=new Vec3(position.x,position.y,position.z);
   const crop=bot.blockAt(p),ground=bot.blockAt(p.offset(0,-1,0));
   let state='unloaded';
   if(crop&&ground){
     if(ground.name!=='farmland')state='blocked';
     else if(crop.name==='wheat'){
       const age=Number(crop.getProperties?.().age);
       state=Number.isInteger(age)&&age>=0&&age<=7?
         (age===7?'mature':'growing'):'unloaded';
     }else if(crop.name==='air'||crop.name==='cave_air')state='empty';
     else state='blocked';
   }
   return {position,state};
 });
}
function wheatPlan(world,progress){
 if(!validFarmSpec(progress))return {kind:'blocked',why:'Invalid authorized wheat field'};
 const cells=world?.wheatCells;
 const expected=farmPositions(progress);
 if(!Array.isArray(cells)||cells.length!==expected.length)return {kind:'blocked',why:'Missing live field observations'};
 for(let i=0;i<cells.length;i++){
   const c=cells[i],p=expected[i];
   if(!c||!c.position||!['x','y','z'].every(k=>c.position[k]===p[k])||
      !['mature','growing','empty','blocked','unloaded'].includes(c.state))
     return {kind:'blocked',why:'Field observation malformed or out of order'};
   if(c.state==='unloaded'||c.state==='blocked')return {kind:'blocked',why:'Field cell is inaccessible or obstructed'};
 }
 const raw=world.inventory?.raw||{};
 const wheat=Number.isFinite(raw.wheat)?raw.wheat:0;
 const seeds=Number.isFinite(raw.wheat_seeds)?raw.wheat_seeds:0;
 if(seeds>0){
   const empty=cells.find(c=>c.state==='empty');
   if(empty)return {kind:'plant_wheat',position:empty.position,
     why:'Replant authorized farmland; verify new crop and seed consumption'};
 }
 if(wheat>=progress.targetCount)return {kind:'complete',why:'Verified '+wheat+' wheat in real inventory'};
 const mature=cells.find(c=>c.state==='mature');
 if(mature)return {kind:'harvest_wheat',position:mature.position,
   why:'Harvest fully mature live wheat and verify inventory pickup'};
 if(cells.some(c=>c.state==='growing'))return {kind:'wait',why:'Authorized wheat still growing; never harvest premature crops'};
 return {kind:'blocked',why:'No mature wheat and no observed means of obtaining more'};
}
module.exports={validFarmSpec,farmPositions,observeWheat,wheatPlan};
