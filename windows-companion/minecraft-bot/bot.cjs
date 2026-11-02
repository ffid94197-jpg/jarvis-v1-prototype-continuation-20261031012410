/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/* JARVIS Java LAN friend — independent Mineflayer player, not desktop input.
   All commands originate from the owner/Guardian or verified leader chat.
   Never advertise joining a world until Mineflayer emits spawn.
*/
const mineflayer = require('mineflayer');
const readline = require('readline');
const net = require('node:net');
const {Vec3} = require('vec3');
const {pathfinder, Movements, goals} = require('mineflayer-pathfinder');
const {validateCommand, inventorySummary} = require('./friend_protocol.cjs');
const {digest, createController, FOOD, resolveOwnerEntity} = require('./autonomy_engine.cjs');
const {createLateSkills} = require('./late_skills.cjs');
const {planSurveyStep}=require('./terrain_survey.cjs');
const {findExposedOre}=require('./ore_access.cjs');
const {confirmedMove}=require('./movement_proof.cjs');
const {SCAN_RADIUS,MAX_LOG_CANDIDATES,surveyTargets,rankLogs}=require('./wood_navigation.cjs');
const {loadedTargets,projectWorld}=require('./minecraft_ai_observation.cjs');
const {stances,reachableStances,isExposed,diggableObserved,rawCount,MINABLE_STONE}=require('./mining_navigation.cjs');
const {stoneProposal,excavationProposal}=require('./stone_access.cjs');
const {stopPathfinder,clearStaleStop}=require('./pathfinder_lifecycle.cjs');
// mineflayer-pathfinder needs up to thinkTimeout (5000ms default) just to
// decide a route. A per-leg navigation budget below that expires while A* is
// still computing, so every stance leg gets at least this much wall clock.
const STANCE_NAV_TIMEOUT_MS = 12000;
const port = Number(process.env.JARVIS_MINECRAFT_LAN_PORT);
const leader = process.env.JARVIS_MINECRAFT_PLAYER || '';
const BOT_USERNAME = 'JarvisBuddy';
const host = process.env.JARVIS_MINECRAFT_LAN_HOST || '127.0.0.1';
function privateLanHost(address){
  if(address==='localhost')return true;
  if(net.isIP(address)!==4)return false;
  const p=address.split('.').map(Number);
  return p[0]===10 || p[0]===127 || (p[0]===192&&p[1]===168) || (p[0]===172&&p[1]>=16&&p[1]<=31);
}

