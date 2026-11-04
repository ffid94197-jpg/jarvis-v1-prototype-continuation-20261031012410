'use strict';
// Focused source-level API contract checks. Uses Mineflayer-shaped fakes;
// does NOT represent a real Java client, model, server, network or UI.
const assert=require('node:assert/strict');
const {createAdvancedActions,findTradeOffer,ownCount,exactPosition}
 =require('./advanced_survival_actions.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {interpretOwnerInstruction}=require('./language_goal.cjs');
let passes=0;
const ok=(condition,name)=>{assert.ok(condition,name);passes++;console.log('PASS',name);};
class Vec3{
 constructor(x,y,z){Object.assign(this,{x,y,z});}
 distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);}
}
const pose=new Vec3(0,64,0), chest={name:'chest',position:new Vec3(1,64,0)},
 table={name:'enchanting_table',position:new Vec3(2,64,0)};
const stock={emerald:6,bread:0,oak_planks:4,lapis_lazuli:4,diamond_sword:1};
let enchanted=false,closed=0,tradeCalls=0,containerMutation=true;
const item=(name,count)=>({name,count,type:{emerald:1,bread:2,oak_planks:3,
 lapis_lazuli:4,diamond_sword:5}[name]||0,nbt:name==='diamond_sword'?
 {Enchantments:enchanted?[{id:'sharpness',lvl:1}]:[]}:undefined});
const worldItems=()=>Object.entries(stock).filter(([,count])=>count>0).map(([name,count])=>item(name,count));
const chestStacks=[item('oak_planks',2),null,null];
const villager={name:'villager',id:17,position:new Vec3(1,64,1)};
const bot={
 entity:{position:pose},entities:{17:villager},
 inventory:{items:worldItems},
 registry:{itemsByName:{oak_planks:{id:3}}},
 experience:{level:20},
 blockAt:p=>p.x===1?chest:p.x===2?table:null,
 openVillager:async()=>({trades:[{
  inputItem1:item('emerald',1),realPrice:2,outputItem:item('bread',1),
  tradeDisabled:false,maximumNbTradeUses:10,nbTradeUses:0
 }],close:()=>{closed++;}}),
 trade:async(_v,index,times)=>{tradeCalls++;stock.emerald-=2*times;stock.bread+=times;},
 openContainer:async()=>({
  inventoryStart:3,slots:chestStacks,
  deposit:async(_id,_meta,count)=>{
   if(containerMutation){stock.oak_planks-=count;chestStacks[0].count+=count;}
  },
  withdraw:async(_id,_meta,count)=>{
   if(containerMutation){stock.oak_planks+=count;chestStacks[0].count-=count;}
  },
  close:()=>{closed++;}
 }),
 openEnchantmentTable:async()=>({
  enchantments:[{level:1},{level:5},{level:10}],
  putTargetItem:async()=>{},putLapis:async()=>{},
  enchant:async()=>{enchanted=true;return item('diamond_sword',1);},
  takeTargetItem:async()=>item('diamond_sword',1),
  close:()=>{closed++;}
 })
};
let permitted=true;
const advanced=createAdvancedActions({bot,Vec3,pause:async()=>{},allowed:()=>permitted});
(async()=>{
 const commands=[
  {command:'inspect_villager',entityId:17},
  {command:'trade_villager',entityId:17,tradeIndex:0,times:1},
  {command:'transfer_container',position:{x:1,y:64,z:0},item:'oak_planks',count:2,operation:'deposit'},
  {command:'enchant_item',position:{x:2,y:64,z:0},item:'diamond_sword',choice:0}
 ];
 for(const cmd of commands)
  ok(validateCommand(cmd)===null,'typed contract '+cmd.command);
 for(const command of [
  {command:'trade_villager',entityId:17,tradeIndex:0,times:5},
  {command:'trade_villager',entityId:17,tradeIndex:0,times:1,commandText:'fake'},
  {command:'enchant_item',position:{x:2,y:64,z:0},item:'diamond_sword',choice:3},
  {command:'transfer_container',position:{x:1,y:64,z:0,admin:1},item:'oak_planks',count:1,operation:'deposit'},
  {command:'transfer_container',position:{x:1,y:64,z:0},item:'oak_planks',count:70,operation:'deposit'}
 ])ok(validateCommand(command)!==null,'invalid advanced command refused');
 ok(exactPosition({x:1,y:64,z:0})&&!exactPosition({x:1,y:64,z:0,admin:true}),
   'exact 3-key observed positions required');
 const inspected=await advanced.inspectVillager(17);
 ok(inspected.ok&&inspected.verified&&inspected.detail.includes('"trades"'),
   'read-only villager offer inspection returns actual window offer data');
 const traded=await advanced.tradeVillager({entityId:17,tradeIndex:0,times:1});
 ok(traded.ok&&traded.verified&&stock.bread===1&&stock.emerald===4,
   'trade needs both exact input consumption and output pickup');
 const prev=tradeCalls;
 const refused=await advanced.tradeVillager({entityId:17,tradeIndex:0,times:4});
 ok(!refused.ok&&tradeCalls===prev,
   'insufficient server inventory blocks trade before sending it');
 let transfer=await advanced.transferContainer({
  position:{x:1,y:64,z:0},item:'oak_planks',count:2,operation:'deposit'});
 ok(transfer.ok&&transfer.verified&&stock.oak_planks===2&&chestStacks[0].count===4,
   'deposit receipt requires player decrease and container increase');
 transfer=await advanced.transferContainer({
  position:{x:1,y:64,z:0},item:'oak_planks',count:1,operation:'withdraw'});
 ok(transfer.ok&&transfer.verified&&stock.oak_planks===3&&chestStacks[0].count===3,
   'withdraw receipt requires player increase and container decrease');
 containerMutation=false;
 transfer=await advanced.transferContainer({
  position:{x:1,y:64,z:0},item:'oak_planks',count:1,operation:'deposit'});
 ok(!transfer.ok&&!transfer.verified,
   'container API dispatch without physical transfer never completes');
 const enchant=await advanced.enchantItem({
  position:{x:2,y:64,z:0},item:'diamond_sword',choice:0});
 ok(enchant.ok&&enchant.verified&&enchanted,
   'enchant requires returned item with changed attributes and player readback');
 permitted=false;
 await assert.rejects(advanced.tradeVillager({entityId:17,tradeIndex:0,times:1}),/cancelled/);
 ok(true,'owner stop cancels pending advanced transaction');
 ok(closed>=5,'opened windows close in success and failure paths');
 const world=JSON.stringify({joined:true,busy:false,nearbyBlocks:[
  {name:'chest',x:1,y:64,z:0},{name:'enchanting_table',x:2,y:64,z:0}],
  villagers:[{name:'villager',id:17,distance:1.5}]});
 const samples=[
  ['show me trades from the villager','inspect_villager'],
  ['trade offer 1 from villager once','trade_villager'],
  ['store 2 oak planks in the chest','transfer_container'],
  ['take 2 oak planks from the chest','transfer_container'],
  ['enchant my diamond sword with the first option','enchant_item']
 ];
 for(const [text,command]of samples){
  const result=await interpretOwnerInstruction(text,{env:{},context:world,
   fetchImpl:async()=>{throw Error('Model should not run for uniquely observed context')}});
  ok(result.ok&&result.command.command===command,
   'owner language routes uniquely observed '+command+' without model');
 }
 console.log('MINECRAFT_ADVANCED_NATIVE_SURVIVAL '+passes+'/'+passes+
 ' PASS (modeled Mineflayer API and inventory, not live game)');
})().catch(error=>{console.error(error);process.exitCode=1;});
