import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/agent/auth/session';
import { makePlan } from '@/lib/agent/longrun/planner.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(req:NextRequest){
  const auth=await requireActiveSession(req);
  if(!auth.ok)return auth.response;
  const [pulse, routines]=await Promise.all([
    db.agentWorkerPulse.findUnique({where:{id:'primary'}}),
    db.agentRoutine.findMany({where:{ownerId:auth.ctx.principalId},orderBy:{createdAt:'desc'},take:60,
    include:{runs:{orderBy:{startedAt:'desc'},take:5}}}),
  ]);
  return Response.json({workerEnabled:process.env.JARVIS_LONGRUN_ENABLED==='1',workerHealthy:Boolean(pulse&&Date.now()-pulse.lastSeenAt.getTime()<40000),routines:routines.map(r=>({
    ...r,planJson:undefined,subgoals:(()=>{try{return JSON.parse(r.planJson);}catch{return [];}})(),
  }))},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest){
  const auth=await requireActiveSession(req);
  if(!auth.ok)return auth.response;
  if(auth.ctx.role!=='OWNER')return Response.json({error:'Only the owner can schedule background routines.'},{status:403});
  const body=await req.json().catch(()=>null);
  if(!body || typeof body!=='object')return Response.json({error:'Invalid request.'},{status:400});
  const title=typeof body.title==='string'?body.title.trim():'';
  const objective=typeof body.objective==='string'?body.objective.trim():'';
  if(!title||title.length>120 || !objective||objective.length>2000)return Response.json({error:'Invalid title or objective.'},{status:400});
  let plan:ReturnType<typeof makePlan>;
  try{plan=makePlan(objective,body.subgoals);}catch(err){return Response.json({error:err instanceof Error?err.message:'Invalid plan.'},{status:400});}
  const mode=body.mode==='interval'?'interval':'once';
  const intervalMinutes=Number(body.intervalMinutes??0);
  const maxRuns=Number(body.maxRuns??(mode==='once'?1:30));
  const maxTotalSteps=Number(body.maxTotalSteps??192);
  if(mode==='interval'&&(!Number.isInteger(intervalMinutes)||intervalMinutes<5||intervalMinutes>10080))return Response.json({error:'Interval must be 5–10080 minutes.'},{status:400});
  if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>10000||!Number.isInteger(maxTotalSteps)||maxTotalSteps<24||maxTotalSteps>384)return Response.json({error:'Invalid total runs or step limit.'},{status:400});
  const startAt=body.startAt?new Date(body.startAt):new Date();
  if(!Number.isFinite(+startAt)||+startAt>Date.now()+366*86400000)return Response.json({error:'Invalid start time.'},{status:400});
  // Per-owner queue cap protects SQLite/companion from unbounded backlog.
  const activeCount=await db.agentRoutine.count({where:{ownerId:auth.ctx.principalId,enabled:true}});
  if(activeCount>=50)return Response.json({error:'Maximum of 50 active owner routines.'},{status:429});
  // No unlimited background jobs: every routine has finite run/step caps.
  const created=await db.agentRoutine.create({data:{ownerId:auth.ctx.principalId,title,objective,
    planJson:JSON.stringify(plan),mode,intervalMinutes:mode==='interval'?intervalMinutes:0,
    maxRuns, maxTotalSteps,nextRunAt:startAt}});
  return Response.json({id:created.id,status:created.status,subgoals:plan.length},{status:201});
}
export async function PATCH(req:NextRequest){
  const auth=await requireActiveSession(req);
  if(!auth.ok)return auth.response;
  if(auth.ctx.role!=='OWNER')return Response.json({error:'Owner permission required.'},{status:403});
  const body=await req.json().catch(()=>null);
  if(typeof body?.id!=='string'||!['disable','enable'].includes(body?.action))return Response.json({error:'Invalid action.'},{status:400});
  const row=await db.agentRoutine.findFirst({where:{id:body.id,ownerId:auth.ctx.principalId}});
  if(!row)return Response.json({error:'Routine not found.'},{status:404});
  if(body.action==='disable'){
    await db.agentRoutine.update({where:{id:row.id},data:{enabled:false,status:'disabled',leaseUntil:null,leaseOwner:null}});
  } else {
    if(!['disabled','scheduled'].includes(row.status)||row.activeTaskId)return Response.json({error:'Blocked or active routines require review; create a new routine instead.'},{status:409});
    await db.agentRoutine.update({where:{id:row.id},data:{enabled:true,status:'scheduled',nextRunAt:new Date(),leaseUntil:null,leaseOwner:null}});
  }
  return Response.json({ok:true});
}
