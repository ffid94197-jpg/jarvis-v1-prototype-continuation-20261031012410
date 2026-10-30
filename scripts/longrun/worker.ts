/** Dedicated local background worker for owner-created routines.
 * Run only through `bun --env-file=.env scripts/longrun/worker.ts`.
 * Does NOT impersonate a user session: acts on tasks explicitly scheduled
 * through the authenticated owner endpoint and on ACTIVE principals only.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { runTask, buildReplayFromJournal } from '../../src/lib/agent/core/loop';
import { reconcileCrashedTasks } from '../../src/lib/agent/core/effects';
import { makePlan, nextAfterOutcome, nextSchedule, taskPrompt, type LongGoal } from '../../src/lib/agent/longrun/planner.mjs';

const WORKER_ID = randomUUID();
const LEASE_MS = 120000;
const HEARTBEAT_MS = 10000;
let stop = false;
process.on('SIGINT', () => { stop = true; });
process.on('SIGTERM', () => { stop = true; });
const delay = (ms:number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function companionReady():Promise<boolean>{
  if (process.env.JARVIS_WINDOWS_AGENT_ENABLED !== '1') return true;
  const token=process.env.JARVIS_WINDOWS_COMPANION_TOKEN;
  if(!token || token.length<32)return false;
  try{
    const r=await fetch('http://127.0.0.1:20189/health',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1600),cache:'no-store'});
    if(!r.ok)return false;
    const body=await r.json() as {ok?:boolean;windows?:boolean};
    return body.ok===true&&body.windows===true;
  }catch{return false;}
}

async function saveIfLeased(id:string, data:Record<string,unknown>) {
  const r = await db.agentRoutine.updateMany({where:{id,leaseOwner:WORKER_ID},data});
  if (r.count !== 1) throw Error('Worker lost fenced routine lease.');
}
async function block(id:string, reason:string) {
  await saveIfLeased(id, {status:'blocked',enabled:false,lastError:reason.slice(0,500),activeTaskId:null,leaseOwner:null,leaseUntil:null});
}
async function runRoutine(id:string) {
  const row = await db.agentRoutine.findUnique({where:{id}});
  if (!row || row.leaseOwner !== WORKER_ID || !row.enabled) return;
  const owner = await db.principal.findUnique({where:{id:row.ownerId}});
  if (!owner || owner.status !== 'ACTIVE') { await block(id,'Owner principal is not active.');return; }
  let plan: LongGoal[];
  try { plan = makePlan(row.objective, JSON.parse(row.planJson)); }
  catch { await block(id,'Persisted routine plan failed validation.');return; }
  if (!plan[row.stepIndex] || !plan[row.stepIndex].strategies[row.routeIndex]) { await block(id,'Invalid persisted planner cursor.');return; }
  let taskId = row.activeTaskId;
  if (!taskId) {
    const objective = taskPrompt(plan,row.stepIndex,row.routeIndex,row.objective);
    // Create task and link in a single transaction: a crash cannot leave
    // a routine pointing to a nonexistent task or launch twice.
    try {
      const created = await db.$transaction(async tx=>{
        const item = await tx.agentTask.create({data:{objective,ownerId:owner.id,status:'planned',stepsUsed:0,sessionId:null,createdByDeviceId:owner.id}});
        const claimed = await tx.agentRoutine.updateMany({where:{id,leaseOwner:WORKER_ID,activeTaskId:null,enabled:true},data:{activeTaskId:item.id,status:'running',sliceCount:0,lastRunAt:new Date()}});
        if (claimed.count!==1) throw Error('Lost lease before task creation.');
        await tx.agentRoutineAttempt.create({data:{routineId:id,taskId:item.id,stepIndex:row.stepIndex,routeIndex:row.routeIndex}});
        return item;
      });
      taskId=created.id;
    } catch(err) { console.error('[longrun] atomic creation:',err);return; }
  }
  let slices = row.activeTaskId ? row.sliceCount : 0;
  let lastStatus = '';
  let lastText = '';
  let lostLease = false;
  let killed = false;
  const deadline=Date.now()+20*60*1000; // maximum wall-clock time per acquired routine lease
  const heartbeat = setInterval(()=>{
    void (async()=>{
      const result=await db.agentRoutine.updateMany({where:{id,leaseOwner:WORKER_ID,enabled:true},data:{leaseUntil:new Date(Date.now()+LEASE_MS)}});
      if(result.count!==1) lostLease=true;
      const current=await db.agentRoutine.findUnique({where:{id},select:{enabled:true}});
      if(!current?.enabled) killed=true;
    })().catch(()=>{lostLease=true;});
  },HEARTBEAT_MS);
  try {
    for (;slices<8 && !stop && !lostLease && !killed && Date.now()<deadline;slices++) {
      const task=await db.agentTask.findUnique({where:{id:taskId}});
      if (!task || task.ownerId !== owner.id) { await block(id,'Task missing or ownership changed.');return; }
      if (task.stepsUsed >= row.maxTotalSteps) {await block(id,'Maximum total tool steps exceeded.');return;}
      if (!['planned','paused'].includes(task.status)) {
        if (['completed','verified','failed','partial','cancelled','denied','effect_unknown'].includes(task.status)) {
          lastStatus=task.status; lastText=task.finalText ?? '';
          break;
        }
        // A task interrupted in EXECUTING/PLANNING must not be blindly
        // replayed because a desktop effect could still be in flight.
        await block(id,`Unsafe interrupted task state: ${task.status}. Manual reconciliation required.`);return;
      }
      const replay=task.status==='paused'?await buildReplayFromJournal(taskId):null;
      if(task.status==='paused' && !replay){await block(id,'Missing durable replay evidence.');return;}
      let sliceFinal='';
      let sliceStatus='';
      await runTask({
        taskId,ownerId:owner.id,objective:task.objective,
        budget:Math.min(24,Math.max(1,row.maxTotalSteps-task.stepsUsed)),
        stepsUsedOffset:replay?.stepsUsed??0,
        replay:replay?.replay,executedEffects:replay?.executedEffects,
        pendingGuiVerification:replay?.pendingGuiVerification,
        planRevision:task.planRevision,
        emit:ev=>{if(ev.type==='final'){sliceStatus=ev.status;sliceFinal=ev.text;}},
        isCancelled:()=>stop||lostLease||killed||Date.now()>=deadline,
      });
      const after=await db.agentTask.findUnique({where:{id:taskId}});
      lastStatus=after?.status??sliceStatus;
      lastText=after?.finalText??sliceFinal;
      await saveIfLeased(id,{sliceCount:slices+1});
      if(lastStatus!=='paused') break;
      const lastStep=await db.agentStep.findFirst({where:{taskId,kind:'pause'},orderBy:{createdAt:'desc'}});
      if(/ineffective|repeated|watchdog/i.test(`${lastText} ${lastStep?.note??''}`)) {
        const outstanding=await buildReplayFromJournal(taskId);
        // Switching to another approach while GUI effects remain unverified
        // can repeat an action. Escalate instead of guessing.
        if(!outstanding || outstanding.pendingGuiVerification>0){await block(id,'Watchdog detected unverified GUI effects; operator review required.');return;}
        lastStatus='watchdog_pause';break;
      }
    }
    if (stop || lostLease || killed) { console.log('[longrun] cancelled or lost lease, leaving journal for review',id);return; }
    if (lastStatus==='paused' || !lastStatus) {
      await block(id,'Routine paused after eight execution slices; requires operator review.');return;
    }
    await db.agentRoutineAttempt.updateMany({where:{taskId},data:{outcome:lastStatus,summary:lastText.slice(0,1000),endedAt:new Date()}});
    const next=nextAfterOutcome(plan,row.stepIndex,row.routeIndex,lastStatus);
    if(next.kind==='blocked') {await block(id,`Task ended ${lastStatus}: ${next.reason??''} ${lastText.slice(0,200)}`);return;}
    if(next.kind==='hold') {await block(id,`Unrecognized agent outcome: ${lastStatus}`);return;}
    if(next.kind==='retry_alternative' || next.kind==='advance') {
      await saveIfLeased(id, {activeTaskId:null,stepIndex:next.stepIndex,routeIndex:next.routeIndex,sliceCount:0,status:'scheduled',nextRunAt:new Date(),lastError:next.kind==='retry_alternative'?`Trying alternative after ${lastStatus}`:null,leaseOwner:null,leaseUntil:null});
      return;
    }
    const runCount=row.runCount+1;
    const when=nextSchedule(row.mode,row.nextRunAt,row.intervalMinutes);
    if (runCount>=row.maxRuns || !when) {
      await saveIfLeased(id,{runCount,activeTaskId:null,stepIndex:0,routeIndex:0,sliceCount:0,status:'done',enabled:false,lastError:null,leaseOwner:null,leaseUntil:null});
    } else {
      await saveIfLeased(id,{runCount,activeTaskId:null,stepIndex:0,routeIndex:0,sliceCount:0,status:'scheduled',nextRunAt:when,lastError:null,leaseOwner:null,leaseUntil:null});
    }
  } finally {
    clearInterval(heartbeat);
    // On exceptions, the lease expires; do not mark work completed.
  }
}
async function main() {
  if (process.platform!=='win32') throw Error('Background desktop scheduler requires native Windows.');
  if (process.env.JARVIS_LONGRUN_ENABLED!=='1') throw Error('Enable only on your local test PC with JARVIS_LONGRUN_ENABLED=1.');
  console.log(`[longrun] worker ${WORKER_ID} started; polling owner routines.`);
  await reconcileCrashedTasks();
  const startedAt=new Date();
  // Global single-desktop lock: never let two independent worker processes
  // manipulate the same keyboard/mouse in parallel. Stale-owner takeover is
  // a compare-and-set write, and the prior owner must stop at its next check.
  const staleBefore=new Date(Date.now()-45000);
  const existing=await db.agentWorkerPulse.findUnique({where:{id:'primary'}});
  if(!existing){
    try{await db.agentWorkerPulse.create({data:{id:'primary',workerId:WORKER_ID,pid:process.pid,startedAt,lastSeenAt:new Date()}});}
    catch{throw Error('A second worker claimed the singleton desktop lock.');}
  }else{
    const claim=await db.agentWorkerPulse.updateMany({where:{id:'primary',lastSeenAt:{lt:staleBefore}},data:{workerId:WORKER_ID,pid:process.pid,startedAt,lastSeenAt:new Date()}});
    if(claim.count!==1)throw Error('A healthy worker already owns the desktop; duplicate worker refused.');
  }
  async function pulse(){
    const result=await db.agentWorkerPulse.updateMany({where:{id:'primary',workerId:WORKER_ID},data:{lastSeenAt:new Date()}});
    if(result.count!==1){stop=true;throw Error('Global desktop worker lease lost.');}
  }
  const pulseTimer=setInterval(()=>{void pulse().catch(err=>console.error('[longrun] heartbeat failed',err));},15000);
  try {while (!stop) {
    if(!(await companionReady())){await delay(3000);continue;}
    const now=new Date();
    const candidates=await db.agentRoutine.findMany({where:{enabled:true,nextRunAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},orderBy:{nextRunAt:'asc'},take:8});
    for(const row of candidates){
      if(stop)break;
      const claimed=await db.agentRoutine.updateMany({where:{id:row.id,enabled:true,nextRunAt:{lte:new Date()},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseOwner:WORKER_ID,leaseUntil:new Date(Date.now()+LEASE_MS)}});
      if(claimed.count!==1)continue;
      try{await runRoutine(row.id);}catch(err){console.error('[longrun] routine failed:',row.id,err);}
    }
    await delay(2000);
  }} finally {
    clearInterval(pulseTimer);
    await db.$disconnect();
  }
}
void main().catch(err=>{console.error('[longrun] fatal',err);process.exitCode=1;});
