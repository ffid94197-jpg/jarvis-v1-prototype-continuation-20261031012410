'use strict';
// Native bounded controller regression, synthetic world states only.
const assert=require('node:assert/strict');
const {createController}=require('./autonomy_engine.cjs');
let checks=0;
const ok=(condition,label)=>{assert.ok(condition,label);checks++;console.log('PASS '+label);};
const make=()=>{
 const c=createController({clock:()=>300000,maxSeconds:3600,maxSteps:180});
 c.start('craft',3600,{item:'chest',targetCount:1});return c;
};
const world=(workbenchNearby=false,extra={})=>({
 joined:true,health:20,hunger:20,workbenchNearby,
 inventory:{raw:{oak_planks:8,crafting_table:1,...extra},planks:8,table:1}
});
const c=make(),w=world();
let step=c.next(w);
ok(step.kind==='place_table','owner craft goal chooses already owned crafting table');
c.record(step,{ok:false,verified:false,detail:'No safe station'});
step=c.next(w);
ok(step.kind==='place_table','one unverified placement may retry bounded action');
c.record(step,{ok:false,verified:false,detail:'No safe floor'});
step=c.next(w);
ok(step.kind==='survey_workstation',
 'two failed station placements trigger existing verified safe exploration');
c.record(step,{ok:true,verified:true,proof:'wrong',
 detail:'Invalid movement proof'});
ok(c.status().milestones.workstationSurveyTrips===undefined,
 'unrelated proof cannot authorize a new crafting search region');
ok(c.status().failures.place_table===2,
 'unverified survey cannot reset failed workstation attempts');
step=c.next(w);
ok(step.kind==='survey_workstation','unverified survey cannot bypass recovery');
c.record(step,{ok:true,verified:true,proof:'workstation_scout_move',
 detail:'Real displacement observed'});
ok(c.status().milestones.workstationSurveyTrips===1 &&
 c.status().failures.place_table===0,
 'correct movement proof permits only another place-table attempt');
step=c.next(w);
ok(step.kind==='place_table','successful scout never fabricates a placed table');
step=c.next(world(true));
ok(step.kind==='craft_general'&&step.item==='chest',
 'actual nearby workstation observed, then normal crafting resumes');
step=c.next(world(true,{chest:1}));
ok(step.kind==='complete',
 'actual owned crafted item alone completes original task');

const exhausted=make();
for(let trip=0;trip<6;trip++){
 for(let attempt=0;attempt<2;attempt++){
  const p=exhausted.next(w);assert.equal(p.kind,'place_table');
  exhausted.record(p,{ok:false,verified:false});
 }
 const scout=exhausted.next(w);
 assert.equal(scout.kind,'survey_workstation');
 exhausted.record(scout,{ok:true,verified:true,proof:'workstation_scout_move'});
}
ok(exhausted.status().milestones.workstationSurveyTrips===6,
 'six verified alternate work areas is the maximum authorized recovery budget');
for(let attempt=0;attempt<2;attempt++){
 const p=exhausted.next(w);assert.equal(p.kind,'place_table');
 exhausted.record(p,{ok:false,verified:false});
}
const last=exhausted.next(w);
ok(last.kind==='blocked'&&exhausted.status().status==='blocked',
 'after six valid moves and unverified table placements, stop honestly');
const noMoves=make();
for(let attempt=0;attempt<2;attempt++){
 const p=noMoves.next(w);noMoves.record(p,{ok:false,verified:false});
}
for(let attempt=0;attempt<3;attempt++){
 const scout=noMoves.next(w);assert.equal(scout.kind,'survey_workstation');
 noMoves.record(scout,{ok:false,verified:false});
}
ok(noMoves.status().status==='blocked',
 'three failed physical scouting attempts halt without an infinite loop');
ok(noMoves.status().milestones.workstationSurveyTrips===undefined,
 'unsuccessful scouting cannot fabricate workstation recovery progress');
console.log('MINECRAFT_WORKSTATION_RECOVERY '+checks+'/'+checks+
 ' PASS (modeled source controller; NOT real Minecraft Java)');
