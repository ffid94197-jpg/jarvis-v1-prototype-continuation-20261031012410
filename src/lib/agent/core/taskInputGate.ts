import {parseInventorySource} from "./inventoryIntegrity";
/**
 * Reject explicit destinations that the scoped workspace file tools cannot
 * fulfill. A model cannot silently convert an OS path to a same-name file
 * under the default workspace or call that an executed owner request.
 */
export function unsupportedFileDestination(objective:string):"absolute_path"|"desktop"|null {
 const createsFile=/\b(?:create|crate|make|write|save|generate|put|place)\b/i.test(objective) &&
   /(?:\b(?:file|folder|directory)\b|\.[a-z0-9]{1,8}\b)/i.test(objective);
 if(!createsFile)return null;
 if(/(?:^|[^a-z0-9_])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/])/i.test(objective))
   return "absolute_path";
 if(/\b(?:on|onto|in|to|at)\s+(?:(?:my|the|your)\s+)?desktop\b/i.test(objective))
   return "desktop";
 return null;
}
export type PreparedObjective=
 | {ok:true;objective:string;inventoryRows:number}
 | {ok:false;status:400|413|422;code:string;message:string;inventoryRows:number};
export function prepareTaskObjective(input:unknown):PreparedObjective{
 if(typeof input!=="string"||!input.trim())
  return {ok:false,status:400,code:"OBJECTIVE_REQUIRED",message:"Objective required",inventoryRows:0};
 const objective=input.trim();
 if(objective.length>12000)
  return {ok:false,status:413,code:"OBJECTIVE_TOO_LONG",
    message:"Task too large; no truncation or execution",inventoryRows:0};
 const unsupported=unsupportedFileDestination(objective);
 if(unsupported)
  return {ok:false,status:422,code:"FILE_TARGET_OUTSIDE_WORKSPACE",
    message:unsupported==="desktop"
     ? "Desktop file destination is not the restricted agent workspace. No file created. Use an explicitly authorized Windows desktop workflow, or choose a permitted workspace-relative path."
     : "Absolute Windows file destination is not a workspace-relative path. No file created. An operator may configure JARVIS_AGENT_WORKSPACE to the intended directory, restart locally, and request a relative filename.",
    inventoryRows:0};
 const source=parseInventorySource(objective);
 const inventoryRows=source?.rows.length??0;
 const deliverables=/\b(?:inventory|stock)\b/i.test(objective)
  &&/\b(?:csv|spreadsheet)\b/i.test(objective)
  &&/(?:\b(?:report|summary)\b|[_-](?:report|summary)\.(?:txt|md)\b)/i.test(objective);
 const original=/\boriginal\s+(?:inventory|product)\s+(?:data|list)\b/i.test(objective);
 if(deliverables&&original&&!source)
  return {ok:false,status:422,code:"INVENTORY_SOURCE_UNAVAILABLE",
    message:"Original inventory source not fully parsed; no task started",inventoryRows:0};
 return {ok:true,objective,inventoryRows};
}
