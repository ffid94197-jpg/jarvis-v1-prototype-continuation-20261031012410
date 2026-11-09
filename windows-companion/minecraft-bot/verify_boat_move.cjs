#!/usr/bin/env node
'use strict';
/** Offline-only owner-bound boat control contract; does NOT claim live travel. */
const assert=require('node:assert/strict');
const {validateCommand}=require('./friend_protocol.cjs');
const {modelPrimitiveGrounded}=require('./general_play_intent.cjs');
const {interpretOwnerInstruction}=require('./language_goal.cjs');
let count=0;function ok(value,why){assert.ok(value,why);count++;}
const boat={id:37,name:'oak_boat',distance:2};
const scene={joined:true,busy:false,position:{x:4,y:64,z:4},inventory:{raw:{}},
 nearbyBlocks:[],boats:[boat]};
const command={command:'row_boat',entityId:37,durationMs:600};
ok(validateCommand(command)===null,'Bounded exact observed vehicle ID and duration');
for(const bad of [
 {...command,entityId:-1},{...command,entityId:200001},
 {...command,durationMs:200},{...command,durationMs:1300},
 {...command,script:'unsafe'},{command:'row_boat',durationMs:600},
])ok(validateCommand(bad)!==null,'Invalid vehicle args or extra fields rejected');
ok(modelPrimitiveGrounded(command,'row the boat forward',JSON.stringify(scene)),
 'Model boat proposal must match owner intent and real nearby boat');
ok(!modelPrimitiveGrounded(command,'row the boat forward',
 JSON.stringify({...scene,boats:[]})),'Unobserved boat cannot be used');
ok(!modelPrimitiveGrounded(command,'do not row the boat forward',JSON.stringify(scene)),
 'Negative owner intent cannot authorize movement');
ok(!modelPrimitiveGrounded(command,'row the boat forward for 900 ms',JSON.stringify(scene)),
 'Model may not change owner-specified duration');
(async()=>{
 const response=await interpretOwnerInstruction('row the boat forward',
  {env:{},context:JSON.stringify(scene)});
 ok(response.ok&&response.command.command==='row_boat'&&
    response.command.entityId===37&&response.command.durationMs===600,
    'Natural owner request resolves to one observed boat and bounded duration');
 const timed=await interpretOwnerInstruction('row the boat forward for 900 ms',
  {env:{},context:JSON.stringify(scene)});
 ok(timed.ok&&timed.command.durationMs===900,'Owner duration is preserved');
 const many=await interpretOwnerInstruction('row the boat forward',{
  env:{},context:JSON.stringify({...scene,boats:[boat,{id:38,name:'oak_boat',distance:2.4}]})});
 ok(many.ok===false,'Multiple reachable boats are ambiguous and denied');
 console.log('MINECRAFT_BOAT_CONTROL '+count+'/'+count+' PASS (offline only)');
})().catch(e=>{console.error(e);process.exitCode=1;});
