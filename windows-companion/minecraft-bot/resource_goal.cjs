'use strict';
/** Bounded, inventory-verified resource acquisition. No cheats, admin commands,
 * fabricated ore locations, or success from merely dispatching an action.
 * The caller must execute and verify every proposed step in the real world.
 */
const RESOURCES=new Set(['logs','planks','sticks','cobblestone','raw_iron',
  'iron_ingot','diamond','obsidian','flint','netherrack','coal']);
const ALIASES=Object.freeze({
 wood:'logs',log:'logs',stones:'cobblestone',stone:'cobblestone',coal_ore:'coal',
 diamonds:'diamond',iron:'iron_ingot',iron_ingots:'iron_ingot',rawiron:'raw_iron',
 plank:'planks',stick:'sticks'
});
function normalizeResource(name){
 if(typeof name!=='string')return null;
 const raw=name.trim().toLowerCase().replace(/[ -]+/g,'_');
 const normalized=ALIASES[raw]||raw;
 return RESOURCES.has(normalized)?normalized:null;
}
const COUNTS={logs:'logs',planks:'planks',sticks:'sticks',
  cobblestone:'cobblestone',raw_iron:'rawIron',iron_ingot:'ironIngot',
  diamond:'diamonds',obsidian:'obsidian',flint:'flint',netherrack:'netherrack',coal:'coal'};
const required=(kind,why,extra={})=>({kind,why,...extra});
function resourceCount(world,resource){
 const inv=world?.inventory||{};
 if(!RESOURCES.has(resource))return 0;
 const n=inv[COUNTS[resource]];
 return Number.isFinite(n) && n>0?Math.floor(n):0;
}
function resourcePlan(world,failures={},progress={},delegate){
 const resource=progress.resource,count=progress.targetCount;
 if(!RESOURCES.has(resource)||!Number.isInteger(count)||count<1||count>64)
   return required('blocked','Invalid or unsupported resource acquisition target');
 const have=resourceCount(world,resource);
 if(have>=count)return required('complete',
   'Server-backed '+resource+' quantity '+have+' >= '+count);
 const inv=world.inventory||{};
 const stage=goal=>{
   const d=delegate(goal);
   return d.kind==='complete'?null:d;
 };
 const mine=(kind,why,ore)=>{
   const failureKey=kind;
   return (failures[failureKey]||0)>=2
     ?required('survey_ore','Seek safe newly observed '+ore+' terrain',{ore,index:progress.steps||0})
     :required(kind,why);
 };
 switch(resource){
 case 'logs':return required('collect_wood','Gather '+(count-have)+' more physical logs');
 case 'planks':
   return (inv.logs||0)>0?required('craft_planks','Craft observed logs into planks'):
     required('collect_wood','Obtain logs for planks');
 case 'sticks':
   if((inv.planks||0)>=2)return required('craft_sticks','Convert real planks into sticks');
   if((inv.logs||0)>0)return required('craft_planks','Prepare planks for sticks');
   return required('collect_wood','Obtain timber for sticks');
 case 'cobblestone':
   if(!(inv.woodenPickaxe||inv.stonePickaxe||inv.ironPickaxe||inv.diamondPickaxe))
     return stage('tools')||required('blocked','Missing pickaxe after tool planning');
   return required('mine_cobblestone','Mine accessible stone and prove inventory increment');
 case 'raw_iron':
 case 'iron_ingot':{
   if(!inv.stonePickaxe&&!inv.ironPickaxe&&!inv.diamondPickaxe)
     return stage('stone_age')||required('blocked','Stone pickaxe prerequisite unresolved');
   if(resource==='iron_ingot' && (inv.rawIron||0)>0){
     if(!world.furnaceNearby){
       if(inv.furnace)return required('place_furnace','Place owned real furnace');
       if((inv.cobblestone||0)<8)return required('mine_cobblestone','Get eight cobblestone for furnace');
       if(!world.workbenchNearby)return (inv.table||0)>0
         ?required('place_table','Place crafting station for furnace'):
          (inv.planks||0)>=4?required('craft_table','Craft furnace workstation'):
            (inv.logs||0)>0?required('craft_planks','Gather workbench planks'):
              required('collect_wood','Acquire workstation timber');
       return required('craft_furnace','Craft real furnace');
     }
     if(!((inv.coal||0)>0||(inv.planks||0)>0||(inv.logs||0)>0))
       return required('collect_wood','Obtain furnace fuel');
     return required('smelt_iron','Smelt a real raw iron item and verify received ingot');
   }
   return mine('mine_iron','Mine naturally generated exposed iron', 'iron');
 }
 case 'coal':
   if(!(inv.woodenPickaxe||inv.stonePickaxe||inv.ironPickaxe||inv.diamondPickaxe))
     return stage('tools')||required('blocked','Missing pickaxe after tool planning');
   return mine('mine_coal','Mine naturally generated exposed coal ore','coal');
 case 'diamond':
   if(!inv.ironPickaxe&&!inv.diamondPickaxe)
     return stage('iron_age')||required('blocked','Iron pickaxe prerequisite unresolved');
   return mine('mine_diamond','Mine naturally generated exposed diamond','diamond');
 case 'obsidian':{
   if(!inv.diamondPickaxe){
     if(!inv.ironPickaxe)return stage('iron_age')||
       required('blocked','Iron pickaxe prerequisite unresolved');
     if((inv.diamonds||0)<3)return mine('mine_diamond',
       'Obtain three diamonds for obsidian pickaxe','diamond');
     if((inv.sticks||0)<2)return (inv.planks||0)>=2
       ?required('craft_sticks','Make pickaxe handles'):
         (inv.logs||0)>0?required('craft_planks','Make pickaxe planks'):
           required('collect_wood','Find wood for diamond pickaxe');
     if(!world.workbenchNearby)return (inv.table||0)>0
       ?required('place_table','Place workstation for diamond pickaxe'):
         (inv.planks||0)>=4?required('craft_table','Craft diamond workbench'):
           (inv.logs||0)>0?required('craft_planks','Prepare table planks'):
             required('collect_wood','Gather crafting table wood');
     return required('craft_diamond_gear','Make diamond pickaxe to harvest obsidian',
       {item:'diamond_pickaxe'});
   }
   return required('mine_obsidian','Search or mine real obsidian with a diamond pickaxe; only inventory delta counts');
 }
 case 'flint':return required('collect_flint','Mine loaded gravel until flint is received');
 case 'netherrack':
   if(!String(world.dimension||'').includes('nether'))
     return required('blocked','Netherrack acquisition requires verified Nether dimension');
   return required('mine_netherrack','Mine naturally generated Nether terrain');
 default:return required('blocked','Resource target not supported');
 }
}
module.exports={RESOURCES,normalizeResource,resourceCount,resourcePlan};
