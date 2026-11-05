/** Plain-language Minecraft mission selection.
 * This router only chooses an owner-intent-limited native goal. It does NOT
 * authorize a game action, start a process or prove any in-game achievement.
 * Guardian and real Mineflayer observations remain separate requirements.
 */
export type MinecraftMissionGoal =
  | "companion" | "dragon_run" | "netherite_dragon_run"
  | "dragon_then_netherite_run" | "netherite_armor_run"
  | "netherite_gear_run" | "gather";

/**
 * Shared bounded quantity grammar for Core direct intent and the Minecraft
 * model-proposal gate. A word count must not be mistaken for the default 1
 * or silently changed by an untrusted model (e.g. "twenty one diamonds").
 */
const COUNT_SMALL: Record<string,number> = {
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,
  sixteen:16,seventeen:17,eighteen:18,nineteen:19
};
const COUNT_TENS: Record<string,number> = {
  twenty:20,thirty:30,forty:40,fifty:50,sixty:60
};
export const MINECRAFT_COUNT_TOKEN = "(?:" +
  [
    ...Object.keys(COUNT_SMALL),
    ...Object.keys(COUNT_TENS).flatMap(t=>[
      t,...Object.keys(COUNT_SMALL).filter(w=>COUNT_SMALL[w]<10)
        .map(w=>t+"[ -]"+w)
    ]),
    "a","an","single"
  ].sort((a,b)=>b.length-a.length).join("|") +
  "|\\d+)";

export function parseMinecraftCount(raw:string):number|null {
  if(typeof raw!=="string" || raw.length>30)return null;
  const s=raw.trim().toLowerCase().replace(/-/g," ").replace(/\s+/g," ");
  let n:number|undefined;
  if(/^\d+$/.test(s))n=Number(s);
  else if(s==="a"||s==="an"||s==="single")n=1;
  else if(Object.hasOwn(COUNT_SMALL,s))n=COUNT_SMALL[s];
  else if(Object.hasOwn(COUNT_TENS,s))n=COUNT_TENS[s];
  else {
    const [t,u,extra]=s.split(" ");
    if(!extra && Object.hasOwn(COUNT_TENS,t) &&
       Object.hasOwn(COUNT_SMALL,u) && COUNT_SMALL[u]<10)
      n=COUNT_TENS[t]+COUNT_SMALL[u];
  }
  return Number.isSafeInteger(n) && n!>=1 && n!<=64 ? n! : null;
}

/**
 * A single exact owner-specified resource request, in ordinary language.
 * The Minecraft scope must be explicit. Never infer permission from "wood"
 * or "iron" alone, silently invent a quantity, or reduce compound requests.
 * The result is an intent ONLY; Guardian and server proof are still mandatory.
 */
export function directResourceGatherFromObjective(objective:string):
  {resource:string;targetCount:number}|null{
  if(typeof objective!=="string" || objective.length>220)return null;
  let s=objective.trim().toLowerCase()
    .replace(/[.!?]+$/,"").replace(/\s+/g," ")
    .replace(/^(?:hey\s+)?jarvis(?:buddy)?[,!:\s]+/,"");
  const courtesy=/^(?:(?:can|could|would|will) you(?: please)?|please)\s+/;
  s=s.replace(courtesy,"");
  let scoped=false;
  const prefix=/^(?:(?:in|inside)\s+)?minecraft[,:\s]+/;
  if(prefix.test(s)){s=s.replace(prefix,"");scoped=true;}
  const suffix=/\s+(?:in|inside)\s+minecraft$/;
  if(suffix.test(s)){s=s.replace(suffix,"");scoped=true;}
  s=s.replace(courtesy,"");
  if(!scoped)return null;
  const match=new RegExp(
    "^(?:gather|collect|mine|obtain|acquire|get|fetch|bring me)\\s+"+
    "("+MINECRAFT_COUNT_TOKEN+")\\s+"+
    "(?:(?:blocks?|pieces?|units?)\\s+of\\s+|(?:blocks?|pieces?|units?|of)\\s+)?"+
    "(logs?|wood|timber|planks?|sticks?|cobblestone|raw iron|iron ingots?|diamonds?|obsidian|flint|netherrack)$"
  ).exec(s);
  if(!match)return null;
  const targetCount=parseMinecraftCount(match[1]);
  if(targetCount===null)return null;
  const named:Record<string,string>={
    log:"logs",logs:"logs",wood:"logs",timber:"logs",
    plank:"planks",planks:"planks",stick:"sticks",sticks:"sticks",
    cobblestone:"cobblestone","raw iron":"raw_iron",
    "iron ingot":"iron_ingot","iron ingots":"iron_ingot",
    diamond:"diamond",diamonds:"diamond",obsidian:"obsidian",
    flint:"flint",netherrack:"netherrack"
  };
  const resource=named[match[2]];
  return resource?{resource,targetCount}:null;
}

