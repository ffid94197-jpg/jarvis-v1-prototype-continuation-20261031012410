/** Plain-language Minecraft mission selection.
 * This router only chooses an owner-intent-limited native goal. It does NOT
 * authorize a game action, start a process or prove any in-game achievement.
 * Guardian and real Mineflayer observations remain separate requirements.
 */
export type MinecraftMissionGoal =
  | "companion" | "dragon_run" | "netherite_dragon_run"
  | "dragon_then_netherite_run" | "netherite_armor_run"
  | "netherite_gear_run";

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
  const scoped=/\b(?:minecraft|ender dragon|netherite|dragon)\b/.test(s);
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
  return {action:"tool" as const,tool:"minecraft_companion_command",
    args:{command:"auto_goal",goal,durationSeconds:21600}};
}
