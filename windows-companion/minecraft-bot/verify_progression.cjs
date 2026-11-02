
'use strict';
const assert=require('node:assert/strict');
const {decide,GOALS,createController}=require('./autonomy_engine.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const w=(inventory={},workbenchNearby=false)=>({joined:true,health:20,hunger:20,threats:[],inventory:{logs:0,planks:0,sticks:0,table:0,woodenPickaxe:0,stonePickaxe:0,stoneSword:0,cobblestone:0,food:0,...inventory},workbenchNearby});
const cases=[
 ['wooden_tools',w(), 'collect_wood'],
 ['reserve_wood_before_mining',w({woodenPickaxe:1}),'collect_wood'],
 ['reserve_planks_before_mining',w({woodenPickaxe:1,logs:1}),'craft_planks'],
 ['reserve_sticks_before_mining',w({woodenPickaxe:1,planks:2}),'craft_sticks'],
 ['mine_stone',w({woodenPickaxe:1,sticks:4}),'mine_cobblestone'],
 ['handles',w({woodenPickaxe:1,cobblestone:5,planks:3}),'craft_sticks'],
 ['station',w({woodenPickaxe:1,cobblestone:5,sticks:4,table:1}),'place_table'],
 ['pickaxe',w({woodenPickaxe:1,cobblestone:5,sticks:4},true),'craft_stone_pickaxe'],
 ['sword',w({woodenPickaxe:1,stonePickaxe:1,cobblestone:5,sticks:4},true),'craft_stone_sword'],
 ['done',w({stonePickaxe:1,stoneSword:1}),'complete']
];
for(const [label,state,expected] of cases)assert.equal(decide('stone_age',state).kind,expected,label);
assert.equal(decide('tools',w({logs:1})).kind,'collect_wood',
 'Do not convert first log before total wooden-tool recipe materials secured');
assert.equal(decide('tools',w({logs:2})).kind,'collect_wood',
 'Two logs are insufficient for table, pickaxe and sticks');
assert.equal(decide('tools',w({logs:3})).kind,'craft_planks',
 'Three logs satisfy complete wooden-tool recipe budget and permit crafting');
assert.equal(decide('tools',w({planks:3,sticks:2,table:1})).kind,'place_table',
 'Already banked handles/table remove redundant raw timber requirement');

const undergroundNoHandles=w({woodenPickaxe:1,cobblestone:5,table:1});
assert.equal(decide('stone_age',undergroundNoHandles).kind,'collect_wood',
 'past stranding is not a victory; record missing handles instead of falsely crafting');
const bankedHandles=w({woodenPickaxe:1,cobblestone:5,sticks:4,table:1});
assert.equal(decide('stone_age',bankedHandles).kind,'place_table',
 'when handles were reserved, five real cobblestone leads directly to workstation placement');

const mobileStation={...w({woodenPickaxe:1,cobblestone:0,sticks:6},true),
 workbenchRecoverySupported:true};
assert.equal(decide('stone_age',mobileStation).kind,'recover_table',
 'recover the actual placed workstation before stone excavation');
const withPackedStation={...w({woodenPickaxe:1,cobblestone:0,sticks:6,table:1},false),
 workbenchRecoverySupported:true};
assert.equal(decide('stone_age',withPackedStation).kind,'mine_cobblestone',
 'packed workstation must not trigger unnecessary wood collection');
const afterStone={...w({woodenPickaxe:1,cobblestone:6,sticks:6,table:1},false),
 workbenchRecoverySupported:true};
assert.equal(decide('stone_age',afterStone).kind,'place_table',
 'six collected cobblestone plus portable table must lead to workstation placement, NOT wood search');
const afterPlaced={...w({woodenPickaxe:1,cobblestone:6,sticks:6},true),
 workbenchRecoverySupported:true};
assert.equal(decide('stone_age',afterPlaced).kind,'craft_stone_pickaxe',
 'after placing the recovered workstation, craft the real stone pickaxe');
assert.equal(decide('stone_age',{...afterPlaced,inventory:{...afterPlaced.inventory,
 stonePickaxe:1,cobblestone:3,sticks:4}}).kind,'craft_stone_sword',
 'then craft the stone sword without further lumber');
const ironStation={...w({stonePickaxe:1,stoneSword:1,woodenPickaxe:1,ironIngot:0},true),
 workbenchRecoverySupported:true};
assert.equal(decide('iron_age',ironStation).kind,'recover_table',
 'the workstation is likewise recovered before long iron exploration');

assert.ok(GOALS.has('dragon_run'));assert.equal(validateCommand({command:'auto_goal',goal:'dragon_run',durationSeconds:300}),null);
assert.equal(decide('dragon_run',w({stonePickaxe:1,stoneSword:1})).kind,'collect_wood',
 'Full survival must carry iron-tool handles/fuel before mining deeper');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,rawIron:1,cobblestone:2})).kind,'mine_cobblestone');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,rawIron:1,cobblestone:8},true)).kind,'craft_furnace');
