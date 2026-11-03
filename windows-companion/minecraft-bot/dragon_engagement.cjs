'use strict';
/** Client-observed dragon engagement, NOT server-side killer attribution. */
const WINDOW_MS=90000;
const isDragon=e=>e?.name==='ender_dragon'&&Number.isSafeInteger(e.id)&&e.id>=0;
function resetDragon(s){if(!s)return;s.dragonSeen=false;s.dragonDied=false;
 s.dragonEntityId=null;s.dragonAttackAt=null;s.dragonAttempts=0;}
function observeDragon(s,e){if(!s||!isDragon(e))return false;
 if(s.dragonEntityId!==e.id)resetDragon(s);
 s.dragonEntityId=e.id;s.dragonSeen=true;return true;}
function noteDragonAttack(s,e,at=Date.now()){if(!s||!isDragon(e)||
 s.dragonEntityId!==e.id||!s.dragonSeen||!Number.isSafeInteger(at)||at<0)return false;
 s.dragonAttackAt=at;s.dragonAttempts=(s.dragonAttempts||0)+1;return true;}
function acceptDragonDeath(s,e,dimension,at=Date.now()){
 if(!s||!isDragon(e)||String(dimension||'').replace(/^minecraft:/,'')!=='the_end'||
    !s.dragonSeen||s.dragonEntityId!==e.id||
    !Number.isInteger(s.dragonAttempts)||s.dragonAttempts<1||
    !Number.isSafeInteger(s.dragonAttackAt)||!Number.isSafeInteger(at)||
    at<s.dragonAttackAt||at-s.dragonAttackAt>WINDOW_MS)return false;
 s.dragonDied=true;return true;}
module.exports={WINDOW_MS,resetDragon,observeDragon,noteDragonAttack,acceptDragonDeath};
