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
module.exports={ALLOWED_HOSTILES,MAX_SWINGS,validHostileTarget,fightObserved};
