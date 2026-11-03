#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {findCraftingSite,findCarvableCraftingAlcove}=require('./crafting_site.cjs');
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
const shaft=fixture();
for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)
 for(let y=58;y<=62;y++)shaft.put(x,y,z,'stone');
shaft.put(0,59,0,'air');shaft.put(0,60,0,'air');
shaft.bot.entity.position=new Vec3(.5,59,.5);
shaft.bot.canDigBlock=block=>block?.position?.distanceTo(shaft.bot.entity.position)<4.3;
verify(findCraftingSite(shaft.bot)===null,'Narrow shaft has no immediately placeable table space');
const alcove=findCarvableCraftingAlcove(shaft.bot);
verify(alcove?.blocks?.length===2 && alcove.target.y===59,
 'Safe adjacent natural stone can be opened into two-high crafting alcove');
for(const pos of alcove.blocks)shaft.put(pos.x,pos.y,pos.z,'air');
verify(findCraftingSite(shaft.bot)!==null,
 'After real block-state changes, previous shaft would have a usable adjacent crafting station');
const protectedShaft=fixture();
for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)
 for(let y=58;y<=62;y++)protectedShaft.put(x,y,z,'stone');
protectedShaft.put(0,59,0,'air');protectedShaft.put(0,60,0,'air');
for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]])
 protectedShaft.put(x,59,z,'crafting_table');
protectedShaft.bot.entity.position=new Vec3(.5,59,.5);
protectedShaft.bot.canDigBlock=()=>true;
verify(findCarvableCraftingAlcove(protectedShaft.bot)===null,
 'Do not mine a neighboring player crafting table or other placed structures to make space');
console.log('MINECRAFT_CRAFTING_SITE '+n+'/'+n+' PASS; independent geometry only, NOT live Minecraft Java');
