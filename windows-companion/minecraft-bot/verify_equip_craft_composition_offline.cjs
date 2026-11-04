'use strict';
// Real JARVIS goal/recipe/controller code, modeled Minecraft registry only.
const assert=require('node:assert/strict');
const {compileRecipeCatalog}=require('./mindcraft_recipe_graph.cjs');
const {generalPlan,validEquipSpec}=require('./general_goal.cjs');
const {createController}=require('./autonomy_engine.cjs');
const {validStep}=require('./mission_sequence.cjs');
let checks=0;
const ok=(cond,label)=>{assert.ok(cond,label);checks++;console.log('PASS '+label);};
const id={iron_ingot:1,stick:2,iron_pickaxe:3};
const items=Object.fromEntries(Object.entries(id).map(([name,itemId])=>[itemId,{id:itemId,name}]));
const registry={items,itemsByName:Object.fromEntries(Object.entries(id).map(([name,itemId])=>[name,{id:itemId}])),
 recipes:{3:[{inShape:[[{id:1},{id:1},{id:1}],[null,{id:2},null],[null,{id:2},null]],
 result:{id:3,count:1}}]}};
const recipeCatalog=compileRecipeCatalog({registry},'iron_pickaxe');
const spec={goal:'equip',item:'iron_pickaxe',destination:'hand'};
const world=(raw={},equipped={hand:null},workbenchNearby=true)=>({
 joined:true,health:20,hunger:20,inventory:{raw},equipped,
 workbenchNearby,recipeCatalog
});
ok(validEquipSpec(spec),'owner equipment goal passes existing restricted item/slot rules');
ok(validStep(spec),'equipment goal can form part of an authorized multi-step mission');
ok(recipeCatalog?.nodes?.iron_pickaxe?.length===1,
 'native Minecraft-version recipe is recognized for requested gear');
const ready=generalPlan(world({iron_ingot:3,stick:2}),spec);
ok(ready.kind==='craft_general'&&ready.item==='iron_pickaxe'&&ready.requiresTable,
 'one equipment objective automatically plans missing gear crafting');
let requested=null;
const missing=generalPlan(world({stick:2}),spec,(goal,args)=>{
 requested={goal,args};return {kind:'mine_iron',why:'Existing approved mining progression'};
});
ok(missing.kind==='mine_iron'&&requested?.goal==='gather'&&
 requested.args.resource==='iron_ingot'&&requested.args.targetCount===3,
 'missing ingots are delegated to existing authorized resource progression');
const noAcquisition=generalPlan(world({stick:2}),spec,()=>({kind:'complete'}));
ok(noAcquisition.kind==='blocked',
 'subgoal declaring completed without inventory cannot bypass crafting proof');
const noTable=generalPlan(world({iron_ingot:3,stick:2},{hand:null},false),spec);
ok(noTable.kind!=='equip_general'&&noTable.kind!=='complete',
 'missing workstation must be supplied before crafting, not imagined');
const owned=generalPlan(world({iron_pickaxe:1}),spec);
ok(owned.kind==='equip_general'&&owned.item==='iron_pickaxe',
 'already owned gear is equipped directly without repeated crafting');
const worn=generalPlan(world({iron_pickaxe:1},{hand:'iron_pickaxe'}),spec);
ok(worn.kind==='complete','only actual equipment slot can prove equip completion');
const unknown=generalPlan({...world({}),recipeCatalog:null},spec);
ok(unknown.kind==='blocked','unavailable server recipe cannot make up gear');
const wrongCatalog=generalPlan({...world({}),recipeCatalog:{root:'diamond_pickaxe',nodes:{}}},spec);
ok(wrongCatalog.kind==='blocked','unrelated recipe registry cannot authorize craft');
const unsupported=generalPlan(world({}),{goal:'equip',item:'command_block',destination:'hand'});
ok(unsupported.kind==='blocked','arbitrary or privileged equipment not authorized');
const controller=createController({clock:()=>300000,maxSeconds:3600,maxSteps:30});
controller.start('equip',3600,{item:'iron_pickaxe',destination:'hand'});
let step=controller.next(world({iron_ingot:3,stick:2}));
ok(step.kind==='craft_general'&&step.item==='iron_pickaxe',
 'production autonomous controller composes crafting into owner equip request');
controller.record(step,{ok:true,verified:true,detail:'Observed crafting receipt'});
step=controller.next(world({iron_pickaxe:1}));
ok(step.kind==='equip_general',
 'after real inventory observation, controller advances to equipping');
controller.record(step,{ok:true,verified:true,detail:'Observed equip receipt'});
step=controller.next(world({iron_pickaxe:1},{hand:'iron_pickaxe'}));
ok(step.kind==='complete'&&controller.status().status==='complete',
 'full owner objective completes only after actual equipped slot observation');
const another=createController({clock:()=>300000,maxSeconds:3600,maxSteps:30});
another.start('equip',3600,{item:'iron_pickaxe',destination:'hand'});
step=another.next(world({iron_ingot:3,stick:2}));
another.record(step,{ok:false,verified:false,detail:'Craft dispatched but no item'});
ok(another.next(world({iron_ingot:3,stick:2})).kind==='craft_general'&&
 another.status().status==='running',
 'failed craft never grants false ownership or equip success');
console.log('MINECRAFT_EQUIP_CRAFT_COMPOSITION '+checks+'/'+checks+
 ' PASS (source-level synthetic inventory, not live Minecraft Java)');
