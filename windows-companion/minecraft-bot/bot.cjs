/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/* JARVIS Java LAN friend — independent Mineflayer player, not desktop input.
   All commands originate from the owner/Guardian or verified leader chat.
   Never advertise joining a world until Mineflayer emits spawn.
*/
const mineflayer = require('mineflayer');
const readline = require('readline');
const net = require('node:net');
const path = require('node:path');
const {createCheckpoint} = require('./mission_checkpoint.cjs');
const {acceptDragonDeath,resetDragon}=require('./dragon_engagement.cjs');
const {Vec3} = require('vec3');
const {pathfinder, Movements, goals} = require('mineflayer-pathfinder');
const {validateCommand, inventorySummary} = require('./friend_protocol.cjs');
const {goalSpecFromCommand}=require('./goal_dispatch.cjs');
const {compactAutonomyStatus}=require('./status_receipt.cjs');
const {interpretOwnerInstruction} = require('./language_goal.cjs');
const {itemName:normalizeCraftItemName}=require('./general_play_intent.cjs');
const {digest, createController, FOOD, HOSTILES, resolveOwnerEntity} = require('./autonomy_engine.cjs');
const {createLateSkills} = require('./late_skills.cjs');
const {createAdvancedActions}=require('./advanced_survival_actions.cjs');
const {validHostileTarget,validPursuitTarget,fightObserved,equipObservedMelee}=require('./native_combat.cjs');
const {compileRecipeCatalog}=require('./mindcraft_recipe_graph.cjs');
const {chooseNativeShelterSite}=require('./native_shelter.cjs');
const {planSurveyStep}=require('./terrain_survey.cjs');
const {findExposedOre}=require('./ore_access.cjs');
const {confirmedMove}=require('./movement_proof.cjs');
const {SCAN_RADIUS,MAX_LOG_CANDIDATES,surveyTargets,rankLogs}=require('./wood_navigation.cjs');
const {collectObservedDrop,pickupFeet}=require('./drop_pickup.cjs');
const {retreatStances}=require('./retreat_access.cjs');
const {normalizeResource,SAFE_GENERIC_RESOURCES}=require('./resource_goal.cjs');
const {validBuildSpec,observeBuild,validVolumeSpec,observeVolume,
  placementReference}=require('./structure_goal.cjs');
