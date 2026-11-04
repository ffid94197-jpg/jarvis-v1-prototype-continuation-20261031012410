'use strict';
/**
 * Owner-language adapter for existing bounded Mineflayer commands.
 * Parser output is UNTRUSTED until friend_protocol validates every field and
 * bot.cjs checks actual world state. No arbitrary scripts or admin commands.
 */
const NUMBER_WORDS=Object.freeze({a:1,an:1,one:1,two:2,three:3,four:4,five:5,
 six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,
 fourteen:14,fifteen:15,sixteen:16});
const COUNT='(?:\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)';
const coord='(-?\\d{1,8})[\\s,]+(-?\\d{1,8})[\\s,]+(-?\\d{1,8})';
const validItem=/^[a-z0-9_]{1,64}$/;
function itemName(value){
 if(typeof value!=='string')return null;
 let s=value.toLowerCase().trim().replace(/[\s-]+/g,'_');
 if(s.endsWith('s')&&!/(?:glass|grass|stairs|compass|cactus|chorus|blaze_powder)$/.test(s))
   s=s.slice(0,-1);
 return validItem.test(s)?s:null;
}
const amount=v=>/^\d+$/.test(v)?Number(v):NUMBER_WORDS[v];
const point=m=>({x:Number(m[1]),y:Number(m[2]),z:Number(m[3])});
function parseOwnerPrimitive(text){
 if(typeof text!=='string'||text.length>600)return null;
 const s=text.toLowerCase().trim().replace(/\s+/g,' ');
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
 move:['directionInput','durationMs'],use_item:['hand'],say:['text']
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
  use_item:/\b(?:use|eat|consume|shoot)\b/,say:/\b(?:say|tell|message)\b/
 };
 if(!verbs[command.command]?.test(s))return false;
 if(['craft_item','equip_item','place_block'].includes(command.command)){
  const label=String(command.item||'').replace(/_/g,' ');
  if(!label||!s.includes(label))return false;
 }
 if(command.command==='craft_item'){
  const countText=String(s).match(/\b(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b/);
  if(countText && amount(countText[0])!==command.count)return false;
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
 if(command.command==='interact_entity'){
  if(!Number.isInteger(command.entityId)||
    !Array.isArray(scene?.threats)||!scene.threats.some(t=>t.id===command.entityId))return false;
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
function modelGoalGrounded(q,ownerText){
 if(!q||q.command!=='auto_goal'||typeof q.goal!=='string')return false;
 const s=String(ownerText||'').toLowerCase().replace(/_/g,' ');
 const has=expression=>expression.test(s);
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
  case 'dragon_run':return has(/\b(?:defeat|beat|kill|slay|fight)\b/)&&has(/\bdragon\b/);
  case 'netherite_dragon_run':case 'dragon_then_netherite_run':
   return has(/\bdragon\b/)&&has(/\bnetherite\b/)&&
     has(/\b(?:defeat|beat|kill|slay|fight)\b/);
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
   const aliases=q.resource==='logs'?/\b(?:wood|logs?|timber)\b/:
     q.resource==='iron_ingot'?/\biron ingots?\b/:
     q.resource==='raw_iron'?/\braw iron\b/:
     new RegExp('\\b'+String(q.resource||'').replace(/_/g,' ')+'s?\\b');
   return has(/\b(?:gather|mine|collect|obtain|find|get|bring|dig)\b/)&&
     aliases.test(s)&&quantityMatches(q.targetCount);
  }
  case 'craft':return has(/\b(?:craft|make)\b/)&&
    itemMention(q.item)&&quantityMatches(q.targetCount);
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
  case 'build':return has(/\b(?:build|construct|place)\b/)&&
    itemMention(q.block)&&has(/\b(?:wall|line|row)\b/);
  case 'farm_wheat':return has(/\b(?:farm|grow|plant|harvest)\b/)&&has(/\bwheat\b/);
  case 'sequence':{
   if(!Array.isArray(q.steps)||!has(/\b(?:then|after that|next)\b/))return false;
   const pieces=s.split(/\s+(?:and then|then|after that|next)\s+/);
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
module.exports={parseOwnerPrimitive,PRIMITIVE_FIELDS,GENERAL_ACTIONS,modelPrimitiveGrounded,modelGoalGrounded,itemName};
