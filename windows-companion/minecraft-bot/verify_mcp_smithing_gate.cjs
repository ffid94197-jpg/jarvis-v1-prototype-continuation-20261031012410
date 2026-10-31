'use strict';
/** Contract for an OPTIONAL host-supplied smith_item extension.
 * This suite is mock-only and never certifies an actual Minecraft smithing action.
 */
const assert=require('node:assert/strict');
const {planAction,checkedOutcome,observedWorld}=require('./mine_ai_mcp_mission.cjs');
let checks=0;
function check(label,fn){fn();checks++;console.log('PASS',label);}
const item='netherite_helmet',base='diamond_helmet';
const req={kind:'smith_netherite',item,base};
const advertised=new Map([['smith_item',{name:'smith_item'}]]);
const state=(data,position='main')=>({
 status:'succeeded',dimension:'minecraft:overworld',position:{x:0,y:64,z:0},
 vitals:{health:20,food:20},nearby:{players:[]},endFight:{dragons:[],crystals:[]},
 inventory:{stacks:Object.entries(data).filter(([,n])=>n>0).map(([name,count])=>({name,count,location:position}))}
});
const start=state({diamond_helmet:1,netherite_ingot:1,netherite_upgrade_smithing_template:1,smithing_table:1});
const end=state({netherite_helmet:1,smithing_table:1});
const ack={state:'settled',output:{result:{status:'succeeded'}}};
check('no advertised smithing capability stays blocked',()=>{
 assert.match(planAction(req,start).blocked,/does not advertise/i);
});
check('wrong diamond base cannot be substituted',()=>{
 assert.match(planAction({...req,base:'diamond_sword'},start,advertised).blocked,/invalid or mismatched/);
});
check('unknown requested output cannot be smith-ed',()=>{
 assert.match(planAction({...req,item:'netherite_shovel'},start,advertised).blocked,/invalid/);
});
check('missing material refuses dispatch before external side effect',()=>{
 assert.match(planAction(req,state({diamond_helmet:1,netherite_upgrade_smithing_template:1}),advertised).blocked,/Missing server-observed/);
});
check('mapped action is actual smith_item and not craft_item',()=>{
 const a=planAction(req,start,advertised);
 assert.equal(a.name,'smith_item');
 assert.deepEqual(a.args,{base_item_name:base,template_item_name:'netherite_upgrade_smithing_template',
  addition_item_name:'netherite_ingot',output_item_name:item});
});
check('verified vanilla ingredient consumption and output gain',()=>{
 const o=checkedOutcome(start,end,ack,req);
 assert.equal(o.verified,true);assert.equal(o.ok,true);
});
check('accepted action with no world change never verifies',()=>{
 assert.equal(checkedOutcome(start,start,ack,req).verified,false);
});
check('output gain without template consumption never verifies',()=>{
 assert.equal(checkedOutcome(start,state({netherite_helmet:1,netherite_upgrade_smithing_template:1}),ack,req).verified,false);
});
check('output gain without ingot consumption never verifies',()=>{
 assert.equal(checkedOutcome(start,state({netherite_helmet:1,netherite_ingot:1}),ack,req).verified,false);
});
check('output gain without diamond base consumption never verifies',()=>{
 assert.equal(checkedOutcome(start,state({netherite_helmet:1,diamond_helmet:1}),ack,req).verified,false);
});
check('failed receipt is rejected regardless of world changes',()=>{
 assert.equal(checkedOutcome(start,end,{state:'settled',output:{result:{status:'failed'}}},req).verified,false);
});
check('unsettled action is effect-unknown, not retryable victory',()=>{
 const r=checkedOutcome(start,end,{state:'pending',actionId:'active-action'},req);
 assert.equal(r.verified,false); assert.equal(r.effectUnknown,true);
});
check('carried armor cannot pretend it was equipped',()=>{
 assert.equal(observedWorld(end).wornNetherite,false);
});
console.log('MCP_SMITHING_CONTRACT',checks+'/'+checks,'PASS (mock host extension; LIVE SMITHING NOT VERIFIED)');
