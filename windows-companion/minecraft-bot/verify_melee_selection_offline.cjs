'use strict';
// Source-loaded Minecraft equipment and combat API checks. NOT live Java.
const assert=require('node:assert/strict');
const {chooseObservedMelee,equipObservedMelee,fightObserved,validHostileTarget}
 =require('./native_combat.cjs');
let checks=0;
const ok=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS '+label)};
const sword=(name)=>({name,count:1});
const entity={id:11,name:'zombie',position:{x:2,y:0,z:0}};
const listeners=new Map();
const bot={
 entity:{position:{distanceTo:p=>Math.hypot(p.x,p.y,p.z)}},
 entities:{11:entity},health:18,heldItem:null,
 inventory:{items:()=>[sword('stone_sword'),sword('iron_sword'),
  sword('diamond_sword'),sword('stick')]},
 equip:async(item)=>{bot.heldItem=item;},
 attack:()=>{bot.attacks=(bot.attacks||0)+1;},
 on:(name,fn)=>{const all=listeners.get(name)||new Set();all.add(fn);listeners.set(name,all);},
 removeListener:(name,fn)=>listeners.get(name)?.delete(fn)
};
(async()=>{
 ok(chooseObservedMelee(bot)?.name==='diamond_sword',
  'observed diamond sword outranks weaker owned swords');
 const first=await equipObservedMelee(bot);
 ok(first.ok&&first.weapon==='diamond_sword'&&bot.heldItem?.name==='diamond_sword',
  'owned sword equipment requires real hand-slot readback');
 const second=await equipObservedMelee(bot);
 ok(second.ok&&second.weapon==='diamond_sword',
  'already-held sword does not require another equip');
 const report=await fightObserved({bot,entityId:11,maxSwings:1,pause:async()=>{}});
 ok(!report.ok&&!report.verified&&bot.attacks===1,
  'one swing without live entity death remains unverified');
 const cleanup=listeners.get('entityDead');
 ok(cleanup?.size===0,'combat event listener is removed');
 bot.heldItem=null;let equipCalls=0;
 bot.equip=async(item)=>{equipCalls++;bot.heldItem=item;};
 bot.attack=()=>{bot.attacks++;for(const fn of listeners.get('entityDead')||[])
  fn({id:11,name:'zombie'});};
 const defeated=await fightObserved({bot,entityId:11,maxSwings:3,pause:async()=>{}});
 ok(defeated.ok&&defeated.verified&&equipCalls===1,
  'single owner-limited bout equips best sword and verifies exact hostile death');
 bot.heldItem=null;const previous=bot.attacks;
 bot.equip=async()=>{}; // server did not confirm held item
 const failure=await fightObserved({bot,entityId:11,maxSwings:1,pause:async()=>{}});
 ok(!failure.ok&&!failure.verified&&bot.attacks===previous,
  'unverified equipped weapon blocks attack before any side effect');
 bot.equip=async(item)=>{bot.heldItem=item;entity.position.x=9;};
 const moved=await fightObserved({bot,entityId:11,maxSwings:2,pause:async()=>{}});
 ok(!moved.ok&&!moved.verified&&bot.attacks===previous,
  'target moving out of range during equipment change is not attacked');
 entity.position.x=2;bot.heldItem=null;
 bot.equip=async(item)=>{bot.heldItem=item;bot.health=7;};
 const danger=await fightObserved({bot,entityId:11,maxSwings:2,pause:async()=>{}});
 ok(!danger.ok&&!danger.verified&&bot.attacks===previous,
  'health dropping while equipping cancels attack');
 bot.health=18;bot.heldItem=null;
 bot.equip=async(item)=>{bot.heldItem=item;};
 await assert.rejects(equipObservedMelee(bot,()=>false),/cancelled/);
 ok(bot.attacks===previous,'owner cancellation before equip makes no attack');
 bot.heldItem=null;
 bot.inventory.items=()=>[sword('wooden_sword'),sword('iron_sword')];
 const medium=await equipObservedMelee(bot);
 ok(medium.ok&&bot.heldItem.name==='iron_sword','iron sword chosen above wood');
 bot.heldItem=null;bot.inventory.items=()=>[sword('stick')];
 const unarmed=await equipObservedMelee(bot);
 ok(unarmed.ok&&unarmed.weapon===null,'no sword never fabricates a weapon');
 bot.entities[12]={id:12,name:'villager',position:{x:2,y:0,z:0}};
 ok(!validHostileTarget(bot,12),'villagers remain disallowed combat targets');
 bot.entities[13]={id:13,name:'creeper',position:{x:2,y:0,z:0}};
 ok(!validHostileTarget(bot,13),'creeper remains disallowed for short melee');
 console.log('MINECRAFT_VERIFIED_MELEE_SELECTION '+checks+'/'+checks+
  ' PASS (mocked inventory and Mineflayer events; not live Java)');
})().catch(e=>{console.error(e);process.exitCode=1});
