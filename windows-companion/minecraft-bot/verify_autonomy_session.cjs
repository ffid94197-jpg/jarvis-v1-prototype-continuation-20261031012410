/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
function pos(x,y,z){return {x,y,z,clone(){return pos(x,y,z);},offset(a,b,c){return pos(x+a,y+b,z+c);},distanceTo(p){return Math.hypot(x-p.x,y-p.y,z-p.z);}};}
let assertions=0;function check(x,msg){assert.ok(x,msg);assertions++;}
const stdout=[],chats=[],attacks=[],crafts=[],goals=[];let botCurrent=pos(0,64,0),tablePlaced=false;
let logsDug=0,inv={oak_log:0,oak_planks:0,stick:0,crafting_table:0,wooden_pickaxe:0};
let named=[];const player=pos(2,64,3);
const bot=new EventEmitter();bot.players={Owner:{entity:{position:player}}};
bot.entity={get position(){return botCurrent;}};bot.entities={};bot.health=20;bot.food=18;
bot.time={timeOfDay:9000};bot.registry={itemsByName:Object.fromEntries(Object.keys(inv).map((name,i)=>[name,{id:i+1}]))};
bot.inventory={items:()=>Object.entries(inv).filter(([,count])=>count>0).map(([name,count])=>({name,count}))};
bot.findBlock=({matching})=>{
  const blocks=[];
  if(tablePlaced)blocks.push({name:'crafting_table',position:pos(1,64,0)});
  if(logsDug<5)blocks.push({name:'oak_log',position:pos(3,64,0)});
  return blocks.find(matching)||null;
};
bot.blockAt=p=> tablePlaced && p.x===1 && p.y===64 && p.z===0 ? {name:'crafting_table',position:pos(1,64,0)} :
  p.y===63?{name:'grass_block',boundingBox:'block',position:pos(p.x,63,p.z)}:
  p.x===3 && p.y===64 && p.z===0&&logsDug<5?{name:'oak_log',position:pos(3,64,0)}:{name:'air',boundingBox:'empty',position:pos(p.x,p.y,p.z)};
