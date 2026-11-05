/**
 * JARVIS owner read-only native Minecraft mission monitoring.
 *
 * A Core task may settle PARTIAL after admitting a multi-hour Minecraft goal.
 * That does not settle the game-server's task. This endpoint retrieves fresh
 * signed status from that SAME original task and never starts/repeats effects.
 *
 * GET /api/jarvis/minecraft/mission-status?taskId=<real Core task UUID>
 */
import {NextRequest} from "next/server";
import {requireActiveSession,requireOwnedTask} from "@/lib/agent/auth/session";
import {authorizeToolCall} from "@/lib/agent/guardian/guardian";
import {runGuardianApprovedPlayerEngine} from "@/lib/agent/windows/playerEngineBridge";
import {db} from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
const TASK=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(req:NextRequest){
  const guard=await requireActiveSession(req);
  if(!guard.ok)return guard.response;
  const ctx=guard.ctx;
  if(ctx.role!=="OWNER")
    return Response.json({error:"Owner role required"},{status:403,headers});
  if(process.env.JARVIS_MC_BACKEND!=="playerengine" ||
     process.env.JARVIS_MC_BRIDGE_ENABLE!=="1")
    return Response.json({error:"Native PlayerEngine is disabled"},{status:503,headers});
  const taskId=req.nextUrl.searchParams.get("taskId");
  if(!taskId || !TASK.test(taskId) || req.nextUrl.searchParams.size!==1)
    return Response.json({error:"Exact original Core task UUID required"},{status:400,headers});
  const owned=await requireOwnedTask(ctx,taskId);
  if(!owned.ok)return owned.response;
  try{
    // A signed game-server snapshot is only meaningful for a real durable
    // admitted owner mission. Query the existing journal, not model text.
    const admitted=await db.effectRecord.findFirst({
      where:{taskId,tool:"minecraft_companion_command",status:"SETTLED"},
      orderBy:{admittedAt:"desc"},select:{argsJson:true,receiptJson:true}
    });
    if(!admitted)
      return Response.json({error:"No settled native mission admission for this task"},{status:404,headers});
    let evidence:Record<string,unknown>;
    let input:Record<string,unknown>;
    try{
      input=JSON.parse(admitted.argsJson||"{}");
      const source=JSON.parse(admitted.receiptJson||"{}");
      evidence=source?.detail;
    }catch{
      return Response.json({error:"Native mission admission receipt is invalid"},{status:409,headers});
    }
    if(!input || input.command!=="auto_goal" ||
       typeof input.goal!=="string" || !evidence ||
       evidence.command!=="auto_goal" || evidence.goal!==input.goal ||
       evidence.botAcknowledged!==true || evidence.missionStartedOnly!==true)
      return Response.json({error:"Latest durable receipt was not an approved native mission"},{status:409,headers});
    // A real, NEW durable Guardian audit is required even for the read-only
    // status. The native transport binds the audit ID to the original task.
    const authorization=await authorizeToolCall(
      {taskId,ownerId:ctx.principalId},
      "minecraft_companion_command",{command:"auto_status"}
    );
    if(authorization.verdict!=="allow" || !authorization.prepared?.desktop)
      return Response.json({error:"Guardian denied native status inspection"},{status:403,headers});
    const packet=await runGuardianApprovedPlayerEngine(taskId,
      ctx.principalId,authorization.prepared.desktop,authorization);
    if(!packet.ok || packet.evidence?.command!=="auto_status" ||
       packet.evidence?.realWorldReadback!==true ||
       typeof packet.evidence?.status!=="string")
      return Response.json({
        taskId,verified:false,status:"unverified",
        error:packet.error||"No signed live game-server mission state"
      },{status:409,headers});
    let mission:Record<string,unknown>;
    try{
      const parsed=JSON.parse(packet.evidence.status);
      if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) ||
         parsed.goal!==input.goal || typeof parsed.status!=="string" ||
         !parsed.milestones || typeof parsed.milestones!=="object" ||
         Array.isArray(parsed.milestones))
        throw Error("Invalid signed mission payload");
      mission=parsed;
    }catch{
      return Response.json({taskId,verified:false,status:"unverified",
        error:"Signed mission payload could not be validated"},{status:409,headers});
    }
    // Mark complete ONLY when Fabric itself reports it and its exact
    // mission milestones are present. The status payload is not a
    // substitute for independent survival acceptance on the owner's PC.
    return Response.json({
      taskId,goal:input.goal,status:mission.status,
      verifiedLiveObservation:true,
      inGameMissionReportedComplete:mission.status==="complete",
      independentlyAccepted:false,
      milestones:mission.milestones,
      observedAt:new Date().toISOString(),
      source:"signed_native_game_server"
    },{headers});
  }catch(e){
    return Response.json({taskId,verified:false,status:"unverified",
      error:"Native mission status unavailable; reconcile original Core task and Fabric journal",
      reason:e instanceof Error?e.message:"unknown"
    },{status:503,headers});
  }
}
