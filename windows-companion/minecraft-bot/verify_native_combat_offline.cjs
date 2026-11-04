'use strict';
// Hostile combat source contract in fake Mineflayer events only, no real hits.
const assert=require('node:assert/strict');
const {fightObserved,ALLOWED_HOSTILES}=require('./native_combat.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {interpretOwnerInstruction}=require('./language_goal.cjs');
let passed=0;
function ok(v,msg){assert.ok(v,msg);passed++;console.log('PASS',msg);}
const position={distanceTo:p=>Math.hypot(p.x,p.y,p.z)};
const zombie={id:11,name:'zombie',position:{x:2,y:0,z:0}};
const player={id:12,name:'player',type:'player',username:'Owner',position:{x:2,y:0,z:0}};
const creeper={id:13,name:'creeper',position:{x:2,y:0,z:0}};
const enderDragon={id:14,name:'ender_dragon',position:{x:2,y:0,z:0}};
const entities={11:zombie,12:player,13:creeper,14:enderDragon};
const listeners=new Map();
let hits=0,emitDeath=true;
const bot={
 entity:{position},health:20,entities,
 on(event,fn){const list=listeners.get(event)||new Set();list.add(fn);listeners.set(event,list);},
 removeListener(event,fn){listeners.get(event)?.delete(fn);},
 attack(e){
  hits++;
  if(hits===2&&emitDeath)
   for(const fn of listeners.get('entityDead')||[])fn({id:e.id,name:e.name});
 }
};
(async()=>{
 ok(ALLOWED_HOSTILES.has('zombie')&&!ALLOWED_HOSTILES.has('creeper')&&
    !ALLOWED_HOSTILES.has('villager')&&!ALLOWED_HOSTILES.has('ender_dragon'),
    'combat catalog excludes creepers, NPCs, bosses and passive targets');
 ok(validateCommand({command:'attack_hostile',entityId:11,maxSwings:4})===null,
    'typed owner-authorized hostile action is valid');
 for(const q of [
  {command:'attack_hostile',entityId:11,maxSwings:0},
  {command:'attack_hostile',entityId:11,maxSwings:5},
  {command:'attack_hostile',entityId:11,maxSwings:4,playerId:17}
 ])ok(validateCommand(q)!==null,'malformed or extraneous combat parameters denied');
 let r=await fightObserved({bot,entityId:11,maxSwings:4,pause:async()=>{}});
 ok(r.ok&&r.verified&&hits===2,'server entityDead event is mandatory positive proof');
 ok(listeners.get('entityDead')?.size===0,'temporary death listener cleaned after verified combat');
 hits=0;emitDeath=false;
 r=await fightObserved({bot,entityId:11,maxSwings:2,pause:async()=>{}});
 ok(!r.ok&&!r.verified&&hits===2,'dispatched hits without death proof cannot claim defeat');
 for(const id of [12,13,14]){
  const before=hits;r=await fightObserved({bot,entityId:id,maxSwings:2,pause:async()=>{}});
  ok(!r.ok&&hits===before,'nonhostile, player or unsafe boss entity never attacked');
 }
 bot.health=7;
 r=await fightObserved({bot,entityId:11,maxSwings:2,pause:async()=>{}});
 ok(!r.ok,'unsafe health blocks optional combat');
 bot.health=20;
 await assert.rejects(fightObserved({bot,entityId:11,maxSwings:1,
  allowed:()=>false,pause:async()=>{}}),/cancelled/);
 ok(listeners.get('entityDead')?.size===0,'cancelled combat cleans temporary listener');
 const obs={joined:true,busy:false,health:20,nearbyBlocks:[],
  threats:[{id:11,name:'zombie',distance:2},{id:13,name:'creeper',distance:2}]};
 for(const [words,expected]of [
  ['attack the zombie',true],
  ['fight the zombie up to 2 times',true],
  ['kill the creeper',false],
  ['attack the villager',false],

  ['attack the zombie up to 5 times',false]
 ]){
  const v=await interpretOwnerInstruction(words,{env:{},context:JSON.stringify(obs),
   fetchImpl:async()=>{throw Error('Must not call model')}});
  ok(expected?v.ok&&v.command.command==='attack_hostile':!v.ok,
     'natural-language owner intent is bounded: '+words);
 }
 const dragon=await interpretOwnerInstruction('kill the ender dragon',{env:{},
  context:JSON.stringify(obs),fetchImpl:async()=>{throw Error('No model needed')}});
 ok(dragon.ok&&dragon.command.command==='auto_goal'&&dragon.command.goal==='dragon_run',
   'existing long-horizon Dragon mission remains the only boss route');
 const multiple={...obs,threats:[...obs.threats,{id:15,name:'zombie',distance:2}]};
 const uncertain=await interpretOwnerInstruction('attack the zombie',{
  env:{},context:JSON.stringify(multiple)});
 ok(!uncertain.ok,'two similar hostiles require target disambiguation');
 console.log('MINECRAFT_NATIVE_HOSTILE_COMBAT '+passed+'/'+passed+
  ' PASS (fake entity death events; NOT real game combat)');
})().catch(err=>{console.error(err);process.exitCode=1;});
