
'use strict';
const assert=require('node:assert/strict');
const {decide,GOALS}=require('./autonomy_engine.cjs');
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
assert.equal(decide('dragon_run',w({stonePickaxe:1,stoneSword:1})).kind,'mine_iron');
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
console.log('PROGRESSION EXTENDED PASS (offline planner checks only; live server not tested)');
