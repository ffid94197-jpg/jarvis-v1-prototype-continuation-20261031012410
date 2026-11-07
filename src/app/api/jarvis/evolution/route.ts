/**
 * Native Skill Forge and Repair Vault owner control plane.
 * No model-facing "approve" or "apply" tool exists. Only an authenticated
 * OWNER's same-origin explicit POST can activate or mutate a staged candidate.
 */
import {NextRequest} from "next/server";
import {requireActiveSession} from "@/lib/agent/auth/session";
import {mutationOriginError} from "@/lib/agent/auth/origin";
import {authorizeToolCall} from "@/lib/agent/guardian/guardian";
import {db} from "@/lib/db";
import {learnFromCompletedTask} from "@/lib/agent/evolution/learnFromTask.mjs";
import {diagnoseOwnerRuntime} from "@/lib/agent/evolution/diagnostics.mjs";
import {getPerformanceSummary} from "@/lib/agent/evolution/selfImprovement.mjs";
import {
  listSkills,getSkill,stageSkill,changeSkill,expandSkill,EvolutionError
} from "@/lib/agent/evolution/skillForge.mjs";
import {
  listRepairs,inspectRecovery,getRepair,stageRepair,approveRepair,applyRepair,verifyRepair,rollbackRepair,
  RepairError
} from "@/lib/agent/evolution/repairVault.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function gate(req:NextRequest,write:boolean){
  const auth=await requireActiveSession(req);
  if(!auth.ok)return {ok:false as const,response:auth.response};
  if(auth.ctx.role!=="OWNER")
    return {ok:false as const,response:Response.json({error:"Owner role required"},{status:403})};
  if(write){
    const error=mutationOriginError(req.headers);
    if(error)return {ok:false as const,response:Response.json({error},{status:403})};
  }
  return {ok:true as const,ownerId:auth.ctx.principalId};
}
function error(e:unknown){
  const x=e as {status?:number;message?:string};
  const status=typeof x?.status==="number" && x.status>=400 && x.status<=599?x.status:503;
  return Response.json({error:x?.message||"JARVIS evolution subsystem unavailable"},{status});
}
const headers={"Cache-Control":"no-store"};

export async function GET(req:NextRequest){
  const session=await gate(req,false);if(!session.ok)return session.response;
  try{
    const [skills,repairs,recovery,diagnostics,performance]=await Promise.all([
      listSkills(session.ownerId,{includeDrafts:true}),listRepairs(session.ownerId),
      inspectRecovery(session.ownerId),diagnoseOwnerRuntime(session.ownerId,db),
      getPerformanceSummary(session.ownerId).catch(()=>({
        status:"unavailable",sampleCount:0,skills:[],
        privacy:{rawObjectivesStored:false,rawArgumentsStored:false,secretsStored:false}
      }))
    ]);
    return Response.json({skills,repairs,recovery,diagnostics,performance,mode:"native_guardian_controlled",
      repairPolicy:{mode:process.env.JARVIS_SELF_REPAIR_AUTO_APPLY==="1"?"bounded_auto":"owner_approval_required",
        enabled:process.env.JARVIS_SELF_REPAIR_AUTO_APPLY==="1",
        scope:"JARVIS_AGENT_WORKSPACE safe non-protected files",maxAutomaticRepairsPerTask:1,
        verification:"static syntax only; project tests/runtime acceptance remain separate"},
      automaticSkillExecution:false,automaticRepairExecutionEnabled:process.env.JARVIS_SELF_REPAIR_AUTO_APPLY==="1",
      ownerApprovalRequiredForSkills:true},{headers});
  }catch(e){return error(e);}
}
export async function POST(req:NextRequest){
  const session=await gate(req,true);if(!session.ok)return session.response;
  let body:Record<string,unknown>;
  try{
    const text=await req.text();
    if(Buffer.byteLength(text)>24000)
      return Response.json({error:"Request too large"},{status:413});
    const input=JSON.parse(text);
    if(!input||typeof input!=="object"||Array.isArray(input))
      return Response.json({error:"Invalid request"},{status:400});
    body=input;
  }catch{return Response.json({error:"Invalid JSON"},{status:400});}
  const owner=session.ownerId;
  // Every actual OWNER mutation is audited by the same mandatory Guardian
  // ledger as ordinary agent tools. Only this authenticated/origin-checked
  // control plane may present ownerControlPlane=true; Core cannot do so.
  const mutations=new Set(["stage_skill","approve_skill","disable_skill","learn_skill",
    "stage_repair","approve_repair","apply_repair","verify_repair","rollback_repair"]);
  if(typeof body.action==="string" && mutations.has(body.action)){
    const decision=await authorizeToolCall(
      {taskId:null,ownerId:owner,ownerControlPlane:true},
      "evolution_owner_control",
      {action:body.action,id:typeof body.id==="string"?body.id:undefined,
       sourceTaskId:typeof body.sourceTaskId==="string"?body.sourceTaskId:undefined}
    );
    if(decision.verdict!=="allow")
      return Response.json({error:decision.reason||"Guardian owner action denied"},{status:403});
  }
  try{
    switch(body.action){
      case "stage_skill":
        return Response.json(await stageSkill(owner,body.manifest),{headers});
      case "learn_skill":
        return Response.json(await learnFromCompletedTask(owner,db,
          typeof body.sourceTaskId==="string"?body.sourceTaskId:undefined),{headers});
      case "skill_details":
        return Response.json(await getSkill(owner,body.id),{headers});
      case "approve_skill":
        return Response.json(await changeSkill(owner,body.id,"approve"),{headers});
      case "disable_skill":
        return Response.json(await changeSkill(owner,body.id,"disable"),{headers});
      case "expand_skill":
        return Response.json(await expandSkill(owner,body.id,body.inputs),{headers});
      case "stage_repair":
        return Response.json(await stageRepair(owner,body.candidate),{headers});
      case "repair_details":
        return Response.json(await getRepair(owner,body.id),{headers});
      case "approve_repair":
        return Response.json(await approveRepair(owner,body.id),{headers});
      case "apply_repair": {
        const applied=await applyRepair(owner,body.id);
        if(applied.state!=="applied")return Response.json(applied,{headers});
        const verification=await verifyRepair(owner,body.id);
        return Response.json({...verification,application:applied,staticSyntaxVerified:verification.verified===true,
          runtimeTestsExecuted:false},{headers});
      }
      case "verify_repair":
        return Response.json(await verifyRepair(owner,body.id),{headers});
      case "rollback_repair":
        return Response.json(await rollbackRepair(owner,body.id),{headers});
      default:return Response.json({error:"Unknown owner action"},{status:400});
    }
  }catch(e){return error(e);}
}
