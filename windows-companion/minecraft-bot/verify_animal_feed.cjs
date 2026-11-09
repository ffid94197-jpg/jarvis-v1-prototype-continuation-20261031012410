#!/usr/bin/env node
'use strict';
/** Owner-bound one-animal feeding contract; no live breeding/taming claim. */
const assert=require('node:assert/strict');
const {validFeedPair,validFeedArgs}=require('./animal_feeding.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {modelPrimitiveGrounded}=require('./general_play_intent.cjs');
const {interpretOwnerInstruction}=require('./language_goal.cjs');
let checked=0;const ok=(v,msg)=>{assert.ok(v,msg);checked++;};
for(const [animal,item] of [['cow','wheat'],['sheep','wheat'],['pig','carrot'],['pig','potato'],
 ['pig','beetroot'],['chicken','wheat_seeds'],['chicken','beetroot_seeds']])
 ok(validFeedPair(animal,item),'Exact approved vanilla food pairing');
for(const [animal,item] of [['cow','potato'],['pig','wheat'],['creeper','wheat'],
 ['chicken','wheat'],['villager','carrot']])
 ok(!validFeedPair(animal,item),'Wrong item, villager or hostile is denied');
const command={command:'feed_animal',entityId:19,item:'wheat'};
ok(validFeedArgs(command)&&validateCommand(command)===null,'Strict single-animal command admitted');
for(const bad of [{...command,entityId:-1},{...command,item:'tnt'},
 {...command,shell:'ls'},{command:'feed_animal',entityId:19},
 {...command,entityId:200001}])
 ok(validateCommand(bad)!==null,'Malformed food or foreign instructions denied');
const world={joined:true,busy:false,position:{x:1,y:64,z:2},
 animals:[{id:19,name:'cow',distance:2}]};
ok(modelPrimitiveGrounded(command,'feed cow with wheat',JSON.stringify(world)),
 'One owner-specified observed animal and food');
ok(!modelPrimitiveGrounded(command,'feed cow with wheat',
 JSON.stringify({...world,animals:[]})),'Unseen animal ID not permitted');
ok(!modelPrimitiveGrounded(command,'breed cows with wheat',JSON.stringify(world)),
 'Breeding claim not permitted by feed primitive');
ok(!modelPrimitiveGrounded(command,'feed cow with potato',JSON.stringify(world)),
 'Model cannot silently substitute a different owner food');
(async()=>{
 const r=await interpretOwnerInstruction('feed the cow with wheat',{env:{},context:JSON.stringify(world)});
 ok(r.ok&&r.command.command==='feed_animal'&&r.command.entityId===19&&
  r.command.item==='wheat','Natural owner language resolves one exact real target');
 const ambiguous=await interpretOwnerInstruction('feed the cow with wheat',
  {env:{},context:JSON.stringify({...world,animals:[
   {id:19,name:'cow',distance:2},{id:20,name:'cow',distance:3}]})});
 ok(ambiguous.ok===false,'Multiple cows are ambiguous and denied');
 const wrongFood=await interpretOwnerInstruction('feed the cow with carrot',
  {env:{},context:JSON.stringify(world)});
 ok(wrongFood.ok===false,'Unsupported food for observed species denied');
 console.log('MINECRAFT_ANIMAL_FEED '+checked+'/'+checked+
 ' PASS (offline only; no real animal fed)');
})().catch(err=>{console.error(err);process.exitCode=1;});