bot.pathfinder={setGoal:g=>goals.push(g),stop(){},setMovements(){},goto:async g=>{botCurrent=pos(g.x,g.y,g.z);}};
bot.setControlState=()=>{};bot.chat=text=>chats.push(text);bot.loadPlugin=()=>{};
bot.nearestEntity=()=>null;bot.lookAt=async()=>{};bot.attack=e=>attacks.push(e);
bot.dig=async()=>{logsDug++;inv.oak_log++;};
bot.equip=async()=>{};bot.placeBlock=async()=>{tablePlaced=true;inv.crafting_table--;};
bot.recipesFor=(id,_meta,_count,table)=>{const name=Object.keys(bot.registry.itemsByName).find(x=>bot.registry.itemsByName[x].id===id);return [{name,table:!!table}];};
bot.craft=async(recipe)=>{
  const name=recipe.name;crafts.push(name);
  if(name==='oak_planks'){assert.ok(inv.oak_log>=1);inv.oak_log--;inv.oak_planks+=4;}
  if(name==='stick'){assert.ok(inv.oak_planks>=2);inv.oak_planks-=2;inv.stick+=4;}
  if(name==='crafting_table'){assert.ok(inv.oak_planks>=4);inv.oak_planks-=4;inv.crafting_table++;}
  if(name==='wooden_pickaxe'){assert.ok(tablePlaced&&inv.oak_planks>=3&&inv.stick>=2);inv.oak_planks-=3;inv.stick-=2;inv.wooden_pickaxe++;}
};
bot.quit=()=>{};
const stdin=new EventEmitter();const fakeReadline={createInterface:()=>stdin};
class GoalNear {constructor(x,y,z,range){Object.assign(this,{x,y,z,range});}}
class GoalFollow {constructor(entity,range){Object.assign(this,{entity,range});}}
let interval;
const realTimeout=setTimeout;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8'),{
 require:mod=>mod==='mineflayer'?{createBot:()=>bot}:mod==='readline'?fakeReadline:
   mod==='mineflayer-pathfinder'?{pathfinder(){},Movements:class{},goals:{GoalNear,GoalFollow}}:
   mod==='vec3'?{Vec3:class {constructor(x,y,z){Object.assign(this,{x,y,z});} distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);} plus(p){return new this.constructor(this.x+p.x,this.y+p.y,this.z+p.z);} offset(x,y,z){return new this.constructor(this.x+x,this.y+y,this.z+z);}}}:require(mod),
 __dirname:fs.mkdtempSync(path.join(require('node:os').tmpdir(),'jarvis-mc-session-fixture-')),process:{env:{JARVIS_MINECRAFT_LAN_PORT:'51234',JARVIS_MINECRAFT_PLAYER:'Owner'},
 stdout:{write:x=>stdout.push(x)},stderr:{write:x=>stdout.push(x)},on(){}},
 Buffer,console,setTimeout:(fn,ms)=>ms<500?realTimeout(fn,0):888,clearTimeout:()=>{},
 setInterval:(fn)=>{interval=fn;return 777;},clearInterval:()=>{}
});
const wait=()=>new Promise(resolve=>setImmediate(resolve));
let num=0;async function command(q){const id=(++num).toString(16).padStart(16,'0');let i=stdout.length;stdin.emit('line',JSON.stringify({id,...q}));await wait();let out=stdout.slice(i).filter(l=>l.startsWith('BOT_ACK '));assert.equal(out.length,1,'one response per command');return JSON.parse(out[0].slice(8));}
(async()=>{
 check(!(await command({command:'auto_goal',goal:'tools'})).ok,'cannot auto play before spawn');
 bot.emit('spawn');check(stdout.some(x=>x.includes('MINECRAFT_COMPANION_JOINED')),'spawn observed');
 const start=await command({command:'auto_goal',goal:'tools',durationSeconds:300});
 check(start.ok,'start autonomous tools; receipt='+JSON.stringify(start));
 check(!(await command({command:'auto_goal',goal:'tools',durationSeconds:300,unsupportedParameter:true})).ok,
  'unrecognized gameplay parameters cannot sneak through correlation envelope');
 check((await command({command:'auto_status'})).status.includes('"running"'),'autonomous status reports running');
 const active=JSON.parse((await command({command:'auto_status'})).status);
 const duplicate=await command({command:'auto_goal',goal:'explore',durationSeconds:300});
 check(!duplicate.ok,'duplicate auto goal rejected while another goal is running');
 const afterDuplicate=JSON.parse((await command({command:'auto_status'})).status);
 check(afterDuplicate.goal===active.goal && afterDuplicate.since===active.since &&
  afterDuplicate.steps===active.steps,'duplicate request cannot overwrite active mission state');
 let completed=false;
 for(let i=0;i<45;i++){
   interval();await new Promise(resolve=>realTimeout(resolve,4));await wait();
   const s=JSON.parse((await command({command:'auto_status'})).status);
   if(s.status==='complete'){completed=true;check(s.successes>=5,'verified substeps recorded');break;}
   if(s.status==='blocked')throw Error('Unexpected autonomy blocking: '+JSON.stringify(s));
 }
 if(!completed) console.error('SIM_DEBUG',JSON.stringify({inv,logsDug,tablePlaced,crafts,stdout:stdout.slice(-12)}));
 check(completed,'crafting objective completes in simulated game');
 check(inv.wooden_pickaxe===1,'pickaxe appears in live-like simulated inventory');
 check(tablePlaced,'workbench physically placed');
 check(crafts.includes('stick')&&crafts.includes('crafting_table')&&crafts.includes('wooden_pickaxe'),'all recipes used');
 check(logsDug>=3,'tree logs actually dug');
 check(attacks.length===0,'no players attacked');
 check((await command({command:'observe'})).ok,'world observation from bot');
 check((await command({command:'auto_goal',goal:'explore'})).ok,'exploration starts');
 check((await command({command:'auto_stop'})).ok,'owner stops exploration');
 check(JSON.parse((await command({command:'auto_status'})).status).status==='paused','stop latched in controller');
 const before=chats.length;bot.emit('chat','Stranger','jarvis auto tools');await wait();
 check(chats.length===before,'stranger cannot start autonomous play');
 bot.emit('chat','Owner','jarvis auto follow');await wait();
 check(chats.some(x=>x.includes('Autonomous follow STARTED')),'owner in-game chat can start goal');
 bot.emit('death');check(JSON.parse((await command({command:'auto_status'})).status).status==='paused','death stops autonomy');
 console.log(`MINECRAFT_SESSION_SIM ${assertions}/${assertions} PASS (mock Mineflayer; no live server)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
