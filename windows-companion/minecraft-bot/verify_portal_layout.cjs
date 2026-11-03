#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {findPortalLayout,pos,isClear}=require('./portal_layout.cjs');
const player=new Vec3(.5,65,.5);
let checks=0;
function test(ok,message){assert(ok,message);checks++;}
function world(blockName){
 return {blockAt(p){
  const name=p.y===64?blockName:'air';
  return {name,position:p,boundingBox:name==='air'?'empty':'block'};
 }};
}
const flat=findPortalLayout(world('dirt'),player,Vec3);
test(!!flat,'Safe loaded ground can support a Nether portal');
test(flat.axis.x===1&&flat.axis.z===0,'X-axis portal preserved for open ground');
test(pos(flat.base,flat.axis,3,4).y===flat.base.y+4,
 'Top-right block of vanilla frame has actual +4 vertical position');
test(isClear(world('dirt'),flat.base,flat.axis),
 'Every 4x5 frame coordinate and foundation checked');
test(findPortalLayout(world('lava'),player,Vec3)===null,
 'No portal may be placed over hazardous lava floor');
test(findPortalLayout({blockAt:()=>null},player,Vec3)===null,
 'Unloaded chunks cannot approve portal geometry');
const zWorld={blockAt(p){
 const floor=p.y===64&&p.x===3&&p.z>=0&&p.z<=3;
 const name=floor?'dirt':'air';
 return {name,position:p,boundingBox:floor?'block':'empty'};
}};
const z=findPortalLayout(zWorld,player,Vec3);
test(z?.axis.x===0&&z?.axis.z===1,'Z-axis alternative works when X-plane foundation is absent');
console.log('MINECRAFT_PORTAL_GEOMETRY '+checks+'/'+checks+
 ' PASS; geometry only, NOT real Nether portal activation');
