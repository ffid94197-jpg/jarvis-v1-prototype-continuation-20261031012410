'use strict';
/**
 * JARVIS native, bounded recipe-dependency planner.
 *
 * Adapted from the dependency-node / verified-inventory planning approach of
 * Mindcraft (Kolby Nottingham, MIT), src/agent/npc/item_goal.js.
 * Upstream: https://github.com/mindcraft-bots/mindcraft
 * License/attribution: docs/integrations/MINDCRAFT_NATIVE_RECIPE_GRAPH_20261104.md
 *
 * No foreign bot, agent, scripts, LLM-generated code, arbitrary tool calls,
 * network access or new dependencies. The owner-authorized JARVIS controller
 * still dispatches EVERY real effect and verifies Minecraft receipts.
 */
const ITEM=/^[a-z0-9_]{1,64}$/;
const {RESOURCES}=require('./resource_goal.cjs');
const MAX_DEPTH=5, MAX_NODES=64, MAX_ALTERNATIVES=6;
const int=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
function lookupName(registry,id){
 if(!int(id,1,200000))return null;
 const name=registry?.items?.[id]?.name || registry?.itemsArray?.find?.(v=>v.id===id)?.name;
 return typeof name==='string'&&ITEM.test(name)?name:null;
}
function ingredient(registry,part){
 if(part===null||part===undefined||part===-1)return null;
 const id=Number.isInteger(part)?part:Array.isArray(part)?part[0]:part?.id;
 const count=Array.isArray(part)?1:typeof part==='object'&&part?.count!==undefined?part.count:1;
 const name=lookupName(registry,id);
 return name && int(count,1,64)?{name,count}:false;
}
function normalizeRecipe(registry,r){
 if(!r||typeof r!=='object'||!r.result)return null;
 const output=typeof r.result==='number'?1:r.result.count??1;
 if(!int(output,1,64))return null;
 const shaped=Array.isArray(r.inShape);
 const parts=shaped?r.inShape.flat():r.ingredients;
 if(!Array.isArray(parts)||parts.length<1||parts.length>9)return null;
 const items=Object.create(null);
 for(const raw of parts){
  const i=ingredient(registry,raw);
  if(i===null)continue;
  if(!i)return null;
  items[i.name]=(items[i.name]||0)+i.count;
 }
 const entries=Object.entries(items).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length||entries.length>9||entries.some(([,n])=>n>64))return null;
 const requiresTable=r.requiresTable===true ||
   (shaped&&(r.inShape.length>2||r.inShape.some(row=>Array.isArray(row)&&row.length>2))) ||
   entries.reduce((n,[,c])=>n+c,0)>4;
 return {output,requiresTable,ingredients:Object.fromEntries(entries)};
}
function compileRecipeCatalog(bot,root){
 if(typeof root!=='string'||!ITEM.test(root))return null;
 const registry=bot?.registry;
 if(!registry?.itemsByName?.[root]||!registry?.recipes||!registry?.items)return null;
 const nodes=Object.create(null),seen=new Set();
 function visit(name,depth,ancestors){
  if(depth>MAX_DEPTH||seen.size>=MAX_NODES||ancestors.includes(name)||seen.has(name))return;
  seen.add(name);
  const id=registry.itemsByName[name]?.id;
  const raw=int(id,1,200000)?registry.recipes[id]:null;
  const list=Array.isArray(raw)?raw:[];
  const recipes=[],uniques=new Set();
  for(const record of list.slice(0,24)){
   const recipe=normalizeRecipe(registry,record);
   if(!recipe)continue;
   const key=JSON.stringify(recipe);
   if(!uniques.has(key)){uniques.add(key);recipes.push(recipe);}
   if(recipes.length>=MAX_ALTERNATIVES)break;
  }
  nodes[name]=recipes;
  for(const rec of recipes){
   for(const part of Object.keys(rec.ingredients)){
    if(part!==name)visit(part,depth+1,[...ancestors,name]);
   }
  }
 }
 visit(root,0,[]);
 return {root,nodes};
}
function planRecipeStep(catalog,raw,goalName,targetCount,{workbenchNearby=false,logs=0,planks=0,delegate=null}={}){
 if(!catalog||catalog.root!==goalName||!catalog.nodes||
   !ITEM.test(String(goalName))||!int(targetCount,1,16))
  return {kind:'blocked',why:'No supported, server-version recipe catalog for requested item'};
 const inventory=raw&&typeof raw==='object'?raw:{};
 const have=name=>Number.isFinite(inventory[name])&&inventory[name]>=0?
   Math.floor(inventory[name]):0;
 if(have(goalName)>=targetCount)
  return {kind:'complete',why:'Server inventory proves requested item count'};
 const rootRecipes=catalog.nodes[goalName];
 if(!Array.isArray(rootRecipes)||!rootRecipes.length)
  return {kind:'blocked',why:'Requested item has no safe registered crafting recipe'};
 function step(name,need,depth,visited){
  if(have(name)>=need)return null;
  if(depth>MAX_DEPTH||visited.includes(name))
   return {kind:'blocked',why:'Recipe dependencies exceed safe depth or contain a cycle'};
  // Mindcraft-inspired prerequisite traversal, but every material source is
  // explicitly JARVIS-authorized and all work is rechecked after each effect.
  const recipes=catalog.nodes[name]||[];
  if(!recipes.length){
   if(name==='cobblestone')return {kind:'mine_cobblestone',why:'Acquire actual cobblestone before crafting'};
   if(name==='oak_log'||name==='spruce_log'||name==='birch_log')
    return {kind:'collect_wood',why:'Acquire actual loaded tree logs before crafting'};
   // Reuse EXISTING JARVIS resource planner (not Mindcraft's unguarded
   // combat or autonomous code interpreter), with exact item and quantity.
   if(RESOURCES.has(name)&&int(need,1,64)&&typeof delegate==='function'){
    const result=delegate('gather',{resource:name,targetCount:need});
    if(result&&typeof result.kind==='string'&&
      !['complete','idle','wait'].includes(result.kind))return result;
   }
   return {kind:'blocked',why:'No approved autonomous acquisition source for '+name};
  }
  // Choose the recipe with the smallest current ingredient deficit. Never
  // assume materials were collected by a prior attempt or fabricate a source.
  const available=recipes.filter(rec=>int(rec.output,1,64)&&
    rec.ingredients&&Object.keys(rec.ingredients).every(n=>ITEM.test(n)&&
      int(rec.ingredients[n],1,64)));
  if(!available.length)return {kind:'blocked',why:'Recipe catalog contains no safe recipe'};
  const options=available.map(rec=>{
   const ops=Math.ceil((need-have(name))/rec.output);
   const deficit=Object.entries(rec.ingredients).reduce((n,[key,num])=>
     n+Math.max(0,ops*num-have(key)),0);
   return {rec,ops,deficit};
  }).sort((a,b)=>a.deficit-b.deficit||a.ops-b.ops);
  for(const {rec,ops} of options){
   const dependencies=Object.entries(rec.ingredients);
   let blocked=null;
   for(const [part,perOp] of dependencies){
    const required=ops*perOp;
    if(!int(required,1,1024)){blocked={kind:'blocked',why:'Recipe ingredient budget exceeded'};break;}
    if(have(part)>=required)continue;
    const next=step(part,required,depth+1,[...visited,name]);
    if(next?.kind==='blocked'){blocked=next;break;}
    if(next)return next;
   }
   if(blocked)continue;
   if(rec.requiresTable && !workbenchNearby){
    if(have('crafting_table')>0)return {kind:'place_table',why:'Place owned crafting table before crafting'};
    if(planks>=4)return {kind:'craft_table',why:'Craft crafting table from actual observed planks'};
    if(logs>0)return {kind:'craft_planks',why:'Prepare workstation planks from real inventory'};
    return {kind:'collect_wood',why:'Collect wood for necessary crafting table'};
   }
   return {kind:'craft_general',item:name,requiresTable:rec.requiresTable,
     why:'Craft one real recipe operation; prove inventory increase'};
  }
  return {kind:'blocked',why:'No supported prerequisite path to '+name};
 }
 return step(goalName,targetCount,0,[])||
  {kind:'blocked',why:'Recipe target already complete but inventory proof unavailable'};
}
module.exports={compileRecipeCatalog,normalizeRecipe,planRecipeStep,MAX_DEPTH,MAX_NODES};
