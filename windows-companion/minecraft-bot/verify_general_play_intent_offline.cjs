/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Native owner-language and general play contracts. No live game connection;
// no model download, network, screenshots, or GitHub Actions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {directIntent,canonicalIntent,interpretOwnerInstruction}=require('./language_goal.cjs');
const {modelPrimitiveGrounded}=require('./general_play_intent.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
let count=0;
function ok(value,label){assert.ok(value,label);count++;console.log('PASS',label);}

const examples=[
 ['make three oak doors','craft_item','oak_door',3],
 ['please craft four glass','craft_item','glass',4],
 ['craft four oak planks','craft_item','oak_planks',4],
 ['craft five stone bricks','craft_item','stone_bricks',5],
 ['craft two torches','craft_item','torch',2],
 ['craft two iron pickaxes','craft_item','iron_pickaxe',2],
 ['craft two diamond boots','craft_item','diamond_boots',2],
 ['craft two chests','craft','chest',2],
 ['craft one torch','craft','torch',1],
 ['wear a diamond helmet','equip_item','diamond_helmet'],
 ['wield an iron sword','equip_item','iron_sword'],
 ['inspect block at 10 64 -12','inspect_block'],
 ['dig block 10 64 -12','dig_block'],
 ['interact with block 5 64 3','interact_block'],
 ['place cobblestone above block at 3 64 2','place_block','cobblestone'],
 ['move forward for 500 ms','move'],
 ['go to coordinates 10 64 20','travel'],
 ['defeat the ender dragon','dragon_run'],
 ['beat the ender dragon then get full netherite armor','dragon_then_netherite_run'],
 ['mine six diamonds then craft two chests','sequence'],
 ['gather four logs then craft one chest','sequence'],
 ['gather four logs then craft a chest','sequence']
];
for(const [text,expected,item,quantity] of examples){
 const r=directIntent(text),q=r?.command;
 ok(r?.ok===true && (q?.goal||q?.command)===expected &&
    (item===undefined||q.item===item) &&
    (quantity===undefined||q.count===quantity||q.targetCount===quantity) &&
    validateCommand(q)===null,'owner words: '+text);
}
const seq=directIntent('gather four logs then craft one chest');
ok(seq.ok&&seq.command.steps.length===2&&seq.command.durationSeconds===21600&&
 seq.command.steps[0].goal==='gather'&&seq.command.steps[1].goal==='craft',
 'verifiable bounded long-horizon sequence stages');
for(const text of [
 "don't mine block 1 64 1","craft 99 chests",
 'mine 65 diamonds','what is an iron sword?',
 'mine six diamonds then attack a player',
 'mine six diamonds then craft eight oak doors'
]){
 const r=directIntent(text);
 ok(!r?.ok,'untrusted, ambiguous or unsupported objective cannot dispatch: '+text);
}
for(const q of [
 {command:'craft_item',item:'oak_door',count:3,script:'bad'},
 {command:'craft_item',item:'oak_door',count:100},
 {command:'place_block',item:'stone',reference:{x:1,y:64,z:1},face:{x:0,y:0,z:0}},
 {command:'dig_block',position:{x:1,y:64,z:1},shell:'not allowed'},
 {command:'dig_block',position:{x:1,y:64,z:1,admin:true}},
 {command:'place_block',item:'stone',reference:{x:1,y:64,z:1,hidden:'bad'},
  face:{x:0,y:1,z:0}},
 {command:'auto_goal',goal:'travel',destination:{x:1,y:64,z:1,script:'bad'},
  arrivalRange:2,durationSeconds:300}
])ok(!canonicalIntent(q).ok,'general model parameters retain strict validation');

const scene=JSON.stringify({joined:true,busy:false,position:{x:0,y:64,z:0},
 nearbyBlocks:[{x:1,y:64,z:3,name:'stone'}],
 threats:[{id:40,name:'zombie'}]});
ok(modelPrimitiveGrounded({command:'dig_block',position:{x:1,y:64,z:3}},
 'mine the stone in front of me',scene),'real nearby block may ground primitive');
ok(!modelPrimitiveGrounded({command:'dig_block',position:{x:4,y:64,z:3}},
 'mine the stone in front of me',scene),'model cannot invent block coordinates');
ok(!modelPrimitiveGrounded({command:'craft_item',item:'diamond_sword',count:1},
 'craft a stone sword',scene),'model cannot silently change requested item');
ok(modelPrimitiveGrounded({command:'craft_item',item:'stone_sword',count:1},
 'craft a stone sword',scene),'matching single craft item permitted');
ok(!modelPrimitiveGrounded({command:'interact_entity',entityId:99},
 'interact with the zombie',scene),'entity must be observed');
ok(modelPrimitiveGrounded({command:'interact_entity',entityId:40},
 'interact with the zombie',scene),'observed entity target admitted');
const namedScene=JSON.stringify({joined:true,nearbyBlocks:[
 {name:'chest',x:1,y:64,z:2},{name:'oak_door',x:2,y:64,z:2},
 {name:'stone',x:3,y:64,z:2},{name:'diamond_ore',x:4,y:64,z:2}],
 threats:[{id:10,name:'zombie'},{id:11,name:'cow'}]});
ok(modelPrimitiveGrounded({command:'interact_block',position:{x:1,y:64,z:2}},
 'open the chest',namedScene),'language may open the requested observed chest');
ok(!modelPrimitiveGrounded({command:'interact_block',position:{x:2,y:64,z:2}},
 'open the chest',namedScene),'language may not substitute an adjacent door for chest');
ok(modelPrimitiveGrounded({command:'interact_block',position:{x:2,y:64,z:2}},
 'open the door',namedScene),'language may open the requested observed door');
ok(!modelPrimitiveGrounded({command:'dig_block',position:{x:4,y:64,z:2}},
 'mine stone',namedScene),'language may not dig diamond ore for requested stone');
ok(modelPrimitiveGrounded({command:'dig_block',position:{x:3,y:64,z:2}},
 'mine stone',namedScene),'language may dig actual observed stone');
ok(!modelPrimitiveGrounded({command:'interact_entity',entityId:10},
 'interact with the cow',namedScene),'language may not select a zombie for requested cow');
ok(modelPrimitiveGrounded({command:'interact_entity',entityId:11},
 'interact with the cow',namedScene),'language can select the observed named animal');

const env={JARVIS_MODEL_BACKEND:'ollama',JARVIS_OLLAMA_MODEL:'verified-local-model'};
const respond=(payload)=>async()=>({ok:true,text:async()=>JSON.stringify({
 message:{content:JSON.stringify(payload)}
})});
(async()=>{
 let called=false;
 const question=await interpretOwnerInstruction('How do I craft stone stairs?',{
  env,context:scene,fetchImpl:async()=>{called=true;throw Error('Unexpected model');}
 });
 ok(!question.ok&&!called,'informational request never invokes model to produce a game effect');
 const allowed=await interpretOwnerInstruction('Mine the stone block in front of me',{
  env,context:scene,fetchImpl:respond({command:'dig_block',position:{x:1,y:64,z:3}})
 });
 ok(allowed.ok&&allowed.command.command==='dig_block','model may select real observed target');
 const denied=await interpretOwnerInstruction('Mine the stone block in front of me',{
  env,context:scene,fetchImpl:respond({command:'dig_block',position:{x:9,y:64,z:9}})
 });
 ok(!denied.ok,'model hallucinated coordinate rejected');
 const swapped=await interpretOwnerInstruction('Could you please obtain three diamonds as safely as possible',{
  env,context:scene,fetchImpl:respond({command:'auto_goal',goal:'dragon_run'})
 });
 ok(!swapped.ok,'model cannot substitute an unrelated Dragon goal');
 const resource=await interpretOwnerInstruction('Could you please obtain three diamonds as safely as possible',{
  env,context:scene,fetchImpl:respond({command:'auto_goal',goal:'gather',resource:'diamond',targetCount:3})
 });
 ok(resource.ok&&resource.command.goal==='gather','model goal matching requested resource and quantity admitted');
 const falseFollow=await interpretOwnerInstruction('Could you please obtain three diamonds as safely as possible',{
  env,context:scene,fetchImpl:respond({command:'follow'})
 });
 ok(!falseFollow.ok,'model cannot turn resource request into follow effect');
 const improper=await interpretOwnerInstruction('Could you defeat the Ender Dragon and then obtain complete Netherite armor',{
  env,context:scene,fetchImpl:respond({command:'auto_goal',goal:'netherite_dragon_run'})
 });
 ok(!improper.ok,'model cannot reverse the explicitly requested Dragon/Netherite order');
 const correct=await interpretOwnerInstruction('Could you defeat the Ender Dragon and then obtain complete Netherite armor',{
  env,context:scene,fetchImpl:respond({command:'auto_goal',goal:'dragon_then_netherite_run'})
 });
 ok(correct.ok&&correct.command.goal==='dragon_then_netherite_run','explicitly ordered combined goal still works');
 const truncated=await interpretOwnerInstruction('Could you mine three diamonds, and make a chest',{
  env,context:scene,fetchImpl:respond({command:'auto_goal',goal:'gather',resource:'diamond',targetCount:3})
 });
 ok(!truncated.ok,'model cannot silently omit the second stage of a composed request');
 const unbounded=await interpretOwnerInstruction('Make a stack of torches for me',{
  env,context:scene,fetchImpl:respond({command:'craft_item',item:'torch',count:1})
 });
 ok(!unbounded.ok,'model cannot turn one stack of torches into one torch');
 const realFollow=await interpretOwnerInstruction('Could you follow me around the cave',{
  env,context:scene,fetchImpl:respond({command:'follow'})
 });
 ok(realFollow.ok&&realFollow.command.command==='follow','model owner-matched follow request admitted');

 // Execute the REAL craftNamed function from bot.cjs with Mineflayer-shaped
 // inventory/recipe stubs, without making any packets. This checks the
 // recipe-operation count and independently observed inventory delta.
 const source=fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8');
 const start=source.indexOf('async function craftNamed(');
 const end=source.indexOf('const lateSkills=',start);
 assert.ok(start>=0&&end>start,'craft implementation anchors');
 const inventory={oak_planks:0};
 let perCraft=4,available=true,produce=true;
 const operations=[];
 const bot={
   registry:{itemsByName:{oak_planks:{id:5}}},
   recipesFor:(_type,_meta,min)=>available&&min<=16?[{result:{count:perCraft}}]:[],
   craft:async(_recipe,n)=>{operations.push(n);if(produce)inventory.oak_planks+=n*perCraft;}
 };
 const craftFactory=Function('bot','digest','leader','waitForInventoryIncrease','pause',
   'const actionEpoch=1;'+source.slice(start,end)+'return craftNamed;');
 const craft=craftFactory(bot,()=>({inventory:{raw:{...inventory}}}),'Owner',
   async({before,read})=>({ok:read()>before,after:read()}),async()=>{});
 let r=await craft('oak_planks',3,1);
 ok(r.ok&&operations[0]===1&&inventory.oak_planks===4,
   'three requested planks require one four-output recipe operation');
 perCraft=1;r=await craft('oak_planks',3,1);
 ok(r.ok&&operations[1]===3&&inventory.oak_planks===7,
   'single-output recipes use the necessary number of operations');
 produce=false;r=await craft('oak_planks',2,1);
 ok(!r.ok,'craft dispatch without inventory readback is never success');
 available=false;
 await assert.rejects(craft('oak_planks',2,1),/ingredients or workstation/);
 ok(true,'no available recipe rejects without fabricating materials');
 await assert.rejects(craft('oak_planks',17,1),/quantity/);
 ok(true,'oversized craft request rejected by runtime too');
 console.log('GENERAL_PLAY_OWNER_LANGUAGE '+count+'/'+count+
  ' PASS (offline interpreter/recipe mocks; NOT a live Minecraft test)');
})().catch(error=>{console.error(error);process.exitCode=1;});
