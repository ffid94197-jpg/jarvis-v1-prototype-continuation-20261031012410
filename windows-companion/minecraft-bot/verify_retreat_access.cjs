#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {retreatStances}=require('./retreat_access.cjs');
let n=0;const check=(v,m)=>{assert(v,m);n++;};
function fixture(ground='dirt'){
 return {blockAt(p){const name=p.y===63?ground:'air';
   return {name,boundingBox:name==='air'?'empty':'block',position:p};
 }};
}
const hero=new Vec3(.5,64,.5),dragon=new Vec3(5,64,.5);
const stances=retreatStances(fixture(),hero,dragon,Vec3);
check(stances.length>0,'A safe loaded flat ground offers escape from an observed Dragon');
check(stances.every(p=>p.distanceTo(dragon)>=hero.distanceTo(dragon)+3),
 'Every candidate must increase actual physical separation from hostile');
check(stances.every(p=>p.distanceTo(hero)>3),'No fake in-place retreat');
check(retreatStances(fixture('lava'),hero,dragon,Vec3).length===0,
 'A lava floor must never be treated as escape terrain');
check(retreatStances({blockAt:()=>null},hero,dragon,Vec3).length===0,
 'Unknown chunks never authorize retreat');
check(retreatStances(fixture(),hero,null,Vec3).length===0,
 'Missing threat cannot produce a fabricated retreat route');
console.log('MINECRAFT_HOSTILE_RETREAT '+n+'/'+n+' PASS (offline geometry, not combat)');
