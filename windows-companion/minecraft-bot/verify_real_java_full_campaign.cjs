#!/usr/bin/env node
'use strict';
/**
 * JARVIS real Minecraft Java survival acceptance gate.
 * This script DOES NOT simulate blocks/entities, issue /give/teleport or use
 * server operator privileges. It starts the actual bot.cjs Mineflayer player
 * and FAILS unless one observed episode ends after real Dragon-death and End
 * exit events, with four Netherite armor slots visibly equipped AFTERWARD.
 *
 * Requires a separately running approved survival Java server and explicit
 * MINECRAFT_LIVE_ACCEPTANCE=1. No auto-connect to arbitrary Internet hosts.
 */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {writeFile,mkdir}=require('node:fs/promises');
const path=require('node:path');
const readline=require('node:readline');
const {isIP}=require('node:net');
const env=process.env;
const port=Number(env.JARVIS_MINECRAFT_LAN_PORT);
const host=env.JARVIS_MINECRAFT_LAN_HOST||'127.0.0.1';
const owner=env.JARVIS_MINECRAFT_PLAYER||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function privateHost(h){
 if(h==='localhost')return true;
 if(isIP(h)!==4)return false;
 const a=h.split('.').map(Number);
 return a[0]===127||a[0]===10||(a[0]===192&&a[1]===168)||(a[0]===172&&a[1]>=16&&a[1]<=31);
}
assert(env.MINECRAFT_LIVE_ACCEPTANCE==='1','Explicit operator enablement required');
assert(privateHost(host) && Number.isInteger(port)&&port>=1024&&port<=65535,'Approved local/LAN Minecraft Java host only');
assert(/^[a-z0-9_]{1,16}$/i.test(owner) && owner.toLowerCase()!=='jarvisbuddy','Owner username required');
const maxMs=Math.min(6*60*60*1000,Math.max(120000,Number(env.JARVIS_MC_ACCEPTANCE_MS||21600000)));
const startedAt=Date.now();
const evidence={schema:'jarvis.minecraft.live.v1',server:{host,port},goal:'dragon_then_netherite_run',start:new Date().toISOString(),verdict:'NOT_ACCEPTED',steps:[],events:[],failures:[]};
const bot=spawn(process.execPath,[path.join(__dirname,'bot.cjs')],{
 cwd:__dirname,env:{...env,JARVIS_MINECRAFT_LAN_HOST:host,JARVIS_MINECRAFT_LAN_PORT:String(port),JARVIS_MINECRAFT_PLAYER:owner},
 stdio:['pipe','pipe','pipe'],windowsHide:true});
