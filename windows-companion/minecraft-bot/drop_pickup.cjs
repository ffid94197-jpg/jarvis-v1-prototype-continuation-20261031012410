'use strict';
/*
 * Server-grounded item-drop acquisition for Mineflayer Java survival.
 * Never treat a dug block, a dispatched path or a nearby entity as loot.
 * Success requires an increase in the actual server-backed inventory.
 */
const {safeSurveyFeet}=require('./wood_navigation.cjs');
const HAZARD=/(?:lava|water|fire|magma|cactus|powder_snow|campfire)/;
function itemEntities(bot,origin,radius=10){
 const entities=Object.values(bot?.entities||{});
 return entities.filter(e=>e?.position &&
   (e.name==='item'||e.displayName==='Item') &&
   typeof e.position.distanceTo==='function' &&
   e.position.distanceTo(origin)<=radius)
   .sort((a,b)=>a.position.distanceTo(origin)-b.position.distanceTo(origin));
}
function pickupFootCandidates(bot,drop,Vec3){
 if(!drop||!bot?.entity?.position||!Vec3)return [];
 // A visible item could be above a cliff or behind a blocked center cell.
 // Try all nearby standable locations, but NEVER label a distant stance
 // (including one several blocks vertically above the item) as pickup reach.
 const origins=[[drop.x,drop.z],[drop.x+1,drop.z],[drop.x-1,drop.z],
   [drop.x,drop.z+1],[drop.x,drop.z-1]];
 const choices=[],seen=new Set();
 for(const [x,z] of origins){
   for(const y of [drop.y,bot.entity.position.y]){
     const p=safeSurveyFeet(bot,x,z,y,Vec3);
     if(!p)continue;
     const key=[p.x,p.y,p.z].join(',');
     if(seen.has(key))continue;
     const foot=bot.blockAt(p),head=bot.blockAt(p.offset(0,1,0));
     const floor=bot.blockAt(p.offset(0,-1,0));
     if(!foot||!head||!floor||HAZARD.test(
       String(foot.name)+' '+String(head.name)+' '+String(floor.name)))continue;
     // The drop must overlap the player's pickup envelope at this stance.
     if(p.offset(.5,0,.5).distanceTo(drop)>1.8)continue;
     seen.add(key);choices.push(p);
   }
 }
 choices.sort((a,b)=>a.offset(.5,0,.5).distanceTo(drop)-
   b.offset(.5,0,.5).distanceTo(drop));
 return choices.slice(0,5);
}
function pickupFeet(bot,drop,Vec3){
 return pickupFootCandidates(bot,drop,Vec3)[0]||null;
}
/**
 * move(position, range, timeoutMs) is a caller-owned, cancellable navigation
 * capability. check() must throw on owner E-stop. The helper has no timers
 * other than caller injected wait() and a bounded deadline. Returned success
 * is NEVER inferred from movement; it is only readCount() > beforeCount.
 */
async function collectObservedDrop({bot,origin,beforeCount,readCount,move,check,wait,
 deadline,Vec3,label='Item',maxMoveMs=9000,now=Date.now}){
 if(!bot?.entity?.position||typeof readCount!=='function'||
    typeof check!=='function'||typeof move!=='function'||
    typeof wait!=='function'||!origin||!Vec3)
   throw Error('Missing verifiable item pickup inputs');
 let last='No item entity observed near mined block';
 const attempted=new Map();let footprintAttempted=false;
 while(now()<deadline){
   check();
   const count=readCount();
   if(count>beforeCount)return {ok:true,verified:true,
     detail:label+' server inventory '+beforeCount+' -> '+count};
   // No reliable vanilla item type is available in every Mineflayer entity
   // version. Rotate among *all* nearby safe drop footprints, rather than
   // following one unrelated or unreachable item for the whole budget.
   const drops=itemEntities(bot,origin,10).slice(0,8);
   const options=[],seen=new Set();
   for(const drop of drops){
     for(const [rank,foot] of pickupFootCandidates(bot,drop.position,Vec3).entries()){
       const key=foot.x+','+foot.y+','+foot.z;
       if(!seen.has(key)){seen.add(key);options.push({foot,key,rank});}
     }
   }
   // If no item entity is visible, Mineflayer may still deliver a delayed
   // block drop. Try the actually observed mining footprint only once.
   if(!drops.length && !footprintAttempted){
     // Try every safe stance near the actual mined block. A drop may be
     // delayed or not exposed as an entity even after block removal.
     for(const [rank,foot] of pickupFootCandidates(bot,origin,Vec3).entries()){
       const key=foot.x+','+foot.y+','+foot.z;
       if(!seen.has(key)){seen.add(key);options.push({foot,key,rank});}
     }
     footprintAttempted=true;
   }
   options.sort((a,b)=>
     (attempted.get(a.key)||0)-(attempted.get(b.key)||0) ||
     (a.rank||0)-(b.rank||0) ||
     a.foot.distanceTo(origin)-b.foot.distanceTo(origin));
   const candidate=options[0],foot=candidate?.foot;
   if(!foot){
     last=drops.length?'Visible drops lack safe standable pickup positions':
       'No observed drop or safe mining footprint';
   }else{
     attempted.set(candidate.key,(attempted.get(candidate.key)||0)+1);
     const target=foot.offset(.5,0,.5);
     if(bot.entity.position.distanceTo(target)>.6){
       const remaining=deadline-now();
       if(remaining>1500){
         try{
           const reached=await move(target,0,Math.min(maxMoveMs,remaining-500));
           check();
           last=reached?'Arrived near pickup position; inventory pending':
             'Navigation did not reach pickup position';
         }catch(e){
           check();
           last='Pickup route failed: '+String(e?.message||e).slice(0,90);
         }
       }
     }else last='At safe pickup footprint; awaiting actual inventory gain';
   }
   check();
   if(readCount()>beforeCount)return {ok:true,verified:true,
     detail:label+' server inventory '+beforeCount+' -> '+readCount()};
   await wait(Math.min(350,Math.max(1,deadline-now())));
 }
 return {ok:false,verified:false,
   detail:label+' mined but actual item not acquired before deadline: '+last};
}
module.exports={itemEntities,pickupFeet,pickupFootCandidates,collectObservedDrop};
