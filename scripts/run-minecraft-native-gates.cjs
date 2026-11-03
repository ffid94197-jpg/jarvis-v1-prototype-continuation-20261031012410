#!/usr/bin/env node
'use strict';
/** JARVIS native Minecraft OFFLINE acceptance, one command, no CI minutes.
 * It never launches Minecraft Java or connects to a server.
 * All dependencies must already be installed on the owner's test checkout.
 */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const python=process.env.PYTHON_BIN||'python';
const tests=[
 {label:'Guardian TypeScript policy',cmd:process.execPath,args:['scripts/verify-minecraft-bridge-policy.cjs']},
 {label:'Main JARVIS language route',cmd:process.execPath,args:['scripts/verify-minecraft-natural-language-routing.cjs']},
 {label:'Python companion admission',cmd:python,args:['windows-companion/verify_minecraft_gateway_offline.py']},
 {label:'Minecraft bot offline suites',cmd:process.execPath,args:['windows-companion/minecraft-bot/run_offline_minecraft_gates.cjs']}
];
const failed=[];
for(const test of tests){
 const p=spawnSync(test.cmd,test.args,{
  cwd:root,encoding:'utf8',stdio:'pipe',timeout:15*60*1000,
  windowsHide:true,env:{...process.env,MINECRAFT_LIVE_ACCEPTANCE:'0',
   JARVIS_MC_TEST_STONE:'0',JARVIS_MC_TEST_IRON:'0'}
 });
 if(p.error||p.status!==0){
   failed.push(test.label);
   console.error('FAIL '+test.label+'\n'+(p.stderr||'').slice(-3500)+'\n'+(p.stdout||'').slice(-1500)+
    '\n'+String(p.error||''));
 }else console.log('PASS '+test.label+' '+(p.stdout||'').trim().slice(-500));
}
console.log('JARVIS_MINECRAFT_NATIVE_OFFLINE '+(tests.length-failed.length)+'/'+tests.length+
 ' groups; real Minecraft/Dragon/Netherite NOT tested');
if(failed.length){console.error('UNVERIFIED/FAILED: '+failed.join(', '));process.exitCode=1;}
