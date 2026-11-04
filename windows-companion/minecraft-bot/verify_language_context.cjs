#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {buildLanguageContext,safePosition}=require('./language_context.cjs');
const raw={oak_log:4,oak_planks:12,stick:6,coal:3,stone_pickaxe:1};
const world={
 dimension:'minecraft:overworld',position:{x:12.25,y:64,z:-8.5},
 health:17,hunger:13,ownerVisible:true,ownerDistance:5,
 inventory:{raw},equipped:{hand:'stone_pickaxe',head:'iron_helmet'},
 threats:[{name:'zombie',distance:3},{name:'creeper',distance:8}],
 workbenchNearby:true,furnaceNearby:false,smithingTableNearby:false,
 netherPortalNearby:false,endPortalPresent:false,endPortalActivated:false,exitPortalPresent:false
};
const mission={goal:'stone_age',status:'running',steps:12,resource:'cobblestone',targetCount:8};
const context=buildLanguageContext(world,{gameMode:'survival',mission,lastAction:'Gathered stone'});
const parsed=JSON.parse(context);
assert.equal(parsed.gameMode,'survival');
assert.equal(parsed.dimension,'minecraft:overworld');
assert.deepEqual(parsed.position,{x:12.3,y:64,z:-8.5});
assert.equal(parsed.inventory.coal,3);
assert.equal(parsed.equipped.hand,'stone_pickaxe');
assert.equal(parsed.nearbyThreats.length,2);
assert.equal(parsed.activeMission.goal,'stone_age');
assert.equal(parsed.activeMission.targetCount,8);
assert.equal(parsed.workstations.craftingTable,true);
assert.ok(context.length<=4000,'context must remain bounded');
assert.equal(safePosition({x:1,y:2,z:Infinity}),null,'invalid coordinates denied');
assert.equal(safePosition({x:30000001,y:2,z:3}),null,'out-of-world coordinates denied');
const huge={...world,inventory:{raw:Object.fromEntries(Array.from({length:500},(_,i)=>['item_'+i,64]))}};
const bounded=buildLanguageContext(huge,{gameMode:'survival',mission,lastAction:'x'.repeat(5000)});
assert.ok(bounded.length<=4000,'large inventory and status cannot overflow model context');
assert.doesNotThrow(()=>JSON.parse(bounded),'bounded fallback must remain valid JSON');
console.log('MINECRAFT_LANGUAGE_CONTEXT 14/14 PASS (bounded observed context; no live LLM/game)');
