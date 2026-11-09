#!/usr/bin/env node
'use strict';
/* JARVIS owner-bound bed action contracts. Offline only: no Minecraft client. */
const assert=require('node:assert/strict');
const {validateCommand}=require('./friend_protocol.cjs');
const {parseOwnerPrimitive,modelPrimitiveGrounded}=require('./general_play_intent.cjs');
const {directIntent,interpretOwnerInstruction}=require('./language_goal.cjs');
const {loadedTargets}=require('./minecraft_ai_observation.cjs');
const point={x:4,y:64,z:8};
let tests=0;
const check=(value,label)=>{assert.ok(value,label);tests++;};
const command={command:'sleep_in_bed',position:point};
check(validateCommand(command)===null,'Only a bounded integer bed coordinate is admitted');
for(const malformed of [
 {...command,shell:'whoami'},
 {...command,position:{...point,owner:'other'}},
 {...command,position:{x:4.5,y:64,z:8}},
 {...command,position:{x:30000001,y:64,z:8}},
 {command:'sleep_in_bed'},
]){
 check(validateCommand(malformed)!==null,'Malformed bed command is rejected');
}
const named=directIntent('sleep in bed at 4 64 8');
check(named?.ok===true&&named.command.command==='sleep_in_bed'&&
 JSON.stringify(named.command.position)===JSON.stringify(point),'Owner coordinates ground sleep action');
check(parseOwnerPrimitive('rest through the night in bed at 4 64 8')?.command==='sleep_in_bed',
 'Natural rest instruction maps to typed primitive');
const scene={joined:true,busy:false,position:{x:4,y:64,z:6},
 nearbyBlocks:[{name:'red_bed',...point}]};
check(modelPrimitiveGrounded(command,'sleep in nearby bed',JSON.stringify(scene)),
 'Bed model intent requires a currently observed physical block');
check(!modelPrimitiveGrounded(command,'sleep in nearby bed',JSON.stringify({...scene,nearbyBlocks:[]})),
 'Model cannot invent a nearby bed');
check(!modelPrimitiveGrounded(command,'open chest',JSON.stringify(scene)),
 'Chest request is not consent to sleep');
const seen=loadedTargets({
 entity:{position:{x:4,y:64,z:6}},
 findBlocks:()=>[{x:4,y:64,z:8},{x:4,y:64,z:9}],
 blockAt:p=>({name:'red_bed',getProperties:()=>({part:p.z===8?'head':'foot'})})
});
check(seen.length===1&&seen[0].z===8,'Only the loaded observed bed head is actionable');
(async()=>{
 const proposed=await interpretOwnerInstruction('sleep in nearby bed',{env:{},context:JSON.stringify(scene)});
 check(proposed.ok===true&&proposed.command.command==='sleep_in_bed'&&
  JSON.stringify(proposed.command.position)===JSON.stringify(point),
  'Nearby unambiguous bed becomes exact typed target without model guessing');
 const ambiguous=await interpretOwnerInstruction('sleep in nearby bed',{env:{},context:JSON.stringify({
  ...scene,nearbyBlocks:[...scene.nearbyBlocks,{name:'blue_bed',x:5,y:64,z:8}]
 })});
 check(ambiguous.ok===false,'Multiple observed beds require explicit owner coordinates');
 console.log('MINECRAFT_SLEEP_BED '+tests+'/'+tests+' PASS (offline only; no live night skip)');
})().catch(err=>{console.error(err);process.exitCode=1;});
