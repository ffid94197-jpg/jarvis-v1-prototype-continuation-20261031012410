#!/usr/bin/env node
'use strict';
/*
 * TRUE JAVA SERVER SMOKE, never a simulated mission. Starts the unmodified
 * Mineflayer companion as another Java protocol player against a vanilla
 * survival server on localhost. Verifies empty inventory at spawn and then
 * wood physically appears in the server-backed inventory during autonomous
 * action. Does NOT award a Dragon / Netherite PASS.
 */
const { spawn }=require('node:child_process');
const assert=require('node:assert/strict');
const path=require('node:path');
const readline=require('node:readline');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..','..');
const botSource=path.join(__dirname,'bot.cjs');
const {isIP}=require('node:net');
const host=process.env.JARVIS_MINECRAFT_LAN_HOST||'127.0.0.1';
const port=Number(process.env.JARVIS_MC_TEST_PORT||process.env.JARVIS_MINECRAFT_LAN_PORT||25565);
const owner=process.env.JARVIS_MINECRAFT_PLAYER||'CIObserver';
function privateHost(h) {
 if(h==='localhost')return true;
 if(isIP(h)!==4)return false;
 const n=h.split('.').map(Number);
 return n[0]===10||n[0]===127||(n[0]===192&&n[1]===168)||
  (n[0]===172&&n[1]>=16&&n[1]<=31);
}
assert(privateHost(host),'Minecraft smoke requires approved loopback/private LAN host');
assert(Number.isInteger(port)&&port>=1024&&port<=65535,'Invalid Minecraft server port');
assert(/^[A-Za-z0-9_]{1,16}$/.test(owner) && owner.toLowerCase()!=='jarvisbuddy','Invalid owner name');
const env={...process.env,JARVIS_MINECRAFT_LAN_HOST:host,
 JARVIS_MINECRAFT_LAN_PORT:String(port),JARVIS_MINECRAFT_PLAYER:owner};
