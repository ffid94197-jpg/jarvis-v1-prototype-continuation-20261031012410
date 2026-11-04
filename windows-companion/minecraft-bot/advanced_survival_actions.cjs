'use strict';
/**
 * Native Mineflayer survival interactions for JARVIS V1.
 * No second agent, dynamic scripts, op/cheat commands, or new dependencies.
 * Every inventory mutation is preflighted and then checked against live
 * player AND container/trade/window state. Inconclusive = NOT VERIFIED.
 */
const NAME=/^[a-z][a-z0-9_]{0,63}$/;
const CONTAINERS=new Set(['chest','trapped_chest','barrel']);
const int=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
function ownCount(bot,name){
 return (bot.inventory?.items?.()||[]).reduce((n,item)=>
   n+(item?.name===name&&int(item.count,1,2304)?item.count:0),0);
}
function stackCount(slots,name){
 return (Array.isArray(slots)?slots:[]).reduce((n,item)=>
   n+(item?.name===name&&int(item.count,1,2304)?item.count:0),0);
}
function exactPosition(p){
 return !!p && typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).length===3&&['x','y','z'].every(k=>int(p[k],-30000000,30000000));
}
function nearby(bot,position,Vec3,maxDistance=4.5){
 if(!exactPosition(position)||!bot.entity?.position)return null;
 const b=bot.blockAt?.(new Vec3(position.x,position.y,position.z));
 return b?.position && bot.entity.position.distanceTo(b.position)<=maxDistance?b:null;
}
function itemProof(ok,description){
 return {ok:ok===true,verified:ok===true,detail:description};
}
function requireCurrent(allowed){if(allowed&&allowed()===false)throw Error('Owner cancelled current gameplay action');}
async function confirmChange(read,predicate,allowed,pause){
 for(let i=0;i<8;i++){
  requireCurrent(allowed);
  const value=read();
  if(predicate(value))return value;
  if(i!==7)await pause(200);
 }
 return read();
}
function findTradeOffer(win,index,times,bot){
 if(!int(index,0,31)||!int(times,1,4)||!Array.isArray(win?.trades))
  return {error:'No verified bounded villager offer'};
 const offer=win.trades[index];
 if(!offer||offer.disabled===true||offer.tradeDisabled===true||
    (Number.isInteger(offer.maxTradeuses)&&Number.isInteger(offer.tooluses)&&
      offer.tooluses+times>offer.maxTradeuses)||
    (Number.isInteger(offer.maximumNbTradeUses)&&Number.isInteger(offer.nbTradeUses)&&
      offer.nbTradeUses+times>offer.maximumNbTradeUses))
  return {error:'Villager offer unavailable or exhausted'};
 const output=offer.outputItem||offer.output;
 const input=offer.inputItem1||offer.firstInput;
 const second=offer.inputItem2||offer.secondaryInput;
 if(!output||!NAME.test(String(output.name))||!int(output.count,1,64)||
    !input||!NAME.test(String(input.name))||!int(input.count,1,64))
  return {error:'Unrecognized live villager offer schema'};
 const requirements=new Map();
 for(const item of [input,second]){
  if(!item)continue;
  if(!NAME.test(String(item.name))||!int(item.count,1,64))
   return {error:'Invalid input item in live villager offer'};
  requirements.set(item.name,(requirements.get(item.name)||0)+item.count*times);
 }
 for(const [name,need] of requirements)if(ownCount(bot,name)<need)
  return {error:'Missing server-observed trade input '+name};
 return {output,requirements,offer};
}
function safeWindowClose(bot,win){
 try{if(typeof win?.close==='function')win.close();
 else if(typeof bot.closeWindow==='function')bot.closeWindow(win);}catch{}
}
function readContainerContents(win){
 if(!win||!int(win.inventoryStart,1,256)||!Array.isArray(win.slots))return null;
 return win.slots.slice(0,win.inventoryStart);
}
function createAdvancedActions({bot,Vec3,pause=ms=>new Promise(r=>setTimeout(r,ms)),allowed=()=>true}){
 if(!bot||typeof Vec3!=='function')throw Error('Real Mineflayer bot and Vec3 required');
 async function inspectVillager(entityId){
  const entity=bot.entities?.[entityId];
  if(!int(entityId,0,200000)||entity?.name!=='villager'||
     !entity.position || !bot.entity?.position ||
     bot.entity.position.distanceTo(entity.position)>4.3)return itemProof(false,'No reachable loaded villager');
  requireCurrent(allowed);
  let win;
  try{
   win=await bot.openVillager(entity);
   requireCurrent(allowed);
   if(!Array.isArray(win?.trades))return itemProof(false,'Villager offers not yet observed');
   const trades=win.trades.slice(0,16).map((offer,index)=>({
    index,disabled:offer?.disabled===true||offer?.tradeDisabled===true,
    input:offer?.inputItem1?.name||offer?.firstInput?.name||null,
    cost:offer?.inputItem1?.count||offer?.firstInput?.count||null,
    second:offer?.inputItem2?.name||offer?.secondaryInput?.name||null,
    output:offer?.outputItem?.name||offer?.output?.name||null,
    outputCount:offer?.outputItem?.count||offer?.output?.count||null
   }));
   return {ok:true,verified:true,detail:JSON.stringify({entityId,trades}).slice(0,1400)};
  }finally{safeWindowClose(bot,win);}
 }
 async function tradeVillager({entityId,tradeIndex,times}){
  const entity=bot.entities?.[entityId];
  if(!int(entityId,0,200000)||entity?.name!=='villager'||!entity.position||
     !bot.entity?.position||bot.entity.position.distanceTo(entity.position)>4.3)
   return itemProof(false,'No reachable server-observed villager');
  if(!int(tradeIndex,0,31)||!int(times,1,4))
   return itemProof(false,'Trade index and repetitions out of owner-approved bounds');
  requireCurrent(allowed);
  let win;
  try{
   win=await bot.openVillager(entity);
   requireCurrent(allowed);
   const offer=findTradeOffer(win,tradeIndex,times,bot);
   if(offer.error)return itemProof(false,offer.error);
   const before=ownCount(bot,offer.output.name);
   const inputBefore=Array.from(offer.requirements).map(([name,need])=>({name,need,have:ownCount(bot,name)}));
   requireCurrent(allowed);
   await bot.trade(win,tradeIndex,times);
   const after=await confirmChange(()=>ownCount(bot,offer.output.name),
      v=>v>=before+offer.output.count*times,allowed,pause);
   const inputsConsumed=inputBefore.every(({name,need,have})=>
      ownCount(bot,name)<=have-need);
   const passed=after>=before+offer.output.count*times&&inputsConsumed;
   return itemProof(passed,passed?
    'Villager transaction output and required input consumption independently observed':
    'Trade sent but server inventory proof incomplete; reconcile before retrying');
  }finally{safeWindowClose(bot,win);}
 }
 async function transferContainer({position,item,count,operation}){
  if(!exactPosition(position)||!NAME.test(String(item))||!int(count,1,64)||
    !['deposit','withdraw'].includes(operation))
   return itemProof(false,'Invalid bounded container transfer');
  const b=nearby(bot,position,Vec3);
  if(!b||!CONTAINERS.has(b.name))return itemProof(false,'No reachable loaded chest or barrel');
  requireCurrent(allowed);
  let win;
  try{
   win=await bot.openContainer(b);
   requireCurrent(allowed);
   let slots=readContainerContents(win);
   if(!slots)return itemProof(false,'Container contents not observed');
   const type=bot.registry?.itemsByName?.[item]?.id;
   if(!int(type,1,200000))return itemProof(false,'Unknown real Minecraft item');
   const beforePlayer=ownCount(bot,item),beforeContainer=stackCount(slots,item);
   if(operation==='deposit'&&beforePlayer<count)return itemProof(false,'Not enough player inventory');
   if(operation==='withdraw'&&beforeContainer<count)return itemProof(false,'Not enough container inventory');
   requireCurrent(allowed);
   if(operation==='deposit')await win.deposit(type,null,count);
   else await win.withdraw(type,null,count);
   const proof=()=>{
    const player=ownCount(bot,item),container=readContainerContents(win);
    if(!container)return false;
    const inChest=stackCount(container,item);
    return operation==='deposit'?
      (player<=beforePlayer-count&&inChest>=beforeContainer+count):
      (player>=beforePlayer+count&&inChest<=beforeContainer-count);
   };
   const result=await confirmChange(proof,v=>v===true,allowed,pause);
   return itemProof(result===true,result===true?
    'Real player inventory and container slot changes both verified':
    'Transfer dispatched but dual inventory proof missing; reconcile before retrying');
  }finally{safeWindowClose(bot,win);}
 }
 async function enchantItem({item,choice,position}){
  if(!NAME.test(String(item))||!int(choice,0,2)||!exactPosition(position))
   return itemProof(false,'Enchant item, table and option must be bounded');
  const table=nearby(bot,position,Vec3);
  if(table?.name!=='enchanting_table')return itemProof(false,'No nearby loaded enchanting table');
  const owned=(bot.inventory?.items?.()||[]).find(i=>i?.name===item);
  const lapis=(bot.inventory?.items?.()||[]).find(i=>i?.name==='lapis_lazuli'&&i.count>=choice+1);
  if(!owned||!lapis)return itemProof(false,'Enchanting item or required Lapis not verified');
  requireCurrent(allowed);
  let win;
  try{
   win=await bot.openEnchantmentTable(table);
   requireCurrent(allowed);
   if(typeof win?.putTargetItem!=='function'||typeof win?.putLapis!=='function')
    return itemProof(false,'Enchantment interface unavailable');
   await win.putTargetItem(owned);
   await win.putLapis(lapis);
   requireCurrent(allowed);
   const option=win.enchantments?.[choice];
   const level=bot.experience?.level;
   if(!int(option?.level,1,100)||!int(level,0,300)||level<option.level)
    return itemProof(false,'Requested enchantment option or experience level unavailable');
   const before=JSON.stringify(owned.nbt??owned.components??null);
   const result=await win.enchant(choice);
   const returned=await win.takeTargetItem();
   requireCurrent(allowed);
   const candidate=returned||result;
   const after=JSON.stringify(candidate?.nbt??candidate?.components??null);
   const valid= candidate?.name===item && after!=='null'&&after!==before;
   return itemProof(valid,valid?
    'Enchantment result item has new observed enchantment metadata':
    'Enchantment was attempted but changed item metadata was not verified');
  }finally{safeWindowClose(bot,win);}
 }
 return {inspectVillager,tradeVillager,transferContainer,enchantItem};
}
module.exports={createAdvancedActions,ownCount,findTradeOffer,exactPosition,readContainerContents};
