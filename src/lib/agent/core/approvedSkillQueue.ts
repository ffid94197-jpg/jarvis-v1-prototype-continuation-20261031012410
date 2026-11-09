/**
 * JARVIS Core's bounded owner-approved Skill Forge execution queue.
 *
 * Expansion is an untrusted ADVISORY receipt, never an authorization.
 * The existing runTask loop consumes one queued step at a time and takes
 * EVERY action through the same Guardian audit, effect admission, cancellation,
 * executor readback, and final arbitration as a model-planned action.
 *
 * Queues are deliberately process-local. After a crash/pause, the Core must
 * re-expand the owner-approved recipe from a fresh, audited read rather than
 * blindly replaying steps with ambiguous external effects.
 */
import {GUARDIAN_KNOWN_TOOLS} from "../guardian/guardian";
import type {ToolResult} from "../tools/executor";

export interface SkillQueueStep {
  tool:string;
  args:Record<string,unknown>;
  why:string;
}
export interface ActiveSkillQueue {
  skillId:string;
  digest:string;
  name:string;
  steps:SkillQueueStep[];
  next:number;
}

const GUID=/^sk_[0-9a-f]{32}$/;
const unsafeKeys=new Set(["__proto__","constructor","prototype"]);
const known=new Set<string>(GUARDIAN_KNOWN_TOOLS as readonly string[]);
// A Guardian-known action is not automatically reviewed for a saved Forge recipe.
// Keep this catalogue identical to evolution/skillForge.mjs (checked by offline fixture).
export const FORGE_STAGE_TOOLS = Object.freeze(["create_folder","read_file","list_dir","write_file","edit_file","memory_recall","world_recall","windows_discover_apps","windows_find_capability","windows_open_url","windows_open_app","windows_open_settings","windows_browser_search","windows_browser_inspect","windows_browser_read_page","windows_browser_click_link","windows_browser_fill_search","windows_browser_scroll","windows_list_windows","windows_desktop_observe","windows_desktop_windows","windows_desktop_state","windows_desktop_focus","windows_desktop_click","windows_desktop_type","windows_desktop_keys","windows_desktop_scroll","windows_native_inspect","windows_native_action","windows_native_verify","minecraft_companion_command","minecraft_companion_join","minecraft_companion_stop"] as const);
const forgeReviewed=new Set<string>(FORGE_STAGE_TOOLS);
const excluded=new Set([
  "evolution_skill_stage","evolution_skill_list","evolution_skill_expand","evolution_skill_run",
  "evolution_repair_stage","evolution_repair_list","evolution_owner_control",
  "adoption_stage_github","adoption_mcp_call","adoption_skill"
]);
const object=(v:unknown):v is Record<string,unknown>=>
  v!==null && typeof v==="object" && !Array.isArray(v);
const jsonSafe=(value:unknown,depth=0):boolean=>{
  if(depth>5)return false;
  if(value===null || typeof value==="string" ||
     typeof value==="boolean" ||
     (typeof value==="number" && Number.isFinite(value)))return true;
  if(Array.isArray(value))return value.length<=32&&value.every(v=>jsonSafe(v,depth+1));
  if(!object(value)||Object.keys(value).length>20)return false;
  return Object.entries(value).every(([key,v])=>
    /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(key)&&
    !unsafeKeys.has(key)&&jsonSafe(v,depth+1));
};

export function acceptedSkillQueue(
  requestedId:unknown,
  receipt:Pick<ToolResult,"ok"|"detail">,
):ActiveSkillQueue|null {
  if(typeof requestedId!=="string" || !GUID.test(requestedId) || !receipt.ok)
    return null;
  const d=receipt.detail;
  if(!object(d)||d.skillId!==requestedId || typeof d.digest!=="string" ||
     !/^[a-f0-9]{64}$/.test(d.digest)||
     typeof d.name!=="string" || !d.name.trim() || d.name.length>70 ||
     d.advisoryOnly!==true || d.executed!==false ||
     d.authorizationGranted!==false ||
     d.requiresPerStepGuardianAudit!==true ||
     d.requiresCoreDurableEffectAdmission!==true ||
     !Array.isArray(d.steps) || d.steps.length<1||d.steps.length>16 ||
     d.stageCount!==d.steps.length)return null;
  const serialized=JSON.stringify(d.steps);
  if(serialized.length>6400)return null;
  const stages:SkillQueueStep[]=[];
  for(const entry of d.steps){
    if(!object(entry) ||
       Object.keys(entry).some(k=>!["tool","args","why"].includes(k)) ||
       typeof entry.tool!=="string" || !known.has(entry.tool) || !forgeReviewed.has(entry.tool) ||
       excluded.has(entry.tool) || !object(entry.args) ||
       !jsonSafe(entry.args) ||
       typeof entry.why!=="string" || entry.why.length>160)
      return null;
    stages.push({tool:entry.tool,
      args:JSON.parse(JSON.stringify(entry.args)) as Record<string,unknown>,
      why:entry.why});
  }
  return {skillId:requestedId,digest:d.digest,name:d.name,steps:stages,next:0};
}
