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
console.log('MINECRAFT_CROP_GOAL '+checks+'/'+checks+' PASS (offline only)');