if (!Number.isInteger(port) || port < 1024 || port > 65535 ||
    !/^[A-Za-z0-9_]{1,16}$/.test(leader) ||
    leader.toLowerCase() === BOT_USERNAME.toLowerCase() || !privateLanHost(host)) {
  process.stderr.write('Configure a valid Minecraft Java LAN port and YOUR owner username (different from JarvisBuddy).\n');
  process.exit(2);
}
const bot = mineflayer.createBot({host,port,username:BOT_USERNAME,auth:'offline',hideErrors:true});
bot.loadPlugin(pathfinder);
let spawned=false, mode='follow', actionEpoch=0, followTimer, moveTimer, lastAction='not started', guardUntil=0;
// Failed digging coordinates are quarantined until a meaningful position change.
const failedDigTargets=new Map();
const autopilot=createController({maxSeconds:43200,maxSteps:20000});
let autoBusy=false;let deathsOnCurrentGoal=0;let resumeAfterSpawn=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MOB_NAMES=new Set(['zombie','skeleton','spider','husk','drowned']);
function ack(id,ok,status,error){
  process.stdout.write('BOT_ACK '+JSON.stringify({id,ok,status:String(status||'').slice(0,1900),error})+'\n');
}
function stopInput(){
  if(moveTimer){clearTimeout(moveTimer);moveTimer=undefined;}
  for(const key of ['forward','back','left','right','jump'])bot.setControlState(key,false);
}
// A stance leg must outlive pathfinder's own A* think budget plus walking time.
function stanceNavTimeoutMs(){
  const think=Number(bot?.pathfinder?.thinkTimeout)||5000;
  return Math.max(STANCE_NAV_TIMEOUT_MS,think+7000);
}
function halt(){
  ++actionEpoch;
  // Order matters. mineflayer-pathfinder's stop() only ARMS a sticky latch
  // that the next setGoal() consumes; calling setGoal(null) first and stop()
  // second left the latch armed, which killed the NEXT goto() before the bot
  // moved. stopPathfinder() arms then consumes, so no sticky state survives.
  stopPathfinder(bot);
  stopInput();
}
function ownerEntity(){ return resolveOwnerEntity(bot, leader); }
function conciseStatus(){
  const p=bot.entity?.position;const owner=ownerEntity();
  const delta=p && owner?.position ? Math.round(p.distanceTo(owner.position)) : null;
  return JSON.stringify({mode,position:p?{x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)}:null,
    ownerName:leader,botName:bot.username,gameMode:bot.game?.gameMode||'unknown',ownerVisible:!!owner,ownerDistance:delta,health:bot.health,food:bot.food,
    inventory:inventorySummary(bot),autonomy:autopilot.status().status,
    autoGoal:autopilot.status().goal,autoSteps:autopilot.status().steps,lastAction}).slice(0,1500);
}
function say(text){
  if(typeof text!=='string'||!text.trim())return;
  bot.chat(String(text).replace(/[\r\n]/g,' ').slice(0,120));
}
function setMode(next){halt();if(mode==='auto')autopilot.stop('Superseded by owner command');mode=next;lastAction='mode '+next;}
function doFollow(){
  const player=ownerEntity();
  if(player)bot.pathfinder.setGoal(new goals.GoalFollow(player,3),true);
}
// Manual jobs own navigation until they finish or the owner explicitly cancels them.
// Do not silently resume follow: that can replace a collection path and mislead status.
function startAction(name,fn){
  setMode(name);const epoch=actionEpoch;lastAction=name+' started';
  (async()=>{
    try {
      const done=await fn(()=>epoch===actionEpoch);
      if(epoch===actionEpoch){lastAction=done;mode='stay';}
    }catch(err){
      if(epoch===actionEpoch){lastAction=name+' failed: '+String(err.message||err).slice(0,175);mode='stay';}
    }
  })();
}
function isTreeLog(block){return !!block && /_log$/.test(block.name) && !block.name.includes('stripped');}
function nearbyLogs(){
  // Inspect multiple logs; the closest one can be behind a wall or above a cliff.
  const positions=typeof bot.findBlocks==='function' ? bot.findBlocks({matching:isTreeLog,maxDistance:SCAN_RADIUS,count:MAX_LOG_CANDIDATES}) : [];
  if(positions?.length)return rankLogs(positions,bot.entity.position);
  const nearest=bot.findBlock({matching:isTreeLog,maxDistance:SCAN_RADIUS});
  return nearest?rankLogs([nearest.position],bot.entity.position):[];
}
// Return a verified inventory delta, not a mere block-digging receipt.
async function gatherOneLog(epoch,deadline){
  const before=digest(bot,leader).inventory.logs;
  const tried=new Set();let lastFailure='no log blocks in loaded nearby chunks';
  const origin=bot.entity.position.clone();
  let searched=false;
  while(epoch===actionEpoch && Date.now()<deadline){
    const positions=nearbyLogs().filter(p=>!tried.has(`${p.x},${p.y},${p.z}`));
    if(!positions.length){
      if(searched)break;
      searched=true;
      // Only survey loaded, verified standable ground. Each waypoint is a
      // distinct bounded attempt; no digging, scaffold towers or blind replay.
      const targets=surveyTargets(bot,origin,Vec3);
      let visited=0;
      for(const target of targets){
        if(epoch!==actionEpoch)throw Error('Wood collection cancelled');
        if(Date.now()+2500>=deadline)break;
        visited++;
        try{
          await navigate(target,2,epoch,Math.min(11000,deadline-Date.now()));
        }catch(err){lastFailure=String(err.message||err).slice(0,120);}
        if(nearbyLogs().some(p=>!tried.has(`${p.x},${p.y},${p.z}`)))break;
      }
      if(!nearbyLogs().length)
        lastFailure=visited?`Surveyed ${visited} safe waypoints; no reachable logs verified (last navigation: ${lastFailure})`:
          'No loaded safe survey waypoint or visible tree; refusing blind movement';
      continue;
    }
    for(const p of positions){
      if(epoch!==actionEpoch)throw Error('Wood collection cancelled');
      if(Date.now()+1000>=deadline)break;
      tried.add(`${p.x},${p.y},${p.z}`);
      lastAction=`collect_wood navigating to ${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
      try{
        const reached=await navigate(p,2,epoch,Math.min(18000,deadline-Date.now()));
        if(!reached)throw Error('Navigation ended outside log reach');
        const live=bot.blockAt(p);
        if(!isTreeLog(live))throw Error('Tree log no longer present');
        if(bot.entity.position.distanceTo(p)>5)throw Error('Log beyond digging reach');
        await bot.dig(live);
        for(let i=0;i<12;i++){
          if(epoch!==actionEpoch)throw Error('Wood collection cancelled');
          await pause(300);
          let after=digest(bot,leader).inventory.logs;
          if(after>before)return {ok:true,verified:true,detail:`Logs in inventory ${before} -> ${after}`};
          const item=bot.nearestEntity?.(e=>e?.position && (e.name==='item'||e.type==='other') && e.position.distanceTo(p)<8);
          if(item?.position && bot.entity.position.distanceTo(item.position)>1.15){
            // A 3s window is shorter than Mineflayer Pathfinder's route
            // planning budget. Keep a safe bounded window and demand actual
            // inventory delta after walking to the dropped item.
            const remaining=deadline-Date.now();
            if(remaining>2500){
              try{
                const reached=await navigate(item.position,1,epoch,Math.min(14000,remaining-500));
                if(!reached)lastFailure='Item route ended without reaching pickup range';
              }catch(err){
                lastFailure='Item route failed: '+String(err.message||err).slice(0,110);
              }
            }
          }
        }
        lastFailure='Log dug but item pickup not verified';
      }catch(err){
        if(epoch!==actionEpoch)throw Error('Wood collection cancelled');
        lastFailure=String(err.message||err).slice(0,130);
      }
    }
  }
  return {ok:false,verified:false,detail:lastFailure+(Date.now()>=deadline?' (wood deadline expired)':'')};
}
async function collectWood(alive){
  const epoch=actionEpoch,deadline=Date.now()+75000;
  const before=digest(bot,leader).inventory.logs;
  for(let i=0;i<2 && alive() && Date.now()<deadline;i++){
    const result=await gatherOneLog(epoch,deadline);
    if(!result.ok){
      if(digest(bot,leader).inventory.logs>before)return `Partial wood gathering: ${before} -> ${digest(bot,leader).inventory.logs}; ${result.detail}`;
      throw Error(result.detail);
    }
  }
  const after=digest(bot,leader).inventory.logs;
  if(!alive())throw Error('Wood collection cancelled');
  if(after<=before)throw Error('No wood collected (inventory unchanged)');
  return `Wood collection verified: inventory logs ${before} -> ${after}`;
}
function guardTick(){
  const owner=ownerEntity();
  if(!owner){lastAction='guard paused: owner not in loaded range';return;}
  if(Date.now()>guardUntil){setMode('follow');return;}
  const hostile=bot.nearestEntity(e=>e && MOB_NAMES.has(e.name) &&
    e.position.distanceTo(owner.position)<=12 && e.position.distanceTo(bot.entity.position)<=12);
  if(!hostile){doFollow();return;}
  const distance=hostile.position.distanceTo(bot.entity.position);
  if(distance>3.1)bot.pathfinder.setGoal(new goals.GoalFollow(hostile,2),true);
  else {bot.pathfinder.setGoal(null);bot.attack(hostile);lastAction='guard engaged '+hostile.name;}
}
// Every automatic operation is bounded, cancellable, and checked against in-world state.
async function navigate(p,range,epoch,limitMs=12000){
  let timer,expired=false;
  const destination=`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  // Clear any latch a previous cancellation or timeout left armed. Otherwise
  // goto() below would reject instantly with 'Path was stopped' and the bot
  // would never take its first step toward this destination.
  clearStaleStop(bot);
  try{
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z),range)),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        expired=true;
        // Queue the meaningful error BEFORE stopping Pathfinder. Otherwise the
        // generic 'Path was stopped' rejection can win the race.
        reject(Error(`Navigation timeout after ${limitMs}ms to ${destination}`));
        // Arm AND consume: a bare stop() here leaves the latch armed and
        // silently poisons every subsequent stance retry in the same action.
        stopPathfinder(bot);
      },limitMs);})
    ]);
  }catch(err){
    if(epoch!==actionEpoch)throw Error('Navigation cancelled by another command');
    if(expired)throw Error(`Navigation timeout after ${limitMs}ms to ${destination}`);
    if(/path was stopped/i.test(String(err.message||err)))
      throw Error(`Pathfinder stopped unexpectedly while approaching ${destination}`);
    throw err;
  }finally{clearTimeout(timer);}
  if(epoch!==actionEpoch)throw Error('Navigation cancelled by another command');
  return bot.entity.position.distanceTo(p) <= range+2;
}
async function craftNamed(name,count,epoch,table=null){
  const item=bot.registry?.itemsByName?.[name];
  if(!item)throw Error('Item not available for this Minecraft version');
  const before=(digest(bot,leader).inventory.raw[name]||0);
  const recipes=bot.recipesFor(item.id,null,1,table);
  if(!recipes?.length)throw Error('Required crafting ingredients or workstation unavailable');
  await bot.craft(recipes[0],count,table);
  if(epoch!==actionEpoch)throw Error('Craft cancelled by owner');
  const after=digest(bot,leader).inventory.raw[name]||0;
  return {ok:after>before,verified:after>before,detail:`${name}: inventory ${before} -> ${after}`};
}
const lateSkills=createLateSkills({bot,navigate,craftNamed,getEpoch:()=>actionEpoch,getOwner:()=>leader,digest,Vec3});
async function collectVerifiedDrop(blockPosition, beforeCount, readCount, epoch, label){
  // A successfully dug block is not progression until the actual server
  // inventory reports the drop. Pathfinder can require >3s to plan movement.
  const deadline=Date.now()+25000;
  let lastRoute='drop entity not yet visible';
  while(Date.now()<deadline){
    if(epoch!==actionEpoch)throw Error('Mining pickup cancelled');
    await pause(350);
    const count=readCount();
    if(count>beforeCount)return {ok:true,verified:true,detail:label+' '+beforeCount+' -> '+count};
    const dropped=bot.nearestEntity?.(e=>e?.position &&
      (e.name==='item'||e.type==='other') && e.position.distanceTo(blockPosition)<8);
    if(dropped?.position){
      if(bot.entity.position.distanceTo(dropped.position)>1.15){
        const remain=deadline-Date.now();
        if(remain>1000){
          try{
            const reached=await navigate(dropped.position,1,epoch,Math.min(14000,remain-400));
            lastRoute=reached?'Near drop but inventory unchanged':'Drop route out of pickup range';
          }catch(e){lastRoute='Drop route: '+String(e.message||e).slice(0,90);}
        }
      }else lastRoute='Near drop, but inventory not updated';
    }
  }
  return {ok:false,verified:false,detail:label+' mined but inventory drop unverified: '+lastRoute};
}
async function scoutStoneSite(epoch){
  // A finite, real-position scouting fallback for exhausted local surface
  // layers. It never claims cobblestone from a movement observation.
  const attempt=bot.jarvisStoneScoutCount||0;
  if(attempt>=8)return {ok:false,verified:false,detail:'Eight stone-search regions exhausted, no ore proof'};
  const dirs=[[8,0],[0,8],[-8,0],[0,-8],[8,8],[-8,8],[8,-8],[-8,-8]];
  const here=bot.entity.position.clone();
  for(let j=0;j<3;j++){
    const [dx,dz]=dirs[(attempt+j)%dirs.length];
    const px=Math.floor(here.x)+dx,pz=Math.floor(here.z)+dz;
    for(const dy of [0,1,-1,2,-2]){
      const foot=new Vec3(px,Math.floor(here.y)+dy,pz);
      const ground=bot.blockAt(foot.offset(0,-1,0));
      const legs=bot.blockAt(foot),head=bot.blockAt(foot.offset(0,1,0));
      if(!ground||ground.boundingBox!=='block'||
         /lava|water|magma|cactus/.test(ground.name)||
         !legs||legs.boundingBox!=='empty'||!head||head.boundingBox!=='empty'||
         /lava|water|fire|powder_snow/.test(legs.name+' '+head.name))continue;
      try{
        const reached=await navigate(foot.offset(.5,0,.5),2,epoch,
          Math.min(14500,stanceNavTimeoutMs()));
        if(reached && bot.entity.position.distanceTo(here)>3){
          bot.jarvisStoneScoutCount=attempt+1;
          return {ok:true,verified:true,detail:'New stone-search region reached, server observed '+here+' -> '+bot.entity.position+'; no stone claimed'};
        }
      }catch(error){if(epoch!==actionEpoch)throw error;}
    }
  }
  bot.jarvisStoneScoutCount=attempt+1;
  return {ok:false,verified:false,detail:'No safe reachable new stone terrain; resource count unchanged'};
}
async function autoExecute(plan,epoch){
  const before=digest(bot,leader);
  if(epoch!==actionEpoch)throw Error('Owner cancelled current action');
  switch(plan.kind){
    case 'follow':{
      const owner=ownerEntity();if(!owner)throw Error('Owner no longer visible');
      const reached=await navigate(owner.position,plan.range||4,epoch,10000);
      return {ok:reached,verified:reached,detail:'Owner distance '+digest(bot,leader).ownerDistance};
    }
    case 'retreat':{
      const enemy=bot.nearestEntity(e=>e && e.position && ['creeper','zombie','skeleton','spider','husk','drowned','witch'].includes(e.name) && e.position.distanceTo(bot.entity.position)<=12);
      if(!enemy)return {ok:true,verified:true,detail:'Threat no longer nearby'};
      const p=bot.entity.position, e=enemy.position;
      const mag=Math.max(1,Math.hypot(p.x-e.x,p.z-e.z));
      const dest={x:p.x+8*(p.x-e.x)/mag,y:p.y,z:p.z+8*(p.z-e.z)/mag};
      const reached=await navigate(dest,3,epoch,9000);
      const now=digest(bot,leader).threats[0];
      return {ok:reached,verified:reached && (!now || now.distance>4),detail:'Retreat destination attempted, nearby threat distance '+(now?.distance||'none')};
    }
    case 'defend':{
      const hostile=bot.entities?.[plan.targetId];
      if(!hostile || !hostile.position)return {ok:true,verified:true,detail:'Threat is no longer visible'};
      if(hostile.position.distanceTo(bot.entity.position)>3)return {ok:false,verified:false,detail:'Target moved away; no blind attack'};
      bot.attack(hostile);await pause(300);
      return {ok:true,verified:true,detail:'Attack input dispatched at observed hostile (no damage claim)'};
    }
    case 'eat':{
      const food=bot.inventory.items().find(i=>FOOD.test(i.name));if(!food)throw Error('No edible item');
      const old=bot.food;
      await bot.equip(food,'hand');await bot.consume();
      if(epoch!==actionEpoch)throw Error('Owner stopped action');
      return {ok:bot.food>old,verified:bot.food>old,detail:'Hunger '+old+' -> '+bot.food};
    }
    case 'recover_table':{
      // Physically retrieve the SAME table that crafted the wooden pickaxe.
      // If left at the surface before underground mining, the only table
      // becomes unreachable and the planner falsely seeks more timber.
      const existing=before.inventory.table;
      // Do not mine another player's table. This coordinate is saved ONLY
      // after a confirmed place_table action by our own autonomous bot.
      const owned=bot.jarvisOwnedCraftingTablePos;
      if(!owned)
        return {ok:false,verified:false,detail:'No proof this crafting table belongs to the bot'};
      const station=bot.blockAt(owned);
      if(station?.name!=='crafting_table')
        return {ok:false,verified:false,detail:'Previously placed crafting table no longer exists'};
      if(epoch!==actionEpoch)throw Error('Workstation retrieval cancelled');
      const p=station.position;
      const distance=bot.entity.position.distanceTo(p.offset(.5,.5,.5));
      if(distance>4.2){
        const reached=await navigate(p,2,epoch,stanceNavTimeoutMs());
        if(!reached) return {ok:false,verified:false,detail:'Placed crafting table is inaccessible'};
      }
      if(epoch!==actionEpoch)throw Error('Workstation retrieval cancelled');
      const live=bot.blockAt(p);
      if(live?.name!=='crafting_table' || !bot.canDigBlock?.(live))
        return {ok:false,verified:false,detail:'Crafting table is no longer present or diggable'};
      await bot.dig(live);
      bot.jarvisOwnedCraftingTablePos=null; // The block is gone even if pickup fails.
      if(epoch!==actionEpoch)throw Error('Workstation retrieval cancelled');
      return collectVerifiedDrop(p,existing,()=>digest(bot,leader).inventory.table,
        epoch,'Recovered crafting table');
    }
    case 'collect_wood':return await gatherOneLog(epoch,Date.now()+45000);
    case 'survey_ore':{
      if(!['iron','diamond'].includes(plan.ore))throw Error('Unsupported ore survey');
      if(String(bot.game?.dimension||'').replace(/^minecraft:/,'')!=='overworld')
        throw Error('Ore excavation only authorized in overworld');
      const oreNames=plan.ore==='iron'?['iron_ore','deepslate_iron_ore']:['diamond_ore','deepslate_diamond_ore'];
      // IMPORTANT: findBlock can return fully buried ore in a loaded chunk.
      // It proves neither exposure nor reachability, and must not reset the
      // mining retry counter. Survey advances only after actual excavation
      // and a new position observed from the server.
      const accessible=()=>findExposedOre(bot,oreNames,24);
      const pickNames=plan.ore==='diamond'?['iron_pickaxe','diamond_pickaxe','netherite_pickaxe']:
        ['stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'];
      const tool=bot.inventory.items().find(i=>pickNames.includes(i.name));
      if(!tool)return {ok:false,verified:false,detail:'No mining-tier pickaxe for '+plan.ore+' cave survey'};
      // Open a short, naturally generated rock staircase instead of repeatedly
      // walking surface circles that cannot expose deep diamond deposits.
      const proposal=planSurveyStep({position:bot.entity.position,ore:plan.ore,
        index:plan.index||0,getBlock:(x,y,z)=>bot.blockAt(new Vec3(x,y,z))});
      if(!proposal.ok)return {ok:false,verified:false,detail:proposal.reason};
      await bot.equip(tool,'hand');
      for(const b of proposal.dig){
        if(epoch!==actionEpoch)throw Error('Ore survey cancelled');
        const block=bot.blockAt(b.position);
        if(!block || block.name!==b.name || !bot.canDigBlock?.(block))
          return {ok:false,verified:false,detail:'Excavation target changed or cannot be mined'};
        await bot.dig(block);
        const after=bot.blockAt(b.position);
        if(after && after.name===block.name)
          return {ok:false,verified:false,detail:'Excavation did not change server block state'};
      }
      const start=bot.entity.position.clone();
      const reached=await navigate(new Vec3(proposal.target.x,proposal.target.y,proposal.target.z),1,epoch,13000)
        .catch(()=>false);
      const moved=confirmedMove(start,bot.entity.position,proposal.target,{minHorizontal:.45,maxTargetDistance:2.4});
      if(!reached||!moved)
        return {ok:false,verified:false,detail:'Survey excavation opened but physical movement not verified'};
      const ore=accessible();
      return {ok:true,verified:true,detail:ore?'Verified cave advance and an exposed '+ore.block.name+' near '+ore.block.position:
        'Verified safe '+plan.ore+' cave advance; no exposed ore found yet'};
    }
    case 'mine_cobblestone':{
      if(!(before.inventory.woodenPickaxe||before.inventory.stonePickaxe||
         before.inventory.ironPickaxe||before.inventory.diamondPickaxe))
        throw Error('Stone mining requires a real pickaxe');
      const pick=bot.inventory.items().find(i=>
        ['stone_pickaxe','wooden_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'].includes(i.name));
      if(!pick)throw Error('Server inventory has no usable pickaxe');
      const candidate=stoneProposal(bot,goals.GoalBlock);
      if(!candidate){
        // The old findBlock picked buried stone and retried impossible A*
        // routes forever. Physically uncover nearby stone instead. No
        // cobblestone is claimed unless inventory later increases.
        const preparation=excavationProposal(bot);
        if(!preparation)return scoutStoneSite(epoch);
        const prior=bot.blockAt(preparation.position);
        if(!prior||!bot.canDigBlock?.(prior))
          return {ok:false,verified:false,detail:'Proposed soil excavation became unsafe'};
        const beforeStone=before.inventory.cobblestone;
        await bot.equip(pick,'hand');
        await bot.dig(prior);
        if(epoch!==actionEpoch)throw Error('Stone excavation cancelled');
        await pause(150);
        const changed=bot.blockAt(preparation.position);
        if(!changed||changed.name===prior.name||/lava|water/.test(changed.name))
          return {ok:false,verified:false,detail:'Excavation did not safely change actual server block state'};
        if(['stone','cobblestone'].includes(prior.name))
          return collectVerifiedDrop(preparation.position,beforeStone,
            ()=>digest(bot,leader).inventory.cobblestone,epoch,'Excavated cobblestone');
        return {ok:true,verified:true,detail:'Server-confirmed safe preparatory excavation; no stone drop claimed'};
      }
      if(candidate.stance){
        const stance=candidate.stance;
        const reached=await navigate(new Vec3(stance.x+.5,stance.y,stance.z+.5),
          1,epoch,stanceNavTimeoutMs());
        if(!reached)return {ok:false,verified:false,detail:'Stone mining stance not physically reached'};
      }
      if(epoch!==actionEpoch)throw Error('Stone mining cancelled');
      const live=bot.blockAt(candidate.position);
      if(!live||!['stone','cobblestone'].includes(live.name)||
         !isExposed(bot,live.position)||!bot.canDigBlock?.(live))
        return {ok:false,verified:false,detail:'Selected stone is not exposed and within real mining reach'};
      const beforeStone=before.inventory.cobblestone;
      await bot.equip(pick,'hand');
      await bot.dig(live);
      return collectVerifiedDrop(candidate.position,beforeStone,
        ()=>digest(bot,leader).inventory.cobblestone,epoch,'Cobblestone');
    }
    case 'mine_iron':{
      if(!before.inventory.stonePickaxe && !before.inventory.ironPickaxe)throw Error('Iron ore needs stone or better pickaxe');
      const exposed=findExposedOre(bot,['iron_ore','deepslate_iron_ore'],24);
      const target=exposed?.block;
      if(!target)throw Error('No safely exposed iron ore in loaded chunks; request cave survey');
      const p=target.position;await navigate(exposed.stance,1,epoch,14500);
      if(epoch!==actionEpoch)throw Error('Mining cancelled');
      const live=bot.blockAt(p);if(!live || !['iron_ore','deepslate_iron_ore'].includes(live.name))throw Error('Ore moved or changed');
      if(bot.entity.position.distanceTo(p)>5)throw Error('Iron ore not within reach');
      const pick=bot.inventory.items().find(i=>['stone_pickaxe','iron_pickaxe'].includes(i.name));
      if(!pick)throw Error('Missing valid iron mining pickaxe');
      await bot.equip(pick,'hand');await bot.dig(live);
       return collectVerifiedDrop(p,before.inventory.rawIron,
         ()=>digest(bot,leader).inventory.rawIron,epoch,'Raw iron');
    }
    case 'craft_furnace':{
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:5});
      if(!station)throw Error('Crafting table not within reach');
      return craftNamed('furnace',1,epoch,station);
    }
    case 'place_furnace':{
      const furnace=bot.inventory.items().find(i=>i.name==='furnace');
      if(!furnace)throw Error('No furnace');
      const p=bot.entity.position;
      for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]]){
        const ground=bot.blockAt(p.offset(dx,-1,dz));const space=bot.blockAt(p.offset(dx,0,dz));
        if(!ground || ground.boundingBox==='empty'||space?.name!=='air')continue;
        await bot.equip(furnace,'hand');await bot.placeBlock(ground,{x:0,y:1,z:0});
        if(epoch!==actionEpoch)throw Error('Placement cancelled');
        const observed=bot.blockAt(ground.position.offset(0,1,0));
        return {ok:observed?.name==='furnace',verified:observed?.name==='furnace',detail:'Furnace observed after placement: '+(observed?.name||'missing')};
      }
      throw Error('No adjacent placement surface for furnace');
    }
    case 'smelt_iron':{
      const block=bot.findBlock({matching:b=>b?.name==='furnace',maxDistance:5});
      if(!block)throw Error('Furnace out of reach');
      const raw=bot.inventory.items().find(i=>i.name==='raw_iron');
      const fuel=bot.inventory.items().find(i=>i.name==='coal'||i.name.endsWith('_planks'));
      if(!raw||!fuel)throw Error('Raw iron and compatible fuel required');
      const ui=await bot.openFurnace(block);
      try{
        await ui.putFuel(fuel.type,null,1);await ui.putInput(raw.type,null,Math.min(raw.count,3));
        for(let i=0;i<32;i++){
          if(epoch!==actionEpoch)throw Error('Smelting cancelled');
          await pause(500);
          if(ui.outputItem()?.name==='iron_ingot'){
            await ui.takeOutput();
            const after=digest(bot,leader).inventory.ironIngot;
            return {ok:after>before.inventory.ironIngot,verified:after>before.inventory.ironIngot,detail:'Iron ingots '+before.inventory.ironIngot+' -> '+after};
          }
        }
        return {ok:false,verified:false,detail:'Furnace produced no verified ingot within 16 seconds'};
      }finally{ui.close();}
    }
    case 'mine_diamond':{
      if(!before.inventory.ironPickaxe && !before.inventory.diamondPickaxe)throw Error('Diamond mining requires iron or diamond pickaxe');
      const exposed=findExposedOre(bot,['diamond_ore','deepslate_diamond_ore'],24);
      const target=exposed?.block;
      if(!target)throw Error('No safely exposed diamond ore in loaded chunks; request cave survey');
      const p=target.position;
      await navigate(exposed.stance,1,epoch,14500);
      if(epoch!==actionEpoch)throw Error('Diamond mining cancelled');
      const live=bot.blockAt(p);
      if(!live || !['diamond_ore','deepslate_diamond_ore'].includes(live.name))throw Error('Diamond ore changed');
      if(bot.entity.position.distanceTo(p)>5)throw Error('Diamond ore out of reach');
      const pick=bot.inventory.items().find(i=>['diamond_pickaxe','iron_pickaxe'].includes(i.name));
      if(!pick)throw Error('Missing pickaxe');
      await bot.equip(pick,'hand');await bot.dig(live);
       return collectVerifiedDrop(p,before.inventory.diamonds,
         ()=>digest(bot,leader).inventory.diamonds,epoch,'Diamonds');
    }
    case 'craft_diamond_gear':{
      const allowed=new Set(['diamond_pickaxe','diamond_sword','diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots']);
      if(!allowed.has(plan.item))throw Error('Invalid diamond crafting target');
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:5});
      if(!station)throw Error('Crafting table not in reach');
      return craftNamed(plan.item,1,epoch,station);
    }
    case 'craft_iron_pickaxe':{
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:5});
      if(!station)throw Error('Crafting table not in reach');
      return craftNamed('iron_pickaxe',1,epoch,station);
    }
    case 'craft_stone_pickaxe':case 'craft_stone_sword':{
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:5});
      if(!station)throw Error('Crafting table not in reach');
      return await craftNamed(plan.kind==='craft_stone_pickaxe'?'stone_pickaxe':'stone_sword',1,epoch,station);
    }
    case 'craft_planks':{
      const logName=Object.keys(before.inventory.raw).find(n=>/_log$/.test(n)&&before.inventory.raw[n]>0);
      if(!logName)throw Error('No log to craft');
      return await craftNamed(logName.replace(/_log$/,'_planks'),1,epoch);
    }
    case 'craft_sticks':return await craftNamed('stick',1,epoch);
    case 'craft_table':return await craftNamed('crafting_table',1,epoch);
    case 'place_table':{
      const tableItem=bot.inventory.items().find(i=>i.name==='crafting_table');
      if(!tableItem)throw Error('Crafting table not in inventory');
      const p=bot.entity.position;
      for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]]){
        if(epoch!==actionEpoch)throw Error('Placement cancelled');
        const ground=bot.blockAt(p.offset(dx,-1,dz));
        const above=bot.blockAt(p.offset(dx,0,dz));
        if(!ground || ground.boundingBox==='empty' || above?.name!=='air')continue;
        await bot.equip(tableItem,'hand');await bot.placeBlock(ground,{x:0,y:1,z:0});
        const placed=bot.blockAt(ground.position.offset(0,1,0));
        const ok=placed?.name==='crafting_table';
        if(ok)bot.jarvisOwnedCraftingTablePos=placed.position.clone();
        return {ok,verified:ok,detail:'Crafting table '+(ok?'placed and observed':'placement unverified')};
      }
      throw Error('No safe adjacent ground for crafting table');
    }
    case 'craft_pickaxe':{
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:5});
      if(!station)throw Error('No placed crafting table in reach');
      return await craftNamed('wooden_pickaxe',1,epoch,station);
    }
    case 'explore':{
      const owner=ownerEntity();if(!owner)throw Error('Owner not visible');
      const offsets=[[7,0],[5,5],[0,7],[-5,5],[-7,0],[-5,-5],[0,-7],[5,-5]];
      const [dx,dz]=offsets[(autopilot.status().steps-1)%offsets.length];
      const p=owner.position;const dest={x:p.x+dx,y:p.y,z:p.z+dz};
      const reached=await navigate(dest,2,epoch,12000);
      const observation=digest(bot,leader);
      return {ok:reached,verified:reached&&observation.ownerDistance<=22,detail:'Explored relative waypoint, owner distance '+observation.ownerDistance};
    }
    default:return lateSkills.run(plan,epoch);
  }
}
async function autoTick(){
  if(mode!=='auto'||autoBusy||!spawned)return;
  const plan=autopilot.next(digest(bot,leader,{dragonDead:lateSkills.session.dragonDied}));
  // Expiring a safety window must not silently claim mission completion or
  // force the owner to reissue a high-level instruction. Continue only a
  // still-authorized long mission; blocked or stopped goals remain stopped.
  if(plan.kind==='idle' && autopilot.status().status==='expired' && autopilot.renewMission(21600)){
    lastAction='Mission time window renewed from live world; victory still unverified';
    return;
  }
  if(['complete','blocked','idle'].includes(plan.kind)){
    if(autopilot.status().status!=='running'){
      lastAction='auto '+autopilot.status().status+': '+autopilot.status().why;
      mode='stay';halt();
    }
    return;
  }
  if(plan.kind==='wait'){lastAction='auto waiting: '+plan.why;return;}
  autoBusy=true;const epoch=actionEpoch;lastAction='auto '+plan.kind+' started';
  try{
    const result=await autoExecute(plan,epoch);
    if(epoch===actionEpoch && mode==='auto'){
      autopilot.record(plan,result);lastAction='auto '+plan.kind+': '+result.detail;
      if(autopilot.status().goal==='dragon_then_netherite_run' && plan.kind==='equip_netherite' &&
         result?.ok===true && result?.verified===true && result?.proof==='netherite_equipped' &&
         digest(bot,leader).wornNetherite===true){
        process.stdout.write('BOT_EVENT '+JSON.stringify({type:'netherite_equipped',
          at:Date.now(),worn:true,dimension:String(bot.game?.dimension||'').replace(/^minecraft:/,''),
          goal:autopilot.status().goal})+'\n');
      }
    }
  }catch(err){
    if(epoch===actionEpoch && mode==='auto'){
      const detail=String(err.message||err).slice(0,120);
      autopilot.record(plan,{ok:false,verified:false,detail});lastAction='auto '+plan.kind+' failed: '+detail;
    }
  }finally{autoBusy=false;}
}
async function action(q){
  const bad=validateCommand(q);
  if(bad)return {ok:false,error:bad};
  if(!spawned)return {ok:false,error:'Minecraft bot has not spawned'};
  switch(q.command){
    case 'status':return {ok:true,status:conciseStatus()};
    case 'inventory':return {ok:true,status:inventorySummary(bot)};
    case 'observe':{
      const snapshot=digest(bot,leader,{dragonDead:lateSkills.session.dragonDied});
      // Compact, valid JSON (<1900 chars) so the managed companion cannot
      // silently truncate a late-game observation and mislead the planner.
      return {ok:true,status:projectWorld(snapshot,loadedTargets(bot),lastAction,mode)};
    }
    case 'auto_status':return {ok:true,status:JSON.stringify(autopilot.status()).slice(0,1900)};
    case 'auto_stop':resumeAfterSpawn=false;setMode('stay');return {ok:true,status:'Autonomous gameplay stopped; movement cancelled'};
    case 'auto_goal':{
      // The Dragon/Netherite acceptance path is survival-only. Never allow
      // creative/spectator/adventure game modes to generate a fake victory.
      if(['dragon_then_netherite_run','netherite_dragon_run','dragon_run','wood'].includes(q.goal) &&
         bot.game?.gameMode!=='survival')
        return {ok:false,error:'Autonomous survival goal requires server-confirmed survival game mode'};
      // A repeated model/tool call must not erase progress or interrupt an
      // already running owner-authorized goal. Explicit auto_stop is required.
      if(autopilot.status().status==='running')
        return {ok:false,error:'Autonomous goal already running; inspect auto_status or use auto_stop before replacement'};
      halt();mode='auto';resumeAfterSpawn=false;deathsOnCurrentGoal=0;
       // Evidence from an earlier owner mission is NOT proof for a new run.
       lateSkills.session.dragonSeen=false;
       lateSkills.session.dragonDied=false;
      try{const st=autopilot.start(q.goal,q.durationSeconds||(q.goal==='netherite_dragon_run'||q.goal==='dragon_then_netherite_run'||q.goal==='dragon_run'||q.goal==='companion'?21600:300));lastAction='Autonomous '+st.goal+' STARTED';
        return {ok:true,status:'Autonomous '+st.goal+' STARTED, expires in '+Math.floor((st.deadline-Date.now())/1000)+'s; verify progress via auto_status'};
      }catch(err){mode='stay';return {ok:false,error:String(err.message||err).slice(0,120)};}
    }
    // General player primitives are owner-authorized, bounded and report observed outcomes.
    case 'inspect_block':{
      const b=bot.blockAt(new Vec3(q.position.x,q.position.y,q.position.z));
      return {ok:!!b,status:b?JSON.stringify({name:b.name,position:q.position,metadata:b.metadata}):'Block not loaded'};
    }
    case 'navigate':{
      startAction('navigate',async alive=>{
        const jobEpoch=actionEpoch;const p=q.position;await navigate(new Vec3(p.x,p.y,p.z),q.range||2,jobEpoch,15000);
        if(!alive())return 'Navigation cancelled';
        const dist=bot.entity.position.distanceTo(new Vec3(p.x,p.y,p.z));
        if(dist>(q.range||2)+1.5)throw Error('Arrival not verified');
        return 'Navigation verified near target';
      });return {ok:true,status:'Navigation STARTED; inspect status for verified arrival'};
    }
    case 'dig_block':{
      const p=q.position, target=new Vec3(p.x,p.y,p.z);
      const block=bot.blockAt(target);
      if(!block || ['air','cave_air','void_air','bedrock'].includes(block.name) || /(lava|water|fire|magma|cactus)/.test(block.name))return {ok:false,error:'No safely diggable loaded block at target; no dig started'};
      if(!isExposed(bot,p) || !stances(bot,p).length)return {ok:false,error:'No exposed target with a safe loaded standable approach; no dig started'};
      const startPos=bot.entity.position.clone();
      const key=`${p.x},${p.y},${p.z}`;
      const failed=failedDigTargets.get(key);
      if(failed && startPos.distanceTo(failed)<4)
        return {ok:false,error:'Dig target previously failed near this position; choose another observed reachable target'};
      if(failedDigTargets.size>24)failedDigTargets.clear();
      // Preflight *full route* before dispatching any effect; geometric safety
      // alone cannot establish a connected path through the loaded terrain.
      // Partial, timed-out, or missing Pathfinder routes fail closed.
      const candidates=reachableStances(bot,p,goals.GoalBlock,{maxCandidates:4,routeTimeoutMs:90});
      if(!candidates.length){
        failedDigTargets.set(key,startPos);
        lastAction='dig_block rejected: no fully reachable mining stance';
        return {ok:false,error:'No confirmed Pathfinder route to a loaded safe mining stance; no dig started. Select another freshly observed stone target or a grounded accessible area.'};
      }
      startAction('dig_block',async alive=>{
        const jobEpoch=actionEpoch;
        const dropMap={stone:'cobblestone',cobblestone:'cobblestone',deepslate:'cobbled_deepslate',cobbled_deepslate:'cobbled_deepslate',iron_ore:'raw_iron',deepslate_iron_ore:'raw_iron',diamond_ore:'diamond',deepslate_diamond_ore:'diamond',gold_ore:'raw_gold',deepslate_gold_ore:'raw_gold'};
        const dropName=dropMap[block.name]||block.name;
        const before=rawCount(bot,dropName);
        let lastFailure='no reachable standable approach';
        try{
          // Do not navigate toward the stone block itself: it may be deep underground.
          // Only standable side positions from loaded blocks are considered.
          let arrived=false;
          for(const stance of candidates.slice(0,3)){
            if(!alive())throw Error('Dig cancelled');
            try{
              // GoalNear(...,0) targets the exact foot block; GoalNear(...,1)
              // could stop on an unreachable ledge next to the stance.
              // The budget must exceed pathfinder's own A* thinkTimeout, or
              // this leg expires while the route is still being computed.
              if(stance.route!=='already_there'){
                const reached=await navigate(new Vec3(stance.x,stance.y,stance.z),0,jobEpoch,stanceNavTimeoutMs());
                if(!reached)throw Error(`Navigation ended outside stance ${stance.x},${stance.y},${stance.z}`);
              }
              if(!alive())throw Error('Dig cancelled');
              const current=bot.entity.position;
              if(Math.floor(current.x)!==stance.x || Math.floor(current.y)!==stance.y || Math.floor(current.z)!==stance.z)
                throw Error(`Arrival at verified mining stance not confirmed (stood at ${Math.floor(current.x)},${Math.floor(current.y)},${Math.floor(current.z)} wanted ${stance.x},${stance.y},${stance.z})`);
              const targetCenter=target.offset(.5,.5,.5);
              const eye=current.offset(0,1.62,0);
              if(eye.distanceTo(targetCenter)>4.4)throw Error('Mining target still outside observed reach');
              const ground=bot.blockAt(new Vec3(Math.floor(current.x),Math.floor(current.y)-1,Math.floor(current.z)));
              if(!ground || ground.boundingBox!=='block')throw Error('No confirmed stable floor at mining stance');
              arrived=true;break;
            }catch(err){
              if(!alive())throw Error('Dig cancelled');
              lastFailure=String(err.message||err).slice(0,90);
            }
          }
          if(!arrived)throw Error('No reachable mining stance; '+lastFailure);
          const live=bot.blockAt(target);
          if(!live || live.name!==block.name)throw Error('Stone changed before digging; fresh observation required');
          const pick=bot.inventory.items().find(i=>/^(?:wooden|stone|iron|golden|diamond|netherite)_pickaxe$/.test(i.name));
          if(!pick)throw Error('No pickaxe in inventory');
          await bot.equip(pick,'hand');
          if(!alive())throw Error('Dig cancelled');
          await bot.dig(live);
          if(!alive())throw Error('Dig cancelled');
          const updated=bot.blockAt(target);
          if(!updated || updated.name===live.name)throw Error('Block-state removal not verified');
          // Short, bounded in-game pickup reconciliation; never claim an item on dispatch alone.
          for(let n=0;n<12;n++){
            if(!alive())throw Error('Dig cancelled');
            if(rawCount(bot,dropName)>before){failedDigTargets.delete(key);return `Dig VERIFIED: ${dropName} inventory ${before} -> ${rawCount(bot,dropName)}`;}
            await pause(300);
          }
          // A block removal is not evidence that the drop entered inventory.
          failedDigTargets.set(key,startPos);
          return `Block removed but ${dropName} pickup NOT VERIFIED; target quarantined`;
        }catch(err){
          if(alive())failedDigTargets.set(key,startPos);
          throw err;
        }
      });
      return {ok:true,status:'Dig STARTED toward safe loaded mining stance; result pending; use observe.lastAction and inventory delta'};
    }
    case 'equip_item':{
      const item=bot.inventory.items().find(i=>i.name===q.item);
      if(!item)return {ok:false,error:'Item not in inventory'};
      await bot.equip(item,q.destination||'hand');
      return {ok:true,status:'Equip request completed for '+q.item};
    }
    case 'craft_item':{
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:4});
      const result=await craftNamed(q.item,q.count,actionEpoch,station||null);
      return {ok:result.ok===true,status:result.detail||'Craft attempted'};
    }
    case 'place_block':{
      const item=bot.inventory.items().find(i=>i.name===q.item);
      if(!item)return {ok:false,error:'Placement item missing'};
      const ref=bot.blockAt(new Vec3(q.reference.x,q.reference.y,q.reference.z));
      if(!ref || ref.name==='air')return {ok:false,error:'Reference block absent'};
      if(bot.entity.position.distanceTo(ref.position)>4.5)return {ok:false,error:'Reference block out of reach'};
      const face=new Vec3(q.face.x,q.face.y,q.face.z);
      const target=ref.position.plus(face);
      const prior=bot.blockAt(target);
      if(prior && !['air','cave_air','void_air','water','tall_grass','short_grass'].includes(prior.name))return {ok:false,error:'Target obstructed'};
      await bot.equip(item,'hand');await bot.placeBlock(ref,face);
      const after=bot.blockAt(target);
      return {ok:!!after && !['air','cave_air','void_air'].includes(after.name),status:'Placed block state '+String(after?.name||'unknown')};
    }
    case 'interact_block':{
      const block=bot.blockAt(new Vec3(q.position.x,q.position.y,q.position.z));
      if(!block || bot.entity.position.distanceTo(block.position)>4.5)return {ok:false,error:'No reachable block'};
      await bot.activateBlock(block);return {ok:true,status:'Block interaction dispatched (effect not independently verified)'};
    }
    case 'interact_entity':{
      const entity=bot.entities[q.entityId];
      if(!entity || !entity.position || bot.entity.position.distanceTo(entity.position)>4.5)return {ok:false,error:'Entity not reachable'};
      if(entity.type==='player')return {ok:false,error:'Player entity interaction not enabled'};
      bot.activateEntity(entity);return {ok:true,status:'Entity interaction dispatched (effect not independently verified)'};
    }
    case 'use_item':{
      bot.activateItem(q.hand==='off-hand');
      return {ok:true,status:'Use-item request dispatched (effect not independently verified)'};
    }
    case 'stop':case 'stay':setMode('stay');return {ok:true,status:'Staying here; movement stopped'};
    case 'follow':setMode('follow');doFollow();return {ok:true,status:'Following '+leader+' (within loaded world)'};
    case 'look':{
      const owner=ownerEntity();if(!owner)return {ok:false,error:'Owner is not visible to bot'};
      await bot.lookAt(owner.position.offset(0,1.5,0),true);
      return {ok:true,status:'Look direction requested toward owner'};
    }
    case 'jump':setMode('stay');bot.setControlState('jump',true);
      moveTimer=setTimeout(()=>stopInput(),350);return {ok:true,status:'Jump input sent'};
    case 'move':setMode('stay');bot.setControlState(q.directionInput,true);
      moveTimer=setTimeout(()=>stopInput(),q.durationMs);
      return {ok:true,status:'Movement input sent, '+q.durationMs+'ms'};
    case 'say':say(q.text);return {ok:true,status:'Message sent to in-game chat; delivery not independently verified'};
    case 'come':{
      const owner=ownerEntity();if(!owner)return {ok:false,error:'Owner not visible to bot'};
      startAction('come',async alive=>{
        const jobEpoch=actionEpoch,p=owner.position.clone();
        const reached=await navigate(p,2,jobEpoch,14000);
        if(!alive())throw Error('Come cancelled');
        if(!reached)throw Error('Arrival not verified');
        return 'reached last observed owner position';
      });
      return {ok:true,status:'Come task STARTED; query status to verify arrival'};
    }
    case 'collect_wood':
      startAction('collect_wood',collectWood);
      return {ok:true,status:'Wood gathering STARTED (maximum 2 verified logs, 75s); query status for result'};
    case 'guard':setMode('guard');guardUntil=Date.now()+60000;
      return {ok:true,status:'Guarding owner against nearby common hostile mobs for at most 60s; never attacks players'};
    default:return {ok:false,error:'Unsupported command'};
  }
}
bot.once('spawn',()=>{
  spawned=true;const movement=new Movements(bot);
  // Resource gathering must not acquire random dirt by mining its path.
  movement.canDig=false;
  movement.allow1by1towers=false;
  movement.allowParkour=false;
  bot.pathfinder.setMovements(movement);
  process.stdout.write('MINECRAFT_COMPANION_JOINED (spawn observed)\n');
  say('Hi '+leader+'! JarvisBuddy joined. Say "jarvis help" in chat.');
  followTimer=setInterval(()=>{
    try{if(mode==='follow')doFollow();else if(mode==='guard')guardTick();else if(mode==='auto')void autoTick();}
    catch(err){lastAction='navigation error: '+String(err.message||err).slice(0,90);}
  },2000);
});
bot.on('chat',(username,message)=>{
  if(username!==leader || !spawned || typeof message!=='string')return;
  const match=/^jarvis(?:buddy)?[,: ]+([a-z_]+)(?:\s+(.+))?$/i.exec(message.trim());
  if(!match)return;
  const cmd=match[1].toLowerCase();
  const normalized=cmd==='gather'?'collect_wood':cmd==='wait'?'stay':cmd;
  if(cmd==='help'){say('Commands: follow, come, stay, guard, gather, auto [survive|wood|tools|stone_age|iron_age|netherite_dragon_run|dragon_then_netherite_run|dragon_run|companion|explore|follow|guard], pause, observe, status, inventory');return;}
  if(cmd==='auto'||cmd==='goal') {const goal=(match[2]||'survive').trim().toLowerCase();
    action({command:'auto_goal',goal,durationSeconds:goal==='companion'||goal==='netherite_dragon_run'||goal==='dragon_then_netherite_run'||goal==='dragon_run'?21600:300}).then(r=>say(r.ok?r.status:r.error)).catch(()=>say('Could not start autonomous goal'));return;}
  if(cmd==='pause') {action({command:'auto_stop'}).then(r=>say(r.status||r.error));return;}
  const q={command:normalized};
  if(normalized==='say')q.text=match[2]||'';
  action(q).then(r=>say(r.ok?(r.status||'OK'):(r.error||'Unavailable'))).catch(()=>say('Action failed'));
});
const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
reader.on('line',line=>{
  let q;try{q=JSON.parse(line);}catch{return;}
  if(typeof q.id!=='string'||!/^[a-f0-9]{16}$/.test(q.id))return;
  action(q).then(r=>ack(q.id,r.ok,r.status,r.error))
    .catch(err=>ack(q.id,false,'',String(err.message||err).slice(0,120)));
});
bot.on('entityDead',entity=>{
   // A death event is only admissible if the current mission observed a
   // Dragon in the End, and this is the same live encounter.
   const inEnd=String(bot.game?.dimension||'').replace(/^minecraft:/,'')==='the_end';
   if(inEnd && entity?.name==='ender_dragon' && lateSkills.session.dragonSeen){
     lateSkills.session.dragonDied=true;
     if(autopilot.status().goal==='dragon_then_netherite_run' && autopilot.status().status==='running')
       process.stdout.write('BOT_EVENT '+JSON.stringify({type:'dragon_death',
         at:Date.now(),dimension:'the_end',entityId:entity.id??null,
         goal:autopilot.status().goal})+'\n');
   }
 });
