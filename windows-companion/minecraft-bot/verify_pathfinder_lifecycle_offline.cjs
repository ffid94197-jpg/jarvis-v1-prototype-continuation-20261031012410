/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/**
 * JARVIS Minecraft companion — mineflayer-pathfinder LIFECYCLE regression.
 *
 * OFFLINE FIXTURE ONLY. There is no Minecraft server, no network connection
 * and no real gameplay here. Passing this file is NOT a real-world mining
 * acceptance; it is a deterministic proof that the companion's cancellation
 * state machine matches the installed library's semantics.
 *
 * WHY THIS FILE EXISTS
 * The pre-existing verify_pathfinder_regression_offline.cjs mocks
 * `pathfinder.stop()` as a no-op and `setGoal()` as a no-op, so it could not
 * observe the defect: in mineflayer-pathfinder 2.4.5 `stop()` only ARMS a
 * sticky module-level `stopPathing` latch (index.js:163) which is cleared
 * EXCLUSIVELY by the internal `stop()` reached from the next `resetPath()`
 * (index.js:139 -> 390). Arming without consuming meant the next `goto()`
 * registered its 'path_stop' listener and then tripped the stale latch
 * itself, rejecting instantly with 'Path was stopped before it could be
 * completed!'. Every manual action's first navigation died before the bot
 * moved, which is the confirmed cause of the live failure to collect even one
 * cobblestone.
 *
 * FIDELITY
 * - The `goto()` promise wrapper is the REAL mineflayer-pathfinder/lib/goto.js,
 *   so listener registration order and rejection names are genuine.
 * - The goal classes are the REAL mineflayer-pathfinder/lib/goals.js, so
 *   `GoalNear(...,0)` arrival semantics are genuine.
 * - Vec3 is the REAL vec3 module, so geometry and `floored()` are genuine.
 * - The pathfinder state machine below replicates index.js line-for-line at
 *   the points that matter (31, 123-139, 142-146, 158-163, 390-395, 456-459,
 *   582-584).
 */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {Vec3}=require('vec3');
const gotoUtil=require('mineflayer-pathfinder/lib/goto');
const {GoalNear,GoalFollow,GoalBlock}=require('mineflayer-pathfinder/lib/goals');

const source=fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8');
let checks=0,failures=0;
// Record and continue: one run yields complete evidence instead of stopping at
// the first broken assertion. Exit status still reflects any failure.
function ok(cond,desc){
  checks++;
  if(cond){console.log('PASS',desc);return;}
  failures++;console.log('FAIL',desc);
}
function done(label){
  if(failures){
    console.log(`${label} ${checks-failures}/${checks} PASS, ${failures} FAIL (offline fixture; NOT real Minecraft gameplay)`);
    process.exitCode=1;return;
  }
  console.log(`${label} ${checks}/${checks} PASS (offline fixture; NOT real Minecraft gameplay)`);
}

/** Faithful replica of the mineflayer-pathfinder 2.4.5 cancellation state
 *  machine. `latchArmed()` exposes the internal `stopPathing` flag so tests can
 *  assert that no sticky state survives into the next route. */
