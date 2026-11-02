#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {itemEntities,pickupFeet,pickupFootCandidates,collectObservedDrop}=require('./drop_pickup.cjs');
let checks=0;
function ok(cond,why){assert(cond,why);checks++;}
const mk=(type='dirt')=>{
 const bot={entity:{position:new Vec3(.5,64,.5)},entities:{},
   blockAt(p){return {
     name:p.y===63?type:'air',
     boundingBox:p.y===63?'block':'empty',position:p.clone()
   };}};
 return bot;
};
(async()=>{
 const origin=new Vec3(3,64,0);
 const bot=mk();
 bot.entities={1:{id:1,name:'item',position:new Vec3(3.5,64.2,.5)},
   2:{id:2,name:'zombie',position:new Vec3(3.5,64.2,.5)}};
 ok(itemEntities(bot,origin).length===1,'Only physical item-drop entities qualify');
 const foot=pickupFeet(bot,bot.entities[1].position,Vec3);
 ok(foot?.x===3&&foot?.y===64,'Find observed standable pickup location with solid safe floor');
 let now=0,held=0,moved=0;
 const acquired=await collectObservedDrop({
   bot,origin,beforeCount:0,readCount:()=>held,
   move:async(p,range)=>{
     ok(range===0,'Pickup navigation demands precise floor reach');
     moved++;bot.entity.position=p.clone();held=1;return true;
   },
   check:()=>{},wait:async()=>{now+=350},deadline:2000,now:()=>now,Vec3
 });
 ok(acquired.ok&&acquired.verified&&held===1&&moved===1,
   'Real inventory delta is the sole pickup success proof');
 let noLootTime=0,attempts=0;
 const denied=await collectObservedDrop({
   bot:mk(),origin,beforeCount:0,readCount:()=>0,
   move:async()=>{attempts++;return true},check:()=>{},
   wait:async()=>{noLootTime+=350},deadline:1100,now:()=>noLootTime,Vec3
 });
 ok(!denied.ok&&!denied.verified,'Movement and dug block are never certified as inventory loot');
 ok(attempts<=4,'Pickup attempts are bounded');
 ok(pickupFeet(mk('lava'),origin,Vec3)===null,'Lava-only ground is unsafe for pickup navigation');
 // A nearby unrelated/unreachable entity must not monopolize all pickup
 // attempts. An independently observed inventory gain remains mandatory.
 const multi=mk();
 multi.entities={
   1:{id:1,name:'item',position:new Vec3(1.5,64.2,.5)},
   2:{id:2,name:'item',position:new Vec3(4.5,64.2,.5)}
 };
 let moves=[],multiNow=0,multiItems=0;
 const alternate=await collectObservedDrop({
   bot:multi,origin:new Vec3(2.5,64,.5),beforeCount:0,
   readCount:()=>multiItems,
   move:async p=>{
     moves.push(p.x);
     if(p.x>=4){multiItems=1;multi.entity.position=p.clone();return true;}
     return false;
   },
   check:()=>{},wait:async()=>{multiNow+=350;},deadline:2300,now:()=>multiNow,Vec3
 });
 ok(alternate.ok&&alternate.verified&&multiItems===1,
   'Alternate physical item location succeeds only after server inventory gain');
 ok(moves.length>=2&&moves.some(x=>x<3)&&moves.some(x=>x>=4),
   'Unreachable first drop does not starve a second safe pickup location');
 // The nearest pickup point can have NO route even while an adjacent
 // safe standable floor tile is reachable. Rotate within the same drop.
 const oneDrop=mk();
 oneDrop.entities={1:{id:1,name:'item',position:new Vec3(3.5,64.2,.5)}};
 const feet=pickupFootCandidates(oneDrop,oneDrop.entities[1].position,Vec3);
 ok(feet.length>=2 && feet[0].x===3,
   'One visible item exposes several safe alternative collection stances');
 let routeNow=0,routeMoves=[],items=0;
 const rotated=await collectObservedDrop({
   bot:oneDrop,origin:new Vec3(3,64,0),beforeCount:0,
   readCount:()=>items,
   move:async(target)=>{
     routeMoves.push(target.x);
     // The center is obstructed to pathfinding, but the east neighbor is open.
     if(target.x>=4){items=1;oneDrop.entity.position=target.clone();return true;}
     return false;
   },
   check:()=>{},wait:async()=>{routeNow+=350},deadline:3500,now:()=>routeNow,Vec3
 });
 ok(rotated.ok && rotated.verified && routeMoves.some(x=>x<4) &&
    routeMoves.some(x=>x>=4),
   'Pickup retries a different safe stance for the SAME drop, then verifies inventory');
 let cancelled=false;
 try{await collectObservedDrop({
   bot:mk(),origin,beforeCount:0,readCount:()=>0,
   move:async()=>true,check:()=>{throw Error('owner E-stop')},
   wait:async()=>{},deadline:500,now:()=>0,Vec3
 });}catch(e){cancelled=e.message==='owner E-stop';}
 ok(cancelled,'Owner cancellation must immediately interrupt pickup recovery');
 console.log('MINECRAFT_DROP_PICKUP '+checks+'/'+checks+' PASS (mock only; live survival still required)');
})().catch(e=>{console.error(e);process.exitCode=1;});
