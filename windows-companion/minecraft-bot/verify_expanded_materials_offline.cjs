'use strict';
// Bounded real-world resource plans, simulated inventories; no Java server.
const assert=require('node:assert/strict');
const {RESOURCES,SAFE_GENERIC_RESOURCES,HAND_GENERIC_RESOURCES,
 PICKAXE_GENERIC_RESOURCES,normalizeResource,resourcePlan}
 =require('./resource_goal.cjs');
const {directIntent}=require('./language_goal.cjs');
let passed=0;const ok=(v,msg)=>{assert.ok(v,msg);passed++;console.log('PASS',msg)};
const stone=['andesite','diorite','granite','tuff','calcite','cobbled_deepslate','blackstone','basalt'];
const bare=['dirt','sand','red_sand','gravel','mud','soul_sand','soul_soil','moss_block'];
for(const material of stone){
 ok(PICKAXE_GENERIC_RESOURCES.has(material)&&
    SAFE_GENERIC_RESOURCES.has(material)&&RESOURCES.has(material),
    'mineral '+material+' has explicit pickaxe policy');
 const blocked=resourcePlan({inventory:{raw:{}}},{},
    {resource:material,targetCount:3},()=>({kind:'collect_wood'}));
 ok(blocked.kind==='collect_wood',
    'unarmed '+material+' acquisition delegates real tool creation');
 const ready=resourcePlan({inventory:{raw:{wooden_pickaxe:1}}},
    {},{resource:material,targetCount:3});
 // The digest has normalized pickaxe fields; model that exact layout.
 const equipped=resourcePlan({inventory:{woodenPickaxe:1,raw:{wooden_pickaxe:1}}},
    {},{resource:material,targetCount:3});
 ok(equipped.kind==='mine_generic'&&equipped.resource===material,
    'equipped live pickaxe allows bounded '+material+' collection');
 const full=resourcePlan({inventory:{raw:{[material]:3}}},
    {},{resource:material,targetCount:3});
 ok(full.kind==='complete','inventory proof finishes '+material);
}
for(const material of bare){
 ok(HAND_GENERIC_RESOURCES.has(material),'surface '+material+' is hand-safe');
 const ready=resourcePlan({inventory:{raw:{}}},{},
  {resource:material,targetCount:2});
 ok(ready.kind==='mine_generic','barehand '+material+' has inventory-verified plan');
}
ok(!RESOURCES.has('diamond_ore')&&!RESOURCES.has('stone')&&
 !RESOURCES.has('clay')&&!RESOURCES.has('grass_block'),
 'unsafe mismatched drops never pretend to yield requested blocks');
ok(normalizeResource('cobbled deepslate')==='cobbled_deepslate',
 'owner multiword block name normalizes safely');
ok(normalizeResource('soul sand')==='soul_sand',
 'owner Nether sand name normalizes safely');
ok(!normalizeResource('lava')&&!normalizeResource('command_block'),
 'hazardous and privileged names never become generic resource goals');
for(const phrase of [
 ['gather three granite','granite',3],
 ['mine two moss blocks',null,null],
 ['collect four soul sand','soul_sand',4],
 ['gather five cobbled deepslate','cobbled_deepslate',5]
]){
 const [input,name,count]=phrase;
 const r=directIntent(input);
 ok(name===null?!r?.ok:r?.ok&&r.command.goal==='gather'&&
 r.command.resource===name&&r.command.targetCount===count,
  'owner phrase respects exact native resource catalog: '+input);
}
console.log('MINECRAFT_EXPANDED_MATERIALS '+passed+'/'+passed+
 ' PASS (source planner, modeled inventories, no real mining)');
