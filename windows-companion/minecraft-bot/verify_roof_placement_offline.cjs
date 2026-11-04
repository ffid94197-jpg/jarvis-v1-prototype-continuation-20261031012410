'use strict';
// Source-level finite survival geometry and typed owner intent, not real Java.
const assert=require('node:assert/strict');
const {validVolumeSpec,volumePositions,observeVolume,volumePlan,
 placementReference}=require('./structure_goal.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {directIntent}=require('./language_goal.cjs');
let checks=0;const ok=(x,n)=>{assert.ok(x,n);checks++;console.log('PASS '+n);};
const origin={x:1,y:64,z:2};
const vol=(shape,y,h)=>({
 goal:'build_volume',block:'cobblestone',
 position:{x:origin.x,y,z:origin.z},
 width:3,depth:3,height:h,shape
});
const floor=vol('floor',64,1),walls=vol('walls',65,2),roof=vol('roof',67,1);
ok(validVolumeSpec(roof),'one-layer roof is a legal native bounded structure');
ok(!validVolumeSpec({...roof,height:2}),'two-layer roof requires a separately authorized structure');
ok(!validVolumeSpec({...roof,width:6}),'unbounded roof width rejected');
ok(validSequence([floor,walls,roof]),
 'floor, walls and roof are legal consecutive native owner goals');
ok(validateCommand({command:'auto_goal',...roof,durationSeconds:3600})===null,
 'typed Guardian-companion command accepts exact approved roof spec');
ok(validateCommand({command:'auto_goal',...roof,secret:'run shell'})!==null,
 'extra fields cannot hide malicious effects inside structure');
const text=directIntent('build a 3 by 3 cobblestone roof at 1 67 2');
ok(text?.ok&&text.command.goal==='build_volume'&&text.command.shape==='roof',
 'owner natural words route to finite three-by-three roof');
class Vec3{
 constructor(x,y,z){Object.assign(this,{x,y,z});}
 offset(dx,dy,dz){return new Vec3(this.x+dx,this.y+dy,this.z+dz);}
}
const occupied=new Map(),key=p=>[p.x,p.y,p.z].join(',');
const world={
 entity:{position:{x:1,y:64,z:2}},
 blockAt:p=>({
  name:p.y===63?'bedrock':occupied.has(key(p))?'cobblestone':'air',
  boundingBox:p.y===63||occupied.has(key(p))?'block':'empty',
  position:new Vec3(p.x,p.y,p.z)
 })
};
const plan=(spec,inventory=100)=>{
 const snap=observeVolume(world,spec,Vec3);
 return volumePlan({inventory:{raw:{cobblestone:inventory}},buildVolumeCells:snap},spec);
};
ok(plan(roof).kind==='blocked',
 'roof over empty air is not claimed buildable or automatically floated');
const placeAll=(spec)=>{
 let placed=0;
 for(let i=0;i<volumePositions(spec).length;i++){
  const step=plan(spec,100-i);
  assert.equal(step.kind,'place_build_block',
   'every cell needs live support, safe geometry and real inventory');
  const reference=placementReference(world,new Vec3(
   step.position.x,step.position.y,step.position.z),Vec3);
  assert.ok(reference&&reference.block.boundingBox==='block');
  occupied.set(key(step.position),true);placed++;
 }
 assert.equal(plan(spec,0).kind,'complete',
  'all requested cells must be physically observed after placement');
 return placed;
};
ok(placeAll(floor)===9,'all nine ground-supported floor cells are planned');
ok(placeAll(walls)===16,'all sixteen bottom-up perimeter wall cells are planned');
const before=observeVolume(world,roof,Vec3);
ok(before[0].state==='ready'&&before[4].state==='unsupported',
 'roof perimeter has real support but unbuilt center does not');
const ready=plan(roof,9);
ok(ready.kind==='place_build_block','roof starts only at supported perimeter');
const count=placeAll(roof);
ok(count===9,'nine roof cells become server-observable with adjacent support');
const center=new Vec3(2,67,3),beneath=world.blockAt(center.offset(0,-1,0));
ok(beneath.boundingBox==='empty'&&
 placementReference(world,center,Vec3).block.boundingBox==='block',
 'roof center has verified side support despite air underneath');
const done=plan(roof,0);
ok(done.kind==='complete','fully observed roof needs no additional inventory');
const waterBlock={...world,blockAt:p=>key(p)===key({x:1,y:68,z:2})?
 {name:'lava',boundingBox:'empty',position:new Vec3(p.x,p.y,p.z)}:world.blockAt(p)};
const hazardous=observeVolume(waterBlock,vol('roof',68,1),Vec3);
ok(hazardous[0].state==='blocked',
 'lava/fire hazard target must block roof instead of treating as air');
console.log('MINECRAFT_VERIFIED_ROOF '+checks+'/'+checks+
 ' PASS (mocked world and typed real source; NOT live Minecraft placement)');
