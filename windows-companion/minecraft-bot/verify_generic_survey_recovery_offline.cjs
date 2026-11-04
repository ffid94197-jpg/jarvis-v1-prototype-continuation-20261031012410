'use strict';
/** Native autonomous material-search recovery contract.
 * Tests source-loaded real controller and resource planner with simulated
 * observations; no live Java server/Windows/model, no fake victory claims.
 */
const assert=require('node:assert/strict');
const {createController}=require('./autonomy_engine.cjs');
const {resourcePlan}=require('./resource_goal.cjs');
let count=0;
function ok(cond,message){assert.ok(cond,message);count++;console.log('PASS '+message);}
const world=(resource,amount=0)=>({
 joined:true,health:20,hunger:20,inventory:{raw:{[resource]:amount}}
});
const controller=(material)=>{const a=createController({
 clock:()=>1000000,maxSeconds:3600,maxSteps:200});
 a.start('gather',3600,{resource:material,targetCount:3});
 return a;
};
const first=controller('dirt'),empty=world('dirt');
let d=first.next(empty);
ok(d.kind==='mine_generic'&&d.resource==='dirt',
 'first attempt requires actual loaded dirt inventory pickup');
first.record(d,{ok:false,verified:false,detail:'No block in loaded chunks'});
d=first.next(empty);
ok(d.kind==='mine_generic','one missing block does not prove entire biome exhausted');
first.record(d,{ok:false,verified:false,detail:'No material at current location'});
d=first.next(empty);
ok(d.kind==='survey_generic'&&d.resource==='dirt',
 'two missed acquisitions trigger bounded alternate-region search');
first.record(d,{ok:true,verified:true,proof:'unrelated_proof',
 detail:'Bad receipt cannot justify move'});
ok(first.status().failures.survey_generic===1,
 'unrelated proof counts as a failed survey');
ok(first.status().milestones.genericSurveyTrips===undefined,
 'unrelated proof never grants a survey milestone');
ok(first.status().failures.mine_generic===2,
 'unrelated proof cannot reset the failed real gather');
d=first.next(empty);
ok(d.kind==='survey_generic','failed unproven survey is retried while bounded');
first.record(d,{ok:true,verified:true,proof:'generic_survey_move',
 detail:'Server shows physical displacement'});
ok(first.status().milestones.genericSurveyTrips.dirt===1,
 'correct source action receipt records one real survey trip');
ok(first.status().failures.mine_generic===0,
 'confirmed movement permits retrying inventory-based gathering');
d=first.next(empty);
ok(d.kind==='mine_generic','scout is not counted as gathered material');
d=first.next(world('dirt',3));
ok(d.kind==='complete'&&first.status().status==='complete',
 'only real target inventory completes the resource goal');

const another=controller('mud');
const no=world('mud');
for(let trip=0;trip<8;trip++){
 for(let attempt=0;attempt<2;attempt++){
  const action=another.next(no);
  assert.equal(action.kind,'mine_generic');
  another.record(action,{ok:false,verified:false});
 }
 const scout=another.next(no);
 assert.equal(scout.kind,'survey_generic');
 another.record(scout,{ok:true,verified:true,proof:'generic_survey_move'});
}
ok(another.status().milestones.genericSurveyTrips.mud===8,
 'recovery search budget capped at eight real movements per material');
for(let i=0;i<2;i++){
 const action=another.next(no);assert.equal(action.kind,'mine_generic');
 another.record(action,{ok:false,verified:false});
}
const exhausted=another.next(no);
ok(exhausted.kind==='blocked'&&another.status().status==='blocked',
 'eight verified search regions followed by misses must block honestly');
ok(/no resource claimed/.test(exhausted.why),
 'no material or success is fabricated at recovery exhaustion');

const raw=resourcePlan(empty,{mine_generic:2},
 {resource:'dirt',targetCount:3,steps:4,milestones:{
  genericSurveyTrips:{dirt:7}}});
ok(raw.kind==='survey_generic'&&raw.resource==='dirt',
 'material-specific seventh search allows last bounded attempt');
const limit=resourcePlan(empty,{mine_generic:2},
 {resource:'dirt',targetCount:3,steps:5,milestones:{
  genericSurveyTrips:{dirt:8}}});
ok(limit.kind==='blocked','material-specific search limit blocks ninth attempt');
const other=resourcePlan(world('mud'),{mine_generic:2},
 {resource:'mud',targetCount:3,steps:5,milestones:{
  genericSurveyTrips:{dirt:8}}});
ok(other.kind==='survey_generic',
 'exhausting one material cannot consume another material search budget');
const noTool=resourcePlan({joined:true,inventory:{raw:{}}},{mine_generic:2},
 {resource:'granite',targetCount:3,milestones:{}});
ok(noTool.kind==='blocked'&&/prerequisite planner/i.test(noTool.why),
 'missing approved tool planner fails closed without attempting mineral survey');
const withTool=resourcePlan({joined:true,inventory:{stonePickaxe:1,raw:{}}},{mine_generic:2},
 {resource:'granite',targetCount:3,milestones:{}});
ok(withTool.kind==='survey_generic'&&withTool.resource==='granite',
 'stone material with actually owned pickaxe may scout new loaded area');
const isolated=controller('sand');
d=isolated.next(world('sand'));
isolated.record(d,{ok:false,verified:false});
d=isolated.next(world('sand'));
isolated.record(d,{ok:false,verified:false});
for(let attempt=0;attempt<3;attempt++){
 const scout=isolated.next(world('sand'));
 assert.equal(scout.kind,'survey_generic');
 isolated.record(scout,{ok:false,verified:false});
}
ok(isolated.status().status==='blocked',
 'three failed real scout executions block rather than spin forever');
ok(isolated.status().milestones.genericSurveyTrips===undefined,
 'no verified displacement means no search progress is claimed');
console.log('MINECRAFT_GENERIC_SURVEY_RECOVERY '+count+'/'+count+
 ' PASS (source controller with simulated real-world observations; no live Java acceptance)');