function attachFaithfulPathfinder(bot){
  let stopPathing=false;          // index.js:31
  let stateGoal=null;
  let path=[];
  const state={stuck:false,noRoute:false,onlyRouteTo:null,goalSetCount:0,armCount:0,
    pathStopCount:0,routeRequests:0,gotoCount:0};
  const fullStop=()=>{bot.clearControlStates();};
  function internalStop(){        // index.js:390-395
    stopPathing=false;stateGoal=null;path=[];state.pathStopCount++;
    bot.emit('path_stop');
    fullStop();
  }
  function resetPath(reason,clearStates=true){   // index.js:123-140
    if(!stopPathing && path.length>0)bot.emit('path_reset',reason);
    path=[];
    if(clearStates)bot.clearControlStates();
    if(stopPathing)return internalStop();        // index.js:139 latch consumption
  }
  const pf={
    thinkTimeout:5000,                            // index.js:39
    movements:{canDig:false,allow1by1towers:false,allowParkour:false},
    setGoal(goal,dynamic=false){                  // index.js:142-147
      stateGoal=goal;state.goalSetCount++;
      bot.emit('goal_updated',goal,dynamic);      // emitted BEFORE resetPath
      resetPath('goal_updated');
    },
    setMovements(m){pf.movements=m;resetPath('movements_updated');},
    stop(){stopPathing=true;state.armCount++;},   // index.js:162-164 ARMS ONLY
    isMoving:()=>path.length>0,
    isThinking:()=>false,
    getPathTo(movements,goal){                    // read-only route proof
      state.routeRequests++;
      if(state.noRoute)return {status:'noPath',path:[]};
      // onlyRouteTo models terrain where exactly one stance has a solved route.
      if(state.onlyRouteTo && `${goal.x},${goal.y},${goal.z}`!==state.onlyRouteTo)
        return {status:'noPath',path:[]};
      return {status:'success',path:[{x:goal.x,y:goal.y,z:goal.z,toBreak:[],toPlace:[]}]};
    },
    goto(goal){state.gotoCount++;return gotoUtil(bot,goal);}, // index.js:158 -> REAL goto util
    // Test introspection only; bot.cjs never reads these.
    latchArmed:()=>stopPathing,
    currentGoal:()=>stateGoal
  };
  bot.pathfinder=pf;
  state.latchArmed=()=>stopPathing;
  state.currentGoal=()=>stateGoal;
  const goalTarget=g=>g instanceof GoalFollow
    ? g.entity.position.floored()
    : {x:g.x,y:g.y,z:g.z};
  function buildRoute(from,to){
    const steps=[];let {x,y,z}=from;
    while(x!==to.x){x+=Math.sign(to.x-x);steps.push({x,y,z,toBreak:[],toPlace:[]});}
    while(z!==to.z){z+=Math.sign(to.z-z);steps.push({x,y,z,toBreak:[],toPlace:[]});}
    while(y!==to.y){y+=Math.sign(to.y-y);steps.push({x,y,z,toBreak:[],toPlace:[]});}
    return steps;
  }
  // index.js monitorMovement(), reduced to routing and arrival semantics.
  bot.on('physicsTick',()=>{
    if(!stateGoal)return;
    const feet=bot.entity.position.floored();
    if(stateGoal.isEnd(feet)){                     // index.js:456-460
      bot.emit('goal_reached',stateGoal);stateGoal=null;path=[];return;
    }
    if(path.length===0){
      path=buildRoute(feet,goalTarget(stateGoal));
      // A genuine noPath still carries a non-empty partial path so goto()
      // rejects with NoPath instead of resolving (lib/goto.js noPathListener).
      bot.emit('path_update',{status:path.length?'success':'noPath',
        path:path.length?path.slice():[{x:feet.x,y:feet.y,z:feet.z,toBreak:[],toPlace:[]}]});
      if(!path.length){stateGoal=null;return;}
    }
    if(stopPathing){internalStop();return;}         // index.js:582-584
    if(state.stuck)return;                          // bot cannot make progress
    const next=path.shift();
    bot.entity.position=new Vec3(next.x+0.5,next.y,next.z+0.5);
    if(stateGoal.isEnd(bot.entity.position.floored())){
      bot.emit('goal_reached',stateGoal);stateGoal=null;path=[];
    }
  });
  return state;
}

