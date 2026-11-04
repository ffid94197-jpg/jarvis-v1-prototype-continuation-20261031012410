#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {goalSpecFromCommand}=require('./goal_dispatch.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {createController}=require('./autonomy_engine.cjs');
let checks=0;
const verify=(q,expect)=>{
 assert.equal(validateCommand(q),null,'Admission rejects expected valid goal '+q.goal);checks++;
 const spec=goalSpecFromCommand(q);
 assert.deepEqual(spec,expect,'Goal spec mismatch '+q.goal);checks++;
 const controller=createController({clock:()=>1000,maxSeconds:43200,maxSteps:40});
 const st=controller.start(q.goal,q.durationSeconds||300,spec);
 assert.equal(st.status,'running','Controller did not start '+q.goal);checks++;
 return spec;
};
const pos={x:120,y:67,z:-310};
const travel=verify({command:'auto_goal',goal:'travel',destination:pos,arrivalRange:3,durationSeconds:1200},
 {destination:pos,arrivalRange:3});
assert.equal(travel.destination.x,120);checks++;
const equip=verify({command:'auto_goal',goal:'equip',item:'diamond_helmet',destinationSlot:'head',durationSeconds:300},
 {item:'diamond_helmet',destination:'head'});
assert.equal(equip.destination,'head');checks++;
verify({command:'auto_goal',goal:'gather',resource:'diamond',targetCount:2},{resource:'diamond',targetCount:2});
verify({command:'auto_goal',goal:'craft',item:'chest',targetCount:2},{item:'chest',targetCount:2});
verify({command:'auto_goal',goal:'build',block:'cobblestone',axis:'x+',length:3,position:{x:0,y:64,z:0}},
 {position:{x:0,y:64,z:0},block:'cobblestone',axis:'x+',length:3});
verify({command:'auto_goal',goal:'build',block:'oak_planks',axis:'z+',length:4,height:2,position:{x:5,y:64,z:5}},
 {position:{x:5,y:64,z:5},block:'oak_planks',axis:'z+',length:4,height:2});
verify({command:'auto_goal',goal:'farm_wheat',position:{x:1,y:64,z:2},width:2,depth:2,targetCount:3},
 {position:{x:1,y:64,z:2},width:2,depth:2,targetCount:3});
const seq=[{goal:'gather',resource:'logs',targetCount:2},{goal:'equip',item:'iron_helmet',destination:'head'}];
verify({command:'auto_goal',goal:'sequence',steps:seq},{steps:seq});
verify({command:'auto_goal',goal:'dragon_then_netherite_run',durationSeconds:21600},{});
const proof={command:'auto_goal',goal:'travel',destination:{x:8,y:64,z:4},arrivalRange:2};
const clone=goalSpecFromCommand(proof);proof.destination.x=999;
assert.equal(clone.destination.x,8,'Input mutation changed admitted destination');checks++;
const no=goalSpecFromCommand({command:'auto_goal',goal:'survive',code:'unsafe',destinationSlot:'head'});
assert.deepEqual(no,{},'Unexpected fields escaped to controller');checks++;
assert.throws(()=>goalSpecFromCommand({command:'execute_js',code:'evil'}));checks++;
console.log('MINECRAFT_GOAL_DISPATCH '+checks+'/'+checks+' PASS (offline controller, not live game)');
