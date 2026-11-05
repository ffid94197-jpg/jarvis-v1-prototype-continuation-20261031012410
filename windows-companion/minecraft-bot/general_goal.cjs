'use strict';
/** Owner-authorized, finite general Minecraft goals. These are NOT arbitrary
 * free-form action execution. The bot proves completion from live inventory
 * and observed equipment slots, not from successful dispatch.
 */
const {planRecipeStep}=require('./mindcraft_recipe_graph.cjs');
const RECIPES=Object.freeze({
 stick:{oak_planks:2},
 crafting_table:{oak_planks:4},
 chest:{oak_planks:8},
 furnace:{cobblestone:8},
 ladder:{stick:7},
 bread:{wheat:3},
 shield:{oak_planks:6,iron_ingot:1},
 torch:{stick:1,coal:1},
});
const EQUIPMENT=Object.freeze({
 hand:new Set(['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe',
 'wooden_sword','stone_sword','iron_sword','diamond_sword','netherite_sword','bow','crossbow','trident','shield','torch']),
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
  typeof s.item==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(s.item)&&
  Number.isInteger(s.targetCount)&&
  s.targetCount>=1&&s.targetCount<=16;
}
function validEquipSpec(s){
 return exact(s,['goal','item','destination'])&&s.goal==='equip'&&
  typeof s.destination==='string'&&Object.hasOwn(EQUIPMENT,s.destination)&&EQUIPMENT[s.destination].has(s.item);
}
const act=(kind,why,params={})=>({kind,why,...params});
const count=(inv,name)=>Number.isFinite(inv?.raw?.[name])?Math.max(0,inv.raw[name]):0;
function generalPlan(world,progress={},delegate){
 const inv=world?.inventory||{};
 if(progress.goal==='equip'){
  if(!validEquipSpec({goal:'equip',item:progress.item,destination:progress.destination}))
   return act('blocked','Unsupported autonomous equipment goal');
  if(world.equipped?.[progress.destination]===progress.item)
    return act('complete','Currently server-observed '+progress.item+' equipped in '+progress.destination);
  // The inventory digest can include items worn in other slots. This is an
  // authorization check only; the executor verifies backpack ownership.
  if(count(inv,progress.item)<1){
   // Reuse the same versioned crafting + resource acquisition planner as
   // explicit craft goals. A single owner equipment objective is an approved
   // durable *goal*, not permission for arbitrary model-selected effects.
   const catalog=world?.recipeCatalog;
   if(catalog?.root!==progress.item ||
      !Array.isArray(catalog?.nodes?.[progress.item]) ||
      catalog.nodes[progress.item].length===0)
     return act('blocked','Requested equipment item not owned and no verified survival crafting recipe available');
   const prerequisite=planRecipeStep(catalog,inv.raw,progress.item,1,{
     workbenchNearby:world?.workbenchNearby===true,
     logs:inv.logs||0,planks:inv.planks||0,delegate
   });
   return prerequisite.kind==='complete'?
     act('blocked','Cannot prove requested equipment exists despite recipe result'):
     prerequisite;
  }
  return act('equip_general','Equip exact owner-authorized item and verify physical slot',
    {item:progress.item,destination:progress.destination});
 }
 if(progress.goal!=='craft'||!validCraftSpec({goal:'craft',item:progress.item,targetCount:progress.targetCount}))
  return act('blocked','Unsupported autonomous crafting goal');
 // Real inventory proves completion even when the recipe catalog is
 // temporarily unavailable (e.g. client reconnect). Never claim an item
 // from a dispatched craft or missing registry data.
 const produced=Number.isSafeInteger(progress?.milestones?.craftedOutput)?
   progress.milestones.craftedOutput:0;
 const current=count(inv,progress.item);
 // Existing owned items are not proof of *new* crafting during this
 // owner's current task. Only server-observed craft output deltas count.
 if(produced>=progress.targetCount&&current>=progress.targetCount)
   return act('complete','This task physically crafted '+produced+
     ' new '+progress.item+'; final inventory contains '+current);
 if(produced>=progress.targetCount&&current<progress.targetCount)
   return act('blocked','Crafted items were spent or lost before final inventory verification');
 // Prefer the actual installed Minecraft version's recipes (including
 // alternatives such as spruce planks for a chest) over the eight historic
 // single-ingredient recipes. Fall back to the old list ONLY if the exact
 // target has no usable versioned recipe; unknown targets fail closed.
 const catalog=world?.recipeCatalog;
 const hasVersionedRecipe=catalog?.root===progress.item &&
   Array.isArray(catalog?.nodes?.[progress.item]) &&
   catalog.nodes[progress.item].length>0;
 if(hasVersionedRecipe || !Object.hasOwn(RECIPES,progress.item)){
  const versioned=planRecipeStep(catalog,inv.raw,progress.item,
   Math.max(1,progress.targetCount-produced),{
   freshOutput:true,
   workbenchNearby:world?.workbenchNearby===true,logs:inv.logs||0,planks:inv.planks||0,
   delegate
  });
  // Only the original eight audited recipes may use this compatibility
  // fallback. Never improvise ingredients for an arbitrary item if its
  // actual versioned recipe graph contains no permitted acquisition path.
  if(versioned.kind!=='blocked'||!Object.hasOwn(RECIPES,progress.item))
   return versioned;
 }
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
  if(ingredient==='cobblestone'||ingredient==='iron_ingot'){
   if(typeof delegate!=='function')return act('blocked','Missing verified ingredient '+ingredient);
   const plan=delegate('gather',{resource:ingredient,targetCount:amount});
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
