'use strict';
const assert=require('node:assert/strict');
const {createLateSkills}=require('./late_skills.cjs');
class Vec3 {constructor(x,y,z){Object.assign(this,{x,y,z});} offset(x,y,z){return new Vec3(this.x+x,this.y+y,this.z+z);} plus(p){return this.offset(p.x,p.y,p.z);} minus(p){return new Vec3(this.x-p.x,this.y-p.y,this.z-p.z);} clone(){return new Vec3(this.x,this.y,this.z);} distanceTo(p){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);}}
let ok=0;function check(b,msg){assert.ok(b,msg);ok++;}
const gear=['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots','netherite_sword'];
const inventory=[];const slots={};let held;
for(const name of gear)inventory.push({name,count:1});
const positions={head:5,torso:6,legs:7,feet:8};
const bot={game:{dimension:'minecraft:overworld'},health:20,food:20,entity:{position:new Vec3(0,64,0)},entities:{},registry:{},
 inventory:{slots,items:()=>inventory},
 getEquipmentDestSlot:k=>positions[k],
 equip:async(it,slot)=>{if(slot==='hand')held=it;else {slots[positions[slot]]=it;inventory.splice(inventory.indexOf(it),1);}},
 findBlock:()=>null,findBlocks:()=>[],nearestEntity:()=>null,
 get heldItem(){return held;},
};
const ctx=createLateSkills({bot,navigate:async()=>true,craftNamed:async()=>{},getEpoch:()=>1,getOwner:()=>'',digest:()=>({inventory:{raw:{}}}),Vec3});
(async()=>{
 const result=await ctx.run({kind:'equip_netherite'},1);
 check(result.ok && result.verified,'Armor equip verified');
 check(result.proof==='netherite_equipped','Equipment proof issued only on verified item slots');
 check(gear.slice(0,4).every((name,k)=>slots[5+k].name===name),'Four armor slots populated');
 check(held.name==='netherite_sword','Netherite sword held');
 bot.inventory.items=()=>[];
 const bad=await ctx.run({kind:'equip_netherite'},1);
 check(!bad.ok && bad.proof===undefined,'No fake equipment proof when sword missing');
 // Smithing must fail closed before clicking slots when server window layout is unknown.
 let moves=0;
 bot.inventory.items=()=>[{name:'netherite_upgrade_smithing_template',count:1},{name:'diamond_sword',count:1},{name:'netherite_ingot',count:1}];
 bot.findBlock=({matching})=>{const b={name:'smithing_table',position:new Vec3(0,64,1)};return matching(b)?b:null;};
 bot.openBlock=async()=>({type:'minecraft:chest',inventoryStart:9,slots:new Array(45).fill(null)});
 bot.moveSlotItem=async()=>{moves++};bot.closeWindow=async()=>{};
 const wrong=await ctx.run({kind:'smith_netherite',item:'netherite_sword',base:'diamond_sword'},1);
 check(!wrong.ok && moves===0,'Wrong GUI refuses inventory moves');
 const incorrect=await ctx.run({kind:'smith_netherite',item:'netherite_sword',base:'netherite_sword'},1);
 check(!incorrect.ok && moves===0,'Illegal smithing material never clicked');
 let ui;const i=[{name:'netherite_upgrade_smithing_template',count:1},{name:'diamond_sword',count:1},{name:'netherite_ingot',count:1}];
 bot.inventory.items=()=>i;
 bot.openBlock=async()=>{ui={type:'minecraft:smithing',inventoryStart:4,slots:new Array(40).fill(null)};ui.slots[4]=i[0];ui.slots[5]=i[1];ui.slots[6]=i[2];return ui;};
 bot.moveSlotItem=async(src,dst)=>{
   ui.slots[dst]=ui.slots[src];ui.slots[src]=null;
   if(ui.slots[0]&&ui.slots[1]&&ui.slots[2])ui.slots[3]={name:'netherite_sword',count:1};
 };
 bot.clickWindow=async(slot)=>{if(slot===3){i.push({name:'netherite_sword',count:1});ui.slots[3]=null;}else ui.slots[slot]=null;};
 const crafted=await ctx.run({kind:'smith_netherite',item:'netherite_sword',base:'diamond_sword'},1);
 check(crafted.ok && crafted.verified,'Smithing UI path validated with simulated window states');
 check(i.some(x=>x.name==='netherite_sword'),'Smithing output verified in inventory');
 // Real Dragon-first progress wears diamond armor; inventory.items excludes
 // those slots. Smithing must unequip it into inventory before opening UI.
 const diamondHelmet={name:'diamond_helmet',count:1};
 const smithMaterial=[
  {name:'netherite_upgrade_smithing_template',count:1},
  {name:'netherite_ingot',count:1}
 ];
 bot.game.dimension='minecraft:overworld';
 bot.inventory.items=()=>smithMaterial;
 slots[positions.head]=diamondHelmet;
 let unequipped=0;
 bot.unequip=async(slot)=>{
   if(slot!=='head')throw Error('Unexpected equipment destination');
   unequipped++;
   smithMaterial.push(slots[positions.head]);slots[positions.head]=null;
 };
 bot.openBlock=async()=>{
   ui={type:'minecraft:smithing',inventoryStart:4,slots:new Array(40).fill(null)};
   smithMaterial.forEach((piece,idx)=>{ui.slots[4+idx]=piece;});
   return ui;
 };
 bot.moveSlotItem=async(src,dst)=>{
   ui.slots[dst]=ui.slots[src];ui.slots[src]=null;
   if(ui.slots[0]&&ui.slots[1]&&ui.slots[2])
     ui.slots[3]={name:'netherite_helmet',count:1};
 };
 bot.clickWindow=async(slot)=>{
   if(slot===3){smithMaterial.push({name:'netherite_helmet',count:1});ui.slots[3]=null;}
   else ui.slots[slot]=null;
 };
 bot.equip=async(it,slot)=>{
   if(slot!=='head')return;
   slots[positions.head]=it;
   const idx=smithMaterial.indexOf(it);
   if(idx>=0)smithMaterial.splice(idx,1);
 };
 const wornResult=await ctx.run({kind:'smith_netherite',item:'netherite_helmet',base:'diamond_helmet'},1);
 check(wornResult.ok&&wornResult.verified,'Worn diamond base is returned from equipment and upgraded');
 check(unequipped===1 && slots[positions.head]?.name==='netherite_helmet',
    'After verified smithing output, upgraded Netherite armor is worn again');
 // A missing Netherite ingot must NOT cause the bot to strip armor.
 const readyItems=bot.inventory.items;
 bot.inventory.items=()=>smithMaterial.filter(x=>x.name!=='netherite_ingot'&&x.name!=='netherite_helmet');
 slots[positions.head]=diamondHelmet;
 const beforeMissing=unequipped;
 const missingSupply=await ctx.run({kind:'smith_netherite',item:'netherite_helmet',base:'diamond_helmet'},1);
 check(!missingSupply.ok && unequipped===beforeMissing && slots[positions.head]===diamondHelmet,
    'Missing smithing materials must leave worn diamond armor untouched');
 bot.inventory.items=readyItems;
 // A failed smithing window open must not strand armor in the backpack.
 bot.inventory.items=()=>smithMaterial.filter(x=>
   x.name!=='netherite_helmet' && x.name!=='diamond_helmet');
 slots[positions.head]=diamondHelmet;
 let windowFailure=false;
 bot.openBlock=async()=>{throw Error('Simulated smithing window open failure');};
 try{
   await ctx.run({kind:'smith_netherite',item:'netherite_helmet',base:'diamond_helmet'},1);
 }catch(e){windowFailure=/Simulated smithing window/.test(String(e));}
 check(windowFailure && slots[positions.head]?.name==='diamond_helmet',
   'A failing smithing GUI must restore diamond armor after verified unequip');
 bot.inventory.items=readyItems;
 // The same worn base must never be removed outside the Overworld.
 bot.game.dimension='minecraft:the_nether';
 bot.inventory.items=()=>smithMaterial.filter(x=>x.name!=='netherite_helmet'&&x.name!=='diamond_helmet');
 slots[positions.head]=diamondHelmet;
 const beforeDenied=unequipped;
 const wrongWorld=await ctx.run({kind:'smith_netherite',item:'netherite_helmet',base:'diamond_helmet'},1);
 check(!wrongWorld.ok&&unequipped===beforeDenied,
    'In-Nether worn armor is not removed for smithing');
 bot.game.dimension='minecraft:overworld';
 // Restore original smithing test inputs.
 bot.inventory.items=()=>i;
 bot.openBlock=async()=>({type:'minecraft:smithing',inventoryStart:4,slots:Array.from({length:40},(_,idx)=>idx===0?{name:'stolen',count:1}:null)});
 moves=0;
 const occupied=await ctx.run({kind:'smith_netherite',item:'netherite_sword',base:'diamond_sword'},1);
 check(!occupied.ok && moves===0,'Occupied smithing slots refuse cross-player item mutation');
 // An End portal requires all frames. Confirm partial frame inserts as
 // verified incremental progress, not a fake portal completion or a failure.
 let filled=false,insertClicks=0;
 const pos=new Vec3(1,64,0);
 bot.game.dimension='minecraft:overworld';
 bot.inventory.items=()=>[{name:'ender_eye',count:2}];
 const frame={name:'end_portal_frame',position:pos,getProperties:()=>({eye:filled})};
 bot.findBlocks=()=>[pos];
 bot.blockAt=()=>frame;
 bot.findBlock=({matching})=>matching(frame)?frame:null;
 bot.equip=async()=>{};
 bot.activateBlock=async()=>{filled=true;insertClicks++;};
 const partial=await ctx.run({kind:'activate_end_portal'},1);
 check(partial.ok && partial.verified && !partial.proof,'Partial frame insertion is genuine progress, not portal victory');
 check(insertClicks===1,'One actual frame activation was attempted');
 const noMore=await ctx.run({kind:'activate_end_portal'},1);
 check(!noMore.ok && insertClicks===1,'Already-filled frame never consumes another eye');
 // Dragon victory is a composite server-event and End-dimension portal proof.
 ctx.session.dragonSeen=true;ctx.session.dragonDied=true;
 bot.findBlock=({matching})=>{const b={name:'end_portal',position:new Vec3(0,64,1)};return matching(b)?b:null;};
 const wrongDimension=await ctx.run({kind:'verify_dragon'},1);
 check(!wrongDimension.ok && !wrongDimension.proof,'An Overworld portal cannot prove Dragon victory');
 bot.game.dimension='minecraft:the_end';ctx.session.dragonDied=false;
 const noDeath=await ctx.run({kind:'verify_dragon'},1);
 check(!noDeath.ok && !noDeath.proof,'End portal without witnessed death is insufficient');
 ctx.session.dragonDied=true;
 const victory=await ctx.run({kind:'verify_dragon'},1);
 check(victory.ok && victory.verified && victory.proof==='dragon_victory',
  'Combined End portal and witnessed dragon death emits distinct proof');
 // Do not claim scouting/progression when Pathfinder returns false without
 // throwing. The real bot navigate() provides this boolean from world position.
 bot.game.dimension='minecraft:the_nether';
 bot.findBlock=()=>null;
 const deniedRoutes=createLateSkills({
   bot,navigate:async()=>false,craftNamed:async()=>({verified:true}),
   getEpoch:()=>1,getOwner:()=>'',digest:()=>({inventory:{raw:{}}}),Vec3
 });
 let denied=false;
 try{await deniedRoutes.run({kind:'loot_bastion_template'},1);}
 catch(e){denied=/No server-confirmed route/.test(String(e.message));}
 check(denied,'False navigator result cannot certify Bastion exploration as progress');
 let netherDenied=false;
 try{await deniedRoutes.run({kind:'hunt_blazes'},1);}
 catch(e){netherDenied=/No server-confirmed route/.test(String(e.message));}
 check(netherDenied,
   'A failed Nether scout navigation cannot be verified as exploration');
 const fakeSuccess=createLateSkills({
   bot,navigate:async()=>true,craftNamed:async()=>({verified:true}),
   getEpoch:()=>1,getOwner:()=>'',digest:()=>({inventory:{raw:{}}}),Vec3
 });
 const staticScout=await fakeSuccess.run({kind:'hunt_blazes'},1);
 check(!staticScout.ok&&!staticScout.verified,
   'Navigator true without server-observed movement is NOT verified exploration');
 bot.game.dimension='minecraft:overworld';
 bot.inventory.items=()=>[{name:'ender_eye',count:1}];
 fakeSuccess.session.bearing={x:1,z:0};fakeSuccess.session.eyesThrown=1;
 const staticEye=await fakeSuccess.run({kind:'track_stronghold'},1);
 check(!staticEye.ok&&!staticEye.verified,
   'Stronghold bearing traversal cannot claim progress without real displacement');
 bot.game.dimension='minecraft:the_nether';
 const physicalMove=createLateSkills({
   bot,navigate:async(target)=>{bot.entity.position=target.clone();return true;},
   craftNamed:async()=>({verified:true}),getEpoch:()=>1,getOwner:()=>'',digest:()=>({inventory:{raw:{}}}),Vec3
 });
 const provenScout=await physicalMove.run({kind:'hunt_blazes'},1);
 check(provenScout.ok&&provenScout.verified,
   'Scouting only succeeds after observed navigation arrival and displacement');
 // Opening real stone blocks without physical downward movement is not a
 // completed stronghold route. The owner must never see false path proof.
 const dugStairs=new Map();
 const stairKey=p=>[p.x,p.y,p.z].join(',');
 bot.entity.position=new Vec3(0,64,0);
 bot.game.dimension='minecraft:overworld';
 const deepFrame=new Vec3(4,40,0);
 const stairBlock=p=>{
   const key=stairKey(p);
   if(dugStairs.has(key))return dugStairs.get(key);
   return {name:'stone',boundingBox:'block',position:p.clone()};
 };
 bot.findBlocks=()=>[deepFrame];
 bot.blockAt=stairBlock;
 bot.findBlock=()=>null;
 bot.canDigBlock=()=>true;
 bot.equip=async()=>{};
 bot.lookAt=async()=>{};
 bot.setControlState=()=>{};
 bot.inventory.items=()=>[{name:'diamond_pickaxe',count:1}];
 bot.dig=async block=>dugStairs.set(stairKey(block.position),
    {name:'air',boundingBox:'empty',position:block.position.clone()});
 const stairCheck=createLateSkills({
   bot,navigate:async()=>true,craftNamed:async()=>({verified:true}),
   getEpoch:()=>1,getOwner:()=>'',digest:()=>({inventory:{raw:{}}}),Vec3
 });
 const stationaryStair=await stairCheck.run({kind:'activate_end_portal'},1);
 check(!stationaryStair.ok&&!stationaryStair.verified &&
   /movement not verified/.test(stationaryStair.detail),
   'Digging underground stone does not prove stronghold route without server movement');
 console.log(`LATE_SKILLS_MOCK ${ok}/${ok} PASS (no live Minecraft server)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
