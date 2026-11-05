/**
 * Native Skill Forge learning from actual completed JARVIS Core task receipts.
 * Not a new agent, not code generation, not an execution authority.
 *
 * Reads same-owner durable traces, rejects partial/missing/unaudited stages,
 * and STAGES a declarative candidate via the existing Forge/Crucible.
 * Only the owner can approve, and every later run uses Core+Guardian.
 */
import {stageSkill,EvolutionError} from "./skillForge.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEARNABLE=new Set([
  "read_file","list_dir","create_folder",
  "windows_discover_apps","windows_find_capability"
]);
const obj=v=>v!==null && typeof v==="object" && !Array.isArray(v);
const cleanArgs=(tool,args)=>{
  if(!obj(args))throw new EvolutionError("Malformed source tool arguments",409);
  if(["read_file","list_dir","create_folder"].includes(tool)){
    if(Object.keys(args).length!==1||typeof args.path!=="string" ||
       !args.path || args.path.length>300)
      throw new EvolutionError("Only exact path-only workspace tools can be learned",409);
    return {path:args.path};
  }
  if(tool==="windows_discover_apps"){
    if(Object.keys(args).length!==0)
      throw new EvolutionError("App discovery trace contains unexpected inputs",409);
    return {};
  }
  if(tool==="windows_find_capability"){
    if(Object.keys(args).length!==1||typeof args.goal!=="string"||
       args.goal.length<2||args.goal.length>160)
      throw new EvolutionError("Capability search arguments invalid",409);
    return {goal:args.goal};
  }
  throw new EvolutionError("Source action cannot be learned without owner review",409);
};
const parseJson=(s,label)=>{
  if(typeof s!=="string"||!s||s.length>6000)
    throw new EvolutionError(label+" is absent or truncated",409);
  let objv;
  try{objv=JSON.parse(s);}catch{throw new EvolutionError(label+" is not complete JSON",409);}
  if(!obj(objv))throw new EvolutionError(label+" is not a JSON object",409);
  return objv;
};
/**
 * @param {string} owner Authenticated principal, NEVER from model arguments.
 * @param {object} db Existing server-owned Prisma client.
 * @param {string|undefined} sourceTaskId A specific owned task or most recent completed.
 */
export async function learnFromCompletedTask(owner,db,sourceTaskId=undefined){
  if(typeof owner!=="string"||owner.length<3)
    throw new EvolutionError("Authenticated owner required",403);
  if(sourceTaskId!==undefined&&(!UUID.test(sourceTaskId)))
    throw new EvolutionError("Completed source task UUID required");
  const task=sourceTaskId
    ? await db.agentTask.findUnique({where:{id:sourceTaskId},
        select:{id:true,ownerId:true,status:true}})
    : await db.agentTask.findFirst({where:{ownerId:owner,status:"completed"},
        orderBy:[{updatedAt:"desc"},{createdAt:"desc"}],
        select:{id:true,ownerId:true,status:true}});
  if(!task || task.ownerId!==owner)
    throw new EvolutionError("Owned source task not found",404);
  if(task.status!=="completed")
    throw new EvolutionError("Only a Core-completed task may be learned",409);
  const rows=await db.agentStep.findMany({
    where:{taskId:task.id,kind:{in:["tool_call","tool_result"]}},
    orderBy:[{seq:"asc"},{createdAt:"asc"}],take:48,
    select:{id:true,seq:true,kind:true,tool:true,argsJson:true,resultJson:true}
  });
  if(rows.length<2||rows.length>=48)
    throw new EvolutionError("No bounded complete task trace available",409);
  const grouped=new Map();
  for(const row of rows){
    if(!Number.isInteger(row.seq)||row.seq<0)
      throw new EvolutionError("Invalid task trace sequence",409);
    const record=grouped.get(row.seq)||{call:[],results:[]};
    if(row.kind==="tool_call")record.call.push(row);
    else if(row.kind==="tool_result")record.results.push(row);
    grouped.set(row.seq,record);
  }
  if(grouped.size<1||grouped.size>8)
    throw new EvolutionError("Only 1–8 complete verified steps may be learned",409);
  const steps=[];
  for(const [seq,record] of [...grouped].sort((a,b)=>a[0]-b[0])){
    if(record.call.length!==1 || record.results.length!==1)
      throw new EvolutionError("Missing or ambiguous task receipt at step "+seq,409);
    const call=record.call[0],receipt=record.results[0];
    if(!call.tool || call.tool!==receipt.tool || !LEARNABLE.has(call.tool))
      throw new EvolutionError("Task includes unsupported, effectful or ungrounded action",409);
    const args=cleanArgs(call.tool,parseJson(call.argsJson,"Original arguments"));
    const result=parseJson(receipt.resultJson,"Actual tool result");
    if(result.ok!==true || result.tool!==call.tool)
      throw new EvolutionError("Source task step did not succeed",409);
    if(call.tool==="create_folder" &&
       (!obj(result.detail)||result.detail.isDirectory!==true))
      throw new EvolutionError("Folder creation lacked live disk postcondition",409);
    if(call.tool==="read_file" &&
       (!obj(result.detail)||result.detail.truncated===true))
      throw new EvolutionError("Source file inspection incomplete",409);
    steps.push({tool:call.tool,args,
      why:"JARVIS Core recorded a successful "+call.tool+" operation"});
  }
  if(steps.some(x=>x.tool==="create_folder")){
    const effects=await db.effectRecord.findMany({
      where:{taskId:task.id,tool:"create_folder"},
      select:{status:true,receiptJson:true}
    });
    if(effects.length<1||effects.some(x=>{
      if(x.status!=="SETTLED")return true;
      try{const receipt=JSON.parse(x.receiptJson||"{}");return receipt.ok!==true;}
      catch{return true;}
    }))throw new EvolutionError("Durable folder effect not settled",409);
  }
  // A recipe is still a candidate, not independent proof that a future run
  // will recreate the original objective or be allowed on another device.
  const manifest={
    name:"Learned JARVIS workflow "+task.id.slice(0,8),
    description:"Owner-reviewable recipe of "+steps.length+
      " fully receipted, bounded JARVIS tool stages from a completed owned task.",
    steps
  };
  const staged=await stageSkill(owner,manifest);
  return {...staged,sourceTaskId:task.id,sourceStatus:"completed",
    fromActualToolReceipts:true,codeExecuted:false,
    ownerApprovalRequired:true,futureCompletionNotProven:true};
}
