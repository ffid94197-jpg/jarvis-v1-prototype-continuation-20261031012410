'use strict';
/**
 * Owner-language adapter for existing bounded Mineflayer commands.
 * Parser output is UNTRUSTED until friend_protocol validates every field and
 * bot.cjs checks actual world state. No arbitrary scripts or admin commands.
 */
const {roofedRoomSteps}=require('./structure_goal.cjs');
const {SMELT_RECIPES}=require('./smelt_goal.cjs');
// A whole armor set is an owner-defined four-slot objective, not permission
// to select arbitrary equipment or execute raw Minecraft actions.
function armorEquipSteps(ownerText){
 if(typeof ownerText!=='string'||ownerText.length>600)return null;
 const s=ownerText.toLowerCase().trim().replace(/^in minecraft[, :]+/,'')
   .replace(/^(?:(?:can|could|would) you (?:please )?|please )/,'')
   .replace(/\s+in minecraft$/,'').replace(/\s+/g,' ');
 const m=/^(?:equip|wear|put on)(?: me)? (?:a |the |my )?(?:full |complete )?(?:set of )?(leather|iron|gold|golden|diamond) (?:armor|armour)(?: set)?$/.exec(s);
 if(!m)return null;
 const tier=m[1]==='gold'?'golden':m[1];
 return [['helmet','head'],['chestplate','torso'],['leggings','legs'],['boots','feet']]
   .map(([part,destination])=>({goal:'equip',item:tier+'_'+part,destination}));
}
const NUMBER_WORDS=Object.freeze({a:1,an:1,one:1,two:2,three:3,four:4,five:5,
 six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,
 fourteen:14,fifteen:15,sixteen:16});
