/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Tests the unchanged source of the TypeScript Core AI interaction guard via
// an isolated JavaScript expression: NOT a TypeScript build or live gameplay.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../src/lib/agent/core/minecraftAiGate.ts');
const source=fs.readFileSync(file,'utf8');
const begin=source.indexOf("    if(command==='interact_block'){");
const end=source.indexOf("    if(command==='dig_block') {",begin);
assert.ok(begin>=0 && end>begin,'exact Core interact-block guard found');
let checks=1;
const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label);};
check(source.includes("'place_block','interact_block','stay'"),
 'interact_block is a controlled effect and invalidates stale observations');
check(source.includes("['navigate','dig_block','place_block','interact_block']"),
 'interact_block needs an explicit block target');
const guarded=Function('args','target','point',
 source.slice(begin,end)+"return {ok:true,reason:'Isolated guard passed'};");
const point=value=>value && typeof value==='object' &&
 ['x','y','z'].every(k=>Number.isFinite(value[k]));
const position={x:2,y:64,z:2};
const scene={nearbyBlocks:[
 {name:'chest',...position},{name:'oak_door',x:3,y:64,z:2},
 {name:'diamond_ore',x:1,y:64,z:2}
]};
const decide=(objective,where=position,extra={},observed=scene)=>
 guarded.call({objective,observed},{command:'interact_block',position:where,...extra},where,point);
check(decide('Open the Minecraft chest').ok===true,
 'explicit chest-opening objective admits exact observed chest');
check(decide('Open the Minecraft door',{x:3,y:64,z:2}).ok===true,
 'explicit door objective admits exact observed door');
check(decide('Mine the Minecraft stone').ok===false,
 'a mining request does not authorize unrelated block interaction');
check(decide('Open the Minecraft chest',{x:99,y:64,z:99}).ok===false,
 'an unobserved coordinate never becomes an interaction');
check(decide('Open the Minecraft chest',{x:1,y:64,z:2}).ok===false,
 'noninteractive ore may not be activated by the model');
check(decide('Open the Minecraft chest',position,{shell:'cmd'}).ok===false,
 'unexpected action parameters are rejected');
check(decide('Open the Minecraft chest',position,{}, {nearbyBlocks:[]}).ok===false,
 'stale or missing observed target is not admitted');
check(decide('Open the Minecraft chest',{...position,meta:true}).ok===true===false,
 'invalid metadata coordinate must be denied by companion exact-schema validator');
// The isolated guard itself is not the full Core: the actual wire validator
// rejects extra position keys at the Mineflayer boundary. This assertion
// only checks that no fabricated full-game completion is inferred here.
console.log('MINECRAFT_CORE_OBSERVED_INTERACT '+checks+'/'+checks+
 ' PASS (isolated Core source guard, no game/client, full TypeScript gate not compiled)');
