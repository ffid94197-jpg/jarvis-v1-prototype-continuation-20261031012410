'use strict';
/**
 * Target-limited JARVIS Mineflayer combat. Never attacks real players, owner,
 * villagers, passive animals, bosses, creepers or unknown entities. A button
 * press is NOT a kill receipt. Only an actual server entityDead event proves
 * the selected hostile died; even that does not claim attack attribution.
 */
const ALLOWED_HOSTILES=new Set([
 'zombie','husk','drowned','skeleton','stray','spider','cave_spider',
 'witch','pillager','blaze','endermite','silverfish','slime',
 'magma_cube','zoglin','hoglin','phantom','wither_skeleton'
]);
const MAX_SWINGS=4;
// Only owned vanilla melee weapons; no invented loadout or durability claims.
// Weapon selection stays a JARVIS subroutine, not a second agent.
const MELEE_PRIORITY=Object.freeze([
 'netherite_sword','diamond_sword','iron_sword','stone_sword',
 'wooden_sword','golden_sword'
]);
function chooseObservedMelee(bot){
 const inventory=bot?.inventory?.items?.();
 if(!Array.isArray(inventory))return null;
 // The live held slot may not appear in backpack item listings. Do not
 // replace an already-held stronger sword with a weaker backpack sword.
 const held=bot?.heldItem;
 for(const name of MELEE_PRIORITY){
  if(held?.name===name)return held;
  const owned=inventory.find(item=>item?.name===name&&item.count>0);
  if(owned)return owned;
 }
 return null;
}
async function equipObservedMelee(bot,allowed=()=>true){
 const wanted=chooseObservedMelee(bot);
 if(!wanted)return {ok:true,weapon:null,detail:'No authorized owned sword; bare-hand defense only'};
 if(bot?.heldItem?.name===wanted.name)
  return {ok:true,weapon:wanted.name,detail:'Best owned melee weapon already held'};
 if(typeof bot?.equip!=='function')
  return {ok:false,detail:'Cannot verify melee equipment capability'};
 if(allowed()===false)throw Error('Owner cancelled combat');
 await bot.equip(wanted,'hand');
 if(allowed()===false)throw Error('Owner cancelled combat');
 if(bot.heldItem?.name!==wanted.name)
  return {ok:false,detail:'Sword equip requested but live hand slot did not confirm item'};
 return {ok:true,weapon:wanted.name,detail:'Server-observed owned melee weapon equipped'};
}
const int=(value,low,high)=>Number.isInteger(value)&&value>=low&&value<=high;
function validHostileTarget(bot,entityId){
 if(!int(entityId,0,200000)||!bot?.entity?.position)return null;
 const e=bot.entities?.[entityId];
 if(!e||!ALLOWED_HOSTILES.has(e.name)||!e.position||
    e.type==='player'||e.username||
    bot.entity.position.distanceTo(e.position)>3.4)return null;
 return e;
}
async function fightObserved({bot,entityId,maxSwings=3,
 pause=ms=>new Promise(r=>setTimeout(r,ms)),allowed=()=>true}){
 if(!int(maxSwings,1,MAX_SWINGS))
  return {ok:false,verified:false,detail:'Attack repetitions exceed safety bound'};
 let target=validHostileTarget(bot,entityId);
 if(!target)return {ok:false,verified:false,detail:'No reachable allowed hostile; no attack'};
 if(!int(bot.health,1,20)||bot.health<9)
  return {ok:false,verified:false,detail:'Health too low for optional hostile combat'};
 if(typeof bot.attack!=='function'||typeof bot.on!=='function'||
    typeof bot.removeListener!=='function')
  return {ok:false,verified:false,detail:'Server death event tracking unavailable'};
 const preparation=await equipObservedMelee(bot,allowed);
 if(!preparation.ok)
  return {ok:false,verified:false,detail:preparation.detail};
 target=validHostileTarget(bot,entityId);
 if(!target||bot.health<9)
  return {ok:false,verified:false,detail:'Target moved out of range or health became unsafe while equipping'};
 let deathObserved=false,attacks=0;
 const died=e=>{if(e?.id===entityId&&e?.name===target.name)deathObserved=true;};
 bot.on('entityDead',died);
 try{
  for(let i=0;i<maxSwings;i++){
   if(allowed()===false)throw Error('Owner cancelled combat');
   if(deathObserved)break;
   target=validHostileTarget(bot,entityId);
   if(!target)break;
   if(bot.health<9)break;
   bot.attack(target);
   attacks++;
   await pause(650);
  }
  if(allowed()===false)throw Error('Owner cancelled combat');
  return {ok:deathObserved,verified:deathObserved,
   detail:deathObserved?
    'Target '+entityId+' server entityDead event observed after '+attacks+
     ' authorized attacks; kill attribution not independently proven':
    'Bounded '+attacks+' combat inputs dispatched; target death not independently verified'};
 }finally{bot.removeListener('entityDead',died);}
}
module.exports={ALLOWED_HOSTILES,MAX_SWINGS,MELEE_PRIORITY,
 chooseObservedMelee,equipObservedMelee,validHostileTarget,fightObserved};
