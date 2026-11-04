#!/usr/bin/env node
'use strict';
// Offline language admission: no Minecraft world, real model call or Github Actions.
const assert=require('node:assert/strict');
const {validateCommand}=require('./friend_protocol.cjs');
const L=require('./language_goal.cjs');
let count=0;const ok=(p,msg)=>{assert.ok(p,msg);count++;};
ok(validateCommand({command:'natural_goal',text:'mine 6 diamonds'})===null,'owner text protocol');
ok(validateCommand({command:'natural_goal',text:'follow',extra:1})!==null,'unexpected keys');
ok(validateCommand({command:'natural_goal',text:'bad\ninput'})!==null,'control chars denied');
ok(L.directIntent('Jarvis, follow me').command.command==='follow','natural follow');
ok(L.directIntent('please protect me').command.goal==='guard','natural protect');
ok(L.directIntent('Can you please protect me?').command.goal==='guard','polite voice protect');
ok(L.directIntent('Could you craft 2 chests?').command.item==='chest','polite natural craft');
ok(L.directIntent('mine 6 diamonds').command.resource==='diamond','natural gather');
ok(L.directIntent('collect 7 iron ingots').command.resource==='iron_ingot','natural iron-ingot alias');
ok(L.directIntent('make 2 chests').command.item==='chest','natural craft');
ok(L.directIntent('Could you please make me 3 torches?').command.item==='torch','natural plural torch craft');
ok(L.directIntent('do not gather wood').ok===false,'negation fail closed');
ok(L.canonicalIntent({command:'auto_goal',goal:'craft',item:'chest',targetCount:2}).ok,'typed craft');
ok(!L.canonicalIntent({command:'run_shell',script:'evil'}).ok,'unknown tool denied');
ok(!L.canonicalIntent({command:'auto_goal',goal:'gather',resource:'command_block',targetCount:1}).ok,'invalid resource denied');
ok(!L.canonicalIntent({command:'auto_goal',goal:'gather',resource:'logs',targetCount:65}).ok,'oversized count denied');
ok(!L.canonicalIntent({command:'follow',attack:true}).ok,'command smuggling denied');
ok(!L.canonicalIntent({command:'auto_goal',goal:'survive',resource:'logs'}).ok,'unrelated params denied');
ok(!L.canonicalIntent({command:'auto_goal',goal:'sequence',steps:[{goal:'evil'}]}).ok,'invalid sequence denied');
for(const goal of ['constructor','__proto__','toString','hasOwnProperty'])
 ok(!L.canonicalIntent({command:'auto_goal',goal}).ok,'inherited JS key denied: '+goal);
ok(L.strictFormat([{role:'assistant',content:'hi'},{role:'user',content:'mine'}])[0].role==='user','Mindcraft formatter');
const env={JARVIS_MODEL_BACKEND:'ollama',JARVIS_OLLAMA_MODEL:'local-test'};
(async()=>{
 const yes=await L.interpretOwnerInstruction('collect five diamonds',{
  env,context:'world observed',
  fetchImpl:async(url,opts)=>{
   ok(url==='http://127.0.0.1:11434/api/chat','loopback JARVIS provider');
   const q=JSON.parse(opts.body);
   ok(q.messages[0].role==='system','model role isolation');
   return {ok:true,text:async()=>JSON.stringify({message:{content:JSON.stringify({
    command:'auto_goal',goal:'gather',resource:'diamond',targetCount:5})}})};
  }
 });
 ok(yes.ok&&yes.command.targetCount===5,'model interpretation passes same validator');
 const bad=await L.interpretOwnerInstruction('collect five diamonds',{env,
  fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({message:{
   content:JSON.stringify({command:'execute_js',script:'process.exit(1)'})}})})});
 ok(!bad.ok,'model-code output fails closed');
 const noProvider=await L.interpretOwnerInstruction('collect five diamonds',{env:{}});
 ok(!noProvider.ok,'no unconfigured model calls');
 let disallowed=false;
 try{L.modelConfig({...env,JARVIS_OLLAMA_BASE_URL:'http://example.com'});}
 catch{disallowed=true;}
 ok(disallowed,'remote URL denied');
 console.log('MINECRAFT_LANGUAGE '+count+'/'+count+' PASS (offline, no real LLM/game)');
})().catch(e=>{console.error(e);process.exitCode=1;});
