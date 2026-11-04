'use strict';
// Local finite-geometry source checks. No Java server, packet, real AI or world.
const assert=require('node:assert/strict');
const {validVolumeSpec,volumePositions,observeVolume,volumePlan}=require('./structure_goal.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {goalSpecFromCommand}=require('./goal_dispatch.cjs');
const {directIntent}=require('./language_goal.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
let checks=0;
function pass(v,msg){assert.ok(v,msg);checks++;console.log('PASS',msg);}
const spec=(shape='walls',width=3,depth=3,height=2)=>({
 goal:'build_volume',position:{x:1,y:64,z:2},block:'cobblestone',
 shape,width,depth,height});
pass(validVolumeSpec(spec()),'finite 3x3x2 perimeter wall accepts valid goal');
pass(volumePositions(spec()).length===16,'perimeter walls require exactly 16 cells');
pass(volumePositions(spec('floor',3,4,1)).length===12,'3x4 floor has 12 cells');
pass(volumePositions(spec('solid',2,2,2)).length===8,'2x2x2 solid has eight cells');
pass(!validVolumeSpec(spec('solid',5,5,3)),'structure size capped at 64 cells');
pass(!validVolumeSpec(spec('floor',3,3,2)),'multi-layer floor is invalid');
pass(!validVolumeSpec({...spec(),position:{x:1,y:64,z:2,shell:'cmd'}}),
 'hidden coordinate metadata cannot enter structure');
pass(!validVolumeSpec({...spec(),block:'lava'}),'unapproved construction material rejected');
pass(!validVolumeSpec({...spec(),script:'bad'}),'extra model parameter rejected');
pass(!validVolumeSpec({...spec(),position:{x:1,y:318,z:2}}),
 'out-of-world ceiling rejected');
pass(validSequence([spec()]),'bounded structure is a legal native sequence stage');
pass(validateCommand({command:'auto_goal',...spec(),durationSeconds:3600})===null,
 'typed Guardian-companion validator allows exact structure goal');
pass(validateCommand({command:'auto_goal',...spec(),axis:'x+'})!==null,
 'typed structure goal rejects unrelated line-axis parameter');
const command={command:'auto_goal',...spec(),durationSeconds:3600};
const copy=goalSpecFromCommand(command);
pass(copy.shape==='walls'&&copy.height===2&&copy.width===3&&
 copy.position.x===1,'owner goal survives dispatcher serialization');
const phrase='build a 3 by 3 by 2 cobblestone walls at 1 64 2';
const parsed=directIntent(phrase);
pass(parsed?.ok&&parsed.command.goal==='build_volume'&&
 parsed.command.block==='cobblestone'&&parsed.command.height===2,
 'natural spoken 3D geometry produces one validated native goal');
pass(!directIntent('build a 5 by 5 by 3 cobblestone walls at 1 64 2')?.ok,
 'natural parser respects over-budget structure limit');
class Vec3{
 constructor(x,y,z){Object.assign(this,{x,y,z});}
 offset(dx,dy,dz){return new Vec3(this.x+dx,this.y+dy,this.z+dz);}
}
const owned=new Map(),key=p=>[p.x,p.y,p.z].join(',');
const bot={
 entity:{position:new Vec3(1,64,2)},
 blockAt:p=>{
  if(p.y===63||owned.has(key(p)))return {name:'cobblestone',boundingBox:'block'};
  return {name:'air',boundingBox:'empty'};
 }
};
let count=20,placed=0,world;
for(let round=0;round<17;round++){
 world={joined:true,inventory:{raw:{cobblestone:count}},
  buildVolumeCells:observeVolume(bot,spec(),Vec3)};
 const plan=volumePlan(world,spec());
 if(round===16){
  pass(plan.kind==='complete','all sixteen cell states separately verified complete');
  break;
 }
 if(plan.kind!=='place_build_block')throw Error('Unexpected wall step: '+JSON.stringify(plan));
 const position=plan.position;
 // Actual executor is the existing place_build_block Mineflayer action.
 // Only model block placement here, never fake a server receipt.
 owned.set(key(position),true);count--;placed++;
 if(round===7){
  pass(owned.size===8 && world.buildVolumeCells[8].state==='unsupported',
   'upper wall blocks remain unsupported until lower layer is observed');
 }
}
pass(placed===16&&owned.size===16&&count===4,
 'bottom-up 16-cell build consumes exactly sixteen owned blocks');
const blocked=volumePlan({...world,inventory:{raw:{cobblestone:0}},
 buildVolumeCells:world.buildVolumeCells.map((c,i)=>
 i===0?{...c,state:'blocked'}:c)},spec());
pass(blocked.kind==='blocked','obstructed player world is never overwritten');
const missing=volumePlan({inventory:{raw:{cobblestone:1}},buildVolumeCells:[]},spec());
pass(missing.kind==='blocked','missing live block observation blocks structure execution');
console.log('MINECRAFT_NATIVE_STRUCTURE_VOLUME '+checks+'/'+checks+
 ' PASS (geometry and simulated loaded-world observations; NOT a live Java build)');
