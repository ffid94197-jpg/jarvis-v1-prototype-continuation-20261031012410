'use strict';
/* Mineflayer live skills for long-run vanilla progression. All results require
 * observed inventory, block state, dimension, or death-event evidence.
 * No commands/creative mode/seed inspection/teleports. Failure is explicit.
 */
const {NETHERITE}=require('./late_game.cjs');
const {findExposedOre}=require('./ore_access.cjs');
const {confirmedMove}=require('./movement_proof.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const solid=b=>b && b.boundingBox!=='empty' && !['air','cave_air','void_air','lava','water','fire','nether_portal'].includes(b.name);
const pos=b=>new Vec3(Math.floor(b.x),Math.floor(b.y),Math.floor(b.z));
const count=(bot,name)=>(bot.inventory?.items?.()||[]).reduce((n,i)=>n+(i.name===name?i.count:0),0);
const counts=(bot,pred)=>(bot.inventory?.items?.()||[]).reduce((n,i)=>n+(pred(i.name)?i.count:0),0);
const observed=(ok,detail,proof)=>({ok:!!ok,verified:!!ok,detail, ...(ok&&proof?{proof}:{})});
const lookup=(bot,names,radius=28)=>bot.findBlock({matching:b=>b && names.includes(b.name),maxDistance:radius});
const item=(bot,name)=>bot.inventory.items().find(i=>i.name===name);
function createLateSkills({bot,navigate,craftNamed,getEpoch,getOwner,digest,Vec3}){
  const session={portalBase:null,portalPosition:null,homePortalPosition:null,netherPortalPosition:null,eyesThrown:0,bearing:null,dragonSeen:false,dragonDied:false,visitedChests:new Set(),surveyIndex:0};
  const check=epoch=>{if(getEpoch()!==epoch)throw Error('Minecraft action cancelled by owner');};
  async function move(position,range,epoch,timeout=20000){check(epoch);await navigate(position,range,epoch,timeout);check(epoch);}
  async function collectDrop(name,before,around,epoch){
    for(let k=0;k<12;k++){
      check(epoch);
      if(count(bot,name)>before)return observed(true,`${name} verified ${before} -> ${count(bot,name)}`);
      const dropped=bot.nearestEntity?.(e=>e?.position&&(e.name==='item'||e.type==='other')&&e.position.distanceTo(around)<6);
      if(dropped?.position && bot.entity.position.distanceTo(dropped.position)>1.5)
        await move(dropped.position,1,epoch,3300).catch(()=>{});
      await delay(300);
    }
    return observed(false,`${name} was not collected into inventory`);
  }
  async function mineKnown(names,drop,toolNames,epoch,searchRadius=26,visibleOnly=false){
    // Restrict approach-face verification to the progression ores that can be
    // buried in the loaded chunk cache. Surface obsidian, netherrack, gravel
    // and other terrain can legitimately be mined from above, so retain their
    // original reachability checks rather than requiring a horizontal cave.
    const needsFace=names.every(n=>['iron_ore','deepslate_iron_ore','diamond_ore','deepslate_diamond_ore'].includes(n));
    const exposed=needsFace?findExposedOre(bot,names,searchRadius):null;
    const block=needsFace?exposed?.block:bot.findBlock({matching:b=>b && names.includes(b.name) && (!visibleOnly ||
      [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([x,y,z])=>
        ['air','cave_air','void_air'].includes(bot.blockAt(b.position.offset(x,y,z))?.name))),maxDistance:searchRadius});
    if(!block)return observed(false,'No accessible '+names.join('/')+' observed in loaded chunks');
    const pick=bot.inventory.items().find(i=>toolNames.includes(i.name));
    if(!pick)return observed(false,'Missing appropriate tool for '+names[0]);
    const before=count(bot,drop), p=block.position.clone();
    await move(needsFace?exposed.stance:p,needsFace?1:3,epoch,19000);
    const live=bot.blockAt(p);
    if(!live||!names.includes(live.name)||bot.entity.position.distanceTo(p)>5)throw Error('Ore absent or out of reach');
    await bot.equip(pick,'hand');await bot.dig(live);check(epoch);
    return collectDrop(drop,before,p,epoch);
  }
  async function walkScout(epoch,kind){
    check(epoch);
    const here=bot.entity.position.clone();
    const vectors=[[16,0],[0,16],[-16,0],[0,-16],[16,16],[-16,16],[-16,-16],[16,-16]];
    const [dx,dz]=vectors[session.surveyIndex++%vectors.length];
    const d=here.offset(dx,0,dz);
    await move(d,3,epoch,18000);
    return observed(true,`Explored a real loaded waypoint for ${kind}, target not yet guaranteed`);
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
    const material=item(bot,input);if(!material)return observed(false,'No '+input+' to smelt');
    const fuel=bot.inventory.items().find(i=>['coal','charcoal','blaze_rod','oak_planks','spruce_planks','birch_planks','jungle_planks','acacia_planks','dark_oak_planks','mangrove_planks','cherry_planks','crimson_planks','warped_planks'].includes(i.name));
    if(!fuel)return observed(false,'Furnace has no verified fuel');
    const before=count(bot,output);const ui=await bot.openFurnace(furnace);
    try{
      if(!ui.fuelItem())await ui.putFuel(fuel.type,null,Math.min(fuel.count,4));
      if(!ui.inputItem())await ui.putInput(material.type,null,Math.min(material.count,8));
      for(let j=0;j<95;j++){
        check(epoch);await delay(350);
        if(ui.outputItem()?.name===output){await ui.takeOutput();
          return observed(count(bot,output)>before,`${output} count ${before} -> ${count(bot,output)}`);}
      }
      return observed(false,`No ${output} observed after 33 seconds`);
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
    await bot.equip(bow,'hand');
    const aim=target.position.offset(0,Math.min(5,dist*dist/135),0);
    await bot.lookAt(aim,true);
    bot.activateItem();
    try{await delay(1200);}finally{bot.deactivateItem();}
    check(epoch);await delay(1000);
    return observed(true,'Bow shot dispatched toward observed target; hit not claimed');
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
      session.visitedChests.add(key);
      if(!found)return observed(false,'Observed chest contained no netherite upgrade template');
      await ui.withdraw(found.type,found.metadata,1);
    }finally{ui.close();}
    return observed(count(bot,'netherite_upgrade_smithing_template')>before,'Bastion template acquired and inventory confirmed');
  }
  async function constructPortal(epoch){
    if(count(bot,'obsidian')<14 && !session.portalBase)return observed(false,'Need 14 obsidian for rectangular Nether portal');
    if(!session.portalBase){
      const p=bot.entity.position;
      for(const [dx,dz] of [[3,0],[-5,0],[0,3],[0,-5]]){
        const base=new Vec3(Math.floor(p.x)+dx,Math.floor(p.y),Math.floor(p.z)+dz);
        const fits=[0,1,2,3].every(x=>{
          const foot=bot.blockAt(base.offset(x,-1,0));
          return solid(foot) && [0,1,2,3,4].every(y=>{
            const b=bot.blockAt(base.offset(x,y,0));return b && ['air','cave_air','void_air'].includes(b.name);
          });
        });
        if(fits){session.portalBase=base;break;}
      }
      if(!session.portalBase)return observed(false,'No safe open 4x5 portal building space with solid foundation');
    }
    const base=session.portalBase;
    const cells=[];
    for(let x=0;x<=3;x++)cells.push([x,0]);
    for(let y=1;y<=3;y++){cells.push([0,y],[3,y]);}
    for(let x=0;x<=3;x++)cells.push([x,4]);
    for(const [x,y] of cells){
      check(epoch);const target=base.offset(x,y,0);
      if(bot.blockAt(target)?.name==='obsidian')continue;
      if(!await placeItem(target,'obsidian',epoch))return observed(false,'Portal block placement not verified: '+target);
    }
    const lighter=item(bot,'flint_and_steel');if(!lighter)return observed(false,'Flint and steel missing');
    await move(base.offset(1,1,0),2,epoch,10000);
    await bot.equip(lighter,'hand');
    const obsidian=bot.blockAt(base.offset(1,0,0));
    await bot.activateBlock(obsidian);
    await delay(850);check(epoch);
    const lit=bot.blockAt(base.offset(1,1,0));
    if(lit?.name!=='nether_portal')return observed(false,'Frame built; ignition did not produce Nether portal blocks');
    session.portalPosition=base.offset(1,1,0);session.homePortalPosition=session.portalPosition.clone();
    return observed(true,'Built and observed lit 4x5 obsidian Nether portal','nether_portal');
  }
  async function enterPortal(targetDimension,epoch){
    const previous=String(bot.game?.dimension||'');
    if(previous.includes(targetDimension))return observed(true,'Already in '+targetDimension);
    let portal=lookup(bot,['nether_portal'],36);
    if(!portal){
      const saved=targetDimension==='overworld'?session.netherPortalPosition:session.homePortalPosition;
      if(saved){await move(saved,3,epoch,30000);portal=lookup(bot,['nether_portal'],36);}
    }
    if(!portal)return observed(false,'No observed Nether portal in loaded range or stored waypoint');
    session.portalPosition=portal.position.clone();
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
    return observed(arrived,arrived?'Observed server dimension: '+bot.game.dimension:'Portal transition not verified');
  }
  async function hunt(name,drop,epoch){
    const e=bot.nearestEntity(e=>e?.name===name&&e?.position);
    if(!e)return walkScout(epoch,name);
    if(name==='enderman'){
      // avoid attacking players and avoid hits without an observed target
      await bot.lookAt(e.position.offset(0,2.5,0),true);
    }
    const start=count(bot,drop);
    await move(e.position,3,epoch,20000);
    const sword=bot.inventory.items().find(i=>/_sword$/.test(i.name));if(sword)await bot.equip(sword,'hand');
    for(let j=0;j<16;j++){
      check(epoch);
      const current=bot.entities?.[e.id];
      if(!current?.position)break;
      if(bot.entity.position.distanceTo(current.position)>4)await move(current.position,3,epoch,9000);
      bot.attack(current);await delay(630);
    }
    return collectDrop(drop,start,e.position,epoch);
  }
  async function searchEye(epoch){
    const eyes=count(bot,'ender_eye')+count(bot,'eye_of_ender');
    if(eyes<1)return observed(false,'No Eyes of Ender to search for stronghold');
    const existing=lookup(bot,['end_portal_frame'],30);
    if(existing)return observed(true,'Stronghold End portal frame actually observed nearby');
    if(session.bearing && session.eyesThrown%3!==0){
      const p=bot.entity.position;
      await move(p.offset(session.bearing.x*22,0,session.bearing.z*22),4,epoch,18000);
      session.eyesThrown++;return observed(true,'Moved along observed Eye of Ender heading; stronghold not yet verified');
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
          await bot.dig(block);dug++;
        }
      }
      await bot.lookAt(next.offset(.5,1,.5),true);
      bot.setControlState('forward',true);
      try{await delay(450);}finally{bot.setControlState('forward',false);}
      check(epoch);
    }
    session.eyesThrown++;
    return observed(dug>0,dug?`Opened ${dug} observed blocks toward stronghold depth`:'No safe downward path opened');
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
    session.dragonSeen=true;
    const gear=NETHERITE.every(n=>count(bot,n)>0||digest(bot,getOwner()).inventory.raw[n]>0);
    if(!gear)return observed(false,'Full Netherite loadout not observed');
    const sword=bot.inventory.items().find(i=>i.name==='netherite_sword');
    if(!sword)return observed(false,'Netherite sword not available');
    if(bot.entity.position.distanceTo(dragon.position)>5){
      return shootVisibleEntity(dragon,epoch);
    }
    await bot.equip(sword,'hand');bot.attack(dragon);await delay(350);check(epoch);
    return observed(true,'Melee attack dispatched at visible dragon; death not claimed','dragon_seen');
  }
  async function destroyCrystal(epoch){
    const c=bot.nearestEntity(e=>e?.name==='end_crystal' && e?.position);
    if(!c)return observed(false,'No End crystal observed');
    if(bot.entity.position.distanceTo(c.position)>4.5){
      const shot=await shootVisibleEntity(c,epoch);
      if(!shot.ok)return shot;
      return observed(!bot.entities?.[c.id],!bot.entities?.[c.id]?'Crystal gone after bow shot':'Shot fired; crystal destruction not yet verified');
    }
    bot.attack(c);await delay(350);check(epoch);
    return observed(!bot.entities?.[c.id],'End crystal removal '+(!bot.entities?.[c.id]?'observed':'unverified'));
  }
  async function smithGear(plan,epoch){
    if(!NETHERITE.includes(plan.item) || plan.base!==plan.item.replace('netherite_','diamond_'))
      return observed(false,'Unexpected smithing recipe item');
    const workbench=lookup(bot,['smithing_table'],5);
    if(!workbench)return observed(false,'No smithing table in range');
    const names=['netherite_upgrade_smithing_template',plan.base,'netherite_ingot'];
    if(names.some(n=>!item(bot,n)))return observed(false,'Missing real template/diamond base/netherite ingot');
    const before=count(bot,plan.item);
    const ui=await bot.openBlock(workbench);
    try{
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
      await delay(200);check(epoch);
      return observed(count(bot,plan.item)>before,`Smithing result ${plan.item} count ${before} -> ${count(bot,plan.item)}`);
    }finally{
      // Return any stranded input items to inventory when server permits.
      for(let slot=0;slot<3;slot++){
        if(ui.slots[slot]){
          try{await bot.clickWindow(slot,0,1);}catch{}
        }
      }
      await bot.closeWindow(ui).catch(()=>{});
    }
  }
  async function equipNetherite(epoch){
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
    const sword=item(bot,'netherite_sword');if(!sword)return observed(false,'Netherite sword missing');
    await bot.equip(sword,'hand');check(epoch);
    const good=pieces.every(([name,slot])=>bot.inventory.slots?.[bot.getEquipmentDestSlot(slot)]?.name===name) && bot.heldItem?.name==='netherite_sword';
    return observed(good,good?'Netherite armor worn and sword held, verified via server inventory':'Netherite equipment not fully verified',good?'netherite_equipped':undefined);
  }
  async function run(plan,epoch){
    check(epoch);
    switch(plan.kind){
      case 'mine_obsidian':{
        const b=lookup(bot,['obsidian'],28);
        if(!b)return walkScout(epoch,'obsidian near surface lava/water');
        return mineKnown(['obsidian'],'obsidian',['diamond_pickaxe','netherite_pickaxe'],epoch);
      }
      case 'mine_netherrack':return mineKnown(['netherrack'],'netherrack',['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],epoch);
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
        if(count(bot,'gold_nugget')>=9)return craft('gold_ingot',epoch);
        const ore=lookup(bot,['nether_gold_ore','gold_ore','deepslate_gold_ore'],27);
        if(!ore)return walkScout(epoch,'gold ore');
        return mineKnown([ore.name],ore.name==='nether_gold_ore'?'gold_nugget':'raw_gold',['iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],epoch);
      }
      case 'craft_netherite_ingot':return craft('netherite_ingot',epoch);
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
      case 'equip_netherite':return equipNetherite(epoch);
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
        const entity=bot.nearestEntity(e=>['cow','pig','sheep'].includes(e?.name)&&e?.position);
        if(!entity)return walkScout(epoch,'passive livestock for food');
        return hunt(entity.name,entity.name==='cow'?'beef':entity.name==='pig'?'porkchop':'mutton',epoch);
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
        session.dragonSeen=true;return observed(true,'Observed dragon entity ID '+dragon.id,'dragon_seen');
      }
      case 'search_dragon':{
        const dragon=bot.nearestEntity(e=>e?.name==='ender_dragon');
        if(dragon){session.dragonSeen=true;return observed(true,'Ender Dragon observed','dragon_seen');}
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