export function minecraftMissionFromObjective(objective: string): MinecraftMissionGoal | null {
  if (typeof objective!=="string" || objective.length>450) return null;
  const s=objective.trim().toLowerCase()
    .replace(/[.!?]+$/g,"")
    .replace(/\s+/g," ")
    .replace(/^(?:hey\s+)?jarvis(?:buddy)?[,!:\s]+/,"")
    .replace(/^(?:(?:can|could|would) you\s+(?:please\s+)?|please\s+)/,"");
  if (!s || /\b(?:don't|do not|never|without defeating|without killing|not to)\b/.test(s)) return null;
  if (/^(?:how|why|what|when|where|who|explain|describe|tell me|show me|status|stop|cancel|pause)\b/.test(s))
    return null;
  const scoped=/\b(?:minecraft|ender dragon|netherite|jarvisbuddy)\b/.test(s);
  const directGather=directResourceGatherFromObjective(objective);
  if(directGather)return "gather";
  if(!scoped)return null;
  const active=/\b(?:play|join|survive|start|finish|complete|beat|defeat|kill|slay|win|get|obtain|equip|wear|craft|make)\b/.test(s);
  if(!active)return null;

  const dragonExplicit=/\b(?:ender )?dragon\b/.test(s);
  const gameWin=/\b(?:finish|complete|win|beat)\s+(?:the\s+)?(?:game|minecraft)\b/.test(s)||
    /\bminecraft\s+(?:to\s+completion|until\s+(?:completion|the\s+end))\b/.test(s);
  const dragon=dragonExplicit || gameWin;
  const netherite=/\bnetherite\b/.test(s);
  const netheriteArmor=/\bnetherite\s+(?:armor|armour|gear|equipment)\b/.test(s);
  const netheriteSword=/\bnetherite\s+sword\b/.test(s);
  const seekNetherite=/\b(?:get|obtain|equip|wear|craft|make|collect|gather|acquire|finish|complete)\b/.test(s);
  const seekDragon=/\b(?:defeat|kill|beat|slay|finish|complete|win)\b/.test(s);

  // Explicit combined survival missions remain distinct from either
  // individual goal. Temporal ordering is not decided from word order alone:
  // "get Netherite AFTER beating the Dragon" is dragon-first even though
  // the first noun in the sentence is Netherite.
  if(dragon && netherite && seekDragon && seekNetherite){
    const dragonFirst=
      /\bnetherite\b.{0,80}\bafter\b.{0,80}\bdragon\b/.test(s)||
      /\bdragon\b.{0,80}\b(?:then|before)\b.{0,80}\bnetherite\b/.test(s);
    if(/\b(?:only|just)\b.{0,20}\b(?:dragon|netherite)\b/.test(s))
      return null; // Compound intent contradicts a single-goal restriction.
    return dragonFirst?"dragon_then_netherite_run":"netherite_dragon_run";
  }
  if(dragon && seekDragon && !netherite)return "dragon_run";
  if(netherite && seekNetherite && !dragon && netheriteArmor)
    return netheriteSword?"netherite_gear_run":"netherite_armor_run";
  // Simply asking for Netherite or mentioning a Dragon is not consent to
  // silently start a different six-hour campaign.
  if(netherite||dragon)return null;
  if(/\b(?:play|join|survive|start playing|come play)\b/.test(s)&&
    /\bminecraft\b/.test(s))
    return "companion";
  return null;
}

export function directMinecraftMission(objective:string, step:number) {
  const goal=minecraftMissionFromObjective(objective);
  if (!goal || (step!==0 && step!==1)) return null;
  // First ensure the independent player is joined (idempotent if already on LAN).
  if (step===0) return {action:"tool" as const,tool:"minecraft_companion_join",args:{}};
  // Then start ONE owner-scoped native goal, requiring a fresh outcome status
  // later. Dispatch acknowledgement never means Minecraft was completed.
  const gather=goal==="gather"?directResourceGatherFromObjective(objective):null;
  if(goal==="gather" && !gather)return null;
  return {action:"tool" as const,tool:"minecraft_companion_command",
    args:{command:"auto_goal",goal,durationSeconds:21600,...(gather||{})}};
}

/**
 * Explicit owner-only one-shot spawn, NOT a general "play Minecraft" join.
 * No model output may supply the UUID, owner, coordinates or entity name.
 * Core sends a special Guardian context token only for this exact intent.
 */
export function directNativeCompanionSpawn(objective:string):
  {action:"tool";tool:"minecraft_companion_spawn";args:Record<string,never>}|null {
  if(typeof objective!=="string"||objective.length>180)return null;
  const normalized=objective.trim().toLowerCase().replace(/[.!]+$/,"")
    .replace(/^(?:hey\s+)?jarvis(?:buddy)?[,!:\s]+/,"")
    .replace(/^(?:please\s+|can you please\s+|could you please\s+)/,"")
    .replace(/\s+/g," ");
  if(!/^(?:spawn|summon|create)\s+(?:(?:my|the|a)\s+)?(?:(?:minecraft|jarvis|ai)\s+)?(?:companion|jarvisbuddy)(?:\s+(?:in|inside)\s+minecraft)?$/.test(normalized))
    return null;
  return {action:"tool",tool:"minecraft_companion_spawn",args:{}};
}
