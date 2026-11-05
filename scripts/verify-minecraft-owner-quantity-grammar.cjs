'use strict';
// Targeted build-regression contract for future local verification.
// This file does not invoke Minecraft, GitHub Actions, or any external model.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,dependencies={}) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const result=ts.transpileModule(source,{
    reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  });
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,file+' TypeScript parser diagnostics');
  const module={exports:{}};
  vm.runInNewContext(result.outputText,{
    module,exports:module.exports,
    require(name){
      if(Object.hasOwn(dependencies,name))return dependencies[name];
      throw Error('Unexpected module in standalone quantity contract: '+name);
    },
    console,process
  },{filename:file,timeout:4000});
  return module.exports;
}
const intent=load('src/lib/agent/core/minecraftIntent.ts');
const gate=load('src/lib/agent/core/minecraftAiGate.ts',{'./minecraftIntent':intent});
const {directResourceGatherFromObjective:direct,minecraftMissionFromObjective,
       directMinecraftMission,parseMinecraftCount}=intent;
const {singleInventoryResourceGoal,mayStartNativeMinecraftGoal,cobblestoneGoalQuantity}=gate;
const pairs=[
  ['Jarvis, gather 16 cobblestone in Minecraft','cobblestone',16],
  ['Hey Jarvis, in Minecraft collect twenty-one diamonds','diamond',21],
  ['Please get three iron ingots inside Minecraft','iron_ingot',3],
  ['Minecraft, please fetch a diamond','diamond',1],
  ['Can you please bring me sixty four sticks in Minecraft?','sticks',64],
  ['I want you to obtain thirty-two pieces of obsidian in Minecraft','obsidian',32],
  ['Jarvis, mine twenty five raw iron in Minecraft','raw_iron',25],
  ['Inside Minecraft, collect forty flint','flint',40]
];
let checks=0;
for(const [phrase,resource,count] of pairs){
  assert.equal(JSON.stringify(direct(phrase)),JSON.stringify({resource,targetCount:count}),phrase);
  assert.equal(minecraftMissionFromObjective(phrase),'gather',phrase);
  const first=directMinecraftMission(phrase,0),second=directMinecraftMission(phrase,1);
  assert.equal(first?.tool,'minecraft_companion_join',phrase);
  assert.equal(second?.tool,'minecraft_companion_command',phrase);
  assert.equal(second?.args?.goal,'gather',phrase);
  assert.equal(second?.args?.resource,resource,phrase);
  assert.equal(second?.args?.targetCount,count,phrase);
  checks+=7;
}
for(const phrase of [
  'Collect 65 diamonds in Minecraft',
  'Gather one hundred diamonds in Minecraft',
  'Gather plenty of diamonds in Minecraft',
  'Collect three diamonds then craft a sword in Minecraft',
  'Get five diamonds and four iron ingots in Minecraft',
  "Jarvis, don't mine five diamonds in Minecraft",
  'Collect four diamonds', // Minecraft scope required for direct effect
  'Tell me how to gather ten diamonds in Minecraft',
  'Get 4 diamonds for my friend in Minecraft',
  'Bring me sixty five diamonds in Minecraft',
  'Minecraft, mine 0 obsidian',
  'Minecraft, mine 999 cobblestone'
]){
  assert.equal(direct(phrase),null,phrase);
  checks++;
}
for(const [count,want] of [
 ['one',1],['twenty',20],['twenty-one',21],
 ['thirty two',32],['forty',40],['sixty four',64],
 ['64',64],['65',null],['one hundred',null],['seventy',null],
 ['-1',null],['NaN',null]
]){
 assert.equal(parseMinecraftCount(count),want,count);
 checks++;
}
const observed={
  joined:true,busy:false,position:{x:0,y:64,z:0},health:20,hunger:20,
  inventory:{logs:0,raw:{diamond:0}},nearbyBlocks:[]
};
const proposed=(targetCount)=>({
  command:'auto_goal',goal:'gather',resource:'diamond',
  targetCount,durationSeconds:3600
});
for(const [phrase,count] of [
  ['Get twenty one diamonds in Minecraft',21],
  ['Mine 17 diamonds in Minecraft',17],
  ['Gather sixty-four diamonds in Minecraft',64]
]){
  assert.equal(singleInventoryResourceGoal(phrase)?.quantity,count,phrase);
  assert.equal(mayStartNativeMinecraftGoal(phrase,proposed(count),observed),true,phrase);
  assert.equal(mayStartNativeMinecraftGoal(phrase,proposed(1),observed),count===1,phrase);
  checks+=3;
}
for(const phrase of [
  'Get 70 diamonds in Minecraft',
  'Mine one hundred diamonds in Minecraft',
  'Get seventeen diamonds and craft a sword in Minecraft'
]){
  assert.equal(mayStartNativeMinecraftGoal(phrase,proposed(1),observed),false,phrase);
  checks++;
}
assert.equal(cobblestoneGoalQuantity('Mine fifty-two cobblestone in Minecraft'),52);checks++;
console.log('Minecraft owner quantity / Guardian AI proposal contract: '+checks+' checks PASS');