let spawned=false,closed=false,seq=0;
const waiters=new Map();
const log=[];
function say(message){log.push(message.slice(0,500));if(log.length>80)log.shift();}
bot.on('exit',(code,signal)=>{
 closed=true;evidence.failures.push('Bot process exit '+code+' signal='+signal);
 for(const w of waiters.values())w.reject(Error('Bot exited'));waiters.clear();
});
function parseLine(line){
 if(line.includes('MINECRAFT_COMPANION_JOINED'))spawned=true;
 if(line.startsWith('BOT_EVENT ')){
  try {
   const v=JSON.parse(line.slice('BOT_EVENT '.length));
   if(typeof v.type==='string' && Number.isFinite(v.at)) evidence.events.push(v);
  } catch {}
 }
 if(line.startsWith('BOT_ACK ')){
  try {
   const v=JSON.parse(line.slice('BOT_ACK '.length));
   const waiting=waiters.get(v.id);
   if(waiting){waiters.delete(v.id);waiting.resolve(v);}
  }catch{}
 }
 say(line);
}
readline.createInterface({input:bot.stdout}).on('line',parseLine);
readline.createInterface({input:bot.stderr}).on('line',line=>say('STDERR: '+line));
function send(command,timeoutMs=20000){
 return new Promise((resolve,reject)=>{
  if(closed)return reject(Error('Bot exited'));
  const id=(++seq).toString(16).padStart(16,'0');
  const alarm=setTimeout(()=>{waiters.delete(id);reject(Error('Command timeout '+command.command));},timeoutMs);
  waiters.set(id,{
   resolve:value=>{clearTimeout(alarm);resolve(value)},
   reject:e=>{clearTimeout(alarm);reject(e)}
  });
  bot.stdin.write(JSON.stringify({id,...command})+'\n');
 });
}
async function proof(){
 for(let i=0;i<90&&!spawned&&!closed;i++)await sleep(1000);
 assert(spawned,'Real Minecraft Java server spawn was not observed');
 const state=await send({command:'status'});
 assert(state.ok && JSON.parse(state.status).gameMode==='survival','Not authoritative survival mode');
 const startInventory=await send({command:'inventory'});
 assert(startInventory.ok&&startInventory.status==='empty','Inventory must start empty; cannot reuse progressed world');
 const ack=await send({command:'auto_goal',goal:evidence.goal,durationSeconds:21600});
 assert(ack.ok && /STARTED/.test(ack.status||''),'One-shot owner-authorized goal not accepted');
 const deadline=Date.now()+maxMs;
 let completed;
 while(!closed && Date.now()<deadline){
  await sleep(15000);
  const a=await send({command:'auto_status'});
  if(!a.ok)throw Error('Autonomy status unavailable');
  const s=JSON.parse(a.status);
  evidence.steps.push({at:Date.now(),state:s.status,action:s.lastDecision?.kind||null,
   successes:s.successes,steps:s.steps,milestones:s.milestones,reason:s.why||null});
  if(evidence.steps.length>3000)evidence.steps.splice(0,evidence.steps.length-3000);
  if(s.status==='complete'){completed=s;break;}
  if(['blocked','paused'].includes(s.status))throw Error('Live mission '+s.status+': '+s.why);
 }
 assert(completed,'Live Dragon/Netherite mission did not complete within bound');
 assert(completed.milestones?.dragonKilled===true && completed.milestones?.exitPortalObserved===true &&
   completed.milestones?.netheriteEquipped===true,'All verified dragon/exit/equip milestones required');
 const observed=await send({command:'observe'});
 assert(observed.ok,'Final Minecraft inventory observation missing');
 const world=JSON.parse(observed.status);
 assert(world.joined===true && world.wornNetherite===true && world.heldNetheriteSword===true,
   'Final Java proof requires four worn Netherite armor pieces AND actively held Netherite sword');
 assert(String(world.dimension||'').replace(/^minecraft:/,'')==='overworld',
   'Bot must complete in actual Overworld after End return');
 const kill=evidence.events.find(e=>e.type==='dragon_death'&&e.dimension==='the_end');
 const endExit=evidence.events.find(e=>e.type==='end_exit' && e.dimension==='overworld' &&
   kill && e.at>kill.at);
 const equip=evidence.events.find(e=>e.type==='netherite_equipped' &&
   e.worn===true && e.held===true && endExit && e.at>endExit.at);
 assert(kill && endExit && equip,
   'Require ordered server-observed Dragon death -> real End exit -> subsequent worn Netherite armor');
 evidence.final={world,mission:completed};
 evidence.verdict='PASS';
 console.log('MINECRAFT_REAL_JAVA_DRAGON_THEN_NETHERITE PASS: observed survival world, Dragon death, End portal and subsequent equipped full Netherite armor');
}
(async()=>{
 try{await proof();}catch(e){evidence.failures.push(String(e?.stack||e));console.error('MINECRAFT_REAL_JAVA_DRAGON_THEN_NETHERITE NOT_ACCEPTED '+String(e?.message||e));process.exitCode=1;}
 finally{
  evidence.finish=new Date().toISOString();evidence.lastLog=log.slice(-20);
  const directory=env.JARVIS_MC_EVIDENCE_DIR||path.join(__dirname,'live-evidence');
  await mkdir(directory,{recursive:true});
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const filename=path.join(directory,'minecraft-real-campaign-evidence.json');
  await writeFile(filename,serialized);
  console.log('Minecraft evidence SHA256 '+createHash('sha256').update(serialized).digest('hex'));
  try{bot.stdin.end()}catch{}
  if(!closed)bot.kill();
  const until=Date.now()+5000;
  while(!closed && Date.now()<until)await sleep(100);
  if(!closed)bot.kill('SIGKILL');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
