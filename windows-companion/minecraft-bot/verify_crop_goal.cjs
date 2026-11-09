#!/usr/bin/env node
'use strict';
/** Bounded owner-crop contract: offline only, never claims live Minecraft. */
const assert=require('node:assert/strict');
const {CROPS,CROP_BLOCKS,MATURE_AGE,validCropSpec,cropPositions,observeCrop,cropPlan}=require('./crop_goal.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {directIntent}=require('./language_goal.cjs');
let checks=0;function check(value,label){assert.ok(value,label);checks++;}
const spec={goal:'farm_crop',crop:'beetroot',targetCount:2,width:2,depth:1,position:{x:4,y:65,z:8}};
check(CROPS.beetroot==='beetroot'&&CROP_BLOCKS.beetroot==='beetroots'&&MATURE_AGE.beetroot===3,'Vanilla beetroot item, block and maturity are distinct');
check(validCropSpec(spec)&&validSequence([spec])&&validateCommand({command:'auto_goal',...spec})===null,'Owned crop is valid as bounded mission/sequence stage');
check(!validCropSpec({...spec,crop:'wheat'})&&!validCropSpec({...spec,width:5}),'Unsupported crop and oversized plot denied');
const parsed=directIntent('farm two beetroots in a field of 2 by 1 at 4 65 8');
check(parsed.ok&&parsed.command.goal==='farm_crop'&&parsed.command.crop==='beetroot','Natural-language beetroot intent');
class V{constructor(x,y,z){Object.assign(this,{x,y,z});}offset(x,y,z){return new V(this.x+x,this.y+y,this.z+z);}}
const key=p=>[p.x,p.y,p.z].join(':');
const blocks=new Map(),farmland={name:'farmland'};
for(const p of cropPositions(spec)){
 blocks.set(key(p),{name:'beetroots',getProperties:()=>({age:3})});
 blocks.set(key({x:p.x,y:p.y-1,z:p.z}),farmland);
}
const bot={entity:{position:{}},blockAt:p=>blocks.get(key(p))||{name:'air'}};
const cells=()=>observeCrop(bot,spec,V);
check(cells().every(c=>c.state==='mature'),'Only real mature age-three crop is harvestable');
check(cropPlan({cropCells:cells(),inventory:{raw:{}}},spec).kind==='harvest_crop','Observed mature crop permits harvest');
const positions=cropPositions(spec);
blocks.set(key(positions[0]),{name:'beetroots',getProperties:()=>({age:2})});
check(cells()[0].state==='growing','Age two crop not mature');
blocks.set(key(positions[0]),{name:'beetroots',getProperties:()=>({age:4})});
check(cells()[0].state==='unloaded','Impossible age denied');
for(const p of positions)blocks.set(key(p),{name:'air'});
check(cropPlan({cropCells:cells(),inventory:{raw:{beetroot:4}}},spec).kind!=='plant_crop','Beetroot vegetable cannot substitute for seed');
check(cropPlan({cropCells:cells(),inventory:{raw:{beetroot_seeds:1}}},spec).kind==='plant_crop','Physical beetroot seed required for planting');
const complete={...spec,milestones:{harvestedCropCount:2}};
check(cropPlan({cropCells:cells(),inventory:{raw:{beetroot:2}}},complete).kind==='complete','Mission crop receipts and actual holding both required');
check(cropPlan({cropCells:cells(),inventory:{raw:{beetroot:0}}},complete).kind==='blocked','Lost crop holdings cannot be falsely marked complete');
const {createController}=require('./autonomy_engine.cjs');
const stageWorld=raw=>({
  joined:true,dimension:'minecraft:overworld',position:{x:4,y:65,z:7},
  health:20,hunger:20,threats:[],inventory:{raw},
  cropCellsByStage:[cropPositions(spec).map(position=>({position,state:'mature'}))]
});
const controller=createController({clock:()=>1000,maxSteps:40,maxSeconds:1000});
controller.start('sequence',300,{steps:[spec]});
const staged=controller.next(stageWorld({}));
check(staged.kind==='harvest_crop'&&staged.crop==='beetroot','Sequence uses current stage and fresh crop observations');
controller.record(staged,{ok:true,verified:true,proof:'crop_harvest',crop:'beetroot',count:2});
check(controller.status().milestones.harvestedCropCount===2,'Stage-matched verified harvest receipt is accumulated');
check(controller.next(stageWorld({beetroot:2})).kind==='complete','Sequence requires harvest receipt plus fresh crop inventory before completion');
const wrong=createController({clock:()=>1000,maxSteps:40,maxSeconds:1000});
wrong.start('sequence',300,{steps:[spec]});
const pending=wrong.next(stageWorld({}));
wrong.record(pending,{ok:true,verified:true,proof:'crop_harvest',crop:'potatoes',count:2});
check((wrong.status().milestones.harvestedCropCount||0)===0,'Wrong-crop receipt cannot settle the requested stage');
console.log('MINECRAFT_CROP_GOAL '+checks+'/'+checks+' PASS (offline only)');