assert.equal(decide('iron_age',{...w({stonePickaxe:1,stoneSword:1,rawIron:1,planks:2}),furnaceNearby:true}).kind,'smelt_iron');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,ironIngot:3,sticks:2},true)).kind,'craft_iron_pickaxe');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,ironPickaxe:1})).kind,'complete');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,sticks:1,planks:2})).kind,'craft_sticks',
 'Reserve iron pickaxe handles before descending into new caves');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,sticks:2})).kind,'collect_wood',
 'Reserve smelting fuel while trees are still reachable');
assert.equal(decide('iron_age',w({stonePickaxe:1,stoneSword:1,sticks:2,logs:1})).kind,'mine_iron',
 'Iron excavation may proceed only when handles and fuel have been reserved');

assert.equal(decide('dragon_run',w({stonePickaxe:1,stoneSword:1,ironPickaxe:1})).kind,'mine_diamond');
assert.equal(decide('dragon_run',w({stonePickaxe:1,stoneSword:1,ironPickaxe:1,diamonds:3,sticks:2},true)).item,'diamond_pickaxe');
const diamondGear={stonePickaxe:1,stoneSword:1,ironPickaxe:1,diamondPickaxe:1,diamondSword:1,diamondHelmet:1,diamondChestplate:1,diamondLeggings:1,diamondBoots:1};
assert.equal(decide('dragon_run',w(diamondGear)).kind,'mine_obsidian','progresses to portal materials without claiming dragon kill');
assert.equal(decide('survive',{...w(),hunger:6}).kind,'obtain_food',
 'Critically hungry survival gameplay must seek real food instead of immediately blocking');
const woodRecovery=createController({clock:()=>100,maxSteps:150});
woodRecovery.start('wood',300);
for(let k=0;k<2;k++){
 const d=woodRecovery.next(w());
 assert.equal(d.kind,'collect_wood');
 woodRecovery.record(d,{ok:false,verified:false,detail:'Server-verified failed path'});
}
const survey=woodRecovery.next(w());
assert.equal(survey.kind,'survey_wood',
 'Two unverified wood approaches must cause a bounded change of search area');
woodRecovery.record(survey,{ok:true,verified:true,detail:'Observed new position'});
assert.equal(woodRecovery.status().failures.collect_wood,0,
 'Verified new terrain resets only the wood-path retry counter');
assert.equal(woodRecovery.status().milestones.woodSurveyTrips,1,
 'Record limited actual scouting; no resource progress or victory is fabricated');
assert.equal(woodRecovery.next(w()).kind,'collect_wood',
 'After scouting, autonomous wood collection resumes without user command');
const falseSurvey=createController({clock:()=>100,maxSteps:150});
falseSurvey.start('wood',300);
for(let k=0;k<2;k++){
 const d=falseSurvey.next(w());falseSurvey.record(d,{ok:false,verified:false});
}
for(let k=0;k<3;k++){
 const d=falseSurvey.next(w());
 assert.equal(d.kind,'survey_wood');
 falseSurvey.record(d,{ok:false,verified:false,detail:'No safe waypoint'});
}
assert.equal(falseSurvey.status().status,'blocked',
 'Three unsuccessful terrain surveys must fail closed without infinite route retries');
console.log('PROGRESSION EXTENDED PASS (offline planner checks only; live server not tested)');
