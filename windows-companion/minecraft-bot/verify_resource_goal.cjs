'use strict';
const assert=require('node:assert/strict');
const {RESOURCES,normalizeResource,resourceCount,resourcePlan}=require('./resource_goal.cjs');
const {decide,createController}=require('./autonomy_engine.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const w=(inventory={},more={})=>({joined:true,dimension:'minecraft:overworld',health:20,hunger:20,
 threats:[],workbenchNearby:false,furnaceNearby:false,
 inventory:{logs:0,planks:0,sticks:0,cobblestone:0,rawIron:0,ironIngot:0,
 diamonds:0,obsidian:0,flint:0,netherrack:0,
 woodenPickaxe:0,stonePickaxe:0,stoneSword:0,ironPickaxe:0,
 diamondPickaxe:0,table:0,coal:0,raw:{},...inventory},...more});
let count=0;
const check=(expr,msg)=>{assert.ok(expr,msg);count++;};
const p=(resource,targetCount,world)=>decide('gather',world,{},{
 goal:'gather',resource,targetCount,steps:0,milestones:{}});
check(normalizeResource('diamonds')==='diamond','Common plural diamond goal normalized');
check(normalizeResource('stone')==='cobblestone','Stone alias maps to real cobblestone receipts');
check(normalizeResource('WOOD')==='logs','Wood alias maps to aggregated observed logs');
check(normalizeResource('coal ore')==='coal','Coal ore wording maps to real coal inventory');
check(normalizeResource('command_block')===null,'Unsupported admin blocks are rejected');
check(RESOURCES.has('cobblestone')&&!RESOURCES.has('command_block'),
 'Only explicitly supported survival resources authorized');
check(p('logs',3,w({logs:3})).kind==='complete',
 'A previously verified exact target count is genuinely complete');
check(p('logs',3,w({logs:2})).kind==='collect_wood',
 'Missing logs require a real wood action');
check(p('cobblestone',32,w()).kind==='collect_wood',
 'Cobblestone acquisition must start with prerequisite timber and tools');
check(p('cobblestone',32,w({woodenPickaxe:1,sticks:4})).kind==='mine_cobblestone',
 'Actual wooden pickaxe permits natural stone mining');
check(p('diamond',10,w({stonePickaxe:1,stoneSword:1})).kind==='collect_wood',
 'Diamond acquisition must first plan the complete Iron gear prerequisites');
check(p('coal',3,w({woodenPickaxe:1})).kind==='mine_coal',
 'Coal gathering requires an actual pickaxe and a live coal-mining action');
check(p('coal',3,w({woodenPickaxe:1,coal:3})).kind==='complete',
 'Coal quantity is read from observed survival inventory');
check(p('coal',3,w()).kind==='collect_wood',
 'Coal mining plans the real pickaxe prerequisite before mining');
check(p('diamond',10,w({ironPickaxe:1})).kind==='mine_diamond',
 'Iron pickaxe enables live exposed diamond ore acquisition');
check(p('diamond',10,w({ironPickaxe:1,diamonds:10})).kind==='complete',
 'Target diamonds are verified from actual inventory');
check(p('raw_iron',4,w({stonePickaxe:1,stoneSword:1})).kind==='mine_iron',
 'Raw iron can be acquired with real Stone tools');
check(p('iron_ingot',2,w({stonePickaxe:1,stoneSword:1,rawIron:1,
 furnace:1,coal:1})).kind==='place_furnace',
 'Smelting must place a real furnace first');
check(p('iron_ingot',2,w({stonePickaxe:1,stoneSword:1,rawIron:1,
 furnace:1,coal:1},{furnaceNearby:true})).kind==='smelt_iron',
 'Only verified furnace input and fuel may create the next ingot');
check(p('obsidian',2,w({ironPickaxe:1,diamonds:3,sticks:2},{workbenchNearby:true})).kind==='craft_diamond_gear',
 'Acquire diamond-grade pickaxe before obsidian');
check(p('obsidian',2,w({diamondPickaxe:1})).kind==='mine_obsidian',
 'Obsidian must use physical diamond-grade mining');
check(p('netherrack',2,w()).kind==='blocked',
 'Never claim Nether-only materials from Overworld without portal travel');
check(p('netherrack',2,w({}, {dimension:'minecraft:the_nether'})).kind==='mine_netherrack',
 'Netherrack mining requires actual Nether dimension');
check(p('hacked_item',2,w()).kind==='blocked','Unknown resources fail closed');
check(validateCommand({command:'auto_goal',goal:'gather',resource:'diamond',targetCount:32})===null,
 'Valid bounded generic resource goal is owner-authorizable');
for(const bad of [{resource:'command_block',targetCount:2},
 {resource:'diamond',targetCount:0},{resource:'diamond',targetCount:65},
 {resource:'diamond',targetCount:1.2},{resource:'diamond',targetCount:'32'}]){
 check(validateCommand({command:'auto_goal',goal:'gather',...bad})!==null,
   'Unsupported or malformed material goal denied');
}
check(validateCommand({command:'auto_goal',goal:'survive',resource:'diamond',targetCount:1})!==null,
 'Unrelated objective fields cannot sneak into regular survival mode');
const control=createController({clock:()=>100,maxSeconds:43200});
control.start('gather',21600,{resource:'cobblestone',targetCount:20});
check(control.status().resource==='cobblestone'&&control.status().targetCount===20,
 'Owner target persists across autonomous replanning');
check(control.next(w({woodenPickaxe:1,cobblestone:21})).kind==='complete',
 'The controller independently completes the goal based on actual quantity');
check(control.status().status==='complete','Controller state settles as complete');
let refused=false;try{createController().start('gather',300,{resource:'diamond',targetCount:100});}
catch{refused=true}
check(refused,'Controller never bypasses input validation');
console.log('MINECRAFT_GENERIC_RESOURCE_GOALS '+count+'/'+count+
 ' PASS (offline planner and protocol only, NOT live survival)');
