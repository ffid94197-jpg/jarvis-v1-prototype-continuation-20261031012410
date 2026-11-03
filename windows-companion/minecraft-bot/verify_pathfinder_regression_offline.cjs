/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Pure offline event/protocol regression fixture. NO real Minecraft connection.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8');
const pos=(x,y,z)=>({x,y,z,offset(dx,dy,dz){return pos(x+dx,y+dy,z+dz);},clone(){return pos(x,y,z);},distanceTo(p){return Math.hypot(x-p.x,y-p.y,z-p.z);}});
let checks=0;
function ok(x,desc){assert.ok(x,desc);console.log('PASS',desc);checks++;}
async function fixture({logs=[],unreachable=[],neverArrive=false,fireDeadline=false}={}){
  const stdin=new EventEmitter(), bot=new EventEmitter(), output=[], blocks=logs.map((at)=>({name:'oak_log',position:pos(...at)}));
  let count=0,pendingReject;
  const blocked=new Set(unreachable.map(x=>x.join(',')));
  bot.players={Owner:{entity:{position:pos(5,64,5)}}};bot.entity={position:pos(0,64,0)};
  bot.entities={};bot.health=20;bot.food=20;bot.inventory={items:()=>count?[{name:'oak_log',count}]:[]};
  bot.game={dimension:'minecraft:overworld'};bot.loadPlugin=()=>{};
  bot.setControlState=()=>{};bot.chat=()=>{};bot.quit=()=>{};
  bot.findBlocks=()=>blocks.map(x=>x.position);
  bot.findBlock=({matching})=>blocks.find(matching)||null;
  bot.blockAt=p=>blocks.find(x=>x.position.distanceTo(p)<.01)||
    (p.y===63?{name:'grass_block',boundingBox:'block',position:p}:
      {name:'air',boundingBox:'empty',position:p});
  bot.nearestEntity=()=>null;
  bot.dig=async block=>{const i=blocks.indexOf(block);assert.ok(i>=0);blocks.splice(i,1);count++;};
  bot.pathfinder={setMovements(){},setGoal(){},stop(){if(pendingReject){const reject=pendingReject;pendingReject=null;reject(Error('Path was stopped before it could be completed'));}},
    goto(goal){
      if(neverArrive)return new Promise((_,reject)=>{pendingReject=reject;});
      if(blocked.has([goal.x,goal.y,goal.z].join(',')))return Promise.reject(Error('Path was stopped before it could be completed'));
      bot.entity.position=pos(goal.x,goal.y,goal.z);return Promise.resolve();
    }};
  class GoalFollow {constructor(entity,r){this.entity=entity;this.range=r;}}
  class GoalNear {constructor(x,y,z,range){Object.assign(this,{x,y,z,range});}}
  let id=0;
  const timer=(fn,ms)=>{if(ms<=350 || (fireDeadline && ms>1000))queueMicrotask(fn);return ++id;};
  const mocks={mineflayer:{createBot:()=>bot},readline:{createInterface:()=>stdin},
    vec3:{Vec3:class{constructor(x,y,z){Object.assign(this,{x,y,z});} distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);} plus(p){return new this.constructor(this.x+p.x,this.y+p.y,this.z+p.z);} offset(x,y,z){return new this.constructor(this.x+x,this.y+y,this.z+z);}}},
    'mineflayer-pathfinder':{pathfinder(){},Movements:class{},goals:{GoalFollow,GoalNear}}};
  vm.runInNewContext(source,{require:name=>mocks[name]||require(name),__dirname:fs.mkdtempSync(path.join(require('node:os').tmpdir(),'jarvis-mc-path-fixture-')),process:{env:{JARVIS_MINECRAFT_LAN_PORT:'54321',JARVIS_MINECRAFT_PLAYER:'Owner'},stdout:{write:x=>output.push(x)},stderr:{write:x=>output.push(x)},on(){}},console,Buffer,setTimeout:timer,clearTimeout(){},setInterval(){},clearInterval(){}});
  const send=async(command)=>{
    const start=output.length;
    stdin.emit('line',JSON.stringify({id:'a'.repeat(16),command}));
    for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
    const received=output.slice(start).find(x=>x.startsWith('BOT_ACK '));
    assert.ok(received,`expected receipt for ${command}`);
    return JSON.parse(received.slice(8));
  };
  bot.emit('spawn');
  return {send,bot,getCount:()=>count};
}
(async()=>{
  const a=await fixture({logs:[[2,64,0],[4,64,0]]});
  await a.send('stay');ok((await a.send('status')).status.includes('"mode":"stay"'),'explicit stay persisted');
  ok((await a.send('collect_wood')).status.includes('STARTED'),'collect command acknowledges start not success');
  let status=(await a.send('status')).status;
  ok(status.includes('"mode":"stay"'),'successful wood collection does not switch back to follow');
  ok(status.includes('oak_log:2'),'successful pickup counted from inventory');
  ok(status.includes('Wood collection verified'),'success receipt requires inventory increase');
  const b=await fixture({logs:[[2,64,0],[4,64,0]],unreachable:[[2,64,0]]});
  await b.send('collect_wood');status=(await b.send('status')).status;
  ok(status.includes('oak_log:1'),'second tree is tried when first target is unreachable');
  ok(status.includes('"mode":"stay"'),'failed first candidate cannot auto-follow');
  const c=await fixture({logs:[]});
  await c.send('collect_wood');status=(await c.send('status')).status;
  ok(status.includes('"inventory":"empty"'),'missing trees do not create fictional logs');
  ok(status.includes('"mode":"stay"'),'no-tree outcome does not auto-follow');
  const d=await fixture({logs:[[2,64,0]],neverArrive:true});
  await d.send('collect_wood');await d.send('stay');status=(await d.send('status')).status;
  ok(status.includes('"mode":"stay"') && status.includes('mode stay'),'explicit operator cancellation remains authoritative');
  ok(status.includes('"inventory":"empty"'),'cancelled collection does not claim inventory gain');
  const e=await fixture({logs:[[2,64,0]],neverArrive:true,fireDeadline:true});
  await e.send('collect_wood');status=(await e.send('status')).status;
  ok(/timeout/i.test(status),'navigation timeout is reported explicitly instead of generic stopped path');
  ok(status.includes('"mode":"stay"'),'timed out task safely releases exclusive movement control');
  console.log(`MINECRAFT_PATHFINDER_REGRESSION ${checks}/${checks} PASS (offline mock only)`);
})().catch(err=>{console.error(err);process.exitCode=1;});
