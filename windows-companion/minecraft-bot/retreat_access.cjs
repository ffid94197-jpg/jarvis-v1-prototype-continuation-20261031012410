'use strict';
/** Read-only escape route candidates for hostile encounters.
 * Does not move the bot, and does not certify successful avoidance.
 */
const {surveyTargets}=require('./wood_navigation.cjs');
function retreatStances(bot,here,hostile,Vec3,{minGain=3}={}){
 if(!here||!hostile||typeof hostile.distanceTo!=='function')return [];
 const initial=here.distanceTo(hostile);
 return surveyTargets(bot,here,Vec3)
   .filter(p=>p.distanceTo(hostile)>=initial+minGain &&
     p.distanceTo(here)>3)
   .sort((a,b)=>a.distanceTo(here)-b.distanceTo(here));
}
module.exports={retreatStances};
