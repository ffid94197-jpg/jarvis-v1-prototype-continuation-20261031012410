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
function pickupFeet(bot,drop,Vec3){
 if(!drop||!bot?.entity?.position)return null;
 // Try the actual observed item location first; never plan into a liquid.
 // Look for feet-level positions that have solid safe floor and two air cells.
 const origins=[[drop.x,drop.z],[drop.x+1,drop.z],[drop.x-1,drop.z],
   [drop.x,drop.z+1],[drop.x,drop.z-1]];
 const choices=[];
 for(const [x,z] of origins){
   for(const y of [drop.y,bot.entity.position.y]){
     const p=safeSurveyFeet(bot,x,z,y,Vec3);
     if(!p)continue;
     const block=bot.blockAt(p),head=bot.blockAt(p.offset(0,1,0));
     if(!block||!head||HAZARD.test(block.name+' '+head.name))continue;
     choices.push(p);
   }
 }
 choices.sort((a,b)=>a.distanceTo(drop)-b.distanceTo(drop));
 return choices[0]||null;
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
 let triedGround=false;
 while(now()<deadline){
   check();
   const count=readCount();
   if(count>beforeCount)return {ok:true,verified:true,
     detail:label+' server inventory '+beforeCount+' -> '+count};
   const drops=itemEntities(bot,origin,10);
   let foot=null;
   if(drops.length){
     foot=pickupFeet(bot,drops[0].position,Vec3);
     if(!foot){last='Drop entity visible but no safe standable pickup foot position';}
   }else if(!triedGround){
     // Mineflayer can receive a spawned block drop late or not yet know its
     // entity ID. Attempt a single safe walk to the observed log footprint.
     foot=pickupFeet(bot,origin,Vec3);triedGround=true;
     if(!foot)last='No safe approach to mined block footprint';
   }
   if(foot && bot.entity.position.distanceTo(foot.offset(.5,0,.5))>.6){
     const remaining=deadline-now();
     if(remaining>1500){
       try{
         const reached=await move(foot.offset(.5,0,.5),0,
           Math.min(maxMoveMs,remaining-500));
         check();
         last=reached?'Arrived near pickup position; inventory pending':
           'Navigation did not reach pickup position';
       }catch(e){
         check();
         last='Pickup route failed: '+String(e?.message||e).slice(0,90);
       }
     }
   }
   check();
   if(readCount()>beforeCount)return {ok:true,verified:true,
     detail:label+' server inventory '+beforeCount+' -> '+readCount()};
   await wait(Math.min(350,Math.max(1,deadline-now())));
 }
 return {ok:false,verified:false,
   detail:label+' mined but actual item not acquired before deadline: '+last};
}
module.exports={itemEntities,pickupFeet,collectObservedDrop};