bot.on('death',()=>{
  const active=mode==='auto' && autopilot.status().status==='running';
  if(active){
    deathsOnCurrentGoal++;
    resumeAfterSpawn=deathsOnCurrentGoal<=3;
    autopilot.stop(resumeAfterSpawn?'Death: bounded autonomous respawn recovery pending':'Death retry budget exhausted');
  }
  halt();mode=resumeAfterSpawn?'recover':'stay';
  lastAction=resumeAfterSpawn?'death observed: respawn and start again from actual remaining inventory':'bot died; recovery stopped';
});
bot.on('spawn',()=>{
  if(!resumeAfterSpawn)return;
  resumeAfterSpawn=false;
  if(autopilot.resumeAfterRespawn()){
    mode='auto';lastAction='Server respawn observed; autonomous mission restarted from actual inventory';
  }else{mode='stay';lastAction='Respawn observed, autonomous deadline expired';}
});
bot.on('kicked',reason=>{process.stderr.write('Bot kicked: '+String(reason).slice(0,150)+'\n');process.exitCode=1;});
bot.on('error',err=>{process.stderr.write('Bot error: '+String(err.code||'unknown')+'\n');process.exitCode=1;});
bot.on('end',()=>{clearInterval(followTimer);halt();process.exit(process.exitCode||0);});
process.on('SIGTERM',()=>{clearInterval(followTimer);if(mode==='auto')autopilot.stop('Operator stopped bot');halt();bot.quit('Operator stopped JARVIS friend');});
