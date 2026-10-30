'use strict';
const assert=require('node:assert/strict');
const {GroundedMcpMission,observedWorld,checkedOutcome}=require('./mine_ai_mcp_mission.cjs');
const inv={};let position={x:0,y:64,z:0};let lastTools=[];
function status(){return {status:'succeeded',situation:{botId:'JarvisBuddy',observedAt:new Date().toISOString(),dimension:'minecraft:overworld',position,vitals:{health:20,food:20},endFight:{dragons:[],crystals:[]},inventory:{stacks:Object.entries(inv).filter(([,c])=>c>0).map(([name,count])=>({name,count,location:'main'}))},nearby:{players:[{username:'aslam0704',position:{x:1,y:64,z:0},distance:1}]}}};}
function take(name,count){assert.ok((inv[name]||0)>=count,'Missing '+name+' x'+count);inv[name]-=count;}
function give(name,count){inv[name]=(inv[name]||0)+count;}
const client={tools:new Map(['view_status','collect_block','craft_item','explore_frontier'].map(k=>[k,{}])),observe:async()=>status(),action:async(name,args)=>{
 lastTools.push(name);
 if(name==='collect_block'){
  if(args.block_name==='oak_log')give('oak_log',1);
  else if(args.block_name==='stone')give('cobblestone',3);
  else return {state:'settled',output:{result:{status:'failed',error:'No natural target in loaded chunks'}}};
 }else if(name==='craft_item'){
  const item=args.items[0].item_name;
  if(item==='oak_planks'){take('oak_log',1);give(item,4);}
  else if(item==='stick'){take('oak_planks',2);give(item,4);}
  else if(item==='crafting_table'){take('oak_planks',4);give(item,1);}
  else if(item==='wooden_pickaxe'){take('oak_planks',3);take('stick',2);give(item,1);}
  else if(item==='stone_pickaxe'){take('cobblestone',3);take('stick',2);give(item,1);}
  else if(item==='stone_sword'){take('cobblestone',2);take('stick',1);give(item,1);}
  else throw Error('Undeveloped fake action is not an accepted test '+item);
 }else if(name==='explore_frontier')position={...position,x:position.x+16};
 return {state:'settled',output:{result:{status:'succeeded'}}};
 }};
(async()=>{
 const c=new GroundedMcpMission(client,{clock:()=>Date.now()});c.start('netherite_dragon_run',600);
 let verified=0;let steps=[];
 for(let j=0;j<21;j++){
  const result=await c.step();steps.push(result.decision.kind);
  if(result.verified)verified++;
  if(['blocked','paused','complete'].includes(result.status.status))break;
 }
 assert.ok(verified>=7,'At least seven observed game actions expected');
 assert.ok((inv.wooden_pickaxe||0)>0,'Real recipe stage wooden pickaxe');
 assert.ok((inv.stone_pickaxe||0)>0,'Real recipe stage stone pickaxe');
 assert.notEqual(c.status().status,'complete');
 console.log('PASS single-instruction MCP gameplay dispatch -> '+verified+' observed physical deltas, no fake win');
 const v=observedWorld(status().situation);assert.equal(v.wornNetherite,false);
 assert.equal(checkedOutcome(status().situation,status().situation,{state:'settled',output:{result:{status:'succeeded'}}},{kind:'craft_sticks'}).verified,false);
 console.log('PASS successful receipt without item delta cannot prove action');
 const fakeArmor=status().situation;fakeArmor.inventory.stacks.push(...['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots'].map(name=>({name,count:1,location:'main'})));
 assert.equal(observedWorld(fakeArmor).wornNetherite,false);
 fakeArmor.inventory.stacks=fakeArmor.inventory.stacks.map(x=>x.name==='netherite_helmet'?{...x,location:'head'}:x.name==='netherite_chestplate'?{...x,location:'torso'}:x.name==='netherite_leggings'?{...x,location:'legs'}:x.name==='netherite_boots'?{...x,location:'feet'}:x);
 assert.equal(observedWorld(fakeArmor).wornNetherite,true);
 console.log('PASS only worn armor slots count as equipped');
 assert.equal(observedWorld(fakeArmor).dragonDeadObserved,false);
 console.log('PASS absent dragon entity is never mistaken for death event');
 console.log('MINE_AI_MCP_MISSION_GROUNDED 4 PASS (mocked game state, NOT real Minecraft)');
})().catch(e=>{console.error(e);process.exitCode=1});
