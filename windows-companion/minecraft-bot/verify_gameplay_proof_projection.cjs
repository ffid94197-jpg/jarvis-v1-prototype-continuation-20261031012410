#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'minecraft_ai_observation.cjs'),'utf8');
const moduleRef={exports:{}};
vm.runInNewContext(source,{module:moduleRef,exports:moduleRef.exports,
  require:()=>({MINABLE_STONE:new Set(['stone','cobblestone']),
    diggableObserved:()=>true,isExposed:(_bot,p)=>p.x%2===0,
    stances:()=>[{x:0,y:64,z:0}]})});
const projectWorld=moduleRef.exports.projectWorld;let n=0;
const test=(world,expected)=>{
 const snap=JSON.parse(projectWorld(world,[],'','stay'));
 assert.equal(snap.heldNetheriteSword,expected.held);
 assert.equal(snap.wornNetherite,expected.worn);
 assert.equal(snap.dragonDeadObserved,expected.dragon);
 assert.equal(snap.joined,true);
 n+=4;
};
const base={joined:true,position:{x:2,y:64,z:4},dimension:'minecraft:overworld',
 health:20,hunger:20,inventory:{logs:0,woodenPickaxe:0,raw:{}},
 wornNetherite:true,heldNetheriteSword:true,dragonDeadObserved:true};
test(base,{worn:true,held:true,dragon:true});
test({...base,heldNetheriteSword:false},{worn:true,held:false,dragon:true});
test({...base,wornNetherite:false},{worn:false,held:true,dragon:true});
test({...base,dragonDeadObserved:false},{worn:true,held:true,dragon:false});
const many=Object.fromEntries(Array.from({length:50},(_,i)=>['item_'+i,64]));
many.cobblestone=6;many.diamond=2;
const snapshot=JSON.parse(projectWorld({...base,inventory:{raw:many}},Array.from({length:30},(_,i)=>({name:'stone',x:i,y:64,z:0})),'last','stay'));
assert.equal(snapshot.heldNetheriteSword,true);n++;
assert.equal(snapshot.wornNetherite,true);n++;
assert.ok(JSON.stringify(snapshot).length<1900);n++;
assert.equal(snapshot.inventory.raw.cobblestone,6);n++;
assert.equal(snapshot.inventory.raw.diamond,2);n++;
const {nativeItemForMission}=moduleRef.exports;
const activeCrop={goal:'farm_crop',crop:'beetroot'};
assert.equal(nativeItemForMission(activeCrop),'beetroot','Native beetroot output is retained');n++;
const sequence={goal:'sequence',sequenceIndex:1,sequence:[
 {goal:'gather',resource:'diamond',targetCount:1},
 {goal:'farm_crop',crop:'beetroot',position:{x:2,y:64,z:4},width:2,depth:1,targetCount:2}
]};
assert.equal(nativeItemForMission(sequence),'beetroot','Active sequence crop chosen');n++;
const completed={...sequence,sequenceIndex:2};
assert.equal(nativeItemForMission(completed),'beetroot','Last stage output remains visible at completion');n++;
assert.equal(nativeItemForMission({...sequence,sequenceIndex:0}),'diamond','Stage progression switches target');n++;
assert.equal(nativeItemForMission({goal:'gather',resource:'sticks'}),'stick','Normalized stick item ID');n++;
assert.equal(nativeItemForMission({goal:'gather',resource:'logs'}),'log','Wood log group prioritization');n++;
assert.equal(nativeItemForMission({goal:'gather',resource:'planks'}),'planks','Plank group prioritization');n++;
const full=Object.fromEntries(Array.from({length:40},(_,i)=>['unrelated_'+i,64]));
full.stick=12;full.oak_planks=20;full.spruce_planks=8;full.birch_log=4;
for(const [goal,target,required] of [['sticks','stick',12],['planks','oak_planks',20],['logs','birch_log',4]]){
 const actual=JSON.parse(projectWorld({...base,inventory:{raw:full}},[], '', 'stay','gather',nativeItemForMission({goal:'gather',resource:goal})));
 assert.equal(actual.inventory.raw[target],required,'Native gather target cannot be lost to unrelated stacks');n++;
}
const overloaded=Object.fromEntries(Array.from({length:45},(_,i)=>['random_'+i,64]));
overloaded.beetroot=3;
const projected=JSON.parse(projectWorld({...base,inventory:{raw:overloaded}},[],
 '','stay','sequence',nativeItemForMission(sequence)));
assert.equal(projected.inventory.raw.beetroot,3,'Native target survives compact inventory truncation');n++;
const newFish={...base,inventory:{...base.inventory,
 raw:{cod:1,salmon:2,tropical_fish:1,pufferfish:1}}};
const observedFish=JSON.parse(projectWorld(newFish,[],'','stay'));
const foodGone=JSON.parse(projectWorld({...base,inventory:{raw:{}}},[], '', 'stay',null,'wheat'));
assert.equal(foodGone.inventory.raw.wheat,0,'Consumed final food stack must report explicit zero');n++;
const foodRemaining=JSON.parse(projectWorld({...base,inventory:{raw:{wheat:9}}},[], '', 'stay',null,'wheat'));
assert.equal(foodRemaining.inventory.raw.wheat,9,'Trusted feed item count remains exact');n++;
assert.equal(observedFish.inventory.raw.cod,1,'Fresh cod must remain in compact physical inventory');n++;
assert.equal(observedFish.inventory.raw.pufferfish,1,'Fresh pufferfish must remain in compact physical inventory');n++;
const observedBed=JSON.parse(projectWorld({...base,sleeping:true,daylight:false},[],'','stay'));
assert.equal(observedBed.sleeping,true,'Real sleeping flag survives projection');n++;
assert.equal(observedBed.daylight,false,'A bed does not imply sunrise');n++;
const {loadedTargets}=moduleRef.exports;
const targets=loadedTargets({
 entity:{position:{x:0,y:64,z:0}},
 findBlocks:()=>[{x:1,y:63,z:0},{x:2,y:63,z:0},{x:4,y:63,z:0}],
 blockAt:p=>({name:p.x===4?'furnace':'diamond_ore'})
});
assert.ok(!targets.some(x=>x.x===1),'Buried ore must not be presented as an accessible target');n++;
assert.ok(targets.some(x=>x.x===2),'Exposed ore should remain available');n++;
assert.ok(targets.some(x=>x.x===4),'Known workstation should remain visible');n++;
console.log('MINECRAFT_FINAL_EQUIPMENT_PROJECTION '+n+'/'+n+' PASS (mock world, no Java server)');
