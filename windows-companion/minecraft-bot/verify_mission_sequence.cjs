#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {validSequence,canonicalSequence}=require('./mission_sequence.cjs');
const {validBuildSpec}=require('./structure_goal.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {createController}=require('./autonomy_engine.cjs');
let checks=0;function ok(x,m){assert.ok(x,m);checks++;}
const build={goal:'build',block:'cobblestone',axis:'x+',length:2,position:{x:10,y:64,z:10}};
ok(validBuildSpec(build),'Bounded construction step contract');
ok(validSequence([build]),'A build stage is allowed within multi-step sequence');
ok(validateCommand({command:'auto_goal',...build})===null,
  'Live owner protocol allows bounded construction');
ok(validateCommand({command:'auto_goal',goal:'build',...build,block:'command_block'})!==null,
  'Live owner protocol rejects admin or unsupported blocks');
const goalSteps=[
 {goal:'gather',resource:'logs',targetCount:4},
 {goal:'travel',destination:{x:40,y:64,z:-5},arrivalRange:2},
 {goal:'gather',resource:'cobblestone',targetCount:5}
];
const world=(inventory={},position={x:0,y:64,z:0})=>({
 joined:true,dimension:'minecraft:overworld',health:20,hunger:20,
 threats:[],workbenchNearby:false,position,
 inventory:{logs:0,planks:0,sticks:0,woodenPickaxe:0,
 cobblestone:0,raw:{},...inventory}
});
ok(validSequence(goalSteps),'Typed gather/travel/gather mission is allowed');
ok(validateCommand({command:'auto_goal',goal:'sequence',steps:goalSteps,
 durationSeconds:300})===null,'Owner command validator approves bounded sequence');
for(const bad of [
 [],
 Array(9).fill({goal:'tools'}),
 [{goal:'eval',code:'process.exit(0)'}],
 [{goal:'gather',resource:'command_block',targetCount:1}],
 [{goal:'travel',destination:{x:30000001,y:64,z:0},arrivalRange:2}],
 [{goal:'dragon_run'}],
 [{goal:'stone_age',evil:true}]
]){
 ok(!validSequence(bad),'Never authorize arbitrary executable or overlong steps');
 ok(validateCommand({command:'auto_goal',goal:'sequence',steps:bad})!==null,
   'Protocol denies every invalid multi-step plan');
}
const copy=canonicalSequence(goalSteps);copy[0].targetCount=1;
ok(goalSteps[0].targetCount===4,
 'Mission sequence must be cloned rather than trusting mutable caller input');
const buildController=createController({clock:()=>1000,maxSteps:40,maxSeconds:1000});
buildController.start('sequence',300,{steps:[{goal:'gather',resource:'logs',targetCount:1},build]});
const stageAction=buildController.next({...world({logs:1}),buildCellsByStage:[null,[
  {position:{x:10,y:64,z:10},state:'ready'},
  {position:{x:11,y:64,z:10},state:'ready'}
]]});
ok(stageAction.kind!=='complete' && stageAction.kind!=='place_build_block',
 'Composed building must acquire real material before attempting placement');
const controller=createController({clock:()=>1000,maxSteps:40,maxSeconds:1000});
controller.start('sequence',300,{steps:goalSteps});
ok(controller.next(world()).kind==='collect_wood',
 'First stage gathers real timber');
let step=controller.next(world({logs:4}));
ok(step.kind==='travel_target' && controller.status().sequenceIndex===1,
 'After observed wood quantity, advance to next stage without a human prompt');
controller.record(step,{ok:true,verified:true,detail:'Navigator sent, no arrival proof'});
ok(controller.next(world({logs:4},{x:40,y:64,z:-5})).kind==='travel_target',
 'A sent navigation packet cannot fulfill travel stage without arrival receipt');
step=controller.next(world({logs:4},{x:40,y:64,z:-5}));
controller.record(step,{ok:true,verified:true,proof:'travel_arrival',
 detail:'Independent Pathfinder arrival verified'});
step=controller.next(world({logs:4,woodenPickaxe:1},{x:40,y:64,z:-5}));
ok(step.kind==='mine_cobblestone' && controller.status().sequenceIndex===2,
 'Verified target arrival advances to third resource stage');
ok(controller.status().milestones.travelArrivalVerified===false,
 'Prior waypoint receipt must not be reused for later travel objectives');
ok(controller.next(world({logs:4,woodenPickaxe:1,cobblestone:5},
 {x:40,y:64,z:-5})).kind==='complete',
 'All three stages require actual world state before completing full mission');
ok(controller.status().status==='complete'&&controller.status().sequenceIndex===3,
 'Full sequential plan settled only after final inventory proof');
const deathRecovery=createController({clock:()=>1000,maxSteps:40,maxSeconds:1000});
deathRecovery.start('sequence',300,{steps:goalSteps});
deathRecovery.next(world({logs:4}));
ok(deathRecovery.status().sequenceIndex===1,'Prepare a partially completed task');
deathRecovery.stop('Death: respawn pending');
ok(deathRecovery.resumeAfterRespawn(),'Owner-authorized task may restart after real respawn');
ok(deathRecovery.status().sequenceIndex===0,
 'Following death, earlier stages must be reverified against actual surviving inventory');
console.log('MINECRAFT_MULTISTEP_SEQUENCE '+checks+'/'+checks+
 ' PASS (offline state machine only, not live Java survival)');