const output=[];
const bot=spawn(process.execPath,[botSource],{cwd:__dirname,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
let joined=false,exit=null;
let waiter=new Map(),seq=0;
bot.on('exit',(code,signal)=>{exit={code,signal};for(const w of waiter.values())w.reject(Error('Bot exited '+code+' '+signal));waiter.clear();});
readline.createInterface({input:bot.stdout}).on('line',line=>{
 output.push(line.slice(0,1000));if(output.length>200)output.shift();
 if(line.includes('MINECRAFT_COMPANION_JOINED'))joined=true;
 if(line.startsWith('BOT_ACK ')){
  try{const v=JSON.parse(line.slice(8)),w=waiter.get(v.id);if(w){waiter.delete(v.id);w.resolve(v);}}catch{}
 }
});
readline.createInterface({input:bot.stderr}).on('line',line=>{output.push('STDERR '+line.slice(0,300));});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function command(cmd,timeout=16000){
 return new Promise((resolve,reject)=>{
  if(exit)return reject(Error('Bot already exited: '+JSON.stringify(exit)));
  const id=(++seq).toString(16).padStart(16,'0');
  const alarm=setTimeout(()=>{waiter.delete(id);reject(Error('Bot command timeout '+cmd.command));},timeout);
  waiter.set(id,{resolve:x=>{clearTimeout(alarm);resolve(x)},reject:e=>{clearTimeout(alarm);reject(e)}});
  bot.stdin.write(JSON.stringify({...cmd,id})+'\n');
 });
}
async function main(){
 const initialAt=Date.now();
 try{
  for(let i=0;i<120 && !joined && !exit;i++)await wait(1000);
  assert(joined,'Mineflayer never spawned as a real Java server player. '+JSON.stringify(output.slice(-15)));
  const survival=await command({command:'status'});
  assert(survival.ok && JSON.parse(survival.status).gameMode==='survival',
    'Minecraft Java server did not confirm SURVIVAL gamemode: '+JSON.stringify(survival));
  const pre=await command({command:'inventory'});
  assert(pre.ok&&pre.status==='empty','Survival world must begin with genuinely empty inventory. Got '+JSON.stringify(pre));
  const state=await command({command:'observe'});
  assert(state.ok && !/creative/i.test(state.status||''),'Unverified server/world state');
  const started=await command({command:'auto_goal',goal:'wood',durationSeconds:600});
  assert(started.ok,'Owner-authorized autonomous wood goal was rejected: '+JSON.stringify(started));
  let received='',lastState='';
  const until=Date.now()+205000;
  while(Date.now()<until && !exit){
   await wait(3000);
   const inventory=await command({command:'inventory'});
   if(inventory.ok)received=inventory.status||'';
   if(/(?:^|, )(?:oak|spruce|birch|jungle|acacia|dark_oak|cherry|mangrove|pale_oak)_log:[1-9]/.test(received))break;
   const status=await command({command:'auto_status'});
   if(status.ok){lastState=status.status||'';
     let js;try{js=JSON.parse(lastState)}catch{}
     if(js && ['blocked','paused','complete'].includes(js.status))break;
   }
  }
  assert(/(?:^|, )(?:oak|spruce|birch|jungle|acacia|dark_oak|cherry|mangrove|pale_oak)_log:[1-9]/.test(received),
    'No physically gathered wood in server inventory; last='+received+' state='+lastState+' output='+JSON.stringify(output.slice(-22)));
  const stopped=await command({command:'auto_stop'});
  assert(stopped.ok,'Owner cancellation not acknowledged');
  console.log('MINECRAFT_REAL_JAVA_WOOD_SMOKE PASS; server-backed independent bot joined, empty survival spawn and mined logs observed; elapsedMs='+String(Date.now()-initialAt));
  if(process.env.JARVIS_MC_TEST_STONE==='1'){
    const beginStone=await command({command:'auto_goal',goal:'stone_age',durationSeconds:600});
    assert(beginStone.ok,'Live stone age mission not accepted');
    let finalStone='',observedStone=null;
    const stoneDeadline=Date.now()+8*60*1000;
    while(Date.now()<stoneDeadline && !exit){
      await wait(3000);
      const observed=await command({command:'observe'});
      if(observed.ok)try{observedStone=JSON.parse(observed.status);}catch{}
      const progress=await command({command:'auto_status'});
      if(progress.ok)finalStone=progress.status;
      const raw=observedStone?.inventory?.raw||{};
      if((raw.stone_pickaxe||0)>0 && (raw.stone_sword||0)>0)break;
      let state;try{state=JSON.parse(finalStone)}catch{}
      if(state && ['blocked','paused','complete'].includes(state.status))break;
    }
    const inventory=observedStone?.inventory?.raw||{};
    assert((inventory.stone_pickaxe||0)>0 && (inventory.stone_sword||0)>0,
      'Live stone crafting not verified; status='+finalStone+' observed='+JSON.stringify(observedStone));
    const stopStone=await command({command:'auto_stop'});
    assert(stopStone.ok,'Stone mission cancellation failed');
    console.log('MINECRAFT_REAL_JAVA_STONE_AGE PASS; actual server-backed stone pickaxe+sword observed after real crafting');
  }
  console.log('MINECRAFT_FULL_DRAGON_NETHERITE_NOT_ACCEPTED: no real game kill/equip proof');
 }catch(error){
  console.error('MINECRAFT_REAL_JAVA_WOOD_SMOKE FAIL '+String(error?.stack||error));
  process.exitCode=1;
 }finally{
  for(const w of waiter.values())w.reject(Error('Bot terminated'));waiter.clear();
  try{bot.stdin.end()}catch{}
  if(!exit){try{bot.kill('SIGTERM')}catch{}}
  const deadline=Date.now()+5000;
  while(!exit && Date.now()<deadline)await wait(100);
  if(!exit){try{bot.kill('SIGKILL')}catch{}}
 }
}
main();
