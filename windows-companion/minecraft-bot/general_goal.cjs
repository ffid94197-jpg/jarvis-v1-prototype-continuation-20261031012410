'use strict';
/** Owner-authorized, finite general Minecraft goals. These are NOT arbitrary
 * free-form action execution. The bot proves completion from live inventory
 * and observed equipment slots, not from successful dispatch.
 */
const RECIPES=Object.freeze({
 stick:{oak_planks:2},
 wooden_pickaxe:{oak_planks:3,stick:2},
 wooden_axe:{oak_planks:3,stick:2},
 wooden_shovel:{oak_planks:1,stick:2},
 wooden_sword:{oak_planks:2,stick:1},
 wooden_hoe:{oak_planks:2,stick:2},
 crafting_table:{oak_planks:4},
 chest:{oak_planks:8},
 oak_door:{oak_planks:6},
 oak_trapdoor:{oak_planks:6},
 oak_fence:{oak_planks:4,stick:2},
 oak_fence_gate:{oak_planks:2,stick:4},
 oak_sign:{oak_planks:6,stick:1},
 furnace:{cobblestone:8},
 stone_pickaxe:{cobblestone:3,stick:2},
 stone_axe:{cobblestone:3,stick:2},
 stone_shovel:{cobblestone:1,stick:2},
 stone_sword:{cobblestone:2,stick:1},
 stone_hoe:{cobblestone:2,stick:2},
 iron_pickaxe:{iron_ingot:3,stick:2},
 iron_axe:{iron_ingot:3,stick:2},
 iron_shovel:{iron_ingot:1,stick:2},
 iron_sword:{iron_ingot:2,stick:1},
 iron_hoe:{iron_ingot:2,stick:2},
 diamond_pickaxe:{diamond:3,stick:2},
 diamond_axe:{diamond:3,stick:2},
 diamond_shovel:{diamond:1,stick:2},
 diamond_sword:{diamond:2,stick:1},
 diamond_hoe:{diamond:2,stick:2},
 iron_helmet:{iron_ingot:5},
 iron_chestplate:{iron_ingot:8},
 iron_leggings:{iron_ingot:7},
 iron_boots:{iron_ingot:4},
 diamond_helmet:{diamond:5},
 diamond_chestplate:{diamond:8},
 diamond_leggings:{diamond:7},
 diamond_boots:{diamond:4},
 shears:{iron_ingot:2},
 bucket:{iron_ingot:3},
 flint_and_steel:{iron_ingot:1,flint:1},
 ladder:{stick:7},
 bread:{wheat:3},
 shield:{oak_planks:6,iron_ingot:1},
 torch:{stick:1,coal:1},
});
const EQUIPMENT=Object.freeze({
 hand:new Set(['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe',
 'wooden_sword','stone_sword','iron_sword','diamond_sword','netherite_sword',
 'wooden_axe','stone_axe','iron_axe','diamond_axe','netherite_axe',
 'wooden_shovel','stone_shovel','iron_shovel','diamond_shovel','netherite_shovel',
 'wooden_hoe','stone_hoe','iron_hoe','diamond_hoe','netherite_hoe','bow','crossbow','trident','shield','torch']),
 head:new Set(['leather_helmet','iron_helmet','golden_helmet','diamond_helmet','netherite_helmet','turtle_helmet']),
 torso:new Set(['leather_chestplate','iron_chestplate','golden_chestplate','diamond_chestplate','netherite_chestplate','elytra']),
 legs:new Set(['leather_leggings','iron_leggings','golden_leggings','diamond_leggings','netherite_leggings']),
 feet:new Set(['leather_boots','iron_boots','golden_boots','diamond_boots','netherite_boots']),
 'off-hand':new Set(['shield','torch','totem_of_undying'])
});
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).every(k=>keys.includes(k));
function validCraftSpec(s){
 return exact(s,['goal','item','targetCount'])&&s.goal==='craft'&&
  Object.hasOwn(RECIPES,s.item)&&Number.isInteger(s.targetCount)&&
  s.targetCount>=1&&s.targetCount<=16;
}
function validEquipSpec(s){
 return exact(s,['goal','item','destination'])&&s.goal==='equip'&&
  typeof s.destination==='string'&&Object.hasOwn(EQUIPMENT,s.destination)&&EQUIPMENT[s.destination].has(s.item);
}
const act=(kind,why,params={})=>({kind,why,...params});
const count=(inv,name)=>Number.isFinite(inv?.raw?.[name])?Math.max(0,inv.raw[name]):0;
const {normalizeResource}=require('./resource_goal.cjs');
function generalPlan(world,progress={},delegate){
 const inv=world?.inventory||{};
 if(progress.goal==='equip'){
  if(!validEquipSpec({goal:'equip',item:progress.item,destination:progress.destination}))
   return act('blocked','Unsupported autonomous equipment goal');
  if(world.equipped?.[progress.destination]===progress.item)
    return act('complete','Currently server-observed '+progress.item+' equipped in '+progress.destination);
  // The inventory digest can include items worn in other slots. This is an
  // authorization check only; the executor verifies backpack ownership.
  if(count(inv,progress.item)<1)return act('blocked','Requested equipment item not owned');
  return act('equip_general','Equip exact owner-authorized item and verify physical slot',
    {item:progress.item,destination:progress.destination});
 }
 if(progress.goal!=='craft'||!validCraftSpec({goal:'craft',item:progress.item,targetCount:progress.targetCount}))
  return act('blocked','Unsupported autonomous crafting goal');
 if(count(inv,progress.item)>=progress.targetCount)
  return act('complete','Server inventory confirms requested crafted item quantity');
 const recipe=RECIPES[progress.item];
 for(const [ingredient,amount] of Object.entries(recipe)){
  if(ingredient==='oak_planks'){
   if((inv.planks||0)>=amount)continue;
   if((inv.logs||0)>0)return act('craft_planks','Convert observed logs to planks');
   return act('collect_wood','Acquire real planks through wood collection');
  }
  if(ingredient==='stick'&&count(inv,'stick')<amount){
   if((inv.planks||0)>=2)return act('craft_sticks','Make recipe handles from real planks');
   if((inv.logs||0)>0)return act('craft_planks','Prepare wood for sticks');
   return act('collect_wood','Gather stick material');
  }
  if(count(inv,ingredient)>=amount)continue;
  const resource=normalizeResource(ingredient);
  if(resource){
   if(typeof delegate!=='function')return act('blocked','Missing verified ingredient '+ingredient);
   const plan=delegate('gather',{resource,targetCount:amount});
   return plan?.kind && plan.kind!=='complete'?plan:act('blocked','Ingredient gathering lacks verified progress');
  }
  return act('blocked','No authorized autonomous acquisition method for missing '+ingredient);
 }
 if(!['stick','crafting_table','torch'].includes(progress.item) && !world.workbenchNearby){
  if(count(inv,'crafting_table')>0)return act('place_table','Place owned crafting table for recipe');
  if((inv.planks||0)>=4)return act('craft_table','Craft workstation for recipe');
  if((inv.logs||0)>0)return act('craft_planks','Prepare workstation planks');
  return act('collect_wood','Gather wood for workstation');
 }
 return act('craft_general','Craft one verified recipe using observed materials',
  {item:progress.item});
}
module.exports={RECIPES,EQUIPMENT,validCraftSpec,validEquipSpec,generalPlan};
