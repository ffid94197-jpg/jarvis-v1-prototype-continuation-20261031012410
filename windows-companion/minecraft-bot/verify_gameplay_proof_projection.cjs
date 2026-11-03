#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'minecraft_ai_observation.cjs'),'utf8');
const moduleRef={exports:{}};
vm.runInNewContext(source,{module:moduleRef,exports:moduleRef.exports,
  require:()=>({MINABLE_STONE:new Set(),diggableObserved:()=>false})});
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
const snapshot=JSON.parse(projectWorld({...base,inventory:{raw:many}},Array.from({length:30},(_,i)=>({name:'stone',x:i,y:64,z:0})),'last','stay'));
assert.equal(snapshot.heldNetheriteSword,true);n++;
assert.equal(snapshot.wornNetherite,true);n++;
assert.ok(JSON.stringify(snapshot).length<1900);n++;
console.log('MINECRAFT_FINAL_EQUIPMENT_PROJECTION '+n+'/'+n+' PASS (mock world, no Java server)');
