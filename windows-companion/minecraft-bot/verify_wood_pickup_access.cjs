#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {rankLogs}=require('./wood_navigation.cjs');
const {pickupFeet}=require('./drop_pickup.cjs');
const origin=new Vec3(.5,65,.5);
const lower=new Vec3(2,65,0),high=new Vec3(3,76,0);
const bot={
 entity:{position:origin},
 blockAt(p){
   if(p.x===2&&p.y===65&&p.z===0)
     return {name:'oak_log',boundingBox:'block',position:p};
   return {name:p.y===64?'dirt':'air',
     boundingBox:p.y===64?'block':'empty',position:p};
 }
};
const accessible=p=>{
 const stand=pickupFeet(bot,p.offset(.5,.5,.5),Vec3);
 return !!stand && stand.distanceTo(p)<=4.5;
};
const result=rankLogs([high,lower],origin,accessible);
assert.deepEqual(result,[lower],
 'Avoid upper canopy log when only its far-below ground is standable; keep accessible base log');
assert.equal(rankLogs([high],origin,accessible).length,0,
 'When all logs have unreachable pickup feet, scout instead of mining stranded drops');
assert.equal(rankLogs([high,lower],origin,()=>false).length,0,
 'Externally denied wood access must fail closed');
console.log('MINECRAFT_WOOD_PICKUP_ACCESS 3/3 PASS (offline geometry only)');
