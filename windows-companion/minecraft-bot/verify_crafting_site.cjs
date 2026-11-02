#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {findCraftingSite}=require('./crafting_site.cjs');
let n=0;const verify=(ok,msg)=>{assert(ok,msg);n++;};
function fixture(){
 const blocks=new Map(),key=p=>[p.x,p.y,p.z].join(',');
 const block=(p,name)=>({name,boundingBox:['air','cave_air','short_grass'].includes(name)?'empty':'block',position:p});
 const put=(x,y,z,name)=>blocks.set(key(new Vec3(x,y,z)),block(new Vec3(x,y,z),name));
 for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)put(x,64,z,'dirt');
 const bot={
  entity:{position:new Vec3(.5,65,.5)},
  blockAt:p=>blocks.get(key(p))||block(p,'air')
 };
 return {bot,put};
}
const base=fixture();
const a=findCraftingSite(base.bot);
verify(a?.ground && a?.target,'flat ground has valid adjacent site');
verify(a.target.y===65 && a.distance<4.2,'placement height and reach independently bounded');
const forest=fixture();
for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]])
 forest.put(x,65,z,'oak_log');
const diagonal=findCraftingSite(forest.bot);
verify(diagonal && Math.abs(diagonal.target.x)+Math.abs(diagonal.target.z)>=2,
 'obstructed cardinal sites do not block usable diagonal ground');
const flooded=fixture();
for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)
 flooded.put(x,64,z,'lava');
verify(findCraftingSite(flooded.bot)===null,'hazardous ground never authorizes placement');
const blocked=fixture();
for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)
 for(let y=62;y<=68;y++)blocked.put(x,y,z,'stone');
verify(findCraftingSite(blocked.bot)===null,'no empty space means placement impossible');
console.log('MINECRAFT_CRAFTING_SITE '+n+'/'+n+' PASS; independent geometry only, NOT live Minecraft Java');
