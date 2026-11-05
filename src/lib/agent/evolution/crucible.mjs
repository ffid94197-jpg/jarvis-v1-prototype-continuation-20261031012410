/**
 * JARVIS deterministic "Crucible" for declarative skills.
 * NO untrusted programs are executed. This is static capability/shape
 * assessment plus risk classification; it is NOT a runtime sandbox test.
 * Every expanded step remains subject to real Guardian review.
 */
const READ_ONLY=new Set([
  "read_file","list_dir","memory_recall","world_recall",
  "windows_discover_apps","windows_find_capability",
  "windows_browser_inspect","windows_browser_read_page",
  "windows_list_windows","windows_desktop_observe","windows_desktop_windows",
  "windows_desktop_state","windows_native_inspect","windows_native_verify"
]);
const MUTATIONS=new Set([
  "create_folder","write_file","edit_file","windows_open_url","windows_open_app",
  "windows_open_settings","windows_browser_search","windows_browser_click_link",
  "windows_browser_fill_search","windows_browser_scroll","windows_desktop_focus",
  "windows_desktop_click","windows_desktop_type","windows_desktop_keys",
  "windows_desktop_scroll","windows_native_action","minecraft_companion_command",
  "minecraft_companion_join","minecraft_companion_stop"
]);
const FRESH_TOKENS=new Set([
  "windows_browser_click_link","windows_browser_fill_search","windows_native_action",
  "windows_desktop_click","windows_desktop_type","windows_desktop_keys"
]);
const obj=v=>v&&typeof v==="object"&&!Array.isArray(v);
const isTemplate=v=>typeof v==="string"&&/^\{\{[a-zA-Z][a-zA-Z0-9_]{0,39}\}\}$/.test(v);
const string=v=>typeof v==="string";
const templateOr=(v,predicate)=>predicate(v)||isTemplate(v);
const requiredString=(args,key)=>templateOr(args[key],string);
const validArguments=(step)=>{
  const a=step.args;
  switch(step.tool){
    case "create_folder":
    case "read_file":
    case "list_dir":return requiredString(a,"path");
    case "write_file":return requiredString(a,"path")&&requiredString(a,"content");
    case "edit_file":return requiredString(a,"path")&&
      templateOr(a.expectedSha256,v=>string(v)&&/^[a-f0-9]{64}$/.test(v))&&
      requiredString(a,"oldText")&&requiredString(a,"newText");
    case "memory_recall":
    case "world_recall":return requiredString(a,"query") &&
      (a.limit===undefined || templateOr(a.limit,
         v=>Number.isInteger(v)&&v>=1&&v<=5));
    case "windows_discover_apps":
    case "windows_list_windows":
    case "windows_desktop_observe":
    case "windows_desktop_windows":
    case "windows_desktop_state":return Object.keys(a).length<=3;
    case "windows_open_url":return requiredString(a,"url");
    case "windows_browser_search":return requiredString(a,"query");
    case "windows_browser_click_link":
    case "windows_browser_fill_search":
      return templateOr(a.index,Number.isInteger)&&requiredString(a,"pageToken");
    case "windows_browser_inspect":
    case "windows_native_inspect":
      return a.query===undefined||requiredString(a,"query");
    case "windows_native_action":return requiredString(a,"elementId")&&requiredString(a,"action");
    case "windows_open_app":return requiredString(a,"app");
    case "windows_open_settings":return requiredString(a,"page");
    case "windows_find_capability":return requiredString(a,"goal");
    case "windows_desktop_click":return requiredString(a,"elementToken")||
      (templateOr(a.x,Number.isInteger)&&templateOr(a.y,Number.isInteger));
    case "windows_desktop_type":return requiredString(a,"text");
    case "minecraft_companion_command":return requiredString(a,"command");
    case "minecraft_companion_join":
    case "minecraft_companion_stop":return true; // actual Guardian checks context
    default:return true; // Guardian owns the full argument schema, not Crucible
  }
};
export function assessSkill(manifest){
  if(!obj(manifest)||!Array.isArray(manifest.steps))
    throw new Error("Invalid normalized skill");
  const placeholders=new Set(),warnings=[],errors=[];
  const traverse=(value,path)=>{
    if(typeof value==="string"){
      const matches=[...value.matchAll(/\{\{([^{}]+)\}\}/g)];
      for(const match of matches){
        if(!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(match[1]))
          errors.push("Malformed input placeholder "+path);
        else placeholders.add(match[1]);
      }
      if((value.includes("{{")||value.includes("}}"))&&!matches.length)
        errors.push("Malformed template syntax "+path);
    }else if(Array.isArray(value))value.forEach((item,i)=>traverse(item,path+"["+i+"]"));
    else if(obj(value))Object.entries(value).forEach(([key,item])=>traverse(item,path+"."+key));
  };
  let effectSteps=0;
  for(let i=0;i<manifest.steps.length;i++){
    const step=manifest.steps[i];
    if(!step||typeof step.tool!=="string"||!obj(step.args)){
      errors.push("Invalid stage "+(i+1));continue;
    }
    if(!READ_ONLY.has(step.tool))effectSteps++;
    if(!READ_ONLY.has(step.tool)&&!MUTATIONS.has(step.tool))
      warnings.push("Unclassified tool "+step.tool+" needs Guardian review");
    if(!validArguments(step))
      errors.push("Required argument shape missing at stage "+(i+1));
    traverse(step.args,"steps["+i+"].args");
    if(FRESH_TOKENS.has(step.tool))
      warnings.push("Stage "+(i+1)+" needs fresh live UI/page token at execution time");
  }
  if(placeholders.size>8)errors.push("Too many dynamic inputs");
  if(errors.length)throw new Error("Crucible static preflight rejected: "+
    errors.slice(0,3).join("; "));
  return {
    mode:"deterministic_static_preflight",
    passed:true,codeExecuted:false,liveSystemTested:false,
    authorizationGranted:false,ownerApprovalRequired:true,
    effectfulStages:effectSteps,readOnlyStages:manifest.steps.length-effectSteps,
    risk:effectSteps?"effectful_requires_guardian":"read_only",
    inputs:[...placeholders].sort(),warnings:warnings.slice(0,8),
    perStepGuardianRequired:true
  };
}