/** Flat stone world with one exposed, diggable stone block at (3,64,0). */
function createWorld(){
  const blocks=new Map();
  const key=(x,y,z)=>`${x},${y},${z}`;
  const make=(name,x,y,z)=>({name,position:new Vec3(x,y,z),metadata:0,
    boundingBox:(name==='air'||name==='cave_air'||name==='void_air')?'empty':'block',
    getProperties:()=>({})});
  const put=(name,x,y,z)=>blocks.set(key(x,y,z),make(name,x,y,z));
  for(let x=-10;x<=10;x++)for(let z=-10;z<=10;z++){
    put('stone',x,63,z);put('air',x,64,z);put('air',x,65,z);put('air',x,66,z);
    for(let y=58;y<=62;y++)put('stone',x,y,z);   // solid, buried substrate
  }
  put('stone',3,64,0);   // the exposed mining target
  return {
    blocks,
    blockAt(p){
      const f=p.floored?p.floored():{x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)};
      return blocks.get(key(f.x,f.y,f.z))||make('air',f.x,f.y,f.z);
    },
    /** Real block removal plus a genuine dropped-item pickup into inventory. */
    removeBlock(p,dropInto){
      const f=p.floored();
      const prior=blocks.get(key(f.x,f.y,f.z));
      blocks.set(key(f.x,f.y,f.z),make('air',f.x,f.y,f.z));
      if(dropInto)dropInto();
      return prior;
    }
  };
}

async function fixture({stuck=false,armNavTimeout=false,noRoute=false,onlyRouteTo=null,inventory=null}={}){
  const stdin=new EventEmitter(),bot=new EventEmitter(),output=[];
  const world=createWorld();
  const pfState=attachFaithfulPathfinder(bot);
  pfState.stuck=stuck;pfState.noRoute=noRoute;pfState.onlyRouteTo=onlyRouteTo;
  let held=inventory?inventory.slice():[{name:'stone_pickaxe',count:1,type:1,slot:0}];
  bot.username='JarvisBuddy';
  bot.players={Owner:{entity:{username:'Owner',position:new Vec3(6.5,64,4.5)}}};
  bot.entities={};
  bot.entity={position:new Vec3(0.5,64,0.5),velocity:new Vec3(0,0,0),
    equipment:[null,null,null,null,null,null]};
  bot.health=20;bot.food=20;bot.game={dimension:'minecraft:overworld'};
  bot.time={timeOfDay:1000};bot.world={};
  bot.inventory={slots:held,items:()=>held.slice()};
  bot.getEquipmentDestSlot=()=>null;
  bot.loadPlugin=()=>{};
  bot.setControlState=()=>{};bot.clearControlStates=()=>{};
  bot.chat=()=>{};bot.quit=()=>{};bot.lookAt=()=>{};bot.attack=()=>{};
  bot.equip=async()=>{};bot.canDigBlock=()=>true;bot.stopDigging=()=>{};
  bot.nearestEntity=()=>null;
  bot.findBlocks=()=>[];
  bot.findBlock=()=>null;
  bot.blockAt=p=>world.blockAt(p);
  bot.dig=async block=>{
    assert.ok(block&&block.name!=='air','dig must target a real observed block');
    const drop=block.name==='stone'?'cobblestone':block.name;
    world.removeBlock(block.position,()=>{
      const existing=held.find(i=>i.name===drop);
      if(existing)existing.count++;else held.push({name:drop,count:1,type:2,slot:1});
    });
  };
  let timers=0;
  // Mutable so a scenario can time one navigation out and then release it.
  const flags={armNavTimeout};
  const timerShim=(fn,ms)=>{
    // pause(300) settles immediately; the navigation deadline only fires when
    // this scenario explicitly asks for a timeout.
    if(ms<=350||(flags.armNavTimeout&&ms>=1000))queueMicrotask(fn);
    return ++timers;
  };
  const mocks={
    mineflayer:{createBot:()=>bot},
    readline:{createInterface:()=>stdin},
    vec3:{Vec3},
    'mineflayer-pathfinder':{pathfinder(){},Movements:class{},
      goals:{GoalFollow,GoalNear,GoalBlock}}
  };
  vm.runInNewContext(source,{
    require:name=>mocks[name]||require(name),
    process:{env:{JARVIS_MINECRAFT_LAN_PORT:'54321',JARVIS_MINECRAFT_PLAYER:'Owner'},
      stdout:{write:x=>output.push(x)},stderr:{write:x=>output.push(x)},on(){},exit(){}},
    console,Buffer,setTimeout:timerShim,clearTimeout(){},setInterval(){},clearInterval(){}
  });
  // A real setTimeout(0) turn is required between ticks: lib/goto.js resolves
  // its promise from a setTimeout(...,0), and setImmediate callbacks queued
  // during the check phase would otherwise all run inside a single event-loop
  // iteration, starving the timers phase.
  const tick=async(n=1)=>{for(let i=0;i<n;i++){bot.emit('physicsTick');
    await new Promise(resolve=>setTimeout(resolve,0));}};
  const send=async(command,extra={})=>{
    const start=output.length;
    stdin.emit('line',JSON.stringify({id:'b'.repeat(16),command,...extra}));
    for(let i=0;i<24;i++)await tick(1);
    const received=output.slice(start).find(x=>x.startsWith('BOT_ACK '));
    assert.ok(received,`expected a receipt for ${command}`);
    return JSON.parse(received.slice(8));
  };
  const acks=()=>output.filter(x=>x.startsWith('BOT_ACK ')).map(x=>JSON.parse(x.slice(8)));
  bot.emit('spawn');
  return {send,tick,bot,pfState,flags,acks,world,
    held:()=>held,status:async()=>(await send('status')).status};
}

