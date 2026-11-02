#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {createController,decide}=require('./autonomy_engine.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const world=position=>({joined:true,health:20,hunger:20,threats:[],position,
 inventory:{food:0,raw:{}}});
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++};
const valid={command:'auto_goal',goal:'travel',
 destination:{x:150,y:64,z:-230},arrivalRange:2,durationSeconds:300};
check(validateCommand(valid)===null,'Explicit bounded owner coordinate travel allowed');
for(const bad of [
 {destination:{x:1.3,y:64,z:0},arrivalRange:2},
 {destination:{x:30000001,y:64,z:0},arrivalRange:2},
 {destination:{x:2,y:64,z:0},arrivalRange:0},
 {destination:{x:2,y:64,z:0},arrivalRange:9},
 {destination:{x:2,y:64,z:0},arrivalRange:'2'},
 {destination:{x:2,y:64},arrivalRange:2},
 {destination:{x:2,y:64,z:0},arrivalRange:2,resource:'diamond'}
]){
 check(validateCommand({...valid,...bad})!==null,
   'Malformed destination, range or unrelated resource denied');
}
const c=createController({clock:()=>1000,maxSeconds:1000,maxSteps:20});
c.start('travel',300,{destination:valid.destination,arrivalRange:2});
check(c.status().destination.x===150 && c.status().arrivalRange===2,
 'Destination and radius retained in autonomous task state');
const plan=c.next(world({x:10,y:64,z:10}));
check(plan.kind==='travel_target' && plan.destination.x===150,
 'Travel replans toward retained requested position from real observations');
c.record(plan,{ok:false,verified:false,detail:'No physically reachable route'});
check(c.next(world({x:10,y:64,z:10})).kind==='travel_target',
 'A single failed route cannot silently certify arrival');
const plan2=c.next(world({x:149,y:64,z:-230}));
check(plan2.kind==='travel_target',
 'Coordinates near target must still require independent navigator receipt');
c.record(plan2,{ok:true,verified:true,proof:'travel_arrival',
 detail:'Observed arrival within owner-specified range'});
check(c.next(world({x:150,y:64,z:-230})).kind==='complete',
 'Only an actual verified travel receipt plus current position closes the goal');
check(c.status().status==='complete','Travel goal settles complete only after proof');
const noFake=createController({clock:()=>1000,maxSteps:20,maxSeconds:1000});
noFake.start('travel',300,{destination:valid.destination,arrivalRange:2});
const attempted=noFake.next(world({x:149,y:64,z:-230}));
noFake.record(attempted,{ok:true,verified:true,detail:'Movement attempted without arrival proof'});
check(noFake.next(world({x:150,y:64,z:-230})).kind==='travel_target',
 'A merely successful route dispatch cannot spoof arrival without proof tag');
check(decide('travel',world({x:4,y:64,z:0}),{},{}).kind==='blocked',
 'Travel goals without authorized destination fail closed');
console.log('MINECRAFT_OWNER_TRAVEL '+checks+'/'+checks+
 ' PASS; offline protocol and controller only, not live Java navigation');
