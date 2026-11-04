'use strict';
// One owner sentence -> native bounded sequence -> observed floor/entry/roof.
// This uses simulated loaded world states, NOT a live Minecraft Java client.
const assert=require('node:assert/strict');
const {roofedRoomSteps,volumePositions,observeVolume}=require('./structure_goal.cjs');
const {directIntent}=require('./language_goal.cjs');
const {modelGoalGrounded}=require('./general_play_intent.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {createController}=require('./autonomy_engine.cjs');
let checks=0;
const ok=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS '+label)};
const owner='build a 3 by 3 by 2 cobblestone roofed room at 1 64 2';
const res=directIntent(owner);
ok(res?.ok===true&&res.command.goal==='sequence',
 'one natural owner instruction becomes durable native sequence');
const steps=res.command.steps;
ok(steps.length===3&&steps.map(s=>s.shape).join(',')===
 'floor,entrance_walls,roof',
 'single instruction composes floor, entry walls and roof in exact order');
ok(validSequence(steps)&&validateCommand(res.command)===null,
 'every generated subgoal passes existing typed Guardian-companion validation');
ok(modelGoalGrounded(res.command,owner),
 'model-generated copy of exact authorized room stages is owner-grounded');
const alternative={...res.command,steps:[steps[0],steps[2],steps[1]]};
ok(!modelGoalGrounded(alternative,owner),
 'AI cannot silently reorder the owner-requested room stages');
const extra={...res.command,steps:[...steps,{...steps[2]}]};
ok(!modelGoalGrounded(extra,owner),
 'AI cannot add a fourth unapproved structure stage');
const change={...res.command,steps:[{...steps[0],block:'dirt'},...steps.slice(1)]};
ok(!modelGoalGrounded(change,owner),
 'AI cannot substitute a different material in one stage');
ok(volumePositions(steps[0]).length===9&&
 volumePositions(steps[1]).length===14&&
 volumePositions(steps[2]).length===9,
 'finite 3x3 room requires 32 observed physical blocks');
const hole=volumePositions(steps[1]);
ok(!hole.some(p=>p.z===2&&p.x===2&&[65,66].includes(p.y)),
 'front-center two-block entrance remains open');
ok(roofedRoomSteps({position:{x:1,y:64,z:2},block:'cobblestone',
 width:5,depth:5,wallHeight:2})===null,
 'owner room larger than safe total 64-block budget is rejected');
ok(roofedRoomSteps({position:{x:1,y:317,z:2},block:'cobblestone',
 width:3,depth:3,wallHeight:2})===null,
 'room roof cannot extend above real survival build height');
ok(!directIntent('do not build a 3 by 3 by 2 cobblestone roofed room at 1 64 2')?.ok,
 'negative owner request never authorizes room construction');
class Vec3{
 constructor(x,y,z){Object.assign(this,{x,y,z});}
 offset(x,y,z){return new Vec3(this.x+x,this.y+y,this.z+z);}
}
const key=p=>[p.x,p.y,p.z].join(',');
const occupied=new Set();
const bot={entity:{position:{x:1,y:64,z:2}},blockAt:p=>{
 const solid=p.y===63||occupied.has(key(p));
 return {name:solid?'cobblestone':'air',boundingBox:solid?'block':'empty',
  position:new Vec3(p.x,p.y,p.z)};
}};
const snapshot=()=>{
 const stages=steps.map(stage=>observeVolume(bot,stage,Vec3));
 return {joined:true,health:20,hunger:20,
  inventory:{raw:{cobblestone:64-occupied.size}},
  buildVolumeCellsByStage:stages};
};
const controller=createController({clock:()=>1000,maxSeconds:21600,maxSteps:100});
controller.start('sequence',21600,{steps});
let count=0;
while(count<33){
 const decision=controller.next(snapshot());
 if(decision.kind==='complete')break;
 assert.equal(decision.kind,'place_build_block');
 assert.equal(decision.block,'cobblestone');
 assert.ok(!occupied.has(key(decision.position)));
 occupied.add(key(decision.position));
 controller.record(decision,{ok:true,verified:true,
  detail:'Simulated cell now physically present'});
 count++;
}
const done=controller.next(snapshot());
ok(count===32&&done.kind==='complete'&&controller.status().status==='complete',
 'all three structure stages advance only from observed world block state');
occupied.delete(key({x:2,y:67,z:3}));
const restarted=createController({clock:()=>1000,maxSeconds:21600,maxSteps:100});
restarted.start('sequence',21600,{steps});
const pending=restarted.next(snapshot());
ok(pending.kind==='place_build_block'&&pending.position.y===67,
 'missing roof block after restart is rebuilt, not falsely completed');
const falseWorld=createController({clock:()=>1000,maxSeconds:21600});
falseWorld.start('sequence',21600,{steps});
const bad=falseWorld.next({joined:true,health:20,hunger:20,
 inventory:{raw:{cobblestone:64}}});
ok(bad.kind==='blocked','missing world-cell observations never claim construction success');
console.log('MINECRAFT_NATIVE_ROOFED_ROOM '+checks+'/'+checks+
 ' PASS (source-loaded controller and simulated world; NOT live Java)');
