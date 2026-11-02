'use strict';
// Safe, bounded tree reconnaissance for the experimental Minecraft LAN companion.
// No movement or block changes happen in this module.
const SCAN_RADIUS = 36;
const MAX_LOG_CANDIDATES = 48;
const SEARCH_OFFSETS = Object.freeze([
  [8,0],[0,8],[-8,0],[0,-8],
  [8,8],[-8,8],[-8,-8],[8,-8],
  [16,0],[0,16],[-16,0],[0,-16],
  [16,8],[-16,8],[-16,-8],[16,-8],
]);
const HAZARD = /(?:lava|water|fire|campfire|magma|cactus|powder_snow|sweet_berry_bush)/;
function isClear(b) {
  return !!b && !HAZARD.test(String(b.name || '')) && b.boundingBox === 'empty';
}
function hasSafeFloor(b) {
  return !!b && !HAZARD.test(String(b.name || '')) && b.boundingBox === 'block';
}
function safeSurveyFeet(bot, x, z, baseY, Vec3) {
  if(!bot || typeof bot.blockAt!=='function') return null;
  const ix=Math.floor(x), iz=Math.floor(z), y0=Math.floor(baseY);
  // Prefer the nearby surface; never guess an unloaded floor or explore cliffs.
  for(const dy of [0,1,-1,2,-2,3,-3]){
    const y=y0+dy;
    const foot=bot.blockAt(new Vec3(ix,y,iz));
    const head=bot.blockAt(new Vec3(ix,y+1,iz));
    const below=bot.blockAt(new Vec3(ix,y-1,iz));
    if(isClear(foot)&&isClear(head)&&hasSafeFloor(below))return new Vec3(ix,y,iz);
  }
  return null;
}
function surveyTargets(bot, origin, Vec3) {
  if(!origin || ![origin.x,origin.y,origin.z].every(Number.isFinite))return [];
  const targets=[];const seen=new Set();
  for(const [dx,dz] of SEARCH_OFFSETS){
    const p=safeSurveyFeet(bot,origin.x+dx,origin.z+dz,origin.y,Vec3);
    if(!p)continue;
    const key=`${p.x},${p.y},${p.z}`;
    if(seen.has(key))continue;
    seen.add(key);targets.push(p);
  }
  return targets;
}
function rankLogs(positions, origin, eligible=()=>true) {
  if(!origin || !Array.isArray(positions))return [];
  const unique=new Set();
  return positions.filter(p=>{
    if(!p || ![p.x,p.y,p.z].every(Number.isFinite))return false;
    const key=`${p.x},${p.y},${p.z}`;
    if(unique.has(key) || Math.abs(p.y-origin.y)>12)return false;
    unique.add(key);return eligible(p)===true;
  }).sort((a,b)=>{
    const score=p=>Math.hypot(p.x-origin.x,p.z-origin.z)+Math.abs(p.y-origin.y)*2;
    return score(a)-score(b);
  }).slice(0,MAX_LOG_CANDIDATES);
}
module.exports={SCAN_RADIUS,MAX_LOG_CANDIDATES,SEARCH_OFFSETS,safeSurveyFeet,surveyTargets,rankLogs};
