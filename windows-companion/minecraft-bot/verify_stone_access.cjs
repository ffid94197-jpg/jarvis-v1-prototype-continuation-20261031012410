#!/usr/bin/env node
'use strict';
/** Source-level regression: buried stone must never be presented as a
 * guaranteed reachable dig. No Minecraft server or creative-mode evidence. */
const assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {stoneProposal,excavationProposal}=require('./stone_access.cjs');
const {isExposed}=require('./mining_navigation.cjs');
let assertions=0;
function check(ok,label){assert(ok,label);assertions++;console.log('PASS '+label);}
function fixture(){
 const cells=new Map(),key=p=>[p.x,p.y,p.z].join(',');
 const air=p=>({name:'air',boundingBox:'empty',position:p});
 function put(x,y,z,name){
  const p=new Vec3(x,y,z);cells.set(key(p),{name,position:p,
   boundingBox:name==='air'?'empty':'block'});
 }
 for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++){
  put(x,63,z,'stone');put(x,64,z,'dirt');
 }
 const origin=new Vec3(.5,65,.5);
 const bot={
  entity:{position:origin},
  blockAt(p){return cells.get(key(p))||air(p)},
  canDigBlock(b){return Boolean(b)&&origin.distanceTo(b.position.offset(.5,.5,.5))<4.4},
  findBlocks({matching,maxDistance,count}){
   return [...cells.values()].filter(b=>matching(b)&&
     origin.distanceTo(b.position)<maxDistance)
     .sort((a,b)=>origin.distanceTo(a.position)-origin.distanceTo(b.position))
     .slice(0,count).map(b=>b.position);
  },
  pathfinder:{movements:null}
 };
 return {bot,put};
}
const f=fixture();
check(stoneProposal(f.bot,()=>null)===null,'reject buried nearest stone that old findBlock selected');
const soil=excavationProposal(f.bot);
check(soil?.position?.x!==0||soil.position.z!==0,'do not excavate underneath player');
check(soil?.potentialStone===true,'choose observed soil with stone directly beneath');
check(f.bot.canDigBlock(f.bot.blockAt(soil.position)),'preparatory soil really within legal mining reach');
f.put(soil.position.x,soil.position.y,soil.position.z,'air');
const stone=f.bot.blockAt(soil.position.offset(0,-1,0));
check(isExposed(f.bot,stone.position),'actual removed topsoil exposed stone face');
const selected=stoneProposal(f.bot,()=>null);
check(selected!==null && selected.stance===null,
 'choose newly exposed stone in direct pickup/mine range without Pathfinder');
check(selected.position.distanceTo(stone.position)<2,'select actual exposed stone, not hidden alternative');
// A cave surface with no permissible dig operation is never accepted.
f.bot.canDigBlock=()=>false;
check(stoneProposal(f.bot,()=>null)===null,'server cannot-dig denial preserved');
check(excavationProposal(f.bot)===null,'no excavation without actual server dig permission');
console.log('MINECRAFT_STONE_ACCESS_REGRESSION '+assertions+'/'+assertions+
 ' PASS (offline geometry only; live vanilla Java acceptance still required)');
