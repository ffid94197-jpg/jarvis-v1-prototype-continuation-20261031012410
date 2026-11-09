#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {compactAutonomyStatus,MAX_BYTES}=require('./status_receipt.cjs');
let cases=0;
const check=(s)=>{
 const json=compactAutonomyStatus(s);
 assert.ok(json.length<=MAX_BYTES,'Oversized game status must never be truncated');cases++;
 const r=JSON.parse(json);cases++;
 assert.equal(r.status,s.status);cases++;
 assert.equal(r.goal,s.goal);cases++;
 return r;
};
const core={status:'running',goal:'dragon_then_netherite_run',since:100,deadline:999999,
 steps:245,successes:240,why:'Engaging live Ender Dragon',lastDecision:{kind:'fight_dragon'},
 lastResult:{kind:'fight_dragon',verified:false,detail:'Battle still running'},failures:{},
 milestones:{dragonSeen:true,dragonKilled:false,exitPortalObserved:false,netheriteEquipped:false}};
const starting=check(core);
assert.equal(starting.milestones.dragonKilled,false);cases++;
assert.equal(starting.milestones.netheriteEquipped,false);cases++;
const complete=check({...core,status:'complete',milestones:{...core.milestones,
 dragonKilled:true,exitPortalObserved:true,endReturned:true,netheriteEquipped:true}});
assert.equal(complete.milestones.dragonKilled,true);cases++;
assert.equal(complete.milestones.exitPortalObserved,true);cases++;
assert.equal(complete.milestones.netheriteEquipped,true);cases++;
const huge=check({...core,goal:'sequence',status:'blocked',why:'No reachable target '.repeat(500),
 failures:Object.fromEntries(Array.from({length:250},(_,i)=>['mine_'+i,15])),
 milestones:{...core.milestones,...Object.fromEntries(Array.from({length:150},(_,i)=>['otherMilestone'+i,true]))},
 sequence:Array.from({length:500},(_,i)=>({goal:'gather',resource:'diamond',targetCount:i})),
 lastDecision:{kind:'collect_wood',why:'many'.repeat(500)}});
assert.equal(huge.status,'blocked');cases++;
assert.equal(huge.milestones.dragonKilled,false);cases++;
assert.equal(huge.milestones.netheriteEquipped,false);cases++;
assert.equal(huge.sequence,undefined,'Do not emit oversized sequence data');cases++;
const gather=check({...core,goal:'gather',status:'complete',resource:'cobblestone',
 targetCount:20,milestones:{initialCount:21,currentCount:41,newItems:20,gatherDone:true}});
assert.equal(gather.milestones.initialCount,21);cases++;
assert.equal(gather.milestones.currentCount,41);cases++;
assert.equal(gather.milestones.newItems,20);cases++;
assert.equal(gather.milestones.gatherDone,true);cases++;
const crowded=check({...core,goal:'gather',status:'complete',resource:'diamond',
 targetCount:2,milestones:{
  ...Object.fromEntries(Array.from({length:75},(_,i)=>['optional'+i,true])),
  initialCount:5,currentCount:7,newItems:2,gatherDone:true
 }});
assert.equal(crowded.milestones.initialCount,5);cases++;
assert.equal(crowded.milestones.currentCount,7);cases++;
assert.equal(crowded.milestones.newItems,2);cases++;
assert.equal(crowded.milestones.gatherDone,true);cases++;
assert.throws(()=>compactAutonomyStatus({status:'complete'}));cases++;
console.log('MINECRAFT_STATUS_RECEIPT '+cases+'/'+cases+' PASS (offline bounded JSON)');
