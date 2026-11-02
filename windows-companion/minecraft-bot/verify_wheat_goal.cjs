#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {validFarmSpec,farmPositions,observeWheat,wheatPlan}=require('./wheat_goal.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {createController}=require('./autonomy_engine.cjs');
let checks=0;const ok=(v,s)=>{assert.ok(v,s);checks++;};
const spec={goal:'farm_wheat',position:{x:4,y:65,z:8},width:2,depth:2,targetCount:2};
ok(validFarmSpec(spec),'Finite field accepted');
ok(validateCommand({command:'auto_goal',...spec})===null,'Owner protocol validates wheat farm');
ok(validSequence([spec]),'Can compose wheat farm with existing sequence');
for(const bad of [
 {...spec,width:5},{...spec,depth:0},{...spec,targetCount:17},
 {...spec,position:{x:29999984,y:65,z:3}},
 {...spec,position:{x:4,y:320,z:3}},{...spec,goal:'eval'},
 {...spec,shell:'whoami'},{...spec,position:{x:4,y:65,z:8,owner:'other'}}
])ok(!validFarmSpec(bad),'Invalid crop target denied');
const ps=farmPositions(spec);
ok(ps.length===4&&ps[3].x===5&&ps[3].z===9,'Observed field positions deterministic');
const key=p=>[p.x,p.y,p.z].join(':');
const map=new Map(),air={name:'air',boundingBox:'empty'},farmland={name:'farmland',boundingBox:'block'};
class V{constructor(x,y,z){Object.assign(this,{x,y,z});}offset(dx,dy,dz){return new V(this.x+dx,this.y+dy,this.z+dz);}}
for(const p of ps){map.set(key(p),{name:'wheat',getProperties:()=>({age:7})});map.set(key({x:p.x,y:p.y-1,z:p.z}),farmland);}
const bot={entity:{position:{x:4,y:65,z:7}},blockAt:p=>map.get(key(p))||air};
let observation=observeWheat(bot,spec,V);
ok(observation.every(c=>c.state==='mature'),'Only fully grown wheat considered mature');
map.set(key(ps[0]),{name:'wheat',getProperties:()=>({age:'unknown'})});
ok(observeWheat(bot,spec,V)[0].state==='unloaded',
 'Unknown crop age is unverified and cannot authorize harvesting');
map.set(key(ps[0]),{name:'wheat',getProperties:()=>({age:8})});
ok(observeWheat(bot,spec,V)[0].state==='unloaded',
 'Impossible crop age is rejected before reaching executor');
map.set(key(ps[0]),{name:'wheat',getProperties:()=>({age:7})});
const world={joined:true,health:20,hunger:20,threats:[],inventory:{raw:{wheat:0,wheat_seeds:0}},wheatCells:observation};
ok(wheatPlan(world,spec).kind==='harvest_wheat','Plan physical crop harvest');
const controller=createController({clock:()=>1000,maxSeconds:20000,maxSteps:100});
controller.start('farm_wheat',600,spec);
ok(controller.next(world).kind==='harvest_wheat','Real controller uses farm planner');
map.set(key(ps[0]),{name:'wheat',getProperties:()=>({age:6})});
observation=observeWheat(bot,spec,V);
ok(observation[0].state==='growing'&&wheatPlan({...world,wheatCells:observation},spec).position.x===4,'Immature crop skipped');
map.set(key(ps[0]),air);
observation=observeWheat(bot,spec,V);
ok(wheatPlan({...world,inventory:{raw:{wheat_seeds:1}},wheatCells:observation},spec).kind==='plant_wheat','Only real seeds permit planting');
ok(wheatPlan({...world,inventory:{raw:{wheat:2,wheat_seeds:1}},wheatCells:observation},spec).kind==='plant_wheat','Replanting prioritized over declaring done');
ok(wheatPlan({...world,inventory:{raw:{wheat:2}},wheatCells:observation},spec).kind==='complete','Harvest success requires observed wheat count');
for(const p of ps)map.set(key(p),{name:'wheat',getProperties:()=>({age:0})});
ok(wheatPlan({...world,wheatCells:observeWheat(bot,spec,V)},spec).kind==='wait','Immature crop cannot be harvested');
map.set(key(ps[2]),{name:'stone'});
ok(wheatPlan({...world,wheatCells:observeWheat(bot,spec,V)},spec).kind==='blocked','Never dig obstruction');
ok(wheatPlan({...world,wheatCells:[...observation].reverse()},spec).kind==='blocked','Stale reordered observations rejected');
map.set(key(ps[2]),{name:'wheat',getProperties:()=>({age:7})});
const unloaded={...bot,blockAt:p=>p.x===ps[2].x&&p.z===ps[2].z&&p.y===ps[2].y-1?null:bot.blockAt(p)};
ok(wheatPlan({...world,wheatCells:observeWheat(unloaded,spec,V)},spec).kind==='blocked','Unloaded floor fails closed');
const sequenceController=createController({clock:()=>1000,maxSeconds:20000,maxSteps:100});
sequenceController.start('sequence',600,{steps:[spec]});
ok(sequenceController.next({...world,wheatCellsByStage:[world.wheatCells]}).kind==='harvest_wheat',
  'Composed mission carries independent live wheat observations');
console.log('WHEAT_GOAL '+checks+'/'+checks+' PASS (offline only; no Java server)');
