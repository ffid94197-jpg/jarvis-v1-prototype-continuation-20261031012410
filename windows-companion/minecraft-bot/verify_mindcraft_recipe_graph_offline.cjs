'use strict';
// Real JARVIS source, modeled server recipe data. No Minecraft process.
const assert=require('node:assert/strict');
const {compileRecipeCatalog,normalizeRecipe,planRecipeStep,MAX_NODES}=require('./mindcraft_recipe_graph.cjs');
const {validCraftSpec,generalPlan}=require('./general_goal.cjs');
const {directIntent}=require('./language_goal.cjs');
let checks=0;
function ok(condition,label){assert.ok(condition,label);checks++;console.log('PASS',label)}
const ids={oak_log:1,oak_planks:2,stick:3,crafting_table:4,
 chest:5,oak_door:6,stone:7,stone_bricks:8,iron_ingot:9,
 iron_pickaxe:10,diamond_sword:11,diamond:12};
const items=Object.fromEntries(Object.entries(ids).map(([name,id])=>[id,{name,id}]));
const shaped=(shape,id,count=1)=>({inShape:shape,result:{id,count}});
const recipeMap={
 [ids.oak_planks]:[{ingredients:[{id:ids.oak_log,count:1}],
   result:{id:ids.oak_planks,count:4}}],
 [ids.stick]:[{ingredients:[{id:ids.oak_planks,count:2}],
   result:{id:ids.stick,count:4}}],
 [ids.crafting_table]:[shaped([[2,2],[2,2]],4)],
 [ids.chest]:[shaped([[2,2,2],[2,null,2],[2,2,2]],5)],
 [ids.oak_door]:[shaped([[2,2],[2,2],[2,2]],6,3)],
 [ids.stone_bricks]:[shaped([[7,7],[7,7]],8,4)],
 [ids.iron_pickaxe]:[shaped([[9,9,9],[null,3,null],[null,3,null]],10)],
 [ids.diamond_sword]:[shaped([[12],[12],[3]],11)]
};
const bot={registry:{recipes:recipeMap,items,
 itemsByName:Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,{name,id}]))}};
const catalog=name=>compileRecipeCatalog(bot,name);
const step=(name,target,raw={},options={workbenchNearby:true})=>
 planRecipeStep(catalog(name),raw,name,target,options);
ok(validCraftSpec({goal:'craft',item:'oak_door',targetCount:3}),
 'validated arbitrary registry-name craft goal can enter core');
ok(!validCraftSpec({goal:'craft',item:'minecraft:command_block',targetCount:1}),
 'unsafe noncanonical item ID denied');
ok(!validCraftSpec({goal:'craft',item:'chest',targetCount:100}),
 'recipe quantity stays capped');
ok(!!catalog('oak_door')?.nodes?.oak_planks?.length,
 'recursive Mindcraft ingredient nodes include intermediate oak planks');
ok(catalog('oak_door')?.root==='oak_door'&&
 Object.keys(catalog('oak_door').nodes).length<=MAX_NODES,
 'recipe graph is bounded to the exact named target');
ok(catalog('unknown_item')===null,'unknown registry item never becomes available');
ok(step('oak_door',3,{oak_planks:6}).kind==='craft_general',
 'a fully stocked chest-table recipe is immediately craftable');
ok(step('oak_door',3,{oak_planks:6}).requiresTable===true,
 'three-row door requires a real crafting table');
let r=step('oak_door',3,{oak_planks:6},{workbenchNearby:false,planks:6});
ok(r.kind==='craft_table','missing workstation is acquired before three-row craft');
r=step('oak_door',3,{oak_log:2});
ok(r.kind==='craft_general'&&r.item==='oak_planks'&&r.requiresTable===false,
 'recursive subgoal selects inventory-backed two-by-two planks first');
r=step('oak_door',3,{oak_log:0});
ok(r.kind==='collect_wood','missing real source yields approved wood acquisition');
r=step('oak_door',3,{oak_door:3});
ok(r.kind==='complete','full requested item count alone proves completion');
r=step('oak_door',3,{oak_door:2,oak_planks:6});
ok(r.kind==='craft_general'&&r.item==='oak_door',
 'two owned doors do not silently satisfy request for three');
r=step('stick',2,{oak_planks:2},{workbenchNearby:false,planks:2});
ok(r.kind==='craft_general'&&!r.requiresTable,
 'inventory 2x2 recipe executes without demanding a crafting table');
r=step('stone_bricks',4,{stone:4},{workbenchNearby:false});
ok(r.kind==='craft_general'&&!r.requiresTable,
 'four-cell stone bricks use 2x2 no-workstation recipe');