const COUNT='(?:\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)';
const coord='(-?\\d{1,8})[\\s,]+(-?\\d{1,8})[\\s,]+(-?\\d{1,8})';
const validItem=/^[a-z0-9_]{1,64}$/;
function itemName(value){
 if(typeof value!=='string'||/\b(?:stack|stacks|some|many|several|lots|enough|all)\b/i.test(value))return null;
 let s=value.toLowerCase().trim().replace(/[\s-]+/g,'_');
 // Many vanilla IDs are intentionally plural; a blind trailing-'s'
 // removal changes oak_planks to the nonexistent oak_plank.
 const canonicalPlural=/(?:^|_)(?:planks|stairs|leaves|bricks|bars|seeds|berries|boots|leggings|shears)$/;
 if(!canonicalPlural.test(s)&&s.endsWith('s')){
   if(/torches$/.test(s))s=s.replace(/torches$/,'torch');
   else if(/pickaxes$/.test(s))s=s.replace(/pickaxes$/,'pickaxe');
   else if(/potatoes$/.test(s))s=s.replace(/potatoes$/,'potato');
   else if(!/(?:glass|grass|compass|cactus|chorus)$/.test(s))s=s.slice(0,-1);
 }
 return validItem.test(s)?s:null;
}
const amount=v=>/^\d+$/.test(v)?Number(v):NUMBER_WORDS[v];
const point=m=>({x:Number(m[1]),y:Number(m[2]),z:Number(m[3])});
function parseOwnerPrimitive(text){
 if(typeof text!=='string'||text.length>600)return null;
 const s=text.toLowerCase().trim().replace(/\s+/g,' ').replace(/\s+(?:for me|please)$/,'');
 if(/\b(?:don't|do not|never|must not|not to|without)\b/.test(s))return null;
 // Coordinates must come from the owner's actual words, not the model's guess.
 let m=new RegExp('^(?:go|walk|move|travel|navigate)(?: to)? (?:coordinates? )?'+coord+'$').exec(s);
 if(m)return {command:'auto_goal',goal:'travel',destination:point(m),arrivalRange:2};
 m=new RegExp('^(?:inspect|examine|check|look at)(?: the)? block(?: at)? '+coord+'$').exec(s);
 if(m)return {command:'inspect_block',position:point(m)};
 m=new RegExp('^(?:dig|break|mine)(?: the)? block(?: at)? '+coord+'$').exec(s);
 if(m)return {command:'dig_block',position:point(m)};
 m=new RegExp('^(?:interact with|use|activate|open)(?: the)? block(?: at)? '+coord+'$').exec(s);
 if(m)return {command:'interact_block',position:point(m)};
 m=new RegExp('^(?:place|put) (?:a |an |the )?([a-z_ ]{2,60}) (?:on top of|above) (?:the )?block(?: at)? '+coord+'$').exec(s);
 if(m){
  const item=itemName(m[1]);
  return item?{command:'place_block',item,reference:point(m.slice(1)),face:{x:0,y:1,z:0}}:null;
 }
 m=new RegExp('^(?:craft|make)(?: me)? ('+COUNT+') ([a-z_ ]{2,60})$').exec(s);
 if(m){
  const item=itemName(m[2]);
  return item?{command:'craft_item',item,count:amount(m[1])}:null;
 }
 m=/^(?:craft|make)(?: me)? (?:a|an|one) ([a-z_ ]{2,60})$/.exec(s);
 if(m){const item=itemName(m[1]);return item?{command:'craft_item',item,count:1}:null;}
 m=/^(?:wear|equip|wield|hold|put on) (?:the |a |an |my )?([a-z_ ]{2,60})$/.exec(s);
 if(m){
  const item=itemName(m[1]);
  if(!item)return null;
  const destination=/_helmet$/.test(item)?'head':/_chestplate$/.test(item)||item==='elytra'?'torso':
    /_leggings$/.test(item)?'legs':/_boots$/.test(item)?'feet':'hand';
  return {command:'equip_item',item,destination};
 }
 m=/^(?:move|walk|step) (forward|backward|back|left|right) for (\d{1,4}) (?:ms|milliseconds?)$/.exec(s);
 if(m){
  const directionInput=m[1]==='backward'?'back':m[1];
  return {command:'move',directionInput,durationMs:Number(m[2])};
 }
 return null;
}
const PRIMITIVE_FIELDS=Object.freeze({
 craft_item:['item','count'],equip_item:['item','destination'],
 inspect_block:['position'],dig_block:['position'],
 navigate:['position','range'],interact_block:['position'],
 interact_entity:['entityId'],place_block:['item','reference','face'],
 move:['directionInput','durationMs'],use_item:['hand'],say:['text'],
 inspect_villager:['entityId'],trade_villager:['entityId','tradeIndex','times'],
 transfer_container:['position','item','count','operation'],
 enchant_item:['position','item','choice'],
 attack_hostile:['entityId','maxSwings']
});
const GENERAL_ACTIONS=Object.freeze(Object.keys(PRIMITIVE_FIELDS));
function modelPrimitiveGrounded(command,ownerText,context){
 if(!command||!Object.hasOwn(PRIMITIVE_FIELDS,command.command))return false;
 const s=String(ownerText||'').toLowerCase();
 // Model output is never an owner instruction by itself.
 const verbs={
  craft_item:/\b(?:craft|make)\b/,equip_item:/\b(?:wear|equip|wield|hold|put on)\b/,
  inspect_block:/\b(?:inspect|examine|check|look at)\b/,
  dig_block:/\b(?:mine|dig|break)\b/,navigate:/\b(?:go|walk|travel|navigate|move)\b/,
  interact_block:/\b(?:interact|activate|open|use)\b/,
  interact_entity:/\b(?:interact|trade|mount|use)\b/,
  place_block:/\b(?:place|put|build)\b/,move:/\b(?:move|walk|step)\b/,
  use_item:/\b(?:use|eat|consume|shoot)\b/,say:/\b(?:say|tell|message)\b/,
  inspect_villager:/\b(?:inspect|show|view|check|list)\b/,
  trade_villager:/\b(?:trade|buy|purchase|exchange)\b/,
  transfer_container:/\b(?:store|deposit|put|take|withdraw|retrieve)\b/,
  enchant_item:/\b(?:enchant|enchantment)\b/,
  attack_hostile:/\b(?:attack|fight|defeat|slay|kill)\b/
 };
 if(!verbs[command.command]?.test(s))return false;
 if(['craft_item','equip_item','place_block'].includes(command.command)){
  const label=String(command.item||'').replace(/_/g,' ');
  if(!label||!s.includes(label))return false;
 }
 if(command.command==='craft_item'){
  // A model may not choose an arbitrary quantity for "make a sword", or
  // silently turn "a stack" into one item. Multi-action instructions need
  // a verified sequence, not partial completion of the first clause.
  if(/\b(?:stack|stacks|some|many|several|lots|all|enough)\b/.test(s)||
     /\b(?:then|after that|and then)\b/.test(s))return false;
  const counts=s.match(/\b(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b/g)||[];
  if(counts.length>1)return false;
  if(counts.length===1 && amount(counts[0])!==command.count)return false;
  if(counts.length===0 && command.count!==1)return false;
 }
 if(command.command==='say' && !s.includes(String(command.text||'').toLowerCase()))return false;
 let scene;
 try{scene=JSON.parse(context);}catch{scene=null;}
 const exactOwnerTriplet=(p)=>{
  if(!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||!Number.isInteger(p.z))return false;
  const triplets=s.match(/-?\d{1,8}[\s,]+-?\d{1,8}[\s,]+-?\d{1,8}/g)||[];
  return triplets.some(v=>{
   const a=v.match(/-?\d+/g)?.map(Number);
   return a?.length===3&&a[0]===p.x&&a[1]===p.y&&a[2]===p.z;
  });
 };
 const sceneBlock=(p)=>Array.isArray(scene?.nearbyBlocks)&&scene.nearbyBlocks.some(b=>
  b&&b.x===p?.x&&b.y===p?.y&&b.z===p?.z);
 const target=command.command==='place_block'?command.reference:command.position;
 if(target!==undefined && !(exactOwnerTriplet(target)||sceneBlock(target)))return false;
 // A model may choose an observed nearby object only when its actual type
 // appears in the owner's request. "Go somewhere" or "mine something" is
 // not permission to select a random live coordinate.
 if(['navigate','dig_block','inspect_block'].includes(command.command) &&
    !exactOwnerTriplet(target)){
   const observed=Array.isArray(scene?.nearbyBlocks)?scene.nearbyBlocks.find(b=>
     b?.x===target?.x&&b?.y===target?.y&&b?.z===target?.z):null;
   if(!observed?.name)return false;
   const noun=String(observed.name).replace(/_/g,' ');
   const aliases=String(observed.name)==='trapped_chest'?['chest']:
     /_door$/.test(observed.name)?['door']:
     /_trapdoor$/.test(observed.name)?['trapdoor']:
     /_button$/.test(observed.name)?['button']:
     /^(?:deepslate_)?(?:iron|diamond)_ore$/.test(observed.name)?
       [String(observed.name).includes('diamond')?'diamond':'iron','ore']:[];
   if(![noun,...aliases].some(label=>s.includes(label)))return false;
 }
 if(command.command==='attack_hostile'){
  const threat=Number.isInteger(command.entityId)&&Array.isArray(scene?.threats)?
    scene.threats.find(t=>t.id===command.entityId):null;
  if(!threat||typeof threat.name!=='string'||!s.includes(threat.name.replace(/_/g,' '))||
     !Number.isInteger(command.maxSwings)||command.maxSwings<1||command.maxSwings>4)
    return false;
  const count=s.match(/\b(?:up to )?(\d{1,2}) (?:hits|swings|times)\b/);
  if(count?Number(count[1])!==command.maxSwings:command.maxSwings!==4)return false;
 }
 if(['inspect_villager','trade_villager'].includes(command.command)){
  if(!Number.isInteger(command.entityId)||
     !Array.isArray(scene?.villagers)||
     !scene.villagers.some(v=>v.id===command.entityId&&v.name==='villager'))
    return false;
  if(!/\bvillager\b/.test(s))return false;
  if(command.command==='trade_villager'){
   const index=command.tradeIndex+1;
   if(!new RegExp('\\b(?:offer|trade|option|deal)\\s*(?:number|#)?\\s*'+index+'\\b').test(s))
    return false;
   const reps=s.match(/\b(?:once|twice|three times|four times)\b/);
   const expected=reps?({once:1,twice:2,'three times':3,'four times':4})[reps[0]]:1;
   if(command.times!==expected)return false;
  }
 }
 if(command.command==='transfer_container'){
  if(!['deposit','withdraw'].includes(command.operation))return false;
  const label=String(command.item||'').replace(/_/g,' ');
  if(!label||!s.includes(label))return false;
  const deposits=/\b(?:store|deposit|put)\b/.test(s);
  const withdraws=/\b(?:withdraw|take|retrieve|get)\b/.test(s);
  if(command.operation==='deposit'?!deposits:!withdraws)return false;
  const count=s.match(/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b/);
  if(count?amount(count[0])!==command.count:command.count!==1)return false;
  if(!Array.isArray(scene?.nearbyBlocks)||!scene.nearbyBlocks.some(b=>
    ['chest','trapped_chest','barrel'].includes(b.name)&&
    b.x===command.position?.x&&b.y===command.position?.y&&b.z===command.position?.z))
    return false;
 }
 if(command.command==='enchant_item'){
  if(!/\benchant\b/.test(s)||!s.includes(String(command.item||'').replace(/_/g,' ')))return false;
  const expected=/\bfirst\b/.test(s)?0:/\bsecond\b/.test(s)?1:/\bthird\b/.test(s)?2:null;
  if(expected===null||expected!==command.choice)return false;
  if(!Array.isArray(scene?.nearbyBlocks)||!scene.nearbyBlocks.some(b=>
    b.name==='enchanting_table'&&b.x===command.position?.x&&
    b.y===command.position?.y&&b.z===command.position?.z))return false;
 }
 if(command.command==='interact_entity'){
  const entity=Number.isInteger(command.entityId) && Array.isArray(scene?.threats)?
    scene.threats.find(t=>t.id===command.entityId):null;
  if(!entity||typeof entity.name!=='string'||
     !s.includes(entity.name.replace(/_/g,' ').toLowerCase()))return false;
 }
 if(command.command==='interact_block'){
  const observed=Array.isArray(scene?.nearbyBlocks)?
    scene.nearbyBlocks.find(b=>b.x===target?.x&&b.y===target?.y&&b.z===target?.z):null;
  if(!observed||typeof observed.name!=='string')return false;
  // A model cannot treat a neighboring door as the requested chest. Require
  // the current source observation plus an exact owner-mentioned block type.
  const categories=[
    [/\bchests?\b/,/^(?:chest|trapped_chest)$/],
    [/\bbarrels?\b/,/^barrel$/],
    [/\btrapdoors?\b/,/^[a-z_]+_trapdoor$/],
    [/\bdoors?\b/,/^[a-z_]+_door$/],
    [/\blevers?\b/,/^lever$/],
    [/\bbuttons?\b/,/^[a-z_]+_button$/],
    [/\bfurnaces?\b/,/^furnace$/],
    [/\bcrafting tables?\b/,/^crafting_table$/],
    [/\bsmithing tables?\b/,/^smithing_table$/]
  ];
  if(categories.some(([noun,type])=>noun.test(s)&&!type.test(observed.name)))return false;
 }
 if(command.command==='dig_block'){
  const observed=Array.isArray(scene?.nearbyBlocks)?
    scene.nearbyBlocks.find(b=>b.x===target?.x&&b.y===target?.y&&b.z===target?.z):null;
  if(!observed || typeof observed.name!=='string')return false;
  const named=scene.nearbyBlocks.filter(b=>b&&typeof b.name==='string'&&
    s.includes(b.name.replace(/_/g,' ').toLowerCase()));
  if(named.length && !named.some(b=>b.x===target.x&&b.y===target.y&&b.z===target.z))return false;
 }
 if(command.command==='place_block' && !sceneBlock(target) && !exactOwnerTriplet(target))return false;
 if(command.command==='use_item' && !scene?.joined)return false;
 return true;
}
/**
 * Defend the long-horizon model route against changing the owner's objective.
 * This only authorizes a typed proposal to proceed to the existing validator
 * and runtime checks; it is not completion evidence or extra tool authority.
 */
function modelGoalGrounded(q,ownerText,context=''){
 if(!q||q.command!=='auto_goal'||typeof q.goal!=='string')return false;
 const s=String(ownerText||'').toLowerCase().replace(/_/g,' ');
 const has=expression=>expression.test(s);
 // Do not reduce "mine then craft" or a different compound owner request
 // into one model-selected subgoal. The typed sequence controller must
 // verify every constituent stage independently.
 const multiPart=has(/\b(?:then|after that|afterwards?|next)\b/)||
   has(/\band(?:\s+then)?\s+(?:mine|craft|make|build|gather|collect|equip|wear|defeat|beat|fight|travel|go|place)\b/);
 // A full Netherite armor AND sword request is one explicit loadout
 // outcome handled by the native smithing goal. It is not an unrelated
 // model-invented two-step sequence. All other conjunctions still require
 // a fully validated owner-matched sequence or approved Dragon order.
 if(multiPart&&!['sequence','netherite_dragon_run','dragon_then_netherite_run',
   'netherite_gear_run'].includes(q.goal))return false;
 if(has(/\b(?:stack|stacks|several|lots|all)\b/) && ['gather','craft'].includes(q.goal))return false;
 const itemMention=name=>typeof name==='string'&&
   (s.includes(name.replace(/_/g,' '))||s.includes(name.replace(/_/g,' ')+'s'));
 const explicitQuantity=()=>{
  const counts=s.match(/\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b/g);
  return counts&&counts.length===1?amount(counts[0]):null;
 };
 const quantityMatches=qty=>{
  if(!Number.isInteger(qty))return false;
  const count=explicitQuantity();
  return count===null?qty===1:qty===count;
 };
 switch(q.goal){
  case 'netherite_armor_run':case 'netherite_gear_run':{
   const explicitlyNamed=/\bnetherite\s+(?:armor|armour)\b/.test(s);
   const approved=/\b(?:get|obtain|make|craft|equip|wear|put on)\b/.test(s);
   const wantsSword=/\bnetherite\s+sword\b/.test(s);
   return explicitlyNamed && approved && !has(/\b(?:dragon|ender dragon)\b/) &&
     (q.goal==='netherite_gear_run'?wantsSword:!wantsSword);
  }
  case 'dragon_run':return !has(/\bnetherite\b/) &&
   has(/\b(?:defeat|beat|kill|slay|fight)\b/)&&has(/\bdragon\b/);
  case 'netherite_dragon_run':case 'dragon_then_netherite_run':{
   if(!has(/\bdragon\b/)||!has(/\bnetherite\b/)||
      !has(/\b(?:defeat|beat|kill|slay|fight)\b/))return false;
   // Explicit ordering is part of the owner instruction. Never satisfy
   // "beat Dragon THEN get Netherite" with the reverse mission.
   if(multiPart){
     const dragonFirst=s.indexOf('dragon')<s.indexOf('netherite');
     return q.goal===(dragonFirst?'dragon_then_netherite_run':'netherite_dragon_run');
   }
   return true;
  }
  case 'defeat_hostile':{
   const mob=q.mob,entityId=q.entityId;
   if(!ALLOWED_HOSTILES.has(mob)||!Number.isInteger(entityId)||entityId<0||entityId>200000)
     return false;
   if(!/\b(?:defeat|kill|slay|eliminate|take out)\b/.test(s) ||
      !s.includes(String(mob).replace(/_/g,' '))||
      /\b(?:player|villager|creeper|dragon|wither)\b/.test(s))return false;
   // A model cannot choose a target ID not present in the current managed
   // observation, or select arbitrarily among multiple same-name threats.
   // The live executor still rechecks identity/range immediately before any
   // movement or attack; this is grounding, not permission.
   let scene;try{scene=JSON.parse(String(context||''));}catch{return false;}
   const matches=Array.isArray(scene?.threats)?scene.threats.filter(t=>
     t?.name===mob&&Number.isInteger(t.id)&&Number.isFinite(t.distance)&&
     t.distance>=0&&t.distance<=12):[];
   return matches.length===1&&matches[0].id===entityId;
  }
  case 'shelter':{
   const sentence=s.replace(/^in minecraft[, :]+/,'').replace(/\s+in minecraft$/,'');
   return /^(?:build|construct|make)(?: me)? (?:a |the )?(?:small|simple|basic) (?:cobblestone |stone )?(?:shelter|hut)(?: here| nearby| near you)?$/.test(sentence);
  }
  case 'survive':return has(/\b(?:survive|survival|stay alive)\b/);
  case 'wood':return has(/\b(?:collect|gather|get|mine|find)\b/)&&has(/\b(?:wood|logs?)\b/);
  case 'tools':return has(/\b(?:tools?|pickaxes?)\b/)&&has(/\b(?:craft|make|get|obtain|upgrade)\b/);
  case 'stone_age':return has(/\bstone\b/)&&has(/\b(?:tools?|pickaxes?|swords?|age)\b/);
  case 'iron_age':return has(/\biron\b/)&&has(/\b(?:tools?|pickaxes?|swords?|age|armor)\b/);
  case 'explore':return has(/\b(?:explore|scout|search|survey)\b/);
  case 'companion':return has(/\b(?:play|join|companion|teammate)\b/);
  case 'follow':return has(/\bfollow\b/);
  case 'guard':return has(/\b(?:guard|protect|defend)\b/);
  case 'gather':{
   if(q.resource==='sand'&&/\bred sand\b/.test(s))return false;
   const aliases=q.resource==='logs'?/\b(?:wood|logs?|timber)\b/:
     q.resource==='iron_ingot'?/\biron ingots?\b/:
     q.resource==='raw_iron'?/\braw iron\b/:
     q.resource==='raw_copper'?/\b(?:raw )?copper\b/:
     q.resource==='raw_gold'?/\b(?:raw )?gold\b/:
     q.resource==='lapis_lazuli'?/\b(?:lapis lazuli|lapis)\b/:
     q.resource==='quartz'?/\b(?:nether )?quartz\b/:
     new RegExp('\\b'+String(q.resource||'').replace(/_/g,' ')+'s?\\b');
   return has(/\b(?:gather|mine|collect|obtain|find|get|bring|dig)\b/)&&
     aliases.test(s)&&quantityMatches(q.targetCount);
  }
  case 'craft':return has(/\b(?:craft|make)\b/)&&
    itemMention(q.item)&&quantityMatches(q.targetCount);
  case 'smelt':{
   const rule=SMELT_RECIPES[q.item];
   if(!rule||!has(/\b(?:smelt|cook|refine|bake)\b/) ||
      !quantityMatches(q.targetCount))return false;
   const product=q.item.replace(/_/g,' ');
   const origin=rule.input.replace(/_/g,' ');
   const source=rule.input==='raw_iron'?/\b(?:raw iron|iron ore|iron ingot)\b/:
      rule.input==='raw_gold'?/\b(?:raw gold|gold ore|gold ingot)\b/:
      rule.input==='raw_copper'?/\b(?:raw copper|copper ore|copper ingot)\b/:
      rule.input==='ancient_debris'?/\b(?:ancient debris|netherite scrap)\b/:
      new RegExp('\\b'+origin.replace(/ /g,'\\s+')+'\\b');
   if(!source.test(s)&&!s.includes(product))return false;
   const named=/\b(?:into|to make|for)\s+([a-z ]{2,35})$/.exec(s.trim());
   const label=named?.[1].trim();
   const singular=label==='glass'?'glass':
     label?.replace(/potatoes$/,'potato').replace(/s$/,'');
   return !named || singular===product;
  }
  case 'equip':return has(/\b(?:wear|equip|wield|hold|put on)\b/)&&itemMention(q.item);
  case 'travel':{
   if(!has(/\b(?:travel|walk|go|navigate|reach|head)\b/)||
      !q.destination||typeof q.destination!=='object')return false;
   const p=q.destination;
   const triplets=s.match(/-?\d{1,8}[\s,]+-?\d{1,8}[\s,]+-?\d{1,8}/g)||[];
   return triplets.some(t=>{
    const xyz=t.match(/-?\d+/g)?.map(Number);
    return xyz?.length===3&&xyz[0]===p.x&&xyz[1]===p.y&&xyz[2]===p.z;
   });
  }
  case 'build_volume':{
   if(!has(/\b(?:build|construct|make)\b/))return false;
   if(!s.includes(String(q.block||'').replace(/_/g,' ')))return false;
   const shapeWord=q.shape==='walls'?'walls?':String(q.shape||'');
   if(!new RegExp('\\b'+shapeWord+'\\b').test(s))return false;
   const dimensions=s.match(/\b(\d{1,2}) by (\d{1,2})(?: by (\d{1,2}))?\b/);
   if(!dimensions||Number(dimensions[1])!==q.width||
      Number(dimensions[2])!==q.depth||
      (dimensions[3]?Number(dimensions[3]):1)!==q.height)return false;
   const point=q.position;
   if(!point||!Number.isInteger(point.x)||!Number.isInteger(point.y)||
      !Number.isInteger(point.z))return false;
   const triplet=s.match(/-?\d{1,8}[\s,]+-?\d{1,8}[\s,]+-?\d{1,8}/g)||[];
   return triplet.some(t=>{
    const v=t.match(/-?\d+/g)?.map(Number);
    return v?.length===3&&v[0]===point.x&&v[1]===point.y&&v[2]===point.z;
   });
  }
  case 'build':return has(/\b(?:build|construct|place)\b/)&&
    itemMention(q.block)&&has(/\b(?:wall|line|row)\b/);
  case 'farm_wheat':return has(/\b(?:farm|grow|plant|harvest)\b/)&&has(/\bwheat\b/);
  case 'sequence':{
   const armor=armorEquipSteps(s);
   if(armor){
    return Array.isArray(q.steps)&&q.steps.length===4&&
     armor.every((expected,i)=>{
      const got=q.steps[i];
      return got&&typeof got==='object'&&!Array.isArray(got)&&
       Object.keys(got).length===3&&
       Object.keys(got).every(k=>Object.hasOwn(expected,k))&&
       Object.keys(expected).every(k=>got[k]===expected[k]);
     });
   }
   // Validate a model-proposed compact room plan against the *owner's*
   // exact dimensions, material and origin. Three stages must be identical
   // to the independent deterministic native recipe; no added side effects.
   const text=s.replace(/^in minecraft\s+/,'').replace(/\s+in minecraft$/,'').trim();
   const room=/^(?:build|construct|make)(?: me)? (?:a )?(\d{1,2}) by (\d{1,2}) by (\d{1,2}) ([a-z_ ]{2,35}?) (?:roofed room|roofed shelter|shelter) (?:at|starting at|from) (?:coordinates? )?(-?\d{1,8})[\s,]+(-?\d{1,8})[\s,]+(-?\d{1,8})$/.exec(text);
   if(room){
    const steps=roofedRoomSteps({
     position:{x:Number(room[5]),y:Number(room[6]),z:Number(room[7])},
     block:itemName(room[4]),width:Number(room[1]),depth:Number(room[2]),
     wallHeight:Number(room[3])
    });
    return !!steps&&Array.isArray(q.steps)&&q.steps.length===steps.length&&
      steps.every((expected,i)=>{
       const got=q.steps[i];
       if(!got||typeof got!=='object'||Array.isArray(got)||
          Object.keys(got).length!==7||Object.keys(got).some(k=>!Object.hasOwn(expected,k)))
         return false;
       return Object.keys(expected).every(k=>
         k==='position'?
          got.position&&typeof got.position==='object'&&!Array.isArray(got.position)&&
          Object.keys(got.position).length===3&&
          ['x','y','z'].every(axis=>got.position[axis]===expected.position[axis]):
         got[k]===expected[k]);
      });
   }
   if(!Array.isArray(q.steps)||!(
   has(/\b(?:then|after that|next)\b/)||
   has(/\band\s+(?:mine|craft|make|build|gather|collect|equip|wear|travel|go|obtain|get|find|bring)\b/)
  ))return false;
   const pieces=s.split(/\s+(?:and then|then|after that|next)\s+|\s+and\s+(?=(?:mine|craft|make|build|gather|collect|equip|wear|travel|go|obtain|get|find|bring)\b)/);
   if(pieces.length!==q.steps.length)return false;
   return q.steps.every((step,i)=>{
    const normalized={command:'auto_goal',...step};
    if(step.goal==='equip'&&step.destination!==undefined){
      normalized.destinationSlot=step.destination;delete normalized.destination;
    }
    return modelGoalGrounded(normalized,pieces[i]);
   });
  }
  default:return false;
 }
}
function modelSimpleGrounded(command,ownerText){
 const text=String(ownerText||'').toLowerCase();
 const patterns={
  follow:/\b(?:follow|stay with me)\b/,
  come:/\b(?:come here|come to me|come over)\b/,
  stay:/\b(?:stay|wait here|don't move)\b/,
  guard:/\b(?:guard|protect|defend)\b/,
  status:/\b(?:status|how are you|progress)\b/,
  inventory:/\b(?:inventory|items do you have)\b/,
  observe:/\b(?:observe|look around|what do you see)\b/,
  auto_status:/\b(?:status|progress|how far)\b/,
  auto_stop:/\b(?:stop|pause|cancel|halt)\b/,
  auto_resume:/\b(?:continue|resume|carry on|keep going)\b/
 };
 return Object.hasOwn(patterns,command)&&patterns[command].test(text);
}
module.exports={parseOwnerPrimitive,PRIMITIVE_FIELDS,GENERAL_ACTIONS,modelPrimitiveGrounded,modelGoalGrounded,modelSimpleGrounded,itemName,armorEquipSteps};
