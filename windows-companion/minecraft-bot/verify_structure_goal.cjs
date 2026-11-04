#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {validBuildSpec,validWallSpec,validPlatformSpec,buildPositions,observeBuild,buildPlan}=require('./structure_goal.cjs');
let n=0;function check(x,reason){assert(x,reason);n++;}
const spec={goal:'build',block:'cobblestone',axis:'x+',length:3,
 position:{x:4,y:64,z:9}};
check(validBuildSpec(spec),'Bounded build goal accepted');
for(const bad of [
 {...spec,length:9}, {...spec,block:'command_block'},
 {...spec,axis:'y+'},{...spec,position:{x:4,y:320,z:0}},
 {...spec,evil:'run command'},{...spec,position:{x:29999985,y:64,z:0}}
])check(!validBuildSpec(bad),'Invalid construction denied');
const positions=buildPositions(spec);
const wall={goal:'wall',length:4,height:2};
check(validWallSpec(wall),'Simple wall request has a bounded typed contract');
check(!validWallSpec({...wall,length:9}),'Wall length cannot exceed eight blocks');
check(!validWallSpec({...wall,height:5}),'Wall height cannot exceed four blocks');
check(!validWallSpec({...wall,script:'execute'}),'Wall intent rejects extra executable fields');
check(validPlatformSpec({goal:'platform',length:3,width:4}),'Platform dimensions have a bounded typed contract');
check(!validPlatformSpec({goal:'platform',length:9,width:4}),'Platform length cannot exceed eight rows');
check(!validPlatformSpec({goal:'platform',length:3,width:9}),'Platform width cannot exceed eight blocks');
check(!validPlatformSpec({goal:'platform',length:3,width:3,position:{x:0,y:64,z:0}}),'Platform cannot smuggle arbitrary coordinates');
const layered={...spec,length:2,height:2};
const layeredPositions=buildPositions(layered);
check(layeredPositions.length===4&&layeredPositions[0].y===64&&layeredPositions[2].y===65,
 'Multi-layer wall positions are ordered bottom-up for supported placement');
check(positions[2].x===6&&positions[2].z===9,'Block row is deterministic');
const cells=new Map();const key=p=>[p.x,p.y,p.z].join(':');
const bot={entity:{position:{x:4,y:64,z:8}},blockAt(p){return cells.get(key(p))||
  {name:p.y===63?'stone':'air',boundingBox:p.y===63?'block':'empty'};}};
class Vec3 {constructor(x,y,z){this.x=x;this.y=y;this.z=z;}offset(x,y,z){return new Vec3(this.x+x,this.y+y,this.z+z);}}
let observed=observeBuild(bot,spec,Vec3);
check(observed.length===3&&observed.every(c=>c.state==='ready'),'Only safe empty supported cells admitted');
const layeredObserved=observeBuild(bot,layered,Vec3);
check(layeredObserved.length===4&&layeredObserved[0].state==='ready'&&layeredObserved[2].state==='unsupported',
 'Upper wall layer waits for its lower support blocks to be physically placed');
check(buildPlan({inventory:{raw:{cobblestone:1}},buildCells:layeredObserved},layered).kind==='place_build_block',
 'Layered wall builds bottom-up without claiming unsupported upper blocks');
const world={inventory:{raw:{cobblestone:1}},buildCells:observed};
let plan=buildPlan(world,spec);
check(plan.kind==='place_build_block'&&plan.position.x===4,'Place first observed block');
check(buildPlan({...world,inventory:{raw:{}}},spec,()=>({kind:'mine_cobblestone'})).kind==='mine_cobblestone',
 'Missing cobblestone delegates to real survival gathering');
check(buildPlan({...world,inventory:{raw:{}}},spec).kind==='blocked',
 'Without verified inventory or real gather ability, block construction');
cells.set(key(positions[0]),{name:'cobblestone',boundingBox:'block'});
observed=observeBuild(bot,spec,Vec3);
check(buildPlan({...world,buildCells:observed},spec).position.x===5,
 'Server-observed first block advances to second');
for(const p of positions)cells.set(key(p),{name:'cobblestone',boundingBox:'block'});
check(buildPlan({...world,buildCells:observeBuild(bot,spec,Vec3)},spec).kind==='complete',
 'Success requires live observed full structure');
cells.set(key(positions[1]),{name:'chest',boundingBox:'block'});
check(buildPlan({...world,buildCells:observeBuild(bot,spec,Vec3)},spec).kind==='blocked',
 'Existing player block is never replaced');
cells.set(key(positions[1]),{name:'air',boundingBox:'empty'});
cells.set(key({x:positions[1].x,y:63,z:positions[1].z}),{name:'lava',boundingBox:'block'});
check(buildPlan({...world,buildCells:observeBuild(bot,spec,Vec3)},spec).kind==='blocked',
 'Hazardous support is rejected');
check(buildPlan({...world,buildCells:[...observed].reverse()},spec).kind==='blocked',
 'Reordered or stale cell proofs are rejected');
console.log('MINECRAFT_STRUCTURE_GOAL '+n+'/'+n+' PASS (offline state checks; not real Java)');