r=step('diamond_sword',1,{stick:1},{workbenchNearby:true});
ok(r.kind==='blocked','unavailable mined diamond source is blocked not fabricated');
ok(step('oak_door',17,{oak_planks:64}).kind==='blocked',
 'runtime refuses out-of-bounds requested target count');
ok(normalizeRecipe(bot.registry,{ingredients:[{id:9999999,count:1}],
 result:{id:6,count:1}})===null,
 'unknown recipe ingredient ID rejected');
ok(normalizeRecipe(bot.registry,{ingredients:[{id:2,count:100}],
 result:{id:6,count:1}})===null,
 'unbounded recipe ingredient quantity rejected');
ok(normalizeRecipe(bot.registry,{ingredients:[{id:2,count:1}],
 result:{id:6,count:0}})===null,
 'zero-output recipe rejected');
const unregistered=generalPlan({inventory:{raw:{}},recipeCatalog:null},
 {goal:'craft',item:'oak_door',targetCount:3});
ok(unregistered.kind==='blocked','absent version registry blocks rather than guessing recipe');
const world={joined:true,inventory:{raw:{oak_planks:6},logs:0,planks:6},
 workbenchNearby:true,recipeCatalog:catalog('oak_door')};
const planned=generalPlan(world,{goal:'craft',item:'oak_door',targetCount:3});
ok(planned.kind==='craft_general'&&planned.item==='oak_door',
 'production autonomous planner uses upstream-derived native recipe graph');
const completion=generalPlan({...world,inventory:{raw:{oak_door:3}}},
 {goal:'craft',item:'oak_door',targetCount:3});
ok(completion.kind==='complete','production planner requires observed final item inventory');
const upstreamDecisions=[];
const delegate=(goal,arguments_)=>{
 upstreamDecisions.push({goal,args:arguments_});
 return {kind:'mine_iron',why:'Existing JARVIS native iron ore plan (modeled)'};
};
const ironWorld={joined:true,inventory:{raw:{stick:2},planks:0,logs:0},
 workbenchNearby:true,recipeCatalog:catalog('iron_pickaxe')};
const ironPlan=generalPlan(ironWorld,{goal:'craft',item:'iron_pickaxe',
 targetCount:1},delegate);
ok(ironPlan.kind==='mine_iron'&&upstreamDecisions[0]?.goal==='gather'&&
 upstreamDecisions[0]?.args.resource==='iron_ingot'&&
 upstreamDecisions[0]?.args.targetCount===3,
 'recipe graph delegates exactly three missing ingots to native JARVIS gathering');
const readyIron=generalPlan({...ironWorld,inventory:{raw:{iron_ingot:3,stick:2}}},
 {goal:'craft',item:'iron_pickaxe',targetCount:1});
ok(readyIron.kind==='craft_general'&&readyIron.item==='iron_pickaxe'&&
 readyIron.requiresTable===true,
 'after observed iron acquisition, planner proposes verified gear crafting');
const missingDiamond=generalPlan({joined:true,inventory:{raw:{stick:1}},
 workbenchNearby:true,recipeCatalog:catalog('diamond_sword')},
 {goal:'craft',item:'diamond_sword',targetCount:1},
 (goal,args)=>({kind:'mine_diamond',why:goal+args.resource+args.targetCount}));
ok(missingDiamond.kind==='mine_diamond',
 'diamond-sword ingredients reuse existing ore progression, not fake drops');
const readySword=generalPlan({joined:true,inventory:{raw:{diamond:2,stick:1}},
 workbenchNearby:true,recipeCatalog:catalog('diamond_sword')},
 {goal:'craft',item:'diamond_sword',targetCount:1});
ok(readySword.kind==='craft_general'&&readySword.item==='diamond_sword',
 'server-observed diamond and stick ingredients permit bounded sword craft');
const falseDelegate=generalPlan(ironWorld,{goal:'craft',item:'iron_pickaxe',
 targetCount:1},()=>({kind:'complete'}));
ok(falseDelegate.kind==='blocked',
 'a delegated subgoal claiming complete without inventory is never trusted');
const natural=directIntent('please craft three oak doors');
ok(natural?.ok===true&&natural.command.command==='auto_goal'&&
 natural.command.goal==='craft'&&natural.command.item==='oak_door'&&
 natural.command.targetCount===3,
 'owner natural-language craft routes to the durable native recipe planner');
const seq=directIntent('gather four logs then craft three oak doors');
ok(seq?.ok===true&&seq.command.goal==='sequence'&&
 seq.command.steps[1].item==='oak_door',
 'Mindcraft-derived crafting works as native sequential owner subgoal');
console.log('MINDCRAFT_NATIVE_RECIPE_GRAPH '+checks+'/'+checks+
 ' PASS (modeled version registry and production planner; NOT live Minecraft Java)');
