'use strict';
/** Native furnace work for a bounded, owner-requested output.
 * Inputs are chosen ONLY from known vanilla recipes; the model cannot
 * introduce arbitrary smelt transformations, fuel, target coordinates or
 * commands. Existing furnace actions verify actual player inventory deltas.
 */
const SMELT_RECIPES=Object.freeze({
 iron_ingot:{input:'raw_iron',source:'raw_iron'},
 gold_ingot:{input:'raw_gold',source:'raw_gold'},
 copper_ingot:{input:'raw_copper',source:'raw_copper'},
 netherite_scrap:{input:'ancient_debris'},
 glass:{input:'sand',source:'sand'},
 stone:{input:'cobblestone',source:'cobblestone'},
 cooked_beef:{input:'beef'},
 cooked_porkchop:{input:'porkchop'},
 cooked_mutton:{input:'mutton'},
 cooked_chicken:{input:'chicken'},
 cooked_rabbit:{input:'rabbit'},
 baked_potato:{input:'potato'}
});
function validSmeltSpec(spec){
 return !!spec&&typeof spec==='object'&&!Array.isArray(spec)&&
  Object.keys(spec).every(k=>['goal','item','targetCount'].includes(k))&&
  spec.goal==='smelt'&&typeof spec.item==='string'&&
  Object.hasOwn(SMELT_RECIPES,spec.item)&&
  Number.isInteger(spec.targetCount)&&spec.targetCount>=1&&spec.targetCount<=16;
}
const quantity=(inv,item)=>Math.max(0,Number.isSafeInteger(inv?.raw?.[item])?inv.raw[item]:0);
const action=(kind,why,extra={})=>({kind,why,...extra});
function smeltPlan(world,progress,delegate){
 const spec={goal:'smelt',item:progress?.item,targetCount:progress?.targetCount};
 if(!validSmeltSpec(spec))return action('blocked','Invalid or unsupported owner-approved furnace output');
 const recipe=SMELT_RECIPES[spec.item],inv=world?.inventory||{};
 const current=quantity(inv,spec.item);
 if(current>=spec.targetCount)
  return action('complete','Physical survival inventory has '+current+' verified '+spec.item);
 if(quantity(inv,recipe.input)<1){
  if(!recipe.source || typeof delegate!=='function')
   return action('blocked','Missing actual '+recipe.input+' for '+spec.item+
     '; no owner-approved generic raw material acquisition exists');
  const needed=Math.min(64,spec.targetCount-current);
  const subgoal=delegate('gather',{resource:recipe.source,targetCount:needed});
  if(subgoal?.kind&&subgoal.kind!=='complete')return subgoal;
  return action('blocked','Source ingredient unavailable after bounded acquisition plan');
 }
 if(!world?.furnaceNearby){
  if(quantity(inv,'furnace')>0)
   return action('place_furnace','Place real owned furnace before smelting');
  if(quantity(inv,'cobblestone')<8){
   if(typeof delegate!=='function')return action('blocked','No prerequisite gathering permitted');
   const step=delegate('gather',{resource:'cobblestone',targetCount:8});
   if(step?.kind&&step.kind!=='complete')return step;
   return action('blocked','Cannot verify furnace stone materials');
  }
  if(!world.workbenchNearby){
   if(quantity(inv,'crafting_table')>0)return action('place_table','Place owned workbench for furnace crafting');
   if(inv.planks>=4)return action('craft_table','Make crafting workstation for furnace');
   if(inv.logs>=1)return action('craft_planks','Prepare workstation timber');
   return action('collect_wood','Acquire wood for crafting workstation');
  }
  return action('craft_furnace','Craft survival furnace from actual cobblestone');
 }
 const enoughFuel=quantity(inv,'coal')>0||quantity(inv,'charcoal')>0||
   quantity(inv,'blaze_rod')>0||
   Object.entries(inv.raw||{}).some(([name,count])=>name.endsWith('_planks')&&count>0);
 if(!enoughFuel){
  if(inv.logs>0)return action('craft_planks','Prepare physically owned wood as furnace fuel');
  return action('collect_wood','Collect bounded real wood for furnace fuel');
 }
 return action('smelt_resource','Smelt one real '+recipe.input+' into '+spec.item+
   ' and reverify output inventory', {input:recipe.input,output:spec.item});
}
module.exports={SMELT_RECIPES,validSmeltSpec,smeltPlan};
