import {parseInventorySource} from "./inventoryIntegrity";
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
 const source=parseInventorySource(objective);
 const inventoryRows=source?.rows.length??0;
 const deliverables=/\b(?:inventory|stock)\b/i.test(objective)
  &&/\b(?:csv|spreadsheet)\b/i.test(objective)
  &&/\b(?:report|summary)\b/i.test(objective);
 const original=/\boriginal\s+(?:inventory|product)\s+(?:data|list)\b/i.test(objective);
 if(deliverables&&original&&!source)
  return {ok:false,status:422,code:"INVENTORY_SOURCE_UNAVAILABLE",
    message:"Original inventory source not fully parsed; no task started",inventoryRows:0};
 return {ok:true,objective,inventoryRows};
}
