'use strict';
/** JARVIS-owned, grounded Minecraft mission planning for the optional Mine AI MCP tool host.
 * The upstream MCP runtime supplies physical actions, not autonomous victory.
 * Never turn an accepted MCP action into progress without settled server-observed facts.
 * Upstream action interface: https://github.com/aibengineering/mine-ai-mcp (MIT; AI Bengineering 2026).
 */
const {decide,createController}=require('./autonomy_engine.cjs');
const ARMOR={head:'netherite_helmet',torso:'netherite_chestplate',legs:'netherite_leggings',feet:'netherite_boots'};
const LOGS=['oak_log','spruce_log','birch_log','dark_oak_log','jungle_log','acacia_log','mangrove_log','cherry_log','pale_oak_log'];
const oreNames={iron:['iron_ore','deepslate_iron_ore'],diamond:['diamond_ore','deepslate_diamond_ore']};
const NETHERITE_UPGRADES=Object.freeze({
 netherite_helmet:'diamond_helmet',netherite_chestplate:'diamond_chestplate',
 netherite_leggings:'diamond_leggings',netherite_boots:'diamond_boots',
 netherite_sword:'diamond_sword'
});
/** Optional Mine AI MCP extension, NOT a capability provided by its published API.
 * Never issue a crafting call as a surrogate for smithing. Require a host-advertised
 * tool, exact approved vanilla recipe ingredients, and post-action inventory deltas.
 */
const SMITH_TOOL='smith_item';

