'use strict';
/** Bounded, always-valid JSON admission receipt for the existing JARVIS
 * autonomous Minecraft controller. Preserve required victory evidence,
 * never claim any milestone not independently present in the controller.
 * This is ONLY status data, not live proof or a second planner.
 */
const MAX_BYTES=1800;
const VICTORY=['dragonSeen','dragonKilled','exitPortalObserved','endReturned',
 'netheriteEquipped','travelArrivalVerified'];
const boundedString=(x,n)=>typeof x==='string'?x.slice(0,n):null;
const boundedNum=x=>Number.isFinite(x)?x:null;
function safeMilestones(input){
 const raw=input && typeof input==='object'&&!Array.isArray(input)?input:{};
 const out={};
 for(const key of VICTORY){
  if(raw[key]===true || raw[key]===false)out[key]=raw[key];
 }
 for(const [key,val] of Object.entries(raw)){
  if(Object.keys(out).length>=32)break;
  if(!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(key) || Object.hasOwn(out,key))continue;
  if(typeof val==='boolean'||typeof val==='number'&&Number.isSafeInteger(val)&&Math.abs(val)<1e9)
   out[key]=val;
 }
 return out;
}
function compactAutonomyStatus(state){
 if(!state||typeof state!=='object'||Array.isArray(state)||
    typeof state.status!=='string'||typeof state.goal!=='string' && state.goal!==null)
   throw Error('Invalid JARVIS autonomy status');
 const receipt={
  status:boundedString(state.status,32),
  goal:boundedString(state.goal,64),
  since:boundedNum(state.since),deadline:boundedNum(state.deadline),
  steps:boundedNum(state.steps),successes:boundedNum(state.successes),
  milestones:safeMilestones(state.milestones),
  why:boundedString(state.why,160),
  lastDecision:state.lastDecision?.kind?{kind:boundedString(state.lastDecision.kind,52)}:null,
  lastResult:state.lastResult?.kind?{
   kind:boundedString(state.lastResult.kind,52),verified:state.lastResult.verified===true,
   detail:boundedString(state.lastResult.detail,120)}:null,
  failures:Object.fromEntries(Object.entries(state.failures||{})
   .filter(([k,v])=>/^[a-z_]{1,52}$/.test(k)&&Number.isSafeInteger(v)&&v>=0)
   .slice(0,15)),
  ...(state.sequenceIndex!==undefined?{sequenceIndex:boundedNum(state.sequenceIndex)}:{}),
  ...(state.resource!==undefined?{resource:boundedString(state.resource,64)}:{}),
  ...(state.item!==undefined?{item:boundedString(state.item,64)}:{}),
  ...(state.targetCount!==undefined?{targetCount:boundedNum(state.targetCount)}:{}),
  ...(state.goal==='shelter'&&state.width!==undefined&&state.depth!==undefined?
    {width:boundedNum(state.width),depth:boundedNum(state.depth)}:{})
 };
 let json=JSON.stringify(receipt);
 if(json.length>MAX_BYTES){receipt.failures={};json=JSON.stringify(receipt);}
 if(json.length>MAX_BYTES){receipt.lastResult=null;receipt.why=null;json=JSON.stringify(receipt);}
 if(json.length>MAX_BYTES){receipt.milestones=safeMilestones(
  Object.fromEntries(VICTORY.filter(k=>Object.hasOwn(receipt.milestones,k))
   .map(k=>[k,receipt.milestones[k]])));json=JSON.stringify(receipt);}
 if(json.length>MAX_BYTES)
  throw Error('JARVIS Minecraft status exceeds safe transport limit');
 return json;
}
module.exports={compactAutonomyStatus,safeMilestones,MAX_BYTES};
