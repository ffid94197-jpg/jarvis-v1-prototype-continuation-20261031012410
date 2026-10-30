/** Explicit one-instruction Minecraft modes. This is intent selection only.
 * Guardian and the companion's operator opt-in still authorize each effect.
 * No output from this router constitutes in-world completion evidence.
 */
export type MinecraftMissionGoal = "companion" | "netherite_dragon_run";
export function minecraftMissionFromObjective(objective: string): MinecraftMissionGoal | null {
  const s=objective.trim().toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ");
  if (s.length>220 || /\?|\b(?:how|why|what|explain|can you|could you|would you|should|tell me|status|stop|cancel|pause|don't|do not)\b/.test(s)) return null;
  const gameplay=/(?:\bminecraft\b|\bender dragon\b)/.test(s);
  if (!gameplay) return null;
  if (/\b(?:defeat|kill|beat|slay)\b.{0,45}\b(?:ender dragon|minecraft)\b/.test(s) ||
      /\b(?:minecraft|ender dragon)\b.{0,45}\b(?:end goal|dragon run|to completion)\b/.test(s))
    return "netherite_dragon_run";
  if (/\b(?:play|join|survive|come play|start playing)\b.{0,50}\bminecraft\b/.test(s) ||
      /\bminecraft\b.{0,40}\b(?:play|with me|beside me|together)\b/.test(s))
    return "companion";
  return null;
}
export function directMinecraftMission(objective:string, step:number) {
  const goal=minecraftMissionFromObjective(objective);
  if (!goal || (step!==0 && step!==1)) return null;
  // First ensure the independent player is joined (idempotent if already on LAN).
  if (step===0) return {action:"tool" as const,tool:"minecraft_companion_join",args:{}};
  // Then start ONE persistent internally driven goal. No repeated user commands.
  return {action:"tool" as const,tool:"minecraft_companion_command",
    args:{command:"auto_goal",goal,durationSeconds:21600}};
}
