/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Owner-authorized safe terrain gathering. No real Minecraft Java connection.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {SAFE_GENERIC_RESOURCES,resourceCount,resourcePlan}=require('./resource_goal.cjs');
let checks=0;
function ok(condition,label){assert.ok(condition,label);checks++;console.log('PASS',label);}
for(const material of SAFE_GENERIC_RESOURCES){
 const target={resource:material,targetCount:2},empty={joined:true,inventory:{raw:{[material]:0}}};
 const plan=resourcePlan(empty,{},target,()=>({kind:'noop'}));
 ok(plan.kind==='mine_generic'&&plan.resource===material,'bounded generic plan '+material);
 const actual={joined:true,inventory:{raw:{[material]:2}}};
 ok(resourcePlan(actual,{},target,()=>({kind:'noop'})).kind==='complete',
   'server-backed inventory completion '+material);
 ok(resourceCount(actual,material)===2,'actual inventory counter '+material);
 ok(resourcePlan(empty,{mine_generic:3},target,()=>({kind:'noop'})).kind==='blocked',
   'failed gather blocks rather than spins '+material);
}
const source=fs.readFileSync(path.join(__dirname,'late_skills.cjs'),'utf8');
const loaded={exports:{}};
vm.runInNewContext(source,{
 module:loaded,exports:loaded.exports,
 require:dep=>{
  if(dep==='./resource_goal.cjs')return {SAFE_GENERIC_RESOURCES};
  if(dep==='./late_game.cjs')return {NETHERITE:[]};
  if(dep==='./drop_pickup.cjs')return {collectObservedDrop:async({beforeCount,readCount})=>{
   const verified=readCount()>beforeCount;
   return {ok:verified,verified,detail:verified?'real pickup counted':'no pickup proved'};
  }};
  return {};
 },Date,setTimeout,clearTimeout,Promise
});
class Vec3{
 constructor(x,y,z){Object.assign(this,{x,y,z});}
 clone(){return new Vec3(this.x,this.y,this.z);}
 offset(dx,dy,dz){return new Vec3(this.x+dx,this.y+dy,this.z+dz);}
 distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);}
}
let inventory=[],removed=false,produce=true,movement=0;
const block={name:'dirt',position:new Vec3(2,64,1)};
const bot={
 entity:{position:new Vec3(1,64,1)},
 inventory:{items:()=>inventory},
 findBlock:({matching})=>!removed&&matching(block)?block:null,
 blockAt:p=>(p.x===2&&p.y===64&&p.z===1&&!removed)?
   block:{name:'air',boundingBox:'empty'},
 dig:async()=>{removed=true;if(produce)inventory.push({name:'dirt',count:1});},
 equip:async()=>{throw Error('Bare-hand gather must not require an equipped tool');}
};
const skills=loaded.exports.createLateSkills({
 bot,navigate:async()=>{movement++;return true;},
 craftNamed:async()=>{},getEpoch:()=>1,getOwner:()=>'',digest:()=>({}),Vec3
});
(async()=>{
 let result=await skills.run({kind:'mine_generic',resource:'dirt'},1);
 ok(result.ok&&result.verified&&movement>0&&inventory[0]?.name==='dirt',
   'real dig and independent pickup proof required for success');
 result=await skills.run({kind:'mine_generic',resource:'diamond'},1);
 ok(!result.ok&&!result.verified,'generic path may not bypass ore mining progression');
 removed=false;inventory=[];produce=false;
 result=await skills.run({kind:'mine_generic',resource:'dirt'},1);
 ok(!result.ok&&!result.verified,'dispatch without received inventory cannot complete');
 console.log('MINECRAFT_SAFE_GENERAL_GATHER '+checks+'/'+checks+
  ' PASS (offline stubs; no live Minecraft Java acceptance)');
})().catch(err=>{console.error(err);process.exitCode=1;});
