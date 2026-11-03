/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/* A mocked Minecraft protocol session. No Minecraft client, TCP or game world required. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {validateCommand,inventorySummary}=require('./friend_protocol.cjs');
let count=0;
function check(value,label){assert.ok(value,label);count++;console.log('PASS',label);}
for(const input of [{command:'follow'},{command:'come'},{command:'stay'},
  {command:'guard'},{command:'collect_wood'},{command:'status'},{command:'inventory'},
  {command:'say',text:'Let us build a house!'},{command:'move',directionInput:'forward',durationMs:700}]) {
  check(validateCommand(input)===null, 'allowed friend action '+input.command);
}
for(const input of [{command:'attack_player'},{command:'move',directionInput:'fly',durationMs:10},
  {command:'move',directionInput:'forward',durationMs:9000},
  {command:'say',text:'bad\ncommand'},{command:'say',text:'X'.repeat(121)},{command:'say',text:''}]) {
  check(validateCommand(input)!==null,'invalid friend action denied '+input.command);
}
check(inventorySummary({inventory:{items:()=>[{name:'oak_log',count:3}]}})==='oak_log:3','inventory observation');
const stdin=new EventEmitter(),output=[],chats=[],controls=[],goalsSet=[],attacks=[];
const pos=(x,y,z)=>({x,y,z,offset(dx,dy,dz){return pos(x+dx,y+dy,z+dz);},clone(){return pos(x,y,z);},distanceTo(p){return Math.hypot(x-p.x,y-p.y,z-p.z);}});
const leader={position:pos(2,64,3)};
const bot=new EventEmitter();
bot.players={Owner:{entity:leader}};
bot.entity={position:pos(0,64,0)};
bot.inventory={items:()=>[{name:'oak_log',count:2}]};
bot.health=19;bot.food=18;
bot.pathfinder={setMovements(){},setGoal(g){goalsSet.push(g);},stop(){},goto(){return Promise.resolve();}};
bot.setControlState=(k,v)=>controls.push([k,v]);
bot.chat=m=>chats.push(m);
bot.loadPlugin=()=>{};
bot.lookAt=()=>Promise.resolve();
bot.findBlock=()=>null;
bot.nearestEntity=()=>null;
bot.attack=e=>attacks.push(e);
bot.quit=()=>{};
const fakeReadline={createInterface(){return stdin;}};
class GoalFollow {constructor(entity,range){this.entity=entity;this.range=range;}}
class GoalNear {constructor(x,y,z,range){this.x=x;this.y=y;this.z=z;this.range=range;}}
const mocks={'vec3':{Vec3:class {constructor(x,y,z){Object.assign(this,{x,y,z});} distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);} plus(p){return new this.constructor(this.x+p.x,this.y+p.y,this.z+p.z);}}},mineflayer:{createBot(){return bot;}},readline:fakeReadline,
  'mineflayer-pathfinder':{pathfinder(){},Movements:class Movements{},goals:{GoalFollow,GoalNear}}};
let nextTimer=0;
const fakeTimers={setTimeout(fn){return ++nextTimer;},clearTimeout(){},setInterval(fn){return ++nextTimer;},clearInterval(){}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8'),{
 require:mod=>mocks[mod]||require(mod),
 __dirname:fs.mkdtempSync(path.join(require('node:os').tmpdir(),'jarvis-mc-bot-fixture-')),process:{env:{JARVIS_MINECRAFT_LAN_PORT:'51234',JARVIS_MINECRAFT_PLAYER:'Owner'},
 stdout:{write:s=>output.push(s)},stderr:{write:s=>output.push(s)},on(){}},
 console,Buffer,setTimeout:fakeTimers.setTimeout,clearTimeout:fakeTimers.clearTimeout,
 setInterval:fakeTimers.setInterval,clearInterval:fakeTimers.clearInterval,
});
const pump=()=>new Promise(resolve=>setImmediate(resolve));
const id='a'.repeat(16);
async function send(command,extra={}){
  const before=output.length;
  stdin.emit('line',JSON.stringify({id,command,...extra}));
  await pump();
  const lines=output.slice(before).filter(s=>s.startsWith('BOT_ACK '));
  assert.equal(lines.length,1,'exactly one acknowledgement');
  return JSON.parse(lines[0].slice(8));
}
(async()=>{
  check(!(await send('status')).ok,'status before spawn refused');
  bot.emit('spawn');
  check(output.some(s=>s.includes('JOINED (spawn observed)')),'Minecraft spawn is the only joined proof');
  check(chats.some(s=>s.includes('Hi Owner')),'friendly greeting after actual spawn');
  check((await send('status')).status.includes('"ownerVisible":true'),'owner visibility reported');
  check((await send('inventory')).status.includes('oak_log:2'),'inventory observed');
  check((await send('follow')).ok,'follow supported');
  check(goalsSet.some(g=>g instanceof GoalFollow),'real Pathfinder follow goal constructed');
  check((await send('come')).status.includes('STARTED'),'come reports started, not completion');
  await pump();
  check((await send('status')).status.includes('reached last observed owner position'),'come later reports outcome');
  check((await send('collect_wood')).status.includes('STARTED'),'gather acknowledges started only');
  await pump();
  // The source now reports the bounded-survey outcome ("No loaded safe survey
  // waypoint or visible tree; refusing blind movement") rather than the older
  // bare "no log blocks" text. Assert the honesty CONTRACT, which is stronger
  // than matching one historical literal: a failed gather must state a real
  // reason, must not claim verified/partial wood, and must not invent logs.
  const gather=(await send('status')).status;
  check(/refusing blind movement|No loaded safe survey waypoint|no log blocks/.test(gather),
    'gather reports failed/no blocks honestly');
  check(!/Wood collection verified|Partial wood gathering/.test(gather),
    'failed gather never claims verified or partial wood');
  check((await send('inventory')).status.includes('oak_log:2'),
    'failed gather leaves the inventory unchanged (no fictional logs)');
  check((await send('guard')).status.includes('60s'),'guard is time bounded');
  check(attacks.length===0,'no player attack in normal flow');
  check(!(await send('say',{text:'hello\nworld'})).ok,'chat control bytes rejected at bot');
  check((await send('say',{text:'Come explore with me!'})).ok,'JARVIS sends in-game chat');
  const beforeChat=chats.length;
  bot.emit('chat','Stranger','jarvis stop');await pump();
  check(chats.length===beforeChat,'non-owner chat ignored');
  bot.emit('chat','Owner','jarvis stay');await pump();
  check(chats.some(s=>s.includes('Staying here')),'owner in-game chat controls companion');
  check((await send('stop')).ok,'stop supported');
  console.log(`MINECRAFT_FRIEND_FIXTURE ${count}/${count} PASS (mock Mineflayer, not a live game)`);
})().catch(err=>{console.error(err);process.exitCode=1;});
