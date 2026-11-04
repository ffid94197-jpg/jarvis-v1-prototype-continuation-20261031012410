/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Modeled observation and tool-tier contract only. Does not connect to a world.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
let count=0;
function pass(condition,label){assert.ok(condition,label);count++;console.log('PASS',label);}
const source=fs.readFileSync(path.join(__dirname,'minecraft_ai_observation.cjs'),'utf8');
const moduleMock={exports:{}};
// This test isolates sampling policy. Actual geometry is separately checked
// by mining_navigation and runtime route/stance verification.
vm.runInNewContext(source,{module:moduleMock,exports:moduleMock.exports,require:name=>{
 assert.equal(name,'./mining_navigation.cjs');
 return {diggableObserved:()=>true,isExposed:()=>true,
  stances:()=>[{}],MINABLE_STONE:new Set(['stone','cobblestone','deepslate','cobbled_deepslate'])};
}});
const {loadedTargets}=moduleMock.exports;
const blocks=[
 ...Array.from({length:10},(_,i)=>({name:'stone',x:i,y:64,z:0})),
 ...Array.from({length:10},(_,i)=>({name:'dirt',x:1,y:64,z:i+1})),
 {name:'diamond_ore',x:6,y:64,z:2},{name:'gold_ore',x:7,y:64,z:2},
 {name:'coal_ore',x:6,y:64,z:3},{name:'crafting_table',x:2,y:64,z:3},
 {name:'chest',x:3,y:64,z:4},{name:'oak_door',x:4,y:64,z:4},
 {name:'oak_log',x:3,y:64,z:2},{name:'oak_planks',x:4,y:64,z:2}
];
const bot={
 entity:{position:{x:0,y:64,z:0}},
 findBlocks:({matching,count})=>blocks.filter(matching).slice(0,count).map(({x,y,z})=>({x,y,z})),
 blockAt:p=>blocks.find(x=>x.x===p.x&&x.y===p.y&&x.z===p.z)||
   {name:'air',boundingBox:'empty'}
};
const baseline=loadedTargets(bot),expanded=loadedTargets(bot,{includeGeneral:true});
pass(baseline.length<=12 && baseline.every(x=>x.name!=='dirt'),
 'ordinary targets remain opt-in; default sampling contract preserved');
pass(expanded.length<=12 && expanded.some(x=>x.name==='dirt'),
 'general-purpose observations show visible dirt');
pass(expanded.some(x=>x.name==='diamond_ore') && expanded.some(x=>x.name==='gold_ore'),
 'ore candidates do not disappear behind abundant ordinary blocks');
pass(expanded.some(x=>x.name==='chest') && expanded.some(x=>x.name==='oak_door'),
 'observed chest and door targets survive bounded sampling');
pass(expanded.filter(x=>x.name==='dirt').length<=4,
 'general block sampling is explicitly capped');
pass(new Set(expanded.map(x=>[x.x,x.y,x.z].join(','))).size===expanded.length,
 'no duplicate game coordinates');
pass(expanded.every(x=>Math.max(Math.abs(x.x),Math.abs(x.z))<=14),
 'general target sampling does not exceed loaded-range guard');

const botSource=fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8');
const begin=botSource.indexOf('const inventoryItems=bot.inventory.items();');
const end=botSource.indexOf("if(!alive())throw Error('Dig cancelled');",begin);
pass(begin>=0 && end>begin,'real Mineflayer harvesting tool selector exists');
const selector=botSource.slice(begin,end);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const selectTool=new AsyncFunction('blockName','names',
 'const live={name:blockName};let equipped=null;'+
 'const bot={inventory:{items:()=>names.map(name=>({name}))},equip:async item=>{equipped=item.name}};'+
 selector+'return equipped;');
(async()=>{
 for(const [block,owned,expected]of [
  ['dirt',[],null],['oak_log',['stone_axe'],'stone_axe'],
  ['sand',['iron_shovel'],'iron_shovel'],
  ['diamond_ore',['iron_pickaxe'],'iron_pickaxe'],
  ['iron_ore',['stone_pickaxe'],'stone_pickaxe'],
  ['obsidian',['iron_pickaxe','diamond_pickaxe'],'diamond_pickaxe'],
  ['ancient_debris',['netherite_pickaxe'],'netherite_pickaxe'],
  ['netherrack',[],null]
 ]){
  const got=await selectTool(block,owned);
  pass(got===expected,block+' correct tool or permitted hand mining');
 }
 for(const [block,owned]of [
  ['obsidian',['iron_pickaxe']],['ancient_debris',['iron_pickaxe']],
  ['diamond_ore',['stone_pickaxe']],['iron_ore',['wooden_pickaxe']]
 ]){
  await assert.rejects(selectTool(block,owned),/Appropriate mining tool tier unavailable/);
  pass(true,block+' rejects inadequate pickaxe tier');
 }
 console.log('MINECRAFT_GENERAL_OBSERVATION '+count+'/'+count+
  ' PASS (mock world / production selector; NOT live Java gameplay)');
})().catch(err=>{console.error(err);process.exitCode=1;});