function observedWorld(s){
 if(!s || !Array.isArray(s.inventory?.stacks) || !s.vitals || !s.position || !s.dimension)throw Error('Incomplete MCP game observation');
 const raw={};const worn={};
 for(const x of s.inventory.stacks){
  if(typeof x.name!=='string'||!Number.isInteger(x.count)||x.count<=0)continue;
  raw[x.name]=(raw[x.name]||0)+x.count;
  if(Object.hasOwn(ARMOR,x.location))worn[x.location]=x.name;
 }
 const count=(name)=>raw[name]||0;
 const logs=Object.entries(raw).filter(([k])=>LOGS.includes(k)).reduce((n,[,v])=>n+v,0);
 const planks=Object.entries(raw).filter(([k])=>k.endsWith('_planks')).reduce((n,[,v])=>n+v,0);
 const food=Object.entries(raw).filter(([k])=>/^(bread|baked_potato|cooked_.*|apple|golden_apple|carrot|potato|melon_slice|pumpkin_pie)$/.test(k)).reduce((n,[,v])=>n+v,0);
 const inventory={...raw,raw,logs,planks,sticks:count('stick'),table:count('crafting_table'),woodenPickaxe:count('wooden_pickaxe'),stonePickaxe:count('stone_pickaxe'),stoneSword:count('stone_sword'),cobblestone:count('cobblestone')+count('cobbled_deepslate'),food,rawIron:count('raw_iron'),ironIngot:count('iron_ingot'),ironPickaxe:count('iron_pickaxe'),diamondPickaxe:count('diamond_pickaxe'),diamonds:count('diamond'),diamondSword:count('diamond_sword'),diamondHelmet:count('diamond_helmet'),diamondChestplate:count('diamond_chestplate'),diamondLeggings:count('diamond_leggings'),diamondBoots:count('diamond_boots'),furnace:count('furnace'),coal:count('coal')};
 const dragons=s.endFight?.dragons||[];const crystals=s.endFight?.crystals||[];
 return {joined:true,dimension:s.dimension,health:s.vitals.health,hunger:s.vitals.food,
  inventory,position:s.position,ownerVisible:!!s.nearby?.players?.some(p=>p.position),
  ownerDistance:s.nearby?.players?.find(p=>p.position)?.distance??null,
  threats:(s.nearby?.hostiles||[]).map(t=>({...t,id:t.entityId})),
  // A carried workstation can be used by MCP's temporary-workstation recipes.
  workbenchNearby:count('crafting_table')>0,furnaceNearby:count('furnace')>0,
  wornNetherite:Object.entries(ARMOR).every(([slot,name])=>worn[slot]===name),
  dragonPresent:dragons.length>0,dragonId:dragons[0]?.entityId??null,crystalsNearby:crystals.length,
  // Never infer dragon death, portal activation, or milestone events from absent entities.
  dragonDeadObserved:false,exitPortalPresent:false,strongholdPortalFrameNearby:false,
  endPortalPresent:false,endPortalActivated:false,netherPortalNearby:false,smithingTableNearby:false};
}
function inventoryCount(s,item){return (s?.inventory?.stacks||[]).filter(x=>x.name===item).reduce((n,x)=>n+x.count,0);}
function checkedOutcome(before,after,action,decision){
 if(action.state!=='settled')return {ok:false,verified:false,effectUnknown:true,detail:'Action still pending; cannot submit a replacement'};
 if(action.output?.result?.status!=='succeeded')return {ok:false,verified:false,detail:'Upstream settled '+String(action.output?.result?.status||'unknown')};
 const oldNames=new Map((before.inventory?.stacks||[]).map(x=>[x.name,inventoryCount(before,x.name)]));
 if(decision.kind==='smith_netherite'){
  const base=NETHERITE_UPGRADES[decision.item];
  const beforeItem=inventoryCount(before,decision.item);
  const verified=!!base && inventoryCount(after,decision.item)>beforeItem &&
    inventoryCount(before,base)>inventoryCount(after,base) &&
    inventoryCount(before,'netherite_ingot')>inventoryCount(after,'netherite_ingot') &&
    inventoryCount(before,'netherite_upgrade_smithing_template')>inventoryCount(after,'netherite_upgrade_smithing_template');
  return {ok:verified,verified,detail:verified?
    'Observed Netherite upgrade item gain and consumption of diamond base, ingot and upgrade template':
    'Smithing action settled but independently observed vanilla recipe effects were incomplete'};
 }

 const newItems=(after.inventory?.stacks||[]).filter(x=>inventoryCount(after,x.name)>(oldNames.get(x.name)||0)).map(x=>x.name);
 const expected={
  collect_wood:n=>LOGS.includes(n),mine_cobblestone:n=>n==='cobblestone'||n==='cobbled_deepslate',
  mine_iron:n=>n==='raw_iron',mine_diamond:n=>n==='diamond',mine_obsidian:n=>n==='obsidian',
  mine_ancient_debris:n=>n==='ancient_debris',mine_netherrack:n=>n==='netherrack',
  collect_flint:n=>n==='flint',craft_planks:n=>n.endsWith('_planks'),craft_sticks:n=>n==='stick',
  craft_table:n=>n==='crafting_table',craft_pickaxe:n=>n==='wooden_pickaxe',
  craft_stone_pickaxe:n=>n==='stone_pickaxe',craft_stone_sword:n=>n==='stone_sword',
  craft_furnace:n=>n==='furnace',craft_iron_pickaxe:n=>n==='iron_pickaxe',
  craft_diamond_gear:n=>n===decision.item,craft_netherite_ingot:n=>n==='netherite_ingot',
  craft_blaze_powder:n=>n==='blaze_powder',craft_eyes:n=>n==='eye_of_ender',
  craft_flint_steel:n=>n==='flint_and_steel',duplicate_template:n=>n==='netherite_upgrade_smithing_template',
  craft_smithing_table:n=>n==='smithing_table',smith_netherite:n=>n===decision.item,
  smelt_iron:n=>n==='iron_ingot',smelt_resource:n=>n===decision.output,
 };
 let gain=typeof expected[decision.kind]==='function' && newItems.some(expected[decision.kind]);
 if(decision.kind==='survey_ore'||decision.kind==='explore')gain=after.position?.x!==before.position?.x||after.position?.z!==before.position?.z;

 return {ok:gain,verified:gain,detail:gain?'MCP action succeeded and updated world was observed':'MCP settled but required world-state change was not observed'};
}
function craftItem(name,count=1){return {name:'craft_item',args:{items:[{item_name:name,count}]}};}
function planAction(decision,before,availableTools=new Map()){
 const i=observedWorld(before).inventory;
 const collect=(names,count=1)=>({alternatives:names.map(block_name=>({name:'collect_block',args:{block_name,count}}))});
 switch(decision.kind){
  case 'collect_wood': return collect(LOGS,1);
  case 'mine_cobblestone': return collect(['stone','deepslate'],3);
  case 'mine_iron':return collect(oreNames.iron,1);
  case 'mine_diamond':return collect(oreNames.diamond,1);
  case 'mine_obsidian':return collect(['obsidian'],1);
  case 'mine_ancient_debris':return collect(['ancient_debris'],1);
  case 'mine_netherrack':return collect(['netherrack'],4);
  case 'collect_flint':return collect(['gravel'],1);
  case 'craft_planks':{
   const log=LOGS.find(n=>inventoryCount(before,n)>0);
   if(!log)return {blocked:'No observed wood for planks'};
   return craftItem(log.replace(/_log$/,'_planks'),4);
  }
  case 'craft_sticks':return craftItem('stick',4);
  case 'craft_table':return craftItem('crafting_table');
  case 'craft_pickaxe':return craftItem('wooden_pickaxe');
  case 'craft_stone_pickaxe':return craftItem('stone_pickaxe');
  case 'craft_stone_sword':return craftItem('stone_sword');
  case 'craft_furnace':return craftItem('furnace');
  case 'craft_iron_pickaxe':return craftItem('iron_pickaxe');
  case 'craft_diamond_gear':return craftItem(decision.item);
  case 'craft_netherite_ingot':return craftItem('netherite_ingot');
  case 'craft_blaze_powder':return craftItem('blaze_powder',2);
  case 'craft_eyes':return craftItem('eye_of_ender');
  case 'craft_flint_steel':return craftItem('flint_and_steel');
  case 'duplicate_template':return craftItem('netherite_upgrade_smithing_template',2);
  case 'craft_smithing_table':return craftItem('smithing_table');
  case 'smith_netherite':{
   const base=NETHERITE_UPGRADES[decision.item];
   if(!base || decision.base!==base)return {blocked:'Invalid or mismatched vanilla Netherite smithing recipe'};
   if(!availableTools.has(SMITH_TOOL))return {blocked:'Mine AI MCP host does not advertise a verified smith_item extension; vanilla smithing unavailable'};
   if(inventoryCount(before,base)<1 || inventoryCount(before,'netherite_ingot')<1 ||
      inventoryCount(before,'netherite_upgrade_smithing_template')<1)
     return {blocked:'Missing server-observed diamond base, Netherite ingot or smithing upgrade template'};
   return {name:SMITH_TOOL,args:{base_item_name:base,
     template_item_name:'netherite_upgrade_smithing_template',
     addition_item_name:'netherite_ingot',output_item_name:decision.item}};
  }
  case 'equip_netherite':return {name:'equip',args:{items:Object.values(ARMOR).map(item_name=>({item_name}))}};
  case 'smelt_iron':return {name:'smelt_item',args:{item_name:'raw_iron',count:1,fuel_item_name:i.coal?'coal':Object.keys(i.raw).find(k=>k.endsWith('_planks')),temporary_workstation:true}};
  case 'smelt_resource':return {name:'smelt_item',args:{item_name:decision.input,count:1,fuel_item_name:i.coal?'coal':Object.keys(i.raw).find(k=>k.endsWith('_planks')),temporary_workstation:true}};
  case 'survey_ore':return {name:'explore_frontier',args:{heading:(decision.index*90)%360,chunks:1}};
  case 'explore':return {name:'explore_frontier',args:{heading:(decision.index*90)%360,chunks:1}};
  // An available MCP tool doesn't mean its game prerequisites were met.
  // Refuse unmapped stages and explain the missing adapter; no false win.
  default:return {blocked:'No grounded MCP action mapping for '+decision.kind};
 }
}
class GroundedMcpMission{
 constructor(client,{clock=()=>Date.now()}={}){this.client=client;this.controller=createController({clock,maxSeconds:43200,maxSteps:20000});this.last=null;}
 start(goal,seconds){return this.controller.start(goal,seconds);}
 status(){return this.controller.status();}
 stop(){return this.controller.stop('Operator requested stop');}
 async step({signal}={}){
  const beforeResult=await this.client.observe();const before=beforeResult?.response?.result?.situation||beforeResult?.result?.situation||beforeResult?.situation;
  const world=observedWorld(before);
  let decision=this.controller.next(world);
  if(decision.kind==='craft_table' && world.inventory.planks<4){
    decision=world.inventory.logs>0
      ? {kind:'craft_planks',why:'Convert existing logs into actual planks before crafting table'}
      : {kind:'collect_wood',why:'Gather logs for missing crafting table planks'};
  }
  if(['idle','blocked','complete','wait'].includes(decision.kind))return {decision,status:this.status(),verified:false,reason:'No physical action occurred'};
  const mapping=planAction(decision,before,this.client.tools);
  if(mapping.blocked){this.controller.stop(mapping.blocked);return {decision,status:this.status(),verified:false,reason:mapping.blocked};}
  const attempts=mapping.alternatives||[mapping];let outcome=null,lastError='';
  for(const action of attempts){
   if(!this.client.tools.has(action.name)){lastError='MCP tool unavailable: '+action.name;continue;}
   try{
    const res=await this.client.action(action.name,{...action.args,rationale:'Advance the observed JARVIS Minecraft mission: '+decision.kind},{signal,maxWaitMs:90000});
    if(res.state!=='settled'){this.controller.stop('MCP foreground action remains pending; do not duplicate side effects');return {decision,status:this.status(),verified:false,pending:res.actionId,reason:'Unsettled action; manual reconciliation required'};}
    if(res.output?.result?.status==='succeeded'){outcome=res;break;}
    lastError='MCP '+action.name+' settled '+String(res.output?.result?.status||'unknown');
   }catch(e){lastError=String(e.message||e);break;}
  }
  if(!outcome){this.controller.record(decision,{ok:false,verified:false,detail:lastError});return {decision,status:this.status(),verified:false,reason:lastError};}
  const afterResult=await this.client.observe();const after=afterResult?.response?.result?.situation||afterResult?.result?.situation||afterResult?.situation;
  observedWorld(after);
  const checked=checkedOutcome(before,after,outcome,decision);
  // Armor is judged only against actual current equipment slots.
  if(decision.kind==='equip_netherite'){
    checked.ok=checked.verified=observedWorld(after).wornNetherite;
    if(checked.verified)checked.proof='netherite_equipped';
  }
  this.controller.record(decision,checked);
  this.last={decision:decision.kind,result:checked.detail,verified:checked.verified};
  return {decision,status:this.status(),verified:checked.verified,reason:checked.detail};
 }
}
module.exports={GroundedMcpMission,observedWorld,planAction,checkedOutcome,ARMOR};
