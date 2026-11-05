/**
 * JARVIS-native owner skill launch intent. This is a deterministic planner
 * convenience ONLY: it does not grant permission, skip the model's Guardian
 * boundary or convert a preview request into a real side effect.
 */
export function directApprovedSkillIntent(objective:string):{
  action:"tool";tool:"evolution_skill_run";
  args:{id:string;inputs:Record<string,string|number|boolean>}
}|null{
  if(typeof objective!=="string"||objective.length>1600)return null;
  const match=objective.trim().match(
    /^run my approved jarvis skill (sk_[0-9a-f]{32}) with inputs (\{[^\r\n]{2,1400}\})$/i
  );
  if(!match)return null;
  try{
    const parsed:unknown=JSON.parse(match[2]);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;
    const inputs=parsed as Record<string,unknown>;
    if(Object.keys(inputs).length>8)return null;
    for(const [key,value] of Object.entries(inputs)){
      if(!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)||
         ["__proto__","prototype","constructor"].includes(key)||
         !["string","number","boolean"].includes(typeof value) ||
         String(value).length>240 || (typeof value==="number"&&!Number.isFinite(value)))
        return null;
    }
    return {action:"tool",tool:"evolution_skill_run",
      args:{id:match[1].toLowerCase(),
        inputs:inputs as Record<string,string|number|boolean>}};
  }catch{return null;}
}

/** Preview/review questions may never be silently promoted to execution by
 * an over-eager planner. Explicit imperative "run it" requests remain allowed.
 */
export function isPreviewOnlySkillRequest(objective:string):boolean{
  if(typeof objective!=="string")return false;
  const s=objective.trim().replace(/^(?:(?:hey\\s+)?jarvis[,!: ]+|please\\s+)+/i,"");
  return /\\b(?:skill|recipe|workflow|automation)\\b/i.test(s) &&
    /^(?:show|preview|list|explain|describe|review|inspect|summarize|tell\\s+me\\s+about|what\\s+(?:does|would|will)|how\\s+(?:does|would|will))\\b/i.test(s);
}
