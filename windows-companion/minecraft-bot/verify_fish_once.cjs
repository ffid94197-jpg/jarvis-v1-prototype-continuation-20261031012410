#!/usr/bin/env node
'use strict';
/** Source-only owner-bound fishing contract; never launches Java Minecraft. */
const assert=require('node:assert/strict');
const {validateCommand}=require('./friend_protocol.cjs');
const {parseOwnerPrimitive,modelPrimitiveGrounded}=require('./general_play_intent.cjs');
const {directIntent,interpretOwnerInstruction}=require('./language_goal.cjs');
const {loadedTargets}=require('./minecraft_ai_observation.cjs');
let count=0;const check=(v,msg)=>{assert.ok(v,msg);count++;};
const position={x:3,y:64,z:8},command={command:'fish_once',position};
check(validateCommand(command)===null,'One exact authorized water target is valid');
for(const bad of [
 {...command,position:{...position,shell:'whoami'}},
 {...command,position:{...position,x:1.5}},
 {...command,position:{...position,z:30000001}},
 {...command,exec:'curl'}, {command:'fish_once'}
])check(validateCommand(bad)!==null,'Unknown or malformed fishing arguments rejected');
const request=directIntent('catch a fish in water at 3 64 8');
check(request.ok&&request.command.command==='fish_once'&&
 JSON.stringify(request.command.position)===JSON.stringify(position),'Owner coordinate fishing intent');
check(parseOwnerPrimitive('fish once in nearby water at 3 64 8')?.command==='fish_once',
 'Typed natural fishing request grounded in coordinate');
const scene={joined:true,busy:false,position:{x:3,y:64,z:6},
 nearbyBlocks:[{name:'water',...position}]};
check(modelPrimitiveGrounded(command,'fish once in water',JSON.stringify(scene)),
 'Model can select only actual observed water');
check(!modelPrimitiveGrounded(command,'fish once in water',JSON.stringify({
 ...scene,nearbyBlocks:[]})),'Unobserved water denied');
check(!modelPrimitiveGrounded(command,'do not fish in water',JSON.stringify(scene)),
 'Negative owner intent cannot authorize a cast');
check(!modelPrimitiveGrounded(command,'fish once in water and build a boat',JSON.stringify(scene)),
 'One fishing effect cannot silently satisfy a compound owner instruction');
const seen=loadedTargets({
 entity:{position:{x:3,y:64,z:6}},
 findBlocks:()=>[{...position}],blockAt:()=>({name:'water'})
},{includeGeneral:true});
check(seen.some(x=>x.name==='water'&&x.x===position.x&&x.z===position.z),
 'Only actual loaded nearby water included in candidate scene');
(async()=>{
 const one=await interpretOwnerInstruction('fish once in nearby water',{env:{},context:JSON.stringify(scene)});
 check(one.ok&&one.command.command==='fish_once'&&
  JSON.stringify(one.command.position)===JSON.stringify(position),
  'Single observed nearby water target is admissible');
 const multiple=await interpretOwnerInstruction('fish once in nearby water',{env:{},
  context:JSON.stringify({...scene,nearbyBlocks:[...scene.nearbyBlocks,
   {name:'water',x:4,y:64,z:8}]})});
 check(!multiple.ok,'Ambiguous water sites require coordinates');
 console.log('MINECRAFT_FISH_ONCE '+count+'/'+count+' PASS (offline only; no fish caught)');
})().catch(e=>{console.error(e);process.exitCode=1;});