const {validFarmSpec,observeWheat}=require('./wheat_goal.cjs');
const {observeCrop}=require('./crop_goal.cjs');
const {validCraftSpec,validEquipSpec}=require('./general_goal.cjs');
const {safeSurveyFeet}=require('./wood_navigation.cjs');
const {waitForInventoryIncrease}=require('./inventory_settlement.cjs');
const {loadedTargets,projectWorld}=require('./minecraft_ai_observation.cjs');
const {stances,reachableStances,isExposed,diggableObserved,rawCount,MINABLE_STONE}=require('./mining_navigation.cjs');
const {stoneProposal,excavationProposal}=require('./stone_access.cjs');
const {findCraftingSite,findCarvableCraftingAlcove}=require('./crafting_site.cjs');
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
const missionCheckpoint=createCheckpoint(path.join(__dirname,'.jarvis-minecraft-mission.json'),{host,port,owner:leader});
// Keep the exact crop output visible in compact game observations even when
// the player carries dozens of unrelated stacks. No invented quantity.
function nativeObservationItem(){
  const state=autopilot.status();
  return state.goal==='farm_crop'?
    (state.crop==='carrots'?'carrot':state.crop==='potatoes'?'potato':null):
    state.item;
}
let autoBusy=false;let deathsOnCurrentGoal=0;let resumeAfterSpawn=false;let languageBusy=false;
let advancedBusy=false;
let guardBusy=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MOB_NAMES=new Set(['zombie','skeleton','spider','husk','drowned']);
function ack(id,ok,status,error){
  process.stdout.write('BOT_ACK '+JSON.stringify({id,ok,status:String(status||'').slice(0,1900),error})+'\n');
}
function stopInput(){
  if(moveTimer){clearTimeout(moveTimer);moveTimer=undefined;}
  // Mineflayer may emit 'end' before it finishes constructing movement
  // controls. Shutdown must not replace the underlying connection error with
  // "bot.setControlState is not a function".
  if(typeof bot.setControlState!=='function'){
    if(spawned){process.exitCode=1;lastAction='Mineflayer movement API disappeared after spawn';}
    return;
  }
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
function setMode(next){halt();if(mode==='auto'){autopilot.stop('Superseded by owner command');missionCheckpoint.clear();}mode=next;lastAction='mode '+next;}
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
  // Avoid digging canopy blocks whose drops cannot be retrieved from an
  // observed standable foot position. The real Java 1.21.1 field run failed
  // at Y=75 after mining logs but leaving inaccessible floating drops.
  const eligible=p=>{
    const foot=pickupFeet(bot,p.offset(.5,.5,.5),Vec3);
    return !!foot && foot.distanceTo(p)<=4.5;
  };
  const positions=typeof bot.findBlocks==='function' ?
    bot.findBlocks({matching:isTreeLog,maxDistance:SCAN_RADIUS,count:MAX_LOG_CANDIDATES*3}) : [];
  if(positions?.length)return rankLogs(positions,bot.entity.position,eligible);
  const nearest=bot.findBlock({matching:isTreeLog,maxDistance:SCAN_RADIUS});
  return nearest?rankLogs([nearest.position],bot.entity.position,eligible):[];
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
        if(epoch!==actionEpoch)throw Error('Wood collection cancelled');
        const acquired=await collectObservedDrop({
          bot,origin:p,beforeCount:before,
          readCount:()=>digest(bot,leader).inventory.logs,
          move:(target,range,limitMs)=>navigate(target,range,epoch,limitMs),
          check:()=>{if(epoch!==actionEpoch)throw Error('Wood collection cancelled')},
          wait:pause,deadline:Math.min(deadline,Date.now()+19000),
          Vec3,label:'Wood logs'
        });
        if(acquired.ok && acquired.verified)return acquired;
        lastFailure=acquired.detail;
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
  if(guardBusy||mode!=='guard'||!spawned)return;
  const owner=ownerEntity();
  if(!owner){lastAction='guard paused: owner not in loaded range';return;}
  if(Date.now()>guardUntil){setMode('follow');return;}
  if(bot.health<10){
    lastAction='guard avoiding combat: health too low';
    doFollow();return;
  }
  const hostile=bot.nearestEntity(e=>e && MOB_NAMES.has(e.name) &&
    e.type!=='player'&&!e.username&&e.position &&
    e.position.distanceTo(owner.position)<=12 &&
    e.position.distanceTo(bot.entity.position)<=12);
  if(!hostile){doFollow();return;}
  const distance=hostile.position.distanceTo(bot.entity.position);
  if(distance>3.4){
    if(distance>8){
      lastAction='guard tracking distant hostile without attacking';
      doFollow();return;
    }
    bot.pathfinder.setGoal(new goals.GoalFollow(hostile,3),true);
    return;
  }
  if(!validHostileTarget(bot,hostile.id))return;
  const epoch=actionEpoch;
  guardBusy=true;
  stopPathfinder(bot);
  void fightObserved({bot,entityId:hostile.id,maxSwings:4,pause,
    allowed:()=>spawned&&mode==='guard'&&epoch===actionEpoch})
    .then(outcome=>{
      if(epoch===actionEpoch&&mode==='guard')
        lastAction='guard: '+String(outcome.detail||'Defensive combat unproven').slice(0,160);
    }).catch(error=>{
      if(epoch===actionEpoch&&mode==='guard')
        lastAction='guard inconclusive: '+String(error?.message||error).slice(0,120);
    }).finally(()=>{guardBusy=false;});
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
  if(!Number.isInteger(count)||count<1||count>16)
    throw Error('Craft quantity must be between 1 and 16 items');
  // Mineflayer count means RECIPE OPERATIONS, not produced items. A log-to-
  // planks recipe yields four items per operation; blindly crafting count
  // times silently spends 4x the material. Query for the requested minimum
  // output, then dispatch only the necessary number of operations.
  const recipes=bot.recipesFor(item.id,null,count,table);
  if(!recipes?.length)throw Error('Required crafting ingredients or workstation unavailable');
  const perCraft=recipes[0]?.result?.count;
  if(!Number.isInteger(perCraft)||perCraft<1||perCraft>64)
    throw Error('Invalid Minecraft recipe output count');
  const operations=Math.ceil(count/perCraft);
  if(epoch!==actionEpoch)throw Error('Craft cancelled by owner');
  await bot.craft(recipes[0],operations,table);
  // The server can acknowledge a crafting operation before the inventory
  // packet settles. Readback immediately after craft() incorrectly rejected
  // real planks/sticks, then retried a spent log and deadlocked the mission.
  if(epoch!==actionEpoch)throw Error('Craft cancelled by owner');
  const result=await waitForInventoryIncrease({
    // Don't settle on the FIRST one-item increment when the owner requested
    // several. Wait until the actual inventory reaches the full target.
    before:before+count-1,read:()=>digest(bot,leader).inventory.raw[name]||0,
    check:()=>{if(epoch!==actionEpoch)throw Error('Craft cancelled by owner')},
    wait:pause,deadline:Date.now()+3500,
  });
  const verified=result.ok===true && result.after>=before+count;
  return {ok:verified,verified,
    detail:`${name}: inventory ${before} -> ${result.after}; requested at least ${count}`+
      (verified?' (server receipt)':' (result unverified or incomplete)')};
}
const lateSkills=createLateSkills({bot,navigate,craftNamed,getEpoch:()=>actionEpoch,getOwner:()=>leader,digest,Vec3});
async function collectVerifiedDrop(blockPosition,beforeCount,readCount,epoch,label){
  return collectObservedDrop({
    bot,origin:blockPosition,beforeCount,readCount,
    move:(target,range,limitMs)=>navigate(target,range,epoch,limitMs),
    check:()=>{if(epoch!==actionEpoch)throw Error('Mining pickup cancelled')},
    wait:pause,deadline:Date.now()+25000,Vec3,label
  });
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
    case 'craft_general':{
      if(!validCraftSpec({goal:'craft',item:plan.item,targetCount:1}))
        return {ok:false,verified:false,detail:'Unapproved crafting target'};
      const table=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:4});
      const needsTable=plan.requiresTable===undefined?
        !['stick','crafting_table','torch'].includes(plan.item):
        plan.requiresTable===true;
      if(needsTable&&!table)
        return {ok:false,verified:false,detail:'Required workstation not server-observed'};
      // The live recipe registry and actual inventory, not a language-model
      // message, determine whether this crafting effect is possible.
      return craftNamed(plan.item,1,epoch,needsTable?table:null);
    }
    case 'equip_general':{
      if(!validEquipSpec({goal:'equip',item:plan.item,destination:plan.destination}))
        return {ok:false,verified:false,detail:'Unapproved equipment combination'};
      const owned=bot.inventory.items().find(i=>i.name===plan.item);
      if(!owned)return {ok:false,verified:false,detail:'Equipment item not in backpack'};
      await bot.equip(owned,plan.destination);
      if(epoch!==actionEpoch)throw Error('Equipment action cancelled by owner');
      const slot=bot.getEquipmentDestSlot?.(plan.destination);
      const observed=plan.destination==='hand'?bot.heldItem?.name:
        Number.isInteger(slot)?bot.inventory.slots?.[slot]?.name:null;
      return {ok:observed===plan.item,verified:observed===plan.item,
        detail:'Server equipment '+plan.destination+': '+String(observed||'unverified')};
    }
    case 'harvest_wheat':case 'plant_wheat':
    case 'harvest_crop':case 'plant_crop':{
      const cropType=plan.kind.endsWith('_crop')?plan.crop:'wheat';
      if(!['wheat','carrots','potatoes'].includes(cropType))
        return {ok:false,verified:false,detail:'Unsupported crop identity'};
      const itemType=cropType==='wheat'?'wheat':
        cropType==='carrots'?'carrot':'potato';
      const seedType=cropType==='wheat'?'wheat_seeds':itemType;
      const harvesting=plan.kind.startsWith('harvest_');
      const p=plan.position;
      const target=new Vec3(p.x,p.y,p.z),prior=bot.blockAt(target);
      const floor=bot.blockAt(target.offset(0,-1,0));
      if(!prior||!floor||floor.name!=='farmland')
        return {ok:false,verified:false,detail:'Wheat field no longer observed on tilled farmland'};
      const pos=bot.entity.position;
      if(pos.distanceTo(target.offset(.5,.5,.5))>12)
        return {ok:false,verified:false,detail:'Wheat action outside 12-block local boundary'};
      if(pos.distanceTo(target.offset(.5,.5,.5))>4.2){
        let navigated=false;
        for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const foot=safeSurveyFeet(bot,p.x+dx,p.z+dz,p.y,Vec3);
          if(!foot)continue;
          try{
            if(await navigate(foot.offset(.5,0,.5),0,epoch,stanceNavTimeoutMs()) &&
               bot.entity.position.distanceTo(target.offset(.5,.5,.5))<=4.2){
              navigated=true;break;
            }
          }catch(e){if(epoch!==actionEpoch)throw e;}
        }
        if(!navigated)return {ok:false,verified:false,detail:'No safe reachable wheat field stance'};
      }
      if(epoch!==actionEpoch)throw Error('Owner cancelled wheat farming');
      const crop=bot.blockAt(target),actualFloor=bot.blockAt(target.offset(0,-1,0));
      if(actualFloor?.name!=='farmland')return {ok:false,verified:false,detail:'Farmland changed during travel'};
      if(harvesting){
        const observedAge=Number(crop?.getProperties?.().age);
        if(crop?.name!==cropType||!Number.isInteger(observedAge)||observedAge!==7 ||
           !bot.canDigBlock?.(crop))
          return {ok:false,verified:false,detail:'Wheat is no longer mature and diggable'};
        const beforeCrop=rawCount(bot,itemType);
        await bot.dig(crop);
        if(epoch!==actionEpoch)throw Error('Owner cancelled wheat harvest');
        if(bot.blockAt(target)?.name===cropType)
          return {ok:false,verified:false,detail:'Mature crop removal not observed'};
        const result=await collectVerifiedDrop(target,beforeCrop,
          ()=>rawCount(bot,itemType),epoch,'Verified '+cropType+' harvest');
        if(plan.kind==='harvest_wheat')return result;
        const actual=rawCount(bot,itemType)-beforeCrop;
        const ok=result?.ok===true&&result?.verified===true &&
          Number.isSafeInteger(actual)&&actual>=1&&actual<=64;
        return {ok,verified:ok,
          ...(ok?{proof:'crop_harvest',crop:cropType,count:actual}:{}),
          detail:ok?String(result.detail||'Actual crop inventory readback verified'):
            'Harvested block changed but new crop inventory unverified'};
      }
      if(!crop||!['air','cave_air'].includes(crop.name))
        return {ok:false,verified:false,detail:'Planting target is not empty farmland'};
      const seed=bot.inventory.items().find(i=>i.name===seedType&&i.count>0);
      if(!seed)return {ok:false,verified:false,detail:'No server-verified '+seedType};
      const beforeSeed=rawCount(bot,seedType);
      await bot.equip(seed,'hand');
      if(epoch!==actionEpoch)throw Error('Owner cancelled wheat planting');
      await bot.placeBlock(actualFloor,new Vec3(0,1,0));
      for(let j=0;j<8;j++){
        if(epoch!==actionEpoch)throw Error('Owner cancelled wheat planting');
        if(bot.blockAt(target)?.name===cropType&&rawCount(bot,seedType)<beforeSeed)
          return {ok:true,verified:true,
            ...(plan.kind==='plant_crop'?{proof:'crop_planted',crop:cropType}:{}),
            detail:'Real '+seedType+' consumed and '+cropType+' crop present on farmland'};
        await pause(200);
      }
      return {ok:false,verified:false,detail:'New wheat crop plus seed consumption not both verified'};
    }
    case 'bridge_end_gap':{
      // An End spawn platform may be isolated from the central island by
      // a short VOID gap. Only place a bounded survival cobblestone bridge
      // tile toward ACTUAL loaded End-stone terrain. Never step into void,
      // synthesize a destination, invent a block, or treat a tile as victory.
      if(String(bot.game?.dimension||'').replace(/^minecraft:/,'')!=='the_end' ||
         bot.health<12 || !bot.entity?.position ||
         rawCount(bot,'cobblestone')<1)
        return {ok:false,verified:false,detail:'Bridge requires live End dimension, healthy player and real cobblestone'};
      const here=bot.entity.position.clone(),footY=Math.floor(here.y)-1;
      const beneath=bot.blockAt(new Vec3(Math.floor(here.x),footY,Math.floor(here.z)));
      if(!beneath||beneath.boundingBox!=='block'||
         /lava|water|fire|magma/.test(beneath.name))
        return {ok:false,verified:false,detail:'Player lacks safe observed platform footing'};
      const island=typeof bot.findBlocks==='function'?
        bot.findBlocks({matching:v=>v?.name==='end_stone',
          maxDistance:18,count:96})||[]:[];
      const candidates=island.map(v=>({
         pos:v,dx:v.x-here.x,dz:v.z-here.z,
         horizontal:Math.hypot(v.x-here.x,v.z-here.z)
        })).filter(v=>v.horizontal>=3&&v.horizontal<=14&&
          Math.abs(v.pos.y-footY)<=2)
          .sort((a,b)=>a.horizontal-b.horizontal);
      if(!candidates.length)
        return {ok:false,verified:false,detail:'No actual island End-stone within 14 horizontal blocks; bridge refused'};
      const direction=candidates[0];
      const sx=Math.abs(direction.dx)>=Math.abs(direction.dz)?
        Math.sign(direction.dx):0;
      const sz=sx===0?Math.sign(direction.dz):0;
      if(sx===0&&sz===0)
        return {ok:false,verified:false,detail:'No measured bridge direction'};
      // Find one target on the same foot level with an ACTUAL contiguous
      // support face. Deliberately limit to a few tiles from the standing
      // position; otherwise navigation could lead over an unbuilt chasm.
      const x=Math.floor(here.x),z=Math.floor(here.z);
      let chosen=null;
      for(let distance=1;distance<=3;distance++){
        const p=new Vec3(x+sx*distance,footY,z+sz*distance);
        const live=bot.blockAt(p),body=bot.blockAt(p.offset(0,1,0)),
          head=bot.blockAt(p.offset(0,2,0)),
          below=bot.blockAt(p.offset(0,-1,0));
        if(!live||!body||!head||!below)return {ok:false,verified:false,
          detail:'End bridge would extend into unloaded world; refused'};
        // Never overwrite existing solid island/platform tiles or build
        // above observed lava. A gap is air over observed void/air.
        if(live.boundingBox==='block')continue;
        if(live.boundingBox!=='empty'||body.boundingBox!=='empty'||
           head.boundingBox!=='empty' ||
           !['air','cave_air','void_air'].includes(below.name))
          return {ok:false,verified:false,detail:'End gap has unsafe or blocked destination'};
        const rear=bot.blockAt(p.offset(-sx,0,-sz));
        if(rear?.boundingBox!=='block')continue;
        const actualTarget={x:p.x,y:p.y,z:p.z};
        if(bot.entity.position.distanceTo(p.offset(.5,.5,.5))>4.2)break;
        chosen=actualTarget;break;
      }
      if(!chosen)return {ok:false,verified:false,
        detail:'No safe directly supported gap tile within physical placement range'};
      // The shared structure executor independently checks support,
      // live occupancy, cancellation, real held item, block placement and
      // cobblestone inventory consumption. Do not duplicate a weaker path.
      const placed=await autoExecute({kind:'place_build_block',
        position:chosen,block:'cobblestone'},epoch);
      if(placed?.ok!==true||placed?.verified!==true)return {ok:false,verified:false,
        detail:'End bridge placement not physically verified: '+String(placed?.detail||'unknown')};
      return {ok:true,verified:true,proof:'end_bridge_tile',
        detail:'One real cobblestone bridge tile verified with source block and survival inventory consumption; no island arrival claimed'};
    }
    case 'place_build_block':{
      const p=plan.position;
      if(!validBuildSpec({goal:'build',position:p,block:plan.block,axis:'x+',length:1}))
        return {ok:false,verified:false,detail:'Invalid bounded construction cell'};
      const target=new Vec3(p.x,p.y,p.z);
      const occupied=()=>[bot.entity,...Object.values(bot.entities||{})].some(e=>{
        if(!e?.position || e.name==='item' || e.name==='experience_orb')return false;
        const q=e.position;
        return [q.x,q.y,q.z].every(Number.isFinite) &&
          Math.abs(q.x-(p.x+.5))<.85 && Math.abs(q.z-(p.z+.5))<.85 &&
          q.y>=p.y-.6 && q.y<=p.y+1.5;
      });
      if(occupied())return {ok:false,verified:false,
        detail:'Construction target occupied by a physically observed entity'};
      if(bot.entity.position.distanceTo(target.offset(.5,.5,.5))>12)
        return {ok:false,verified:false,detail:'Construction cell outside 12-block local authority radius'};
      const beforeBlock=bot.blockAt(target),initial=placementReference(bot,target,Vec3);
      if(!beforeBlock||beforeBlock.boundingBox!=='empty'||
        /lava|water|fire|magma|cactus|powder_snow|campfire/.test(beforeBlock.name)||
        !initial)
        return {ok:false,verified:false,detail:'Construction target obstructed, unloaded or lacks safe supporting face'};
      const stack=bot.inventory.items().find(i=>i.name===plan.block&&i.count>0);
      if(!stack)return {ok:false,verified:false,detail:'Actual building block missing from survival inventory'};
      const beforeCount=rawCount(bot,plan.block);
      // Navigation is allowed only to observed safe adjacent foot locations.
      if(bot.entity.position.distanceTo(target.offset(.5,.5,.5))>4.2){
        // A roof cell may be reachable from the real floor below, not
        // from an imaginary standable platform at rooftop elevation.
        // Search a few nearby *observed* safe foot levels, never teleport.
        const around=[[p.x+1,p.z],[p.x-1,p.z],[p.x,p.z+1],[p.x,p.z-1]];
        const feet=[p.y,p.y-1,p.y-2,p.y-3,p.y-4]
          .flatMap(y=>around.map(([x,z])=>safeSurveyFeet(bot,x,z,y,Vec3)))
          .filter(Boolean);
        let reached=false;
        for(const foot of feet.slice(0,8)){
          if(epoch!==actionEpoch)throw Error('Owner cancelled construction');
          try{
            if(await navigate(foot.offset(.5,0,.5),0,epoch,stanceNavTimeoutMs()) &&
               bot.entity.position.distanceTo(target.offset(.5,.5,.5))<=4.2){reached=true;break;}
          }catch(e){if(epoch!==actionEpoch)throw e;}
        }
        if(!reached)return {ok:false,verified:false,detail:'No safe reachable placement stance'};
      }
      if(epoch!==actionEpoch)throw Error('Owner cancelled construction');
      // Re-evaluate support AFTER navigation: another game action might
      // remove a support block or replace the target during the walk.
      const currentTarget=bot.blockAt(target),support=placementReference(bot,target,Vec3);
      const liveReference=support?.block?.position?
        bot.blockAt(support.block.position):null;
      if(occupied())return {ok:false,verified:false,
        detail:'Entity entered structure cell during approach; placement refused'};
      if(!currentTarget||currentTarget.boundingBox!=='empty'||
         /lava|water|fire|magma|cactus|powder_snow|campfire/.test(currentTarget.name)||
         !liveReference||liveReference.name!==support.block.name||
         liveReference.boundingBox!=='block')
        return {ok:false,verified:false,detail:'Target or safe reference face changed before placement'};
      await bot.equip(stack,'hand');
      if(epoch!==actionEpoch)throw Error('Owner cancelled construction');
      await bot.placeBlock(liveReference,support.face);
      for(let attempt=0;attempt<8;attempt++){
        if(epoch!==actionEpoch)throw Error('Owner cancelled construction');
        const placed=bot.blockAt(target)?.name===plan.block;
        const consumed=rawCount(bot,plan.block)<beforeCount;
        if(placed&&consumed)return {ok:true,verified:true,
          detail:'Survival block placed and inventory consumed at '+p.x+','+p.y+','+p.z};
        await pause(200);
      }
      return {ok:false,verified:false,detail:'Placement not proved by BOTH block state and survival inventory consumption'};
    }
    case 'travel_target':{
      const dest=plan.destination,radius=plan.range;
      if(!dest || !['x','y','z'].every(k=>Number.isInteger(dest[k])) ||
          !Number.isInteger(radius)||radius<1||radius>8)
        return {ok:false,verified:false,detail:'Invalid owner-authorized travel destination'};
      const exact=new Vec3(dest.x+.5,dest.y,dest.z+.5);
      if(epoch!==actionEpoch)throw Error('Travel cancelled');
      const reached=await navigate(exact,radius,epoch,15000);
      if(epoch!==actionEpoch)throw Error('Travel cancelled');
      const actual=bot.entity.position.clone();
      const distance=actual.distanceTo(exact);
      const verified=reached===true && distance<=radius;
      return {ok:verified,verified,proof:verified?'travel_arrival':undefined,
        detail:verified?'Reached authorized target with observed distance '+distance.toFixed(2):
          'Travel not proven: actual distance '+distance.toFixed(2)+'; route='+String(reached)};
    }
    case 'follow':{
      const owner=ownerEntity();if(!owner)throw Error('Owner no longer visible');
      const reached=await navigate(owner.position,plan.range||4,epoch,10000);
      return {ok:reached,verified:reached,detail:'Owner distance '+digest(bot,leader).ownerDistance};
    }
    case 'retreat':{
      // The planner and executor MUST recognize the same hostile set, even
      // in Nether and End. Never return "threat cleared" for an observed
      // Dragon just because an Overworld-only filter missed its entity.
      const here=bot.entity.position.clone();
      const threat=Object.values(bot.entities||{})
        .filter(e=>e?.position && HOSTILES.has(e.name) &&
          e.position.distanceTo(here)<=16)
        .sort((a,b)=>a.position.distanceTo(here)-b.position.distanceTo(here))[0];
      if(!threat){
        const observed=digest(bot,leader).threats;
        const clear=observed.length===0;
        return {ok:clear,verified:clear,
          detail:clear?'No hostile entity remains in loaded danger range':
            'Threat list and live entity positions disagree; retreat unverified'};
      }
      const initial=here.distanceTo(threat.position);
      const targets=retreatStances(bot,here,threat.position,Vec3);
      if(!targets.length)return {ok:false,verified:false,
        detail:'No server-observed safe retreat stance farther from '+threat.name};
      let reason='No fully reached retreat route';
      for(const target of targets.slice(0,4)){
        if(epoch!==actionEpoch)throw Error('Retreat cancelled');
        try{
          const reached=await navigate(target,2,epoch,12500);
          const current=bot.entity.position.clone();
          const separation=current.distanceTo(threat.position);
          if(reached && separation>=initial+2 && current.distanceTo(here)>=3){
            return {ok:true,verified:true,
              detail:'Real '+threat.name+' retreat from distance '+
                initial.toFixed(1)+' to '+separation.toFixed(1)};
          }
          reason='Retreat path returned but actual separation did not improve';
        }catch(err){
          if(epoch!==actionEpoch)throw Error('Retreat cancelled');
          reason=String(err?.message||err).slice(0,110);
        }
      }
      return {ok:false,verified:false,detail:'Retreat not verified: '+reason};
    }
    case 'approach_bound_hostile':{
      const live=validPursuitTarget(bot,plan.targetId,12);
      if(!live||live.name!==plan.mob||bot.health<12)
        return {ok:false,verified:false,detail:'Bound target absent, changed or player health unsafe'};
      const observed=digest(bot,leader);
      // Never chase through another hostile's occupied danger corridor or
      // route through an active creeper blast zone.
      if(observed.threats.some(t=>t.id!==plan.targetId&&t.distance<=8))
        return {ok:false,verified:false,detail:'Other hostiles nearby; bounded pursuit refused'};
      if(epoch!==actionEpoch)throw Error('Owner cancelled hostile approach');
      const from=bot.entity.position.clone();
      const arrived=await navigate(live.position,2,epoch,14000);
      if(epoch!==actionEpoch)throw Error('Owner cancelled hostile approach');
      const current=validPursuitTarget(bot,plan.targetId,3.4);
      const moved=bot.entity.position.distanceTo(from)>0.8;
      const ok=arrived&&!!current&&current.name===plan.mob&&
        bot.health>=9&&(moved||from.distanceTo(current.position)<=3.4);
      return {ok,verified:ok,
        ...(ok?{proof:'bound_hostile_approach',targetId:plan.targetId,mob:plan.mob}:{}),
        detail:ok?'Server-observed safe approach to bound hostile '+plan.mob+
          '; no damage or death claimed':
          'Pursuit route failed or target changed before reaching confirmed melee range'};
    }
    case 'fight_bound_hostile':{
      const live=validHostileTarget(bot,plan.targetId);
      if(!live||live.name!==plan.mob)
        return {ok:false,verified:false,detail:'Owner-bound hostile ID no longer matches an in-reach approved target'};
      const result=await fightObserved({bot,entityId:plan.targetId,
        maxSwings:4,pause,allowed:()=>spawned&&epoch===actionEpoch});
      if(epoch!==actionEpoch)throw Error('Owner stopped target-bound combat');
      const killed=result.ok===true&&result.verified===true;
      return {ok:killed,verified:killed,
        ...(killed?{proof:'bound_hostile_death',targetId:plan.targetId,mob:plan.mob}:{}),
        detail:killed?'Target-specific server death event recorded for '+plan.mob+
          ' ID '+plan.targetId+'; kill attribution not inferred':
          'Target-bound combat remains unresolved: '+String(result.detail||'no death proof')};
    }
    case 'defend':{
      const hostile=bot.entities?.[plan.targetId];
      if(!hostile?.position)
        return {ok:true,verified:true,
          detail:'Target no longer in loaded danger range; no kill attributed'};
      if(!validHostileTarget(bot,plan.targetId))
        return {ok:false,verified:false,
          detail:'Unsafe or out-of-range hostile; do not blindly attack'};
      // Reuse the independent, bounded melee executor rather than marking
      // a single input as a successful defense. This enforces live weapon
      // readback, target identity/range/health checks, cancellation and an
      // actual target-specific entityDead receipt when a death is claimed.
      const result=await fightObserved({bot,entityId:plan.targetId,
        maxSwings:4,pause,allowed:()=>spawned&&epoch===actionEpoch});
      if(epoch!==actionEpoch)throw Error('Defensive action cancelled');
      const remaining=bot.entities?.[plan.targetId];
      const clear=!remaining?.position ||
        remaining.position.distanceTo(bot.entity.position)>6;
      const proven=result.verified===true||clear;
      return {ok:proven,verified:proven,
        detail:result.verified===true?
          'Target-specific server death observed during bounded defense; attribution not claimed':
          clear?'Original hostile moved beyond observed defensive range; death not claimed':
          'Defensive attacks bounded; hostile still present: '+String(result.detail||'unknown')};
    }
    case 'approach_container':{
      const p=plan.position;
      if(!p||!['x','y','z'].every(k=>Number.isInteger(p[k])) ||
         epoch!==actionEpoch)throw Error('Container approach cancelled or invalid');
      const target=new Vec3(p.x,p.y,p.z),block=bot.blockAt(target);
      if(!block||!['chest','trapped_chest','barrel'].includes(block.name))
        return {ok:false,verified:false,detail:'Owner-named container changed or is unloaded'};
      if(bot.entity.position.distanceTo(target)>16)
        return {ok:false,verified:false,detail:'Container outside authorized local approach envelope'};
      const arrived=await navigate(target,2,epoch,14000);
      if(epoch!==actionEpoch)throw Error('Container approach cancelled');
      const live=bot.blockAt(target);
      const ok=arrived===true&&live?.name===block.name&&
        bot.entity.position.distanceTo(target)<=4;
      return {ok,verified:ok,...(ok?{proof:'container_approach'}:{}),
        detail:ok?'Physical approach to exact, unchanged container verified; nothing transferred':
          'Target container no longer safely reachable or identity changed'};
    }
    case 'transfer_inventory':{
      const p=plan.position;
      if(epoch!==actionEpoch)throw Error('Container transfer cancelled');
      if(!p||!['x','y','z'].every(k=>Number.isInteger(p[k])))
        return {ok:false,verified:false,detail:'Invalid owner-named container coordinates'};
      const at=bot.blockAt(new Vec3(p.x,p.y,p.z));
      if(!at||!['chest','trapped_chest','barrel'].includes(at.name)||
         bot.entity?.position?.distanceTo(at.position)>4.5)
        return {ok:false,verified:false,detail:'Exact container absent or outside current interaction range'};
      const advanced=createAdvancedActions({bot,Vec3,pause,
        allowed:()=>spawned&&epoch===actionEpoch&&mode==='auto'});
      // Reuse the existing dual player+container inventory readback.
      // Never create a second item-transfer primitive or infer that the
      // player's inventory changing alone proves chest settlement.
      const result=await advanced.transferContainer({
        position:p,item:plan.item,count:plan.count,operation:plan.operation});
      if(epoch!==actionEpoch)throw Error('Container transfer cancelled');
      const ok=result?.ok===true&&result?.verified===true;
      return {ok,verified:ok,
        ...(ok?{proof:'container_transfer',position:{...p},
           item:plan.item,count:plan.count,operation:plan.operation}:{}),
        detail:String(result?.detail||'Container transfer not settled').slice(0,190)};
    }
    case 'recover_health':{
      // Passive recovery has no movement, attack, mining or world edit.
      // Remain in the current position only while the server still shows
      // enough hunger and zero nearby enemies. A timer is NOT health proof.
      if(epoch!==actionEpoch)throw Error('Owner cancelled recovery');
      const start=digest(bot,leader),initial=bot.health;
      if(!Number.isFinite(initial)||initial>=12||bot.food<18 ||
         start.threats.some(t=>t.distance<=10))
        return {ok:false,verified:false,detail:'No safe, hungry-enough physical health recovery state'};
      for(let i=0;i<12;i++){
        if(epoch!==actionEpoch)throw Error('Owner cancelled passive health recovery');
        await pause(500);
        if(epoch!==actionEpoch)throw Error('Owner cancelled passive health recovery');
        const current=digest(bot,leader);
        if(current.threats.some(t=>t.distance<=10)||bot.food<18)
          return {ok:false,verified:false,detail:'Threat or hunger changed during health recovery'};
        if(Number.isFinite(bot.health)&&bot.health>initial)
          return {ok:true,verified:true,proof:'health_regenerated',
            detail:'Server health rose '+initial+' -> '+bot.health+
              ' without any artificial heal command'};
      }
      return {ok:false,verified:false,
        detail:'No real health regeneration observed in bounded safe recovery window'};
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
    case 'survey_workstation':
    case 'scout_survival':{
      if(epoch!==actionEpoch)throw Error('Survival scouting cancelled');
      const origin=bot.entity.position.clone();
      const persistent=plan.kind==='scout_survival';
      const visited=persistent?
        (bot.jarvisSafeSurveyVisited instanceof Set?bot.jarvisSafeSurveyVisited:new Set()):new Set();
      if(persistent)bot.jarvisSafeSurveyVisited=visited;
      // A safe standable floor is not enough when a creeper or other hostile
      // is already physically present at the proposed landing point.
      const danger=Object.values(bot.entities||{}).filter(e=>
        HOSTILES.has(e?.name)&&e?.position);
      const sites=surveyTargets(bot,origin,Vec3).filter(p=>
        p.distanceTo(origin)>4 &&
        !visited.has([Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)].join(',')) &&
        !danger.some(e=>p.distanceTo(e.position)<7));
      if(!sites.length)return {ok:false,verified:false,
        detail:'No new hazard-free loaded waypoint for independent survival exploration'};
      const start=(Number.isInteger(plan.index)?Math.abs(plan.index):0)%sites.length;
      let last='All selected safe routes inaccessible';
      for(let attempt=0;attempt<Math.min(4,sites.length);attempt++){
        if(epoch!==actionEpoch)throw Error('Survival scouting cancelled');
        const site=sites[(start+attempt)%sites.length];
        const key=[Math.floor(site.x),Math.floor(site.y),Math.floor(site.z)].join(',');
        visited.add(key);
        try{
          const arrived=await navigate(site,2,epoch,14000);
          const actual=bot.entity.position.clone();
          if(arrived && actual.distanceTo(origin)>3 && actual.distanceTo(site)<=4){
            if(persistent){
              visited.add([Math.floor(actual.x),Math.floor(actual.y),Math.floor(actual.z)].join(','));
              if(visited.size>160)return {ok:false,verified:false,
                detail:'Bounded exploration history exhausted; no unlimited terrain search'};
            }
            return {ok:true,verified:true,
              proof:plan.kind==='survey_workstation'?'workstation_scout_move':'safe_scout_move',
              detail:'Independent safe exploration reached '+Math.floor(actual.x)+','+
              Math.floor(actual.y)+','+Math.floor(actual.z)+'; no loot or combat success claimed'};
          }
          last='No significant observed player displacement';
        }catch(e){
          if(epoch!==actionEpoch)throw Error('Survival scouting cancelled');
          last=String(e?.message||e).slice(0,110);
        }
      }
      return {ok:false,verified:false,detail:'Safe independent exploration blocked: '+last};
    }
    case 'survey_generic':{
      const resource=plan.resource;
      if(!SAFE_GENERIC_RESOURCES.has(resource))
        return {ok:false,verified:false,detail:'Generic survey material is not owner-authorized'};
      if(epoch!==actionEpoch)throw Error('Material survey cancelled');
      const start=bot.entity.position.clone();
      const catalog=bot.jarvisGenericSurveyVisited instanceof Map?
        bot.jarvisGenericSurveyVisited:new Map();
      bot.jarvisGenericSurveyVisited=catalog;
      const used=catalog.get(resource)||new Set();
      catalog.set(resource,used);
      const sites=surveyTargets(bot,start,Vec3).filter(p=>
        !used.has([p.x,p.y,p.z].join(',')) && p.distanceTo(start)>5);
      if(!sites.length)
        return {ok:false,verified:false,detail:'No new safe loaded survey waypoints for '+resource};
      const offset=(Number.isInteger(plan.index)?Math.abs(plan.index):0)%sites.length;
      let last='No reachable alternate '+resource+' search region';
      for(let i=0;i<Math.min(4,sites.length);i++){
        if(epoch!==actionEpoch)throw Error('Material survey cancelled');
        const p=sites[(offset+i)%sites.length],key=[p.x,p.y,p.z].join(',');
        used.add(key);
        try{
          const reached=await navigate(p,2,epoch,14000);
          const now=bot.entity.position;
          if(reached&&now.distanceTo(start)>4&&now.distanceTo(p)<=4){
            return {ok:true,verified:true,proof:'generic_survey_move',
              detail:'Server-confirmed movement to a new safe '+resource+' search region; no resource acquired or claimed'};
          }
          last='No server-confirmed displacement to a fresh '+resource+' search region';
        }catch(err){
          if(epoch!==actionEpoch)throw Error('Material survey cancelled');
          last=String(err?.message||err).slice(0,105);
        }
      }
      return {ok:false,verified:false,detail:'Material survey blocked: '+last};
    }
    case 'survey_wood':{
      if(epoch!==actionEpoch)throw Error('Wood survey cancelled');
      const start=bot.entity.position.clone(),used=bot.jarvisWoodSurveyVisited||new Set();
      bot.jarvisWoodSurveyVisited=used;
      const targets=surveyTargets(bot,start,Vec3).filter(p=>
        !used.has([p.x,p.y,p.z].join(',')) &&
        p.distanceTo(start)>5);
      if(!targets.length)return {ok:false,verified:false,
        detail:'No unvisited safe loaded wood-survey locations; no movement claimed'};
      let last='No reachable wood survey waypoint';
      for(const p of targets.slice(0,4)){
        if(epoch!==actionEpoch)throw Error('Wood survey cancelled');
        used.add([p.x,p.y,p.z].join(','));
        try{
          const arrived=await navigate(p,2,epoch,14000);
          const now=bot.entity.position;
          if(arrived && now.distanceTo(start)>4 && now.distanceTo(p)<=4){
            return {ok:true,verified:true,detail:
              'Observed move to new standable wood survey region '+Math.floor(now.x)+','+
              Math.floor(now.y)+','+Math.floor(now.z)+'; NO logs claimed'};
          }
          last='Route ended without proved displacement to a fresh survey region';
        }catch(err){
          if(epoch!==actionEpoch)throw Error('Wood survey cancelled');
          last=String(err?.message||err).slice(0,115);
        }
      }
      return {ok:false,verified:false,detail:'Wood survey exhausted safe routes: '+last};
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
         before.inventory.ironPickaxe||before.inventory.diamondPickaxe||
         (before.inventory.raw?.netherite_pickaxe||0)>0))
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
        if(['stone','cobblestone'].includes(prior.name)){
          const picked=await collectVerifiedDrop(preparation.position,beforeStone,
            ()=>digest(bot,leader).inventory.cobblestone,epoch,'Excavated cobblestone');
          if(picked.ok&&picked.verified)bot.jarvisStoneScoutCount=0;
          return picked;
        }
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
      const picked=await collectVerifiedDrop(candidate.position,beforeStone,
        ()=>digest(bot,leader).inventory.cobblestone,epoch,'Cobblestone');
      if(picked.ok&&picked.verified)bot.jarvisStoneScoutCount=0;
      return picked;
    }
    case 'mine_iron':{
      if(!before.inventory.stonePickaxe && !before.inventory.ironPickaxe &&
         !before.inventory.diamondPickaxe && !(before.inventory.raw?.netherite_pickaxe>0))
        throw Error('Iron ore needs stone or better pickaxe');
      const exposed=findExposedOre(bot,['iron_ore','deepslate_iron_ore'],24);
      const target=exposed?.block;
      if(!target)throw Error('No safely exposed iron ore in loaded chunks; request cave survey');
      const p=target.position;
      const ironReached=await navigate(exposed.stance,1,epoch,14500);
      if(!ironReached)return {ok:false,verified:false,detail:'Iron ore stance not reached; no ore claimed'};
      if(epoch!==actionEpoch)throw Error('Mining cancelled');
      const live=bot.blockAt(p);
      if(!live || !['iron_ore','deepslate_iron_ore'].includes(live.name) ||
        !bot.canDigBlock?.(live) || bot.entity.position.distanceTo(p)>5)
        return {ok:false,verified:false,detail:'Iron ore no longer server-observed within real dig range'};
      const pick=bot.inventory.items().find(i=>
        ['stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'].includes(i.name));
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
      const site=findCraftingSite(bot);
      if(!site)return {ok:false,verified:false,
        detail:'No loaded safe furnace site; will not place over lava, occupied blocks, or unsupported ground'};
      const ground=bot.blockAt(site.ground);
      if(!ground || ground.boundingBox!=='block')return {ok:false,verified:false,detail:'Furnace floor changed'};
      await bot.equip(furnace,'hand');
      if(epoch!==actionEpoch)throw Error('Furnace placement cancelled');
      await bot.placeBlock(ground,new Vec3(0,1,0));
      if(epoch!==actionEpoch)throw Error('Furnace placement cancelled');
      await pause(170);
      const observed=bot.blockAt(site.target);
      return {ok:observed?.name==='furnace',verified:observed?.name==='furnace',
        detail:'Real furnace '+(observed?.name==='furnace'?'placed and server-observed':'placement unverified')};
    }
    case 'smelt_iron':{
      const block=bot.findBlock({matching:b=>b?.name==='furnace',maxDistance:5});
      if(!block)throw Error('Furnace not observed in reach');
      const beforeIron=before.inventory.ironIngot||0;
      const ui=await bot.openFurnace(block);
      try{
        if(!ui.outputItem() && !ui.inputItem()){
          const raw=bot.inventory.items().find(i=>i.name==='raw_iron');
          if(!raw)return {ok:false,verified:false,detail:'No raw iron available; furnace has no observed pending input/output'};
          // Commit exactly one raw item per action. The previous batch-of-3
          // behavior left two untracked ingots in an unloaded furnace.
          await ui.putInput(raw.type,null,1);
        }
        if(!ui.outputItem() && !ui.fuelItem()){
          const fuel=bot.inventory.items().find(i=>i.name==='coal'||i.name==='charcoal'||i.name.endsWith('_planks'));
          if(!fuel)return {ok:false,verified:false,detail:'No actual furnace fuel available'};
          await ui.putFuel(fuel.type,null,1);
        }
        for(let i=0;i<55;i++){
          if(epoch!==actionEpoch)throw Error('Smelting cancelled');
          if(ui.outputItem()?.name==='iron_ingot'){
            await ui.takeOutput();
            const proof=await waitForInventoryIncrease({
              before:beforeIron,read:()=>digest(bot,leader).inventory.ironIngot||0,
              check:()=>{if(epoch!==actionEpoch)throw Error('Smelting cancelled')},
              wait:pause,deadline:Date.now()+3500
            });
            return {ok:proof.ok,verified:proof.ok,
              detail:'Iron furnace output '+beforeIron+' -> '+proof.after+(proof.ok?' (real inventory)':' (unverified)')};
          }
          await pause(400);
        }
        return {ok:false,verified:false,detail:'No confirmed iron ingot output within bounded smelt window'};
      }finally{ui.close();}
    }
    case 'mine_diamond':{
      if(!before.inventory.ironPickaxe && !before.inventory.diamondPickaxe &&
         !(before.inventory.raw?.netherite_pickaxe>0))
        throw Error('Diamond mining requires iron-grade or better pickaxe');
      const exposed=findExposedOre(bot,['diamond_ore','deepslate_diamond_ore'],24);
      const target=exposed?.block;
      if(!target)throw Error('No safely exposed diamond ore in loaded chunks; request cave survey');
      const p=target.position;
      const diamondReached=await navigate(exposed.stance,1,epoch,14500);
      if(!diamondReached)return {ok:false,verified:false,detail:'Diamond mining stance not reached; no resource claimed'};
      if(epoch!==actionEpoch)throw Error('Diamond mining cancelled');
      const live=bot.blockAt(p);
      if(!live || !['diamond_ore','deepslate_diamond_ore'].includes(live.name) ||
        !bot.canDigBlock?.(live) || bot.entity.position.distanceTo(p)>5)
        return {ok:false,verified:false,detail:'Diamond ore no longer within dig range or safe after route'};
      const pick=bot.inventory.items().find(i=>
        ['netherite_pickaxe','diamond_pickaxe','iron_pickaxe'].includes(i.name));
      if(!pick)throw Error('Missing real diamond-grade mining pickaxe');
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
      const site=findCraftingSite(bot);
      if(!site){
        // Underground, a narrow mined shaft can have no adjacent air cell.
        // Create one tiny safe alcove without digging the player's own floor
        // or anybody's placed workstations; observe the real block changes.
        const alcove=findCarvableCraftingAlcove(bot);
        if(alcove){
          const pick=bot.inventory.items().find(i=>/_pickaxe$/.test(i.name));
          if(!pick)return {ok:false,verified:false,detail:'No pickaxe to prepare underground table site'};
          await bot.equip(pick,'hand');
          for(const p of alcove.blocks){
            if(epoch!==actionEpoch)throw Error('Crafting-site excavation cancelled');
            const block=bot.blockAt(p);
            if(!block||!bot.canDigBlock?.(block)||
              !['stone','cobblestone','dirt','grass_block','coarse_dirt',
               'rooted_dirt','gravel','sand','granite','andesite','diorite',
               'tuff','deepslate','cobbled_deepslate'].includes(block.name))
              return {ok:false,verified:false,detail:'Crafting-site block changed or cannot be safely dug'};
            await bot.dig(block);
            if(epoch!==actionEpoch)throw Error('Crafting-site excavation cancelled');
            await pause(100);
            if(bot.blockAt(p)?.boundingBox!=='empty')
              return {ok:false,verified:false,detail:'Crafting-site excavation not confirmed by server'};
          }
          return {ok:true,verified:true,detail:'Verified adjacent underground crafting alcove cleared, table still NOT placed'};
        }
        // A tree canopy or uneven surface can surround the player. Relocate
        // to a safe, server-confirmed clearing; do not retry four bad blocks.
        return scoutStoneSite(epoch);
      }
      if(epoch!==actionEpoch)throw Error('Placement cancelled');
      const ground=bot.blockAt(site.ground);
      if(!ground || ground.boundingBox!=='block' ||
         !bot.entity.position || bot.entity.position.distanceTo(site.target.offset(.5,.5,.5))>4.2)
        return {ok:false,verified:false,detail:'Crafting site moved or became unreachable'};
      await bot.equip(tableItem,'hand');
      await bot.placeBlock(ground,new Vec3(0,1,0));
      if(epoch!==actionEpoch)throw Error('Placement cancelled');
      await pause(150);
      const placed=bot.blockAt(site.target);
      const ok=placed?.name==='crafting_table';
      if(ok)bot.jarvisOwnedCraftingTablePos=placed.position.clone();
      return {ok,verified:ok,detail:'Crafting table '+(ok?'placed at observed safe ground '+site.target:'placement unverified')};
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
  const gameWorld=digest(bot,leader,{dragonDead:lateSkills.session.dragonDied});
  const active=autopilot.status();
  if(active.goal==='transfer'){
    const p=active.position;
    const target=p&&['x','y','z'].every(k=>Number.isInteger(p[k]))?
      bot.blockAt(new Vec3(p.x,p.y,p.z)):null;
    // This observation is from the current server-loaded world, never
    // from model-provided text or persisted checkpoints.
    gameWorld.transferBlock=target&&['chest','trapped_chest','barrel'].includes(target.name)?
      {name:target.name,position:{...p}}:null;
  }
  if(active.goal==='farm_crop')
    gameWorld.cropCells=observeCrop(bot,{
      goal:'farm_crop',crop:active.crop,position:active.position,
      width:active.width,depth:active.depth,targetCount:active.targetCount
    },Vec3);
  if(active.goal==='farm_wheat')gameWorld.wheatCells=observeWheat(bot,
    {goal:'farm_wheat',position:active.position,width:active.width,depth:active.depth,
      targetCount:active.targetCount},Vec3);
  if(active.goal==='build')gameWorld.buildCells=observeBuild(bot,
    {goal:'build',position:active.position,block:active.block,axis:active.axis,length:active.length},Vec3);
  if(active.goal==='build_volume')
    gameWorld.buildVolumeCells=observeVolume(bot,{
      goal:'build_volume',position:active.position,block:active.block,
      width:active.width,depth:active.depth,height:active.height,shape:active.shape
    },Vec3);
  if(active.goal==='shelter' && !active.sequence)
    gameWorld.shelterSite=chooseNativeShelterSite(bot,Vec3,{width:active.width,depth:active.depth});
  if(active.goal==='sequence'||active.goal==='shelter'){
    const stages=active.sequence||gameWorld.shelterSite?.steps||[];
    gameWorld.buildCellsByStage=stages.map(s=>
      s.goal==='build'?observeBuild(bot,s,Vec3):null);
    gameWorld.buildVolumeCellsByStage=stages.map(s=>
      s.goal==='build_volume'?observeVolume(bot,s,Vec3):null);
    gameWorld.wheatCellsByStage=stages.map(s=>
      s.goal==='farm_wheat'?observeWheat(bot,s,Vec3):null);
  }
  // Only the active, owner-authorized craft target is indexed. No broad
  // repository searches, no third-party bot, no AI code execution.
  const stage=['sequence','shelter'].includes(active.goal)?
    (active.sequence?.[active.sequenceIndex]||gameWorld.shelterSite?.steps?.[0]):active;
  if(['craft','equip'].includes(stage?.goal)&&typeof stage.item==='string')
    gameWorld.recipeCatalog=compileRecipeCatalog(bot,stage.item);
  const plan=autopilot.next(gameWorld);
  // Expiring a safety window must not silently claim mission completion or
  // force the owner to reissue a high-level instruction. Continue only a
  // still-authorized long mission; blocked or stopped goals remain stopped.
  if(plan.kind==='idle' && autopilot.status().status==='expired' && autopilot.renewMission(21600)){
    try{missionCheckpoint.save(autopilot.status());}catch{lastAction='Renewed mission checkpoint could not be saved';}
    lastAction='Mission time window renewed from live world; victory still unverified';
    return;
  }
  if(['complete','blocked','idle'].includes(plan.kind)){
    if(autopilot.status().status!=='running'){
      lastAction='auto '+autopilot.status().status+': '+autopilot.status().why;
      missionCheckpoint.clear();
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
      if(process.env.JARVIS_MC_TRACE_AUTONOMY==='1'){
        const snap=digest(bot,leader);
        process.stdout.write('BOT_STEP '+JSON.stringify({
          action:plan.kind,verified:result?.verified===true && result?.ok===true,
          detail:String(result?.detail||'').slice(0,130),position:snap.position,
          logs:snap.inventory.logs,cobblestone:snap.inventory.cobblestone,
          woodenPickaxe:snap.inventory.woodenPickaxe,
          stonePickaxe:snap.inventory.stonePickaxe,stoneSword:snap.inventory.stoneSword
        })+'\n');
      }
      if(autopilot.status().goal==='dragon_then_netherite_run' &&
         plan.kind==='exit_end' && result?.ok===true && result?.verified===true &&
         result.proof==='end_return' &&
         String(bot.game?.dimension||'').replace(/^minecraft:/,'')==='overworld' &&
         lateSkills.session.dragonDied===true){
        process.stdout.write('BOT_EVENT '+JSON.stringify({type:'end_exit',
          at:Date.now(),dimension:'overworld',goal:autopilot.status().goal})+'\n');
      }
      if(autopilot.status().goal==='dragon_then_netherite_run' && plan.kind==='equip_netherite' &&
         result?.ok===true && result?.verified===true && result?.proof==='netherite_equipped' &&
         digest(bot,leader).wornNetherite===true &&
         digest(bot,leader).heldNetheriteSword===true){
        process.stdout.write('BOT_EVENT '+JSON.stringify({type:'netherite_equipped',
          at:Date.now(),worn:true,held:true,dimension:String(bot.game?.dimension||'').replace(/^minecraft:/,''),
          goal:autopilot.status().goal})+'\n');
      }
    }
  }catch(err){
    if(epoch===actionEpoch && mode==='auto'){
      const detail=String(err.message||err).slice(0,120);
      autopilot.record(plan,{ok:false,verified:false,detail});lastAction='auto '+plan.kind+' failed: '+detail;
      if(process.env.JARVIS_MC_TRACE_AUTONOMY==='1')
        process.stdout.write('BOT_STEP '+JSON.stringify({action:plan.kind,verified:false,
          error:detail,position:digest(bot,leader).position})+'\n');
    }
  }finally{autoBusy=false;}
}
async function action(q){
  const bad=validateCommand(q);
  if(bad)return {ok:false,error:bad};
  if(!spawned)return {ok:false,error:'Minecraft bot has not spawned'};
  if(advancedBusy&&!['auto_stop','stop','stay','status','inventory','auto_status','observe'].includes(q.command))
    return {ok:false,error:'An advanced gameplay transaction is still in flight; reconcile first'};
  switch(q.command){
    case 'natural_goal':{
      // The LLM interprets only; it cannot bypass the existing JARVIS executor.
      if(languageBusy)return {ok:false,error:'Previous JARVIS language interpretation still active'};
      languageBusy=true;
      const before=actionEpoch;
      try{
        // Send a valid, compact fresh world observation, not truncated JSON or
        // the older status blob without grounded block coordinates.
        const observation=projectWorld(
          digest(bot,leader,{dragonDead:lateSkills.session.dragonDied}),
          loadedTargets(bot,{includeGeneral:true}),lastAction,mode,
          autopilot.status().goal,nativeObservationItem());
        const parsed=await interpretOwnerInstruction(q.text,{env:process.env,context:observation});
        if(before!==actionEpoch)return {ok:false,error:'Superseded owner command cancelled stale language result'};
        if(!parsed.ok)return {ok:false,error:parsed.error};
        // A language-model suggestion may not silently interrupt a running
        // long mission. A separate explicit owner stop is required.
        const safeWhileBusy=new Set(['auto_stop','stay','status','inventory','observe','auto_status']);
        if((mode==='auto'||autoBusy) && !safeWhileBusy.has(parsed.command.command))
          return {ok:false,error:'Autonomous mission still active; stop it explicitly before another effect'};
        return await action(parsed.command);
      }finally{languageBusy=false;}
    }
    case 'status':return {ok:true,status:conciseStatus()};
    case 'inventory':return {ok:true,status:inventorySummary(bot)};
    case 'observe':{
      const snapshot=digest(bot,leader,{dragonDead:lateSkills.session.dragonDied});
      // Compact, valid JSON (<1900 chars) so the managed companion cannot
      // silently truncate a late-game observation and mislead the planner.
      return {ok:true,status:projectWorld(snapshot,loadedTargets(bot,{includeGeneral:true}),lastAction,mode,
        autopilot.status().goal,nativeObservationItem())};
    }
    case 'auto_status':return {ok:true,status:compactAutonomyStatus(autopilot.status())};
    case 'auto_checkpoint':{
      const lease=missionCheckpoint.load();
      return {ok:true,status:JSON.stringify(lease.ok?
        {recoverable:true,goal:lease.spec.goal,secondsRemaining:lease.remainingSeconds}:
        {recoverable:false,reason:lease.reason})};
    }
    case 'auto_resume':{
      if(autopilot.status().status==='running')
        return {ok:false,error:'Autonomous goal already running; resume refused'};
      const lease=missionCheckpoint.load();
      if(!lease.ok)return {ok:false,error:lease.reason};
      if(bot.game?.gameMode!=='survival')return {ok:false,error:'Restart recovery requires real survival mode'};
      try{
        // A new owner/Guardian instruction is mandatory after process restart;
        // no old witnessed Dragon death or crafting receipt is restored.
        halt();deathsOnCurrentGoal=0;resumeAfterSpawn=false;
        resetDragon(lateSkills.session);
        autopilot.start(lease.spec.goal,lease.remainingSeconds,lease.spec);
        mode='auto';lastAction='Owner-confirmed restart recovery; milestones recheck live world';
        return {ok:true,status:'Autonomous '+lease.spec.goal+' RESUMED from saved goal intent only; prior success proofs discarded'};
      }catch(err){mode='stay';return {ok:false,error:String(err.message||err).slice(0,120)};}
    }
    case 'auto_stop':resumeAfterSpawn=false;setMode('stay');return {ok:true,status:'Autonomous gameplay stopped; movement cancelled'};
    case 'auto_goal':{
      if(q.goal==='defeat_hostile'){
        const bound=validPursuitTarget(bot,q.entityId,12);
        if(!bound||bound.name!==q.mob)
          return {ok:false,error:'Hostile target ID/name and 12-block pursuit radius must be freshly server-observed'};
      }
      if(q.goal==='farm_wheat' && bot.entity.position.distanceTo(
        new Vec3(q.position.x+.5,q.position.y+.5,q.position.z+.5))>12)
        return {ok:false,error:'Wheat field origin must be within 12 blocks of actual player'};
      if(q.goal==='build' && bot.entity.position.distanceTo(
        new Vec3(q.position.x+.5,q.position.y+.5,q.position.z+.5))>12)
        return {ok:false,error:'Build origin must be within 12 blocks of the actual player'};
      if(q.goal==='build_volume' && bot.entity.position.distanceTo(
        new Vec3(q.position.x+.5,q.position.y+.5,q.position.z+.5))>4.5)
        return {ok:false,error:'Multi-layer build origin must begin within 4.5 blocks of the player'};
      // A composed nearby room starts at the actual observed world position,
      // not at a remotely invented shell site. Later stages are re-observed.
      if(q.goal==='sequence'&&q.steps?.[0]?.goal==='build_volume'){
        const start=q.steps[0].position;
        if(!start||bot.entity.position.distanceTo(
          new Vec3(start.x+.5,start.y+.5,start.z+.5))>4.5)
          return {ok:false,error:'Composed structure origin must start within 4.5 blocks of player'};
      }
      // The Dragon/Netherite acceptance path is survival-only. Never allow
      // creative/spectator/adventure game modes to generate a fake victory.
      if(['dragon_then_netherite_run','netherite_dragon_run','dragon_run','netherite_armor_run','netherite_gear_run','shelter','defeat_hostile','wood','gather','travel','build','build_volume','farm_wheat','farm_crop','sequence','craft','smelt','transfer','equip'].includes(q.goal) &&
         bot.game?.gameMode!=='survival')
        return {ok:false,error:'Autonomous survival goal requires server-confirmed survival game mode'};
      // A repeated model/tool call must not erase progress or interrupt an
      // already running owner-authorized goal. Explicit auto_stop is required.
      if(autopilot.status().status==='running')
        return {ok:false,error:'Autonomous goal already running; inspect auto_status or use auto_stop before replacement'};
      halt();mode='auto';resumeAfterSpawn=false;deathsOnCurrentGoal=0;
      bot.jarvisSafeSurveyVisited=new Set();
      bot.jarvisStoneScoutCount=0;
       // Evidence from an earlier owner mission is NOT proof for a new run.
       resetDragon(lateSkills.session);
      try{const st=autopilot.start(q.goal,q.durationSeconds||(q.goal==='netherite_dragon_run'||q.goal==='dragon_then_netherite_run'||q.goal==='dragon_run'||q.goal==='netherite_armor_run'||q.goal==='netherite_gear_run'||q.goal==='shelter'||q.goal==='companion'||q.goal==='gather'||q.goal==='smelt'||q.goal==='sequence'?21600:300),goalSpecFromCommand(q));lastAction='Autonomous '+st.goal+' STARTED';
        let saved=false;try{saved=missionCheckpoint.save(st);}catch{ /* Mission runs but restart recovery is unavailable. */ }
        return {ok:true,status:'Autonomous '+st.goal+' STARTED, expires in '+Math.floor((st.deadline-Date.now())/1000)+'s; '+(saved?'recoverable goal intent saved':'restart recovery unavailable')+'; verify progress via auto_status'};
      }catch(err){mode='stay';return {ok:false,error:String(err.message||err).slice(0,120)};}
    }
    // General player primitives are owner-authorized, bounded and report observed outcomes.
    case 'attack_hostile':{
      if(mode==='auto'||autoBusy||advancedBusy)
        return {ok:false,error:'Explicitly stop ongoing autonomous work or transaction before attacking'};
      setMode('stay');const epoch=actionEpoch;advancedBusy=true;
      try{
        const result=await fightObserved({bot,entityId:q.entityId,maxSwings:q.maxSwings,
          pause,allowed:()=>spawned&&epoch===actionEpoch});
        return {ok:result.ok===true,verified:result.verified===true,
          status:String(result.detail||'Combat outcome unknown').slice(0,800)};
      }catch(err){
        return {ok:false,verified:false,error:'Combat unresolved: '+String(err.message||err).slice(0,150)};
      }finally{advancedBusy=false;}
    }
    case 'inspect_villager':case 'trade_villager':case 'transfer_container':case 'enchant_item':{
      if(mode==='auto'||autoBusy||advancedBusy)
        return {ok:false,error:'Active autonomous mission or another transaction must finish or be stopped explicitly'};
      setMode('stay');const epoch=actionEpoch;advancedBusy=true;
      const advanced=createAdvancedActions({bot,Vec3,pause,allowed:()=>epoch===actionEpoch&&spawned});
      try{
        const result=q.command==='inspect_villager'?
          await advanced.inspectVillager(q.entityId):
          q.command==='trade_villager'?
          await advanced.tradeVillager(q):
          q.command==='transfer_container'?
          await advanced.transferContainer(q):
          await advanced.enchantItem(q);
        return {ok:result.ok===true,verified:result.verified===true,
          status:String(result.detail||'Outcome unverified').slice(0,1600)};
      }catch(err){
        return {ok:false,verified:false,error:'Transaction not verified: '+String(err.message||err).slice(0,160)};
      }finally{advancedBusy=false;}
    }
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
        const dropMap={stone:'cobblestone',cobblestone:'cobblestone',deepslate:'cobbled_deepslate',cobbled_deepslate:'cobbled_deepslate',
          grass_block:'dirt',iron_ore:'raw_iron',deepslate_iron_ore:'raw_iron',
          copper_ore:'raw_copper',deepslate_copper_ore:'raw_copper',
          diamond_ore:'diamond',deepslate_diamond_ore:'diamond',
          gold_ore:'raw_gold',deepslate_gold_ore:'raw_gold',
          coal_ore:'coal',deepslate_coal_ore:'coal',
          redstone_ore:'redstone',deepslate_redstone_ore:'redstone',
          lapis_ore:'lapis_lazuli',deepslate_lapis_ore:'lapis_lazuli',
          emerald_ore:'emerald',deepslate_emerald_ore:'emerald',
          nether_gold_ore:'gold_nugget',nether_quartz_ore:'quartz'};
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
          // General gameplay must not demand a pickaxe for dirt, sand, logs,
          // planks, or wool. Ores still require the correct tier; otherwise
          // a seemingly successful dig can destroy a valuable block without
          // dropping an item. Never claim a harvest from dispatch alone.
          const inventoryItems=bot.inventory.items();
          const byNames=names=>inventoryItems.find(i=>names.includes(i.name));
          const name=live.name;
          const picks=['netherite_pickaxe','diamond_pickaxe','iron_pickaxe','stone_pickaxe','wooden_pickaxe','golden_pickaxe'];
          const toughest=/^(?:ancient_debris|obsidian)$/;
          const valuable=/^(?:deepslate_)?(?:diamond|redstone|emerald|gold)_ore$/;
          const ironOre=/^(?:deepslate_)?(?:iron|copper|lapis)_ore$/;
          const hardStone=/^(?:stone|cobblestone|cobbled_deepslate|deepslate|stone_bricks|(?:deepslate_)?[a-z_]+_ore|ancient_debris|obsidian)$/;
          let tool=null;
          if(toughest.test(name))tool=byNames(['netherite_pickaxe','diamond_pickaxe']);
          else if(valuable.test(name))tool=byNames(['netherite_pickaxe','diamond_pickaxe','iron_pickaxe']);
          else if(ironOre.test(name))tool=byNames(['netherite_pickaxe','diamond_pickaxe','iron_pickaxe','stone_pickaxe']);
          else if(hardStone.test(name))tool=byNames(picks);
          else if(/(?:_log|_wood|_planks)$/.test(name))
            tool=inventoryItems.find(i=>/_axe$/.test(i.name))||null;
          else if(/^(?:dirt|grass_block|coarse_dirt|rooted_dirt|gravel|sand|red_sand|mud|clay|snow_block)$/.test(name))
            tool=inventoryItems.find(i=>/_shovel$/.test(i.name))||null;
          if((toughest.test(name)||valuable.test(name)||ironOre.test(name)||hardStone.test(name))&&!tool)
            throw Error('Appropriate mining tool tier unavailable; no block broken');
          if(tool)await bot.equip(tool,'hand');
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
      if(mode==='auto'||autoBusy)return {ok:false,error:'Autonomous mission is active; stop it before changing equipment'};
      const item=bot.inventory.items().find(i=>i.name===q.item);
      if(!item)return {ok:false,error:'Item not in inventory'};
      setMode('stay');const epoch=actionEpoch;
      const destination=q.destination||'hand';
      await bot.equip(item,destination);
      if(epoch!==actionEpoch)return {ok:false,error:'Equipment change cancelled'};
      const slot=destination==='hand'?bot.heldItem:
        bot.inventory?.slots?.[bot.getEquipmentDestSlot(destination)];
      const verified=slot?.name===q.item;
      return {ok:verified,status:'Equip '+q.item+
        (verified?' verified in '+destination:' dispatched but equipment slot unverified')};
    }
    case 'craft_item':{
      if(mode==='auto'||autoBusy)return {ok:false,error:'Autonomous mission is active; stop it before manual crafting'};
      setMode('stay');const epoch=actionEpoch;
      const station=bot.findBlock({matching:b=>b?.name==='crafting_table',maxDistance:4});
      const result=await craftNamed(q.item,q.count,epoch,station||null);
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
  // Never claim a successful live Minecraft join if the actual movement API
  // is missing. This also catches an incompatible Mineflayer runtime early.
  if(typeof bot.setControlState!=='function'){
    process.stderr.write('Minecraft movement API unavailable at spawn; rejecting live gameplay acceptance\n');
    process.exitCode=1;
    if(typeof bot.quit==='function')bot.quit('Unsupported Mineflayer movement API');
    return;
  }
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
const CHAT_KEYWORDS=new Set(['help','auto','goal','craft','equip','pause','resume','travel','farm','build','gather',
  'follow','come','stay','guard','stop','jump','look','status','inventory','observe','auto_status',
  'collect_wood','say','wait']);
function naturalChat(text){
  action({command:'natural_goal',text}).then(r=>say(r.ok?(r.status||'Goal accepted'):(r.error||'Unavailable')))
    .catch(()=>say('JARVIS could not interpret that owner request'));
}
bot.on('chat',(username,message)=>{
  if(username!==leader || !spawned || typeof message!=='string')return;
  const trimmed=message.trim();
  const match=/^(?:hey\s+)?jarvis(?:buddy)?[,: ]+([a-z_]+)(?:\s+(.+))?$/i.exec(trimmed);
  if(!match){
    const natural=/^(?:hey\s+)?jarvis(?:buddy)?[,: ]+(.+)$/i.exec(trimmed);
    if(natural)naturalChat(natural[1]);
    return;
  }
  const cmd=match[1].toLowerCase();
  const freeForm=()=>naturalChat((cmd+' '+(match[2]||'')).trim());
  if(!CHAT_KEYWORDS.has(cmd)){freeForm();return;}
  // Legacy one-word commands cannot consume arbitrary owner modifiers:
  // "follow the dragon" must not silently become "follow the owner".
  if(match[2] && ['follow','come','stay','guard','jump','look','status','inventory',
                   'observe','auto_status','auto_resume','resume','collect_wood'].includes(cmd)){
    freeForm();return;
  }
  const normalized=cmd==='gather'?'collect_wood':cmd==='wait'?'stay':cmd;
  if(cmd==='help'){say('Ask Jarvis in your own words, or use: follow, guard, gather [count resource], auto, pause, craft, equip, build, status');return;}
  if(cmd==='auto'||cmd==='goal') {const goal=(match[2]||'survive').trim().toLowerCase();
    const q={command:'auto_goal',goal,durationSeconds:goal==='companion'||goal==='netherite_dragon_run'||goal==='dragon_then_netherite_run'||goal==='dragon_run'?21600:300};
    if(validateCommand(q)){naturalChat((match[2]||cmd).trim());return;}
    action(q).then(r=>say(r.ok?r.status:r.error)).catch(()=>say('Could not start autonomous goal'));return;}
  if(cmd==='craft' && match[2]){
    const m=/^(\d{1,2})\s+([a-z_]{1,64})$/i.exec(match[2].trim());
    if(!m){freeForm();return;}
    const q={command:'auto_goal',goal:'craft',
      item:normalizeCraftItemName(m[2])||m[2].toLowerCase(),
      targetCount:Number(m[1]),durationSeconds:3600};
    if(validateCommand(q)){freeForm();return;}
    action(q).then(r=>say(r.ok?r.status:r.error)).catch(()=>say('Could not start crafting goal'));
    return;
  }
  if(cmd==='equip' && match[2]){
    const m=/^([a-z_]{1,64})\s+(hand|head|torso|legs|feet|off-hand)$/i.exec(match[2].trim());
    if(!m){freeForm();return;}
    const q={command:'auto_goal',goal:'equip',item:m[1].toLowerCase(),
      destinationSlot:m[2].toLowerCase(),durationSeconds:3600};
    if(validateCommand(q)){freeForm();return;}
    action(q).then(r=>say(r.ok?r.status:r.error)).catch(()=>say('Could not start equip goal'));
    return;
  }
  if(cmd==='pause') {action({command:'auto_stop'}).then(r=>say(r.status||r.error));return;}
  if(cmd==='resume') {action({command:'auto_resume'}).then(r=>say(r.status||r.error));return;}
  if(cmd==='travel' && match[2]){
    const parts=/^(-?\d+)\s+(-?\d+)\s+(-?\d+)$/.exec(match[2].trim());
    if(!parts){freeForm();return;}
    const q={command:'auto_goal',goal:'travel',
      destination:{x:Number(parts[1]),y:Number(parts[2]),z:Number(parts[3])},
      arrivalRange:2,durationSeconds:1800};
    if(validateCommand(q)){freeForm();return;}
    action(q).then(r=>say(r.ok?r.status:r.error))
      .catch(()=>say('Could not start travel goal'));
    return;
  }

  if(cmd==='farm' && match[2]){
    const a=/^(\d{1,2})\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d)\s+(\d)$/.exec(match[2].trim());
    if(!a){freeForm();return;}
    const q={command:'auto_goal',goal:'farm_wheat',targetCount:Number(a[1]),
      position:{x:Number(a[2]),y:Number(a[3]),z:Number(a[4])},
      width:Number(a[5]),depth:Number(a[6]),durationSeconds:3600};
    if(validateCommand(q)){freeForm();return;}
    action(q).then(r=>say(r.ok?r.status:r.error)).catch(()=>say('Could not start wheat farming'));
    return;
  }
  if(cmd==='build' && match[2]){
    const args=/^(\d)\s+([a-z_]+)\s+(x\+|x-|z\+|z-)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i.exec(match[2].trim());
    if(!args){freeForm();return;}
    const q={command:'auto_goal',goal:'build',length:Number(args[1]),block:args[2].toLowerCase(),
      axis:args[3].toLowerCase(),position:{x:Number(args[4]),y:Number(args[5]),z:Number(args[6])},
      durationSeconds:3600};
    if(validateCommand(q)){freeForm();return;}
    action(q).then(r=>say(r.ok?r.status:r.error)).catch(()=>say('Could not start construction goal'));
    return;
  }
  if(cmd==='gather' && match[2]){
    // Plain owner-chat entrypoint for finite dynamic goals. The validator
    // still checks resource names and count before changing game state.
    const spec=/^(\d{1,2})\s+([a-z_]+)$/i.exec(match[2].trim());
    if(!spec){freeForm();return;}
    const q={command:'auto_goal',goal:'gather',
      resource:normalizeResource(spec[2].toLowerCase()),
      targetCount:Number(spec[1]),durationSeconds:21600};
    if(validateCommand(q)){freeForm();return;}
    action(q).then(r=>say(r.ok?r.status:r.error))
      .catch(()=>say('Could not start resource goal'));
    return;
  }

  // A missing argument is not an unsupported executable command.
  // Let native owner-language parsing or the configured local model handle it.
  if(['craft','equip','travel','farm','build','gather'].includes(cmd) && !match[2]){
    freeForm();return;
  }
  const q={command:normalized};
  if(normalized==='say')q.text=match[2]||'';
  action(q).then(r=>say(r.ok?(r.status||'OK'):(r.error||'Unavailable'))).catch(()=>say('Action failed'));
});
const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
reader.on('line',line=>{
  let envelope;try{envelope=JSON.parse(line);}catch{return;}
  if(!envelope || typeof envelope!=='object' || Array.isArray(envelope))return;
  const {id,...command}=envelope;
  if(typeof id!=='string'||!/^[a-f0-9]{16}$/.test(id))return;
  // The transport correlation ID is NOT a Minecraft command argument.
  // natural_goal rejects extra properties and auto_goal has a strict typed
  // key allowlist. Passing the envelope as-is made BOTH commands unusable
  // over stdin, despite being accepted by the owner-chat entrypoint.
  action(command).then(r=>ack(id,r.ok,r.status,r.error))
    .catch(err=>ack(id,false,'',String(err.message||err).slice(0,120)));
});
bot.on('entityDead',entity=>{
   // A death event is only admissible if the current mission observed a
   // Dragon in the End, and this is the same live encounter.
   const inEnd=String(bot.game?.dimension||'').replace(/^minecraft:/,'')==='the_end';
   if(inEnd && acceptDragonDeath(lateSkills.session,entity,bot.game?.dimension,Date.now())){
     if(autopilot.status().goal==='dragon_then_netherite_run' && autopilot.status().status==='running')
       process.stdout.write('BOT_EVENT '+JSON.stringify({type:'dragon_death',
         at:Date.now(),dimension:'the_end',entityId:entity.id??null,
         goal:autopilot.status().goal})+'\n');
   }
 });
bot.on('death',()=>{
  resetDragon(lateSkills.session);
  const active=mode==='auto' && autopilot.status().status==='running';
  if(active){
    deathsOnCurrentGoal++;
    resumeAfterSpawn=deathsOnCurrentGoal<=3;
    autopilot.stop(resumeAfterSpawn?'Death: bounded autonomous respawn recovery pending':'Death retry budget exhausted');
  }
  if(!resumeAfterSpawn)missionCheckpoint.clear();
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
let intentionalProcessStop=false;
bot.on('end',()=>{
  clearInterval(followTimer);
  if(!intentionalProcessStop){
    // A disconnected Minecraft Java session is not successful task
    // settlement, even when the server closes an idle TCP connection
    // cleanly. Only the explicit operator shutdown path may exit zero.
    process.exitCode=1;
  }
  const mission=autopilot.status();
  const lostActiveMission=mode==='auto'&&mission.status==='running';
  if(!spawned){
    process.stderr.write('Minecraft connection ended before spawn; no in-game action was verified\n');
    process.exitCode=1;
  }
  if(lostActiveMission){
    // A remote server/network disconnect is NOT an autonomous-gameplay
    // victory, even when Mineflayer produces a normal 'end' event with no
    // earlier 'error'. Preserve the sealed typed mission-intent lease but
    // discard in-memory progress proofs. A new bot/owner session may resume
    // only through existing Guardian-authorized auto_resume and fresh world
    // evidence, not an automatic stale-action replay.
    autopilot.stop('Minecraft connection ended before native mission settled; all effects unverified after disconnect');
    process.exitCode=1;
    process.stderr.write('JARVIS Minecraft session disconnected during active autonomous mission; saved intent requires owner-authorized reconciliation\n');
  }
  halt();
  process.exit(process.exitCode||0);
});
process.on('SIGTERM',()=>{intentionalProcessStop=true;clearInterval(followTimer);if(mode==='auto')autopilot.stop('Operator stopped bot');missionCheckpoint.clear();halt();bot.quit('Operator stopped JARVIS friend');});