const DIG_TARGET={x:3,y:64,z:0};

(async()=>{
  // ---- 1. The reported live failure: dig a stone block, verify cobblestone.
  const a=await fixture();
  const ack=await a.send('dig_block',{position:DIG_TARGET});
  ok(ack.ok===true,'dig_block dispatch is accepted for an exposed stone target');
  ok(/STARTED/i.test(ack.status||''),'dispatch acknowledges START, never a fabricated success');
  const st=await a.status();
  ok(/Dig VERIFIED: cobblestone inventory 0 -> 1/.test(st),
    'FIRST MILESTONE: one newly mined cobblestone verified by inventory delta');
  ok(st.includes('cobblestone:1'),'cobblestone is physically present in the reported inventory');
  ok(a.held().some(i=>i.name==='cobblestone'&&i.count===1),'inventory model holds the mined drop');
  ok(a.world.blockAt(new Vec3(3,64,0)).name==='air','server block state actually changed to air');
  ok(/"mode":"stay"/.test(st),'a completed manual action ends in stay, never silent follow');
  ok(a.pfState.latchArmed()===false,'no sticky stopPathing latch survives a completed action');
  ok(a.pfState.routeRequests>0,'the route was prefetched through the real getPathTo proof');
  ok(a.pfState.gotoCount===1,
    'the FIRST route attempt is not wasted on a stale-latch abort');
  ok(!/Pathfinder stopped unexpectedly/.test(st),
    'no navigation is reported as an unexpected pathfinder stop');

  // ---- 1b. The exact live symptom: a target whose ONLY routable stance is
  // reached by the first navigation after halt(). A stale latch kills that
  // single attempt, so no retry can mask it and no cobblestone is collected.
  const a2=await fixture({onlyRouteTo:'1,64,0'});
  const ack2=await a2.send('dig_block',{position:DIG_TARGET});
  ok(ack2.ok===true,'single-stance dig is dispatched');
  const st2=await a2.status();
  ok(/Dig VERIFIED: cobblestone inventory 0 -> 1/.test(st2),
    'LIVE-SYMPTOM REGRESSION: the only routable stance is reached on the first attempt');
  ok(a2.held().some(i=>i.name==='cobblestone'&&i.count===1),
    'single-stance dig actually collected one cobblestone');
  ok(a2.world.blockAt(new Vec3(3,64,0)).name==='air','single-stance target block was really removed');
  ok(!/Pathfinder stopped unexpectedly|No reachable mining stance/.test(st2),
    'single-stance navigation is not aborted by the pathfinder stop latch');

  // ---- 2. Regression guard: navigation immediately after halt() must survive.
  const b=await fixture();
  await b.send('stay');                       // halt() arms+consumes the latch
  ok(b.pfState.latchArmed()===false,'halt() leaves the pathfinder latch disarmed');
  const nav=await b.send('navigate',{position:{x:5,y:64,z:5},range:2});
  ok(nav.ok===true,'navigate command accepted after an explicit halt');
  const navStatus=await b.status();
  ok(/Navigation verified near target/.test(navStatus),
    'the FIRST navigation after halt() reaches its goal instead of dying instantly');

  // ---- 3. A navigation timeout must not poison the next navigation.
  const c=await fixture({stuck:true,armNavTimeout:true});
  const t1=await c.send('navigate',{position:{x:9,y:64,z:9},range:2});
  ok(t1.ok===true,'stalled navigation is dispatched');
  let s=await c.status();
  ok(/Navigation timeout after/.test(s),'a stalled route reports an explicit timeout');
  ok(!/Pathfinder stopped unexpectedly/.test(s),'timeout is not misreported as an unexpected stop');
  ok(c.pfState.latchArmed()===false,'timeout disarms the latch instead of leaving it armed');
  // Release the stall and the deadline: the very next route must work in the
  // same session, which is impossible if the latch were left armed.
  c.pfState.stuck=false;c.flags.armNavTimeout=false;
  const t2=await c.send('navigate',{position:{x:2,y:64,z:6},range:2});
  ok(t2.ok===true,'second navigation dispatched after a timeout');
  s=await c.status();
  ok(/Navigation verified near target/.test(s),
    'RECOVERY: the navigation after a timeout is not killed by a stale latch');

  // ---- 4. Cancellation must remain authoritative (no weakening).
  const d=await fixture({stuck:true});
  const dig=await d.send('dig_block',{position:DIG_TARGET});
  ok(dig.ok===true,'dig dispatched while the bot cannot make progress');
  await d.send('stay');                       // owner cancels mid-navigation
  s=await d.status();
  ok(/"mode":"stay"/.test(s),'explicit operator cancellation remains authoritative');
  ok(!/Dig VERIFIED/.test(s),'a cancelled dig never claims a verified collection');
  ok(d.held().every(i=>i.name!=='cobblestone'),'cancelled dig produced no cobblestone');
  ok(d.world.blockAt(new Vec3(3,64,0)).name==='stone','cancelled dig left the block unbroken');
  ok(/cancelled|mode stay/i.test(s),'cancellation reason is surfaced in lastAction');
  ok(d.pfState.latchArmed()===false,'cancellation disarms the latch for the next command');

  // ---- 5. Follow mode must not be silently killed by a stale latch.
  // The bot is deliberately stalled so the follow goal cannot legitimately be
  // cleared by arrival; any null goal here is the latch defect, not success.
  const e=await fixture({stuck:true});
  await e.send('stay');
  const fol=await e.send('follow');
  ok(fol.ok===true,'follow command accepted');
  ok(e.pfState.currentGoal() instanceof GoalFollow,
    'the follow goal survives halt() instead of being nullified by a stale latch');

  // ---- 6. Fail-closed preconditions are unchanged by this repair.
  const f=await fixture({noRoute:true});
  const refused=await f.send('dig_block',{position:DIG_TARGET});
  ok(refused.ok===false,'no fully solved route means the dig is refused before any effect');
  ok(/no confirmed Pathfinder route|No confirmed/i.test(refused.error||''),
    'refusal states the reachability reason');
  ok(f.held().every(i=>i.name!=='cobblestone'),'refused dig produced no cobblestone');
  ok(f.world.blockAt(new Vec3(3,64,0)).name==='stone','refused dig left the block unbroken');

  const g=await fixture();
  const bad=await g.send('dig_block',{position:{x:0,y:60,z:0}});
  ok(bad.ok===false,'a fully buried block with no standable approach is refused');
  ok(/No exposed target with a safe loaded standable approach/.test(bad.error||''),
    'refusal names the missing exposed/standable precondition');
  ok(g.world.blockAt(new Vec3(0,60,0)).name==='stone','refused target is untouched');

  done('MINECRAFT_PATHFINDER_LIFECYCLE');
})().catch(err=>{console.error(err);process.exitCode=1;});
