'use strict';
/* Mineflayer live skills for long-run vanilla progression. All results require
 * observed inventory, block state, dimension, or death-event evidence.
 * No commands/creative mode/seed inspection/teleports. Failure is explicit.
 */
const {NETHERITE}=require('./late_game.cjs');
const {SAFE_GENERIC_RESOURCES,PICKAXE_GENERIC_RESOURCES,PICKAXES,ORE_RESOURCE_RULES}=require('./resource_goal.cjs');
const {observeDragon,noteDragonAttack}=require('./dragon_engagement.cjs');
const {findExposedOre}=require('./ore_access.cjs');
const {confirmedMove}=require('./movement_proof.cjs');
const {collectObservedDrop}=require('./drop_pickup.cjs');
const {waitForInventoryIncrease}=require('./inventory_settlement.cjs');
const {findPortalLayout,pos:portalCell}=require('./portal_layout.cjs');
const {surveyTargets}=require('./wood_navigation.cjs');
const {ALLOWED_HOSTILES,equipObservedMelee}=require('./native_combat.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const solid=b=>b && b.boundingBox!=='empty' && !['air','cave_air','void_air','lava','water','fire','nether_portal'].includes(b.name);
const count=(bot,name)=>(bot.inventory?.items?.()||[]).reduce((n,i)=>n+(i.name===name?i.count:0),0);
const counts=(bot,pred)=>(bot.inventory?.items?.()||[]).reduce((n,i)=>n+(pred(i.name)?i.count:0),0);
const observed=(ok,detail,proof)=>({ok:!!ok,verified:!!ok,detail, ...(ok&&proof?{proof}:{})});
const lookup=(bot,names,radius=28)=>bot.findBlock({matching:b=>b && names.includes(b.name),maxDistance:radius});
const item=(bot,name)=>bot.inventory.items().find(i=>i.name===name);
function createLateSkills({bot,navigate,craftNamed,getEpoch,getOwner,digest,Vec3}){
  const session={portalBase:null,portalPosition:null,homePortalPosition:null,netherPortalPosition:null,eyesThrown:0,bearing:null,dragonSeen:false,dragonDied:false,dragonEntityId:null,dragonAttackAt:null,dragonAttempts:0,visitedChests:new Set(),surveyIndex:0,surveyVisited:new Map()};
  const check=epoch=>{if(getEpoch()!==epoch)throw Error('Minecraft action cancelled by owner');};
  async function move(position,range,epoch,timeout=20000){
    check(epoch);
    const reached=await navigate(position,range,epoch,timeout);
    check(epoch);
    // Mineflayer's pathfinder may return false without throwing. Never
    // report progress just because the navigation request was dispatched.
    if(reached!==true)throw Error('No server-confirmed route to action target');
    return true;
  }
  async function collectDrop(name,before,around,epoch){
    return collectObservedDrop({
      bot,origin:around,beforeCount:before,readCount:()=>count(bot,name),
      move:(position,range,timeout)=>move(position,range,epoch,timeout),
      check:()=>check(epoch),wait:delay,deadline:Date.now()+25000,
      Vec3,label:name
    });
  }
  async function mineKnown(names,drop,toolNames,epoch,searchRadius=26,visibleOnly=false){
    // Restrict approach-face verification to the progression ores that can be
    // buried in the loaded chunk cache. Surface obsidian, netherrack, gravel
    // and other terrain can legitimately be mined from above, so retain their
    // original reachability checks rather than requiring a horizontal cave.
    const needsFace=names.every(n=>/^(?:deepslate_)?(?:iron|diamond|coal|copper|gold|redstone|lapis|emerald)_ore$/.test(n) ||
      n==='nether_quartz_ore');
    const exposed=needsFace?findExposedOre(bot,names,searchRadius):null;
    const block=needsFace?exposed?.block:bot.findBlock({matching:b=>b && names.includes(b.name) && (!visibleOnly ||
      [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([x,y,z])=>
        ['air','cave_air','void_air'].includes(bot.blockAt(b.position.offset(x,y,z))?.name))),maxDistance:searchRadius});
    if(!block)return observed(false,'No accessible '+names.join('/')+' observed in loaded chunks');
    // Bare-hand gathering is allowed only for an audited catalog of common,
    // harvestable surface blocks. Valuable ores still need a real pickaxe.
    const handSafe=toolNames.length===0 && names.length===1 && SAFE_GENERIC_RESOURCES.has(names[0]);
    const pick=bot.inventory.items().find(i=>toolNames.includes(i.name))||
      (toolNames.includes(bot.heldItem?.name)?bot.heldItem:null);
    if(!pick&&!handSafe)return observed(false,'Missing appropriate tool for '+names[0]);
    const before=count(bot,drop), p=block.position.clone();
    await move(needsFace?exposed.stance:p,needsFace?1:3,epoch,19000);
    const live=bot.blockAt(p);
    if(!live||!names.includes(live.name)||bot.entity.position.distanceTo(p)>5)throw Error('Ore absent or out of reach');
    if(pick)await bot.equip(pick,'hand');
    check(epoch);await bot.dig(live);check(epoch);
    return collectDrop(drop,before,p,epoch);
  }
  async function walkScout(epoch,kind){
    check(epoch);
    if(typeof kind!=='string'||kind.length>80)
      return observed(false,'Unrecognized or oversized exploration goal');
    const here=bot.entity?.position?.clone();
    if(!here)return observed(false,'No server-observed player position for scouting');
    // Reuse the native no-digging survey geometry. The previous hardcoded
    // offsets could route to lava, unloaded cliffs or nonexistent ground.
    const dimension=String(bot.game?.dimension||'unknown');
    const key=dimension+'|'+kind;
    const seen=session.surveyVisited.get(key)||new Set();
    if(seen.size>=48)return observed(false,'Forty-eight bounded '+kind+
      ' survey sites exhausted; no loot or discovery claimed');
    session.surveyVisited.set(key,seen);
    const hazardNames=new Set([...ALLOWED_HOSTILES,'creeper','ender_dragon','wither']);
    const hazards=Object.values(bot.entities||{}).filter(e=>
      hazardNames.has(e?.name)&&e?.position);
    const candidates=surveyTargets(bot,here,Vec3).filter(p=>
      p.distanceTo(here)>=4 &&
      !seen.has([p.x,p.y,p.z].join(',')) &&
      !hazards.some(e=>p.distanceTo(e.position)<8));
    if(!candidates.length)return observed(false,
      'No new safe loaded '+kind+' survey position; will not invent remote terrain');
    const start=session.surveyIndex++%candidates.length;
    let last='No physical progress to a safe observed '+kind+' waypoint';
    for(let i=0;i<Math.min(4,candidates.length);i++){
      check(epoch);
      const p=candidates[(start+i)%candidates.length];
      seen.add([p.x,p.y,p.z].join(','));
      try{
        await move(p,2,epoch,18000);
        check(epoch);
        const actual=bot.entity?.position;
        if(actual&&actual.distanceTo(here)>=4&&actual.distanceTo(p)<=4){
          return observed(true,'Observed movement to fresh safe '+kind+
            ' terrain at '+Math.floor(actual.x)+','+Math.floor(actual.y)+','+
            Math.floor(actual.z)+'; no item or objective completion claimed','safe_scout_move');
        }
        last='Server did not confirm new '+kind+' region';
      }catch(err){
        check(epoch);
        last=String(err?.message||err).slice(0,100);
      }
    }
    return observed(false,'Loaded '+kind+' search positions inaccessible: '+last);
  }
  async function placeItem(target,itemName,epoch){
    check(epoch);
    const existing=bot.blockAt(target);
    if(existing && existing.name===itemName)return true;
    if(existing && !['air','cave_air','void_air','fire'].includes(existing.name))throw Error('Placement target obstructed: '+existing.name);
    const faces=[new Vec3(0,-1,0),new Vec3(-1,0,0),new Vec3(1,0,0),new Vec3(0,0,-1),new Vec3(0,0,1),new Vec3(0,1,0)];
    let ref;
    for(const direction of faces){const at=bot.blockAt(target.plus(direction));if(solid(at)){ref=at;break;}}
    if(!ref)throw Error('No physical neighboring block supports placement');
    if(bot.entity.position.distanceTo(target)>4)await move(target,3,epoch,14000);
    const held=item(bot,itemName);if(!held)throw Error(itemName+' no longer in inventory');
    await bot.equip(held,'hand');check(epoch);
    await bot.placeBlock(ref,target.minus(ref.position));
    check(epoch);await delay(130);
    return bot.blockAt(target)?.name===itemName;
  }
  async function smelt(input,output,epoch){
    const furnace=lookup(bot,['furnace','blast_furnace'],5);
    if(!furnace)return observed(false,'Furnace not loaded/in reach');
    const before=count(bot,output);
    const ui=await bot.openFurnace(furnace);
    try{
      // Check existing furnace contents before taking more ingredients.
      // One item at a time prevents a mission from abandoning a bulk input
      // inside a furnace and repeatedly mining new raw resources.
      if(!ui.outputItem() && !ui.inputItem()){
        const material=item(bot,input);
        if(!material)return observed(false,'No '+input+' in inventory or existing furnace input');
        await ui.putInput(material.type,null,1);
      }
      if(!ui.outputItem() && !ui.fuelItem()){
        const fuel=bot.inventory.items().find(i=>
          ['coal','charcoal','blaze_rod'].includes(i.name) || i.name.endsWith('_planks'));
        if(!fuel)return observed(false,'No safe observed furnace fuel');
        await ui.putFuel(fuel.type,null,1);
      }
      for(let j=0;j<65;j++){
        check(epoch);
        if(ui.outputItem()?.name===output){
          await ui.takeOutput();
          for(let attempt=0;attempt<18;attempt++){
            check(epoch);
            if(count(bot,output)>before)
              return observed(true,`${output} real inventory ${before} -> ${count(bot,output)}`);
            await delay(140);
          }
          return observed(false,`${output} output withdrawn but inventory receipt still unverified`);
        }
        await delay(360);
      }
      return observed(false,`No verified ${output} output in bounded furnace window`);
    }finally{ui.close();}
  }
  async function craft(name,epoch,tableName){
    const table=tableName?lookup(bot,[tableName],5):null;
    if(tableName&&!table)return observed(false,'Missing '+tableName+' in reach');
    const result=await craftNamed(name,1,epoch,table);
    return observed(result.verified===true,result.detail);
  }
  async function safeNetherTunnel(epoch){
    session.surveyIndex++; // rotate away from repeatedly unsafe tunnel approaches
    if(!String(bot.game?.dimension||'').includes('nether'))return observed(false,'Nether tunneling requires Nether dimension');
    const tool=bot.inventory.items().find(i=>['diamond_pickaxe','netherite_pickaxe'].includes(i.name));
    if(!tool)return observed(false,'Diamond-grade pickaxe required to harvest ancient debris');
    const dirs=[[1,0],[0,1],[-1,0],[0,-1]];
    let progress=0;
    for(let step=0;step<4;step++){
      check(epoch);
      const where=bot.entity.position;
      const [dx,dz]=dirs[Math.floor(session.surveyIndex/11)%4];
      const dropping=where.y>16;
      const next=new Vec3(Math.floor(where.x)+dx,Math.floor(where.y)-(dropping?1:0),Math.floor(where.z)+dz);
      const beneath=bot.blockAt(next.offset(0,-1,0));
      if(!solid(beneath))return observed(false,'Tunnel floor unsafe/unknown at '+next);
      const blocks=[bot.blockAt(next.offset(0,1,0)),bot.blockAt(next)];
      if(blocks.some(b=>!b||['lava','water','bedrock'].includes(b.name)))return observed(false,'Unknown liquid or bedrock ahead; stopping excavation');
      // Server-sent neighboring lava must never be opened to the player.
      const around=[next.offset(-1,0,0),next.offset(1,0,0),next.offset(0,0,1),next.offset(0,0,-1),next.offset(0,2,0)];
      if(around.some(p=>bot.blockAt(p)?.name==='lava'))return observed(false,'Neighboring lava detected before digging');
      await bot.equip(tool,'hand');
      for(const block of blocks){
        check(epoch);
        if(block.boundingBox==='empty')continue;
        if(!bot.canDigBlock?.(block))return observed(false,'Tunnel block not safely diggable: '+block.name);
        await bot.dig(block);check(epoch);
        const changed=bot.blockAt(block.position);
        if(!changed || changed.name===block.name)
          return observed(false,'Nether dig was dispatched but server block change was not observed');
        progress++;
      }
      const beforeMove=bot.entity.position.clone();
      await bot.lookAt(next.offset(.5,1,.5),true);
      bot.setControlState('forward',true);
      try{await delay(350);}finally{bot.setControlState('forward',false);}
      check(epoch);
      if(!confirmedMove(beforeMove,bot.entity.position,next,{minHorizontal:.45,maxTargetDistance:2.4}))
        return observed(false,'Nether blocks cleared but actual tunnel movement was not verified');
      session.surveyIndex++;
      const uncovered=lookup(bot,['ancient_debris'],20);
      if(uncovered)break;
    }
    return observed(progress>0,`Safe Nether branch/stair tunnel cleared ${progress} physical blocks (no debris claimed)`);
  }
  async function shootVisibleEntity(target,epoch){
    const bow=item(bot,'bow'),arrow=item(bot,'arrow');
    if(!bow||!arrow)return observed(false,'Ranged attack requires actual bow and arrows');
    if(!target?.position)return observed(false,'Target entity not visible');
    const dist=bot.entity.position.distanceTo(target.position);
    if(dist>55)return observed(false,'Target outside bounded bow range');
    const beforeArrows=count(bot,'arrow');
    await bot.equip(bow,'hand');
    check(epoch);
    const aim=target.position.offset(0,Math.min(5,dist*dist/135),0);
    await bot.lookAt(aim,true);
    bot.activateItem();
    try{await delay(1200);}finally{bot.deactivateItem();}
    // Arrow consumption is server-backed physical evidence of an actual
    // survival shot. A button release alone is not evidence. Even a real
    // arrow shot does not prove a hit or the Dragon's death.
    for(let attempt=0;attempt<15;attempt++){
      check(epoch);
      if(count(bot,'arrow')<beforeArrows){
        if(target.name==='ender_dragon')noteDragonAttack(session,target);
        return observed(true,'Bow fired: actual arrow inventory consumed; target damage unverified');
      }
      await delay(150);
    }
    return observed(false,'Bow activation returned without verified arrow consumption; hit not claimed');
  }
  async function findTemplate(epoch){
    // Never loot a player's overworld storage. Chests must be observed in Nether
    // vicinity of bastion materials. Does not assume every chest is a bastion.
    if(!String(bot.game?.dimension||'').includes('nether'))return observed(false,'Not in Nether');
    const bastion=lookup(bot,['polished_blackstone_bricks','blackstone','gilded_blackstone'],32);
    if(!bastion)return walkScout(epoch,'bastion remnant');
    const chest=lookup(bot,['chest','trapped_chest'],25);
    if(!chest)return walkScout(epoch,'bastion chest');
    const key=String(chest.position);if(session.visitedChests.has(key))return walkScout(epoch,'unopened bastion chest');
    await move(chest.position,3,epoch,12000);
    const before=count(bot,'netherite_upgrade_smithing_template');
    const ui=await bot.openContainer(chest);
    try{
      const found=(ui.containerItems?.()||[]).find(i=>i.name==='netherite_upgrade_smithing_template');
      if(!found){
        session.visitedChests.add(key); // Inspected, genuinely empty.
        return observed(false,'Observed chest contained no Netherite upgrade template');
      }
      await ui.withdraw(found.type,found.metadata,1);
      check(epoch);
    }finally{ui.close();}
    const acquired=count(bot,'netherite_upgrade_smithing_template')>before;
    if(acquired)session.visitedChests.add(key);
    return observed(acquired,acquired?'Bastion template acquired with server inventory proof':
      'Template transfer unverified; preserve chest for another bounded attempt');
  }
  async function constructPortal(epoch){
    if(count(bot,'obsidian')<14 && !session.portalBase)return observed(false,'Need 14 obsidian for rectangular Nether portal');
    if(!session.portalBase){
      const layout=findPortalLayout(bot,bot.entity.position,Vec3);
      if(!layout)return observed(false,'No safe loaded 4x5 portal site in either horizontal orientation');
      session.portalBase=layout.base;
      session.portalAxis=layout.axis;
    }
    const base=session.portalBase, axis=session.portalAxis||{x:1,z:0};
    const cells=[];
    for(let x=0;x<=3;x++)cells.push([x,0]);
    for(let y=1;y<=3;y++){cells.push([0,y],[3,y]);}
    for(let x=0;x<=3;x++)cells.push([x,4]);
    for(const [x,y] of cells){
      check(epoch);const target=portalCell(base,axis,x,y);
      if(bot.blockAt(target)?.name==='obsidian')continue;
      if(!await placeItem(target,'obsidian',epoch))return observed(false,'Portal block placement not verified: '+target);
    }
    const lighter=item(bot,'flint_and_steel');if(!lighter)return observed(false,'Flint and steel missing');
    await move(portalCell(base,axis,1,1),2,epoch,10000);
    await bot.equip(lighter,'hand');
    const obsidian=bot.blockAt(portalCell(base,axis,1,0));
    await bot.activateBlock(obsidian);
    await delay(850);check(epoch);
    const lit=bot.blockAt(portalCell(base,axis,1,1));
    if(lit?.name!=='nether_portal')return observed(false,'Frame built; ignition did not produce Nether portal blocks');
    session.portalPosition=portalCell(base,axis,1,1);
    session.homePortalPosition=session.portalPosition.clone();
    return observed(true,'Built and observed lit 4x5 obsidian Nether portal','nether_portal');
  }
  async function enterPortal(targetDimension,epoch){
    const previous=String(bot.game?.dimension||'');
    if(previous.includes(targetDimension))return observed(true,'Already in '+targetDimension);
    if(!['nether','overworld'].includes(targetDimension))
      return observed(false,'Unknown or unauthorized portal destination');
    let portal=lookup(bot,['nether_portal'],36);
    if(!portal){
      const saved=targetDimension==='overworld'?session.netherPortalPosition:session.homePortalPosition;
      if(saved){
        const here=bot.entity?.position?.clone();
        if(!here)return observed(false,'Cannot locate player to recover saved portal');
        if(here.distanceTo(saved)>26){
          // Portals remembered from real prior visits may be hundreds of
          // blocks away. Do not issue a blind 30-second pathfinder request
          // to unknown, unloaded ground: advance in short physically
          // observed stages, never claiming a dimension change from travel.
          const vx=saved.x-here.x,vz=saved.z-here.z;
          const length=Math.hypot(vx,vz);
          if(length<1)return observed(false,'Saved portal position has no safe horizontal bearing');
          const heading={x:vx/length,z:vz/length};
          const threats=Object.values(bot.entities||{}).filter(e=>e?.position &&
            (ALLOWED_HOSTILES.has(e.name)||['creeper','ghast','wither','piglin_brute'].includes(e.name)));
          const candidates=surveyTargets(bot,here,Vec3).map(p=>{
            const along=(p.x-here.x)*heading.x+(p.z-here.z)*heading.z;
            const sideways=Math.abs((p.x-here.x)*heading.z-(p.z-here.z)*heading.x);
            return {p,along,sideways};
          }).filter(x=>x.along>=4 && x.sideways<=Math.max(5,x.along*.9) &&
            !threats.some(t=>x.p.distanceTo(t.position)<8))
            .sort((a,b)=>b.along-a.along||a.sideways-b.sideways).slice(0,4);
          for(const {p} of candidates){
            check(epoch);
            try{
              await move(p,2,epoch,18000);check(epoch);
              const actual=bot.entity?.position;
              const advance=actual?
                (actual.x-here.x)*heading.x+(actual.z-here.z)*heading.z:0;
              if(actual&&advance>=3&&actual.distanceTo(p)<=4)
                return observed(true,'Physically approached saved portal via loaded safe waypoint; dimension unchanged',
                  'portal_waypoint');
            }catch(error){check(epoch);}
          }
          return observed(false,'No loaded, safe route toward previously observed portal');
        }
        // Recheck the actual loaded block. A remembered coordinate is not
        // proof the portal survived a block update or chunk unload.
        const storedBlock=bot.blockAt(saved);
        if(!storedBlock)
          return observed(false,'Saved portal location is not in loaded world data');
        await move(saved,3,epoch,30000);
        portal=lookup(bot,['nether_portal'],36);
      }
    }
    if(!portal)return observed(false,'No observed Nether portal in loaded range or stored waypoint');
    session.portalPosition=portal.position.clone();
    if(targetDimension==='nether' && previous.includes('overworld'))
      session.homePortalPosition=portal.position.clone();
    await move(portal.position,2,epoch,18000);
    // Minecraft requires remaining inside an existing portal for a transition.
    let arrived=false;
    const until=Date.now()+22000;
    while(Date.now()<until){
      check(epoch);
      if(String(bot.game?.dimension||'').includes(targetDimension)){arrived=true;break;}
      const p=bot.entity?.position;if(p && p.distanceTo(portal.position)>1.5){
        await bot.lookAt(portal.position.offset(.5,.5,.5),true);
        bot.setControlState('forward',true);await delay(350);bot.setControlState('forward',false);
      }else await delay(550);
    }
    bot.setControlState('forward',false);
    if(arrived && targetDimension==='nether'){
      session.netherPortalPosition=lookup(bot,['nether_portal'],32)?.position?.clone()||bot.entity.position.clone();
    }
    if(arrived && targetDimension==='overworld'){
      session.homePortalPosition=lookup(bot,['nether_portal'],32)?.position?.clone()||bot.entity.position.clone();
    }
    return observed(arrived,arrived?'Observed server dimension: '+bot.game.dimension:'Portal transition not verified',
      arrived?(targetDimension==='nether'?'nether_entered':'overworld_return'):undefined);
  }
  async function hunt(name,drop,epoch){
    // Only the existing explicitly planned survival resource targets are
    // eligible for this routine. Unknown model-suggested entity names never
    // become attack authority and players are excluded.
    const eligible=new Set(['blaze','enderman','spider','skeleton',
      'cow','pig','sheep','hoglin']);
    if(!eligible.has(name)||!bot.entity?.position)
      return observed(false,'Unapproved or unobserved survival hunting target');
    check(epoch);
    if(bot.health<10)return observed(false,'Unsafe health for survival hunt');
    const e=bot.nearestEntity(t=>t?.name===name && t?.position &&
      t?.type!=='player' && !t?.username);
    if(!e)return walkScout(epoch,name);
    if(bot.entity.position.distanceTo(e.position)>18)
      return observed(false,'Observed target exceeds bounded hunting approach range');
    // Avoid starting melee with multiple additional hostiles in range.
    const hazards=Object.values(bot.entities||{}).filter(t=>t?.id!==e.id&&t?.position&&
      (ALLOWED_HOSTILES.has(t.name)||['creeper','wither','ender_dragon'].includes(t.name))&&
      t.position.distanceTo(bot.entity.position)<8);
    if(hazards.length)return observed(false,'Multiple observed hostiles: hunting postponed');
    const start=count(bot,drop);
    await move(e.position,3,epoch,20000);
    check(epoch);
    const live=bot.entities?.[e.id];
    if(!live?.position||live.name!==name||bot.entity.position.distanceTo(live.position)>4)
      return observed(false,'Target identity or physical melee range changed during approach');
    const gear=await equipObservedMelee(bot,()=>getEpoch()===epoch);
    if(!gear.ok)return observed(false,'Hunt weapon could not be server-verified: '+gear.detail);
    check(epoch);
    for(let j=0;j<12;j++){
      check(epoch);
      if(bot.health<9)return observed(false,'Health dropped during hunt; retreat required');
      const current=bot.entities?.[e.id];
      if(!current?.position)break;
      if(current.name!==name||current.type==='player'||current.username)
        return observed(false,'Target identity changed during hunt');
      if(bot.entity.position.distanceTo(current.position)>4){
        if(bot.entity.position.distanceTo(current.position)>9)
          return observed(false,'Hostile moved beyond bounded melee pursuit range');
        await move(current.position,3,epoch,9000);
        check(epoch);
      }
      if(bot.entity.position.distanceTo(current.position)>4)
        return observed(false,'Physical melee reach not confirmed');
      bot.attack(current);await delay(630);
    }
    check(epoch);
    return collectDrop(drop,start,e.position,epoch);
  }
  async function searchEye(epoch){
    const eyes=count(bot,'ender_eye')+count(bot,'eye_of_ender');
    if(eyes<1)return observed(false,'No Eyes of Ender to search for stronghold');
    const existing=lookup(bot,['end_portal_frame'],30);
    if(existing)return observed(true,'Stronghold End portal frame actually observed nearby');
    if(session.bearing && session.eyesThrown%3!==0){
      const origin=bot.entity.position?.clone();
      if(!origin)return observed(false,'No observed position for Eye-of-Ender heading');
      // Previous implementation assumed the ground at an arbitrary 22-block
      // same-Y destination existed and could be walked to. Hills, ravines,
      // lava and unloaded chunks made the real End route frequently stall.
      // Navigate only through live standable, loaded terrain, preserving
      // the actual Eye heading as a preference rather than inventing a path.
      const bearing=session.bearing;
      const threats=Object.values(bot.entities||{}).filter(e=>e?.position &&
        (ALLOWED_HOSTILES.has(e.name)||['creeper','wither'].includes(e.name)));
      const options=surveyTargets(bot,origin,Vec3).map(p=>{
        const dx=p.x-origin.x,dz=p.z-origin.z;
        const along=dx*bearing.x+dz*bearing.z;
        const sideways=Math.abs(dx*bearing.z-dz*bearing.x);
        return {p,along,sideways};
      }).filter(o=>o.along>=4 && o.sideways<=Math.max(5,o.along*0.8) &&
        !threats.some(t=>o.p.distanceTo(t.position)<8))
        .sort((a,b)=>b.along-a.along||a.sideways-b.sideways).slice(0,5);
      if(!options.length)return observed(false,
        'No loaded hazard-free terrain in measured Eye direction; refuse guessed route');
      for(const {p} of options){
        check(epoch);
        try{
          await move(p,2,epoch,18000);
          check(epoch);
          const actual=bot.entity?.position;
          const forward=actual?
            (actual.x-origin.x)*bearing.x+(actual.z-origin.z)*bearing.z:0;
          if(actual&&forward>=3&&actual.distanceTo(p)<=4){
            session.eyesThrown++;
            return observed(true,'Physical player travel along observed Eye direction '+ 
              Math.floor(actual.x)+','+Math.floor(actual.y)+','+
              Math.floor(actual.z)+'; stronghold not yet claimed');
          }
        }catch(err){check(epoch);}
      }
      return observed(false,'No bounded Eye-bearing route physically reached');
    }
    const eye=item(bot,'ender_eye')||item(bot,'eye_of_ender');
    const origin=bot.entity.position.clone();
    await bot.equip(eye,'hand');
    bot.activateItem();await delay(1100);check(epoch);
    const observedEye=bot.nearestEntity(e=>e?.position && /eye_of_ender|ender_eye/.test(e.name||''));
    if(!observedEye)return observed(false,'Thrown Eye not observed in server entities; cannot infer stronghold heading');
    const delta=observedEye.position.minus(origin);
    const mag=Math.hypot(delta.x,delta.z);
    if(mag<.4)return observed(false,'Observed Eye had no measurable flight direction');
    session.bearing={x:delta.x/mag,z:delta.z/mag};session.eyesThrown++;
    return observed(true,`Eye flight observed: heading ${session.bearing.x.toFixed(2)},${session.bearing.z.toFixed(2)}`);
  }
  async function approachBuriedStronghold(goalPosition,epoch){
    const tool=bot.inventory.items().find(i=>['diamond_pickaxe','netherite_pickaxe','iron_pickaxe'].includes(i.name));
    if(!tool)return observed(false,'No mining pickaxe for underground stronghold stairs');
    let dug=0;
    for(let n=0;n<5;n++){
      check(epoch);
      const current=bot.entity.position;
      if(Math.floor(current.y)<=Math.floor(goalPosition.y)+3)break;
      const dir=session.eyesThrown%4;
      const [dx,dz]=[[1,0],[0,1],[-1,0],[0,-1]][dir];
      const next=new Vec3(Math.floor(current.x)+dx,Math.floor(current.y)-1,Math.floor(current.z)+dz);
      if(!solid(bot.blockAt(next.offset(0,-1,0))))return observed(false,'Void or liquid beneath stronghold stairs');
      const clear=[bot.blockAt(next.offset(0,1,0)),bot.blockAt(next)];
      if(clear.some(b=>!b||['water','lava','bedrock','end_portal_frame','end_portal'].includes(b.name)))
        return observed(false,'Cannot safely excavate observed stronghold staircase');
      const around=[next.offset(-1,0,0),next.offset(1,0,0),next.offset(0,0,-1),next.offset(0,0,1)];
      if(around.some(p=>bot.blockAt(p)?.name==='lava'))return observed(false,'Lava alongside proposed staircase');
      await bot.equip(tool,'hand');
      for(const block of clear){
        if(block.boundingBox!=='empty'){
          if(!bot.canDigBlock?.(block))return observed(false,'Unmineable stronghold stair obstacle');
          await bot.dig(block);check(epoch);
          if(bot.blockAt(block.position)?.boundingBox!=='empty')
            return observed(false,'Stronghold dig was dispatched but no server block-state change observed');
          dug++;
        }
      }
      const start=bot.entity.position.clone();
      await bot.lookAt(next.offset(.5,1,.5),true);
      bot.setControlState('forward',true);
      try{await delay(450);}finally{bot.setControlState('forward',false);}
      check(epoch);
      if(!confirmedMove(start,bot.entity.position,next,{minHorizontal:.45,maxTargetDistance:2.4}))
        return observed(false,'Stair blocks cleared but physical player movement not verified');
    }
    if(dug>0)session.eyesThrown++;
    return observed(dug>0,dug?`Opened ${dug} server-observed blocks and confirmed movement down the stronghold stair`:
      'No safe downward path opened');
  }
  async function activateEnd(epoch){
    const frames=bot.findBlocks({matching:b=>b?.name==='end_portal_frame',maxDistance:30,count:12});
    if(!frames?.length)return observed(false,'No End portal frames observed');
    if(Math.max(...frames.map(p=>Math.abs(p.y-bot.entity.position.y)))>6)
      return approachBuriedStronghold(frames[0],epoch);
    if(lookup(bot,['end_portal'],30))return observed(true,'Actual End portal already active');
    const eye=item(bot,'ender_eye')||item(bot,'eye_of_ender');
    if(!eye)return observed(false,'No Eyes of Ender to fill portal');
    let inserted=0;
    for(const p of frames){
      check(epoch);
      const frame=bot.blockAt(p);if(!frame || frame.name!=='end_portal_frame')continue;
      // Java frame has eye property in state metadata. Avoid blindly consuming
      // eyes into an already full frame (no hardcoded state bits).
      if(frame.getProperties?.().eye === true)continue;
      await move(frame.position,3,epoch,12000);
      const liveEye=item(bot,'ender_eye')||item(bot,'eye_of_ender');
      if(!liveEye)break; // Don't use a stale item after it was consumed.
      await bot.equip(liveEye,'hand');await bot.activateBlock(frame);
      await delay(250);check(epoch);
      if(bot.blockAt(p)?.getProperties?.().eye===true)inserted++;
      if(lookup(bot,['end_portal'],30))return observed(true,'End portal blocks appeared after frame activation');
    }
    // Placing 1..11 eyes is real verified progress but NOT an opened portal.
    // Never block a mission just because activation requires multiple passes.
    return inserted>0
      ? observed(true,`Verified ${inserted} newly filled frame(s); portal not yet activated`)
      : observed(false,'No new eye states or active End portal were observed');
  }
  async function fightDragon(epoch){
    const dragon=bot.nearestEntity(e=>e?.name==='ender_dragon'&&e?.position);
    if(!dragon)return observed(false,'No live dragon entity in loaded world');
    if(!observeDragon(session,dragon))return observed(false,'Dragon lacked stable server ID');
    const live=digest(bot,getOwner());
    if(live.wornDiamond!==true && live.wornNetherite!==true)
      return observed(false,'Four diamond or Netherite armor slots must be server-observed as worn');
    const sword=bot.inventory.items().find(i=>i.name==='netherite_sword'||i.name==='diamond_sword');
    if(!sword)return observed(false,'Diamond or Netherite sword not available');
    if(bot.entity.position.distanceTo(dragon.position)>5){
      return shootVisibleEntity(dragon,epoch);
    }
    await bot.equip(sword,'hand');bot.attack(dragon);check(epoch);
    noteDragonAttack(session,dragon);
    await delay(350);check(epoch);
    return observed(true,'Melee attack dispatched at visible dragon; death not claimed','dragon_seen');
  }
  async function destroyCrystal(epoch){
    const c=bot.nearestEntity(e=>e?.name==='end_crystal' && e?.position);
    if(!c||!bot.entity?.position)return observed(false,'No End crystal observed');
    check(epoch);
    let current=bot.entities?.[c.id];
    if(!current?.position||current.name!=='end_crystal')
      return observed(false,'Crystal identity changed before controlled attack');
    // End crystals explode on close-range impact. NEVER melee a crystal in
    // survival, even when the current weapon is powerful. Reuse physically
    // observed standable terrain to retreat before any bounded bow shot.
    if(bot.entity.position.distanceTo(current.position)<9){
      const here=bot.entity.position.clone();
      const safe=surveyTargets(bot,here,Vec3).filter(p=>
        p.distanceTo(here)>=3 && p.distanceTo(current.position)>=10);
      if(!safe.length)return observed(false,
        'No observed safe standoff for End crystal; refusing self-damaging melee attack');
      let separated=false;
      for(const site of safe.slice(0,4)){
        check(epoch);
        try{
          await move(site,2,epoch,16000);
          const live=bot.entities?.[c.id];
          if(live?.name==='end_crystal' && live.position &&
             bot.entity.position.distanceTo(live.position)>=9){
            separated=true;break;
          }
        }catch(err){check(epoch);}
      }
      if(!separated)return observed(false,
        'Could not physically reach a safe bow position; crystal left untouched');
    }
    check(epoch);
    current=bot.entities?.[c.id];
    if(!current?.position||current.name!=='end_crystal')
      return observed(false,'Crystal disappeared before ranged attack; destruction unproven');
    if(bot.entity.position.distanceTo(current.position)<9)
      return observed(false,'Crystal still too close to safely attack');
    const shot=await shootVisibleEntity(current,epoch);
    if(!shot.ok)return shot;
    await delay(250);check(epoch);
    const destroyed=!bot.entities?.[c.id];
    return observed(destroyed,destroyed?
      'Server no longer reports the selected crystal after a verified ranged shot':
      'Verified survival arrow consumed, but crystal destruction still unproven');
  }
  async function smithGear(plan,epoch){
    if(!NETHERITE.includes(plan.item) || plan.base!==plan.item.replace('netherite_','diamond_'))
      return observed(false,'Unexpected smithing recipe item');
    const workbench=lookup(bot,['smithing_table'],5);
    if(!workbench)return observed(false,'No smithing table in range');
    const names=['netherite_upgrade_smithing_template',plan.base,'netherite_ingot'];
    let removedArmorSlot=null,ui=null;
    try{
    // Never remove worn armor unless all OTHER ingredients are already real.
    if(!item(bot,names[0])||!item(bot,names[2]))
      return observed(false,'Missing verified upgrade template or Netherite ingot; armor stays equipped');
    // After a real Dragon-first fight all diamond armor pieces are WORN,
    // not present in inventory.items(). Mineflayer's smithing UI consumes
    // backpack slots only. First move the exact observed owned piece back
    // into survival inventory, verifying the server changed the armor slot.
    // Never pull an unrelated armor item or invent a diamond base.
    if(!item(bot,plan.base)){
      const slotName=plan.base.endsWith('_helmet')?'head':
        plan.base.endsWith('_chestplate')?'torso':
        plan.base.endsWith('_leggings')?'legs':
        plan.base.endsWith('_boots')?'feet':null;
      const slot=slotName?bot.getEquipmentDestSlot?.(slotName):null;
      if(!Number.isInteger(slot) || bot.inventory.slots?.[slot]?.name!==plan.base)
        return observed(false,'Missing real '+plan.base+' in backpack or equipped armor');
      if(String(bot.game?.dimension||'').replace(/^minecraft:/,'')!=='overworld')
        return observed(false,'Equipped diamond armor may only be removed for smithing in Overworld');
      if(typeof bot.unequip!=='function')
        return observed(false,'Mineflayer armor unequip API unavailable');
      check(epoch);
      removedArmorSlot=slotName;
      await bot.unequip(slotName);
      check(epoch);
      if(bot.inventory.slots?.[slot]?.name===plan.base || !item(bot,plan.base))
        return observed(false,'Server did not confirm diamond armor returned to inventory');
    }
    if(names.some(n=>!item(bot,n)))return observed(false,'Missing real template/diamond base/netherite ingot');
    const before=count(bot,plan.item);
    ui=await bot.openBlock(workbench);
      // Vanilla 1.20+ smithing window: three inputs, output, player inventory.
      // Refuse to click any slots until server window layout is observed.
      const type=String(ui.type||'');
      if(!/smithing/.test(type) || ui.inventoryStart!==4 || ui.slots.length<40)
        return observed(false,`Unsupported smithing window layout: ${type}, start ${ui.inventoryStart}`);
      if(ui.slots.slice(0,4).some(Boolean))return observed(false,'Smithing input slots occupied; refusing to overwrite foreign contents');
      for(let dst=0;dst<3;dst++){
        check(epoch);
        const src=ui.slots.findIndex((v,index)=>index>=ui.inventoryStart && v?.name===names[dst]);
        if(src<0)return observed(false,'Required smithing ingredient absent from window: '+names[dst]);
        await bot.moveSlotItem(src,dst);
        if(ui.slots[dst]?.name!==names[dst])return observed(false,'Input slot movement not verified');
      }
      await delay(250);check(epoch);
      if(ui.slots[3]?.name!==plan.item)return observed(false,'Server did not offer expected '+plan.item+' output');
      await bot.clickWindow(3,0,1); // shift-click verified smithing output
      const settled=await waitForInventoryIncrease({
        before,read:()=>count(bot,plan.item),
        check:()=>check(epoch),wait:delay,deadline:Date.now()+3500
      });
      return observed(settled.ok,
        `Smithing result ${plan.item} inventory ${before} -> ${settled.after}`+
        (settled.ok?' (server observed)':' (input clicked; output not proven)'));
    }finally{
      // Cleanup also covers failed GUI opens and a failed inventory settle;
      // previously the original diamond armor was left unequipped.
      if(ui){
        for(let slot=0;slot<3;slot++){
          if(ui.slots?.[slot]){
            try{await bot.clickWindow(slot,0,1);}catch{}
          }
        }
        try{await Promise.resolve(bot.closeWindow(ui));}catch{}
      }
      // The prior diamond armor is now in the backpack. Re-equip the
      // upgraded armor when smithing succeeded, otherwise restore diamond
      // armor, but only while the same owner-authorized action remains live.
      // This is NOT a smithing success proof: the smithing output must
      // independently have been verified by an inventory delta.
      if(removedArmorSlot && getEpoch()===epoch){
        try{
          const slot=bot.getEquipmentDestSlot(removedArmorSlot);
          if(Number.isInteger(slot) && !bot.inventory.slots?.[slot]){
            const replacement=item(bot,plan.item)||item(bot,plan.base);
            if(replacement){
              await bot.equip(replacement,removedArmorSlot);
              // Failure to re-equip is not reported as having worn the item.
              // Final full-Netherite equipment remains separately verified.
            }
          }
        }catch{ /* do not fabricate armor state after a failed recovery */ }
      }
    }
  }
  async function equipDiamond(epoch){
    const pieces=[['diamond_helmet','head'],['diamond_chestplate','torso'],['diamond_leggings','legs'],['diamond_boots','feet']];
    for(const [name,slot] of pieces){
      check(epoch);
      const idx=bot.getEquipmentDestSlot?.(slot);
      if(!Number.isInteger(idx))return observed(false,'Unknown equipment slot '+slot);
      if(bot.inventory.slots?.[idx]?.name===name)continue;
      const piece=item(bot,name);if(!piece)return observed(false,'Missing actual '+name);
      await bot.equip(piece,slot);check(epoch);
      if(bot.inventory.slots?.[idx]?.name!==name)
        return observed(false,'Diamond equipment slot not server-verified: '+slot);
    }
    const good=pieces.every(([name,slot])=>bot.inventory.slots?.[bot.getEquipmentDestSlot(slot)]?.name===name);
    return observed(good,good?'Four diamond armor slots verified by server':'Diamond equipment verification incomplete');
  }
  async function equipNetherite(epoch,armorOnly=false){
    const pieces=[['netherite_helmet','head'],['netherite_chestplate','torso'],['netherite_leggings','legs'],['netherite_boots','feet']];
    for(const [name,slot] of pieces){
      check(epoch);
      const idx=bot.getEquipmentDestSlot?.(slot);
      if(!Number.isInteger(idx))return observed(false,'Equipment slot not known: '+slot);
      if(bot.inventory.slots?.[idx]?.name===name)continue;
      const piece=item(bot,name);if(!piece)return observed(false,'Missing '+name);
      await bot.equip(piece,slot);
      if(bot.inventory.slots?.[idx]?.name!==name)return observed(false,'Server did not equip '+name);
    }
    const armorGood=pieces.every(([name,slot])=>
      bot.inventory.slots?.[bot.getEquipmentDestSlot(slot)]?.name===name);
    if(!armorGood)return observed(false,'Netherite armor slots not fully confirmed');
    if(armorOnly)return observed(true,
      'All four Netherite armor slots physically observed; no sword/Dragon implied',
      'netherite_armor_equipped');
    const sword=item(bot,'netherite_sword');
    if(!sword && bot.heldItem?.name!=='netherite_sword')
      return observed(false,'Netherite sword missing');
    if(bot.heldItem?.name!=='netherite_sword')await bot.equip(sword,'hand');
    check(epoch);
    const good=armorGood&&bot.heldItem?.name==='netherite_sword';
    return observed(good,good?'Netherite armor worn and sword held, verified via server inventory':'Netherite equipment not fully verified',good?'netherite_equipped':undefined);
  }
  async function run(plan,epoch){
    check(epoch);
    switch(plan.kind){
      case 'mine_resource_ore':{
        const rule=ORE_RESOURCE_RULES[plan.resource];
        if(!rule)return observed(false,'Unsupported generic ore resource');
        const dimension=String(bot.game?.dimension||'').replace(/^minecraft:/,'');
        if(dimension!==rule.dimension)
          return observed(false,'Wrong live dimension for '+plan.resource+' ore');
        return mineKnown(rule.blocks,rule.drop,PICKAXES[rule.tier],epoch,26);
      }
      case 'survey_resource':{
        if(!Object.hasOwn(ORE_RESOURCE_RULES,plan.resource))
          return observed(false,'Unsupported generic ore survey target');
        return walkScout(epoch,'resource '+plan.resource);
      }
      case 'mine_obsidian':{
        const b=lookup(bot,['obsidian'],28);
        if(!b)return walkScout(epoch,'obsidian near surface lava/water');
        return mineKnown(['obsidian'],'obsidian',['diamond_pickaxe','netherite_pickaxe'],epoch);
      }
      case 'mine_netherrack':return mineKnown(['netherrack'],'netherrack',['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],epoch);
      case 'mine_generic':{
        if(!SAFE_GENERIC_RESOURCES.has(plan.resource))
          return observed(false,'Unsupported general terrain gathering resource');
        // Miner must hold a real pickaxe for minerals; a bare-hand dig can
        // remove the block while dropping NO item. That is not a success.
        const toolNames=PICKAXE_GENERIC_RESOURCES.has(plan.resource)?
          ['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe']:[];
        return mineKnown([plan.resource],plan.resource,toolNames,epoch,20,true);
      }
      case 'collect_flint':{
        const b=lookup(bot,['gravel'],28);
        if(!b)return walkScout(epoch,'gravel');
        return mineKnown(['gravel'],'flint',['wooden_shovel','stone_shovel','iron_shovel','diamond_shovel','netherite_shovel','diamond_pickaxe','iron_pickaxe'],epoch);
      }
      case 'collect_iron':{
        if(count(bot,'raw_iron')>0)return smelt('raw_iron','iron_ingot',epoch);
        return mineKnown(['iron_ore','deepslate_iron_ore'],'raw_iron',['stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],epoch);
      }
      case 'craft_flint_steel':return craft('flint_and_steel',epoch);
      case 'build_nether_portal':return constructPortal(epoch);
      case 'enter_nether':return enterPortal('nether',epoch);
      case 'enter_overworld':return enterPortal('overworld',epoch);
      case 'mine_ancient_debris':{
        const b=bot.findBlock({matching:block=>block?.name==='ancient_debris' &&
          [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([x,y,z])=>
            ['air','cave_air','void_air'].includes(bot.blockAt(block.position.offset(x,y,z))?.name)),maxDistance:32});
        return b?mineKnown(['ancient_debris'],'ancient_debris',['diamond_pickaxe','netherite_pickaxe'],epoch,32,true):safeNetherTunnel(epoch);
      }
      case 'smelt_resource':return smelt(plan.input,plan.output,epoch);
      case 'collect_gold':{
        if(count(bot,'raw_gold')>0)return smelt('raw_gold','gold_ingot',epoch);
        if(count(bot,'gold_nugget')>=9 && lookup(bot,['crafting_table'],5))return craft('gold_ingot',epoch,'crafting_table');
        const ore=lookup(bot,['nether_gold_ore','gold_ore','deepslate_gold_ore'],27);
        if(!ore)return walkScout(epoch,'gold ore');
        return mineKnown([ore.name],ore.name==='nether_gold_ore'?'gold_nugget':'raw_gold',['iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],epoch);
      }
      case 'craft_netherite_ingot':return craft('netherite_ingot',epoch,'crafting_table');
      case 'loot_bastion_template':return findTemplate(epoch);
      case 'collect_template_materials':{
        if(count(bot,'netherrack')<1){
          return mineKnown(['netherrack'],'netherrack',['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],epoch);
        }
        return observed(false,'More diamonds required for template duplication; return to Overworld diamond mining');
      }
      case 'duplicate_template':return craft('netherite_upgrade_smithing_template',epoch,'crafting_table');
      case 'craft_smithing_table':return craft('smithing_table',epoch,'crafting_table');
      case 'place_smithing_table':{
        const p=bot.entity.position;let placed=false;
        for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]]){
          const target=new Vec3(Math.floor(p.x)+dx,Math.floor(p.y),Math.floor(p.z)+dz);
          try{if(await placeItem(target,'smithing_table',epoch)){placed=true;break;}}catch{}
        }
        return observed(placed,'Smithing table '+(placed?'block verified':'could not be placed'));
      }
      case 'smith_netherite':return smithGear(plan,epoch);
      case 'equip_diamond':return equipDiamond(epoch);
      case 'equip_netherite':return equipNetherite(epoch);
      case 'equip_netherite_armor':return equipNetherite(epoch,true);
      case 'hunt_blazes':return hunt('blaze','blaze_rod',epoch);
      case 'hunt_endermen':return hunt('enderman','ender_pearl',epoch);
      case 'craft_blaze_powder':return craft('blaze_powder',epoch);
      case 'craft_eyes':return craft('ender_eye',epoch);
      case 'prepare_archery':{
        if(!item(bot,'bow')){
          if(count(bot,'string')<3)return hunt('spider','string',epoch);
          if(count(bot,'stick')<3)return count(bot,'oak_log')+counts(bot,n=>n.endsWith('_planks'))>=2?
            craft('stick',epoch):observed(false,'Need wood/sticks for bow');
          return craft('bow',epoch,'crafting_table');
        }
        if(count(bot,'arrow')>=32)return observed(true,'Thirty-two arrows verified');
        if(count(bot,'flint')>0 && count(bot,'stick')>0 && count(bot,'feather')>0)
          return craft('arrow',epoch,'crafting_table');
        return hunt('skeleton','arrow',epoch);
      }
      case 'obtain_food':{
        const safeRaw=bot.inventory.items().find(i=>['beef','porkchop','mutton','rabbit'].includes(i.name));
        if(safeRaw){const before=bot.food;await bot.equip(safeRaw,'hand');await bot.consume();
          check(epoch);return observed(bot.food>before,'Hunger '+before+' -> '+bot.food);}
        const inNether=String(bot.game?.dimension||'').includes('nether');
        const targetTypes=inNether?['hoglin']:['cow','pig','sheep'];
        const entity=bot.nearestEntity(e=>targetTypes.includes(e?.name)&&e?.position);
        if(!entity)return walkScout(epoch,inNether?'hoglin for Nether survival':'passive livestock for food');
        // Hoglins drop raw, edible porkchop. Next iteration consumes only
        // after a real inventory delta and server food-level observation.
        return hunt(entity.name,entity.name==='cow'?'beef':entity.name==='sheep'?'mutton':'porkchop',epoch);
      }
      case 'track_stronghold':return searchEye(epoch);
      case 'activate_end_portal':return activateEnd(epoch);
      case 'enter_end':{
        const portal=lookup(bot,['end_portal'],30);
        if(!portal)return observed(false,'End portal absent');
        await move(portal.position,1,epoch,16000);
        for(let j=0;j<20;j++){check(epoch);if(String(bot.game?.dimension).includes('the_end'))return observed(true,'End dimension verified');await delay(500);}
        return observed(false,'Server dimension did not change to the_end');
      }
      case 'exit_end':{
        const dimension=String(bot.game?.dimension||'').replace(/^minecraft:/,'');
        if(dimension!=='the_end'||!session.dragonDied||!session.dragonSeen)
          return observed(false,'Refuse End exit without real End dragon-death and prior entity observation');
        const portal=lookup(bot,['end_portal'],36);
        if(!portal)return observed(false,'No server-observed End exit portal');
        await move(portal.position,1,epoch,16000);
        for(let j=0;j<35;j++){
          check(epoch);
          if(String(bot.game?.dimension).replace(/^minecraft:/,'')==='overworld')
            return observed(true,'Exited End through actual portal and server dimension changed to Overworld','end_return');
          await delay(500);
        }
        return observed(false,'End exit did not cause actual Overworld dimension transition');
      }
      case 'destroy_end_crystal':return destroyCrystal(epoch);
      case 'fight_dragon':return fightDragon(epoch);
      case 'observe_dragon':{const dragon=bot.nearestEntity(e=>e?.name==='ender_dragon');
        if(!dragon)return observed(false,'No dragon entity to observe');
        if(!observeDragon(session,dragon))return observed(false,'Dragon identity unverified');
        return observed(true,'Observed dragon entity ID '+dragon.id,'dragon_seen');
      }
      case 'search_dragon':{
        const dragon=bot.nearestEntity(e=>e?.name==='ender_dragon');
        if(dragon&&observeDragon(session,dragon))
          return observed(true,'Ender Dragon observed ID '+dragon.id,'dragon_seen');
        return walkScout(epoch,'Ender Dragon');
      }
      case 'verify_dragon':{
        const inEnd=String(bot.game?.dimension||'').replace(/^minecraft:/,'')==='the_end';
        const hasPortal=inEnd && !!lookup(bot,['end_portal'],36);
        if(!session.dragonDied || !session.dragonSeen || !hasPortal)
          return observed(false,'Observed dragon death and End exit portal required in the End');
        // Composite proof is distinct from a mere portal observation. The
        // controller must not infer dragonKilled from end_exit_portal alone.
        return observed(true,'Observed server dragon death and End exit portal','dragon_victory');
      }
      default:return observed(false,'Unknown late-game action '+plan.kind);
    }
  }
  return {run,session};
}
module.exports={createLateSkills};
