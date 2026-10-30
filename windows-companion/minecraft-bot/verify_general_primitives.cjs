const assert=require('node:assert/strict');
const {validateCommand}=require('./friend_protocol.cjs');
const good=[
{command:'inspect_block',position:{x:0,y:64,z:0}},
{command:'dig_block',position:{x:0,y:64,z:0}},
{command:'interact_block',position:{x:0,y:64,z:0}},
{command:'navigate',position:{x:1,y:65,z:3}},
{command:'equip_item',item:'iron_pickaxe'},
{command:'craft_item',item:'torch',count:4},
{command:'place_block',item:'torch',reference:{x:0,y:64,z:0},face:{x:0,y:1,z:0}},
{command:'interact_entity',entityId:23},
{command:'use_item'}
];for(const c of good)assert.equal(validateCommand(c),null,JSON.stringify(c));
for(const c of [
{command:'dig_block',position:{x:Infinity,y:64,z:0}},
{command:'navigate',position:{x:1.5,y:0,z:0}},
{command:'craft_item',item:'diamond',count:10000},
{command:'equip_item',item:'../../secret'},
{command:'place_block',item:'stone',reference:{x:0,y:0,z:0},face:{x:1,y:1,z:0}},
{command:'interact_entity',entityId:-1},
{command:'use_item',hand:'foot'}
])assert.notEqual(validateCommand(c),null,JSON.stringify(c));
console.log('PASS 16 primitive validation cases (offline only)');
