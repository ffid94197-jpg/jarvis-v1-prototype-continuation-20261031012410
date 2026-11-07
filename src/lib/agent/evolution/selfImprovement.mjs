/**
 * JARVIS self-improvement evaluator.
 *
 * Records only owner-scoped task outcome metadata (never objectives, prompts,
 * arguments, file contents or credentials) and compares repeated runs of the
 * same normalized objective with and without an approved skill.
 *
 * This is measurement, not authority: it never approves, disables, executes,
 * or modifies a skill. Owner/Guardian policy remains unchanged.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export class ImprovementError extends Error {
  constructor(message,status=400){super(message);this.name="ImprovementError";this.status=status;}
}
const ROOT=path.resolve(process.env.JARVIS_EVOLUTION_ROOT||
  path.join(process.cwd(),"data","jarvis-evolution"));
const MAX_SAMPLES=200;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SKILL=/^sk_[0-9a-f]{32}$/;
const STATUSES=new Set(["completed","failed","partial","denied","effect_unknown"]);
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const ownerKey=owner=>{
  if(typeof owner!=="string"||owner.length<3||owner.length>250)
    throw new ImprovementError("Authenticated owner required",403);
  return hash(owner).slice(0,40);
};
const folder=owner=>path.join(ROOT,ownerKey(owner));
const ledger=owner=>path.join(folder(owner),"performance.json");
const lockPath=owner=>path.join(folder(owner),"performance.lock");
const queues=new Map();

async function serialized(owner,fn){
  const key=ownerKey(owner),prior=queues.get(key)||Promise.resolve();
  let release;
  const current=new Promise(resolve=>{release=resolve;});
  const tail=prior.catch(()=>{}).then(()=>current);
  queues.set(key,tail);
  await prior.catch(()=>{});
  let handle;
  try{
    await fs.mkdir(folder(owner),{recursive:true,mode:0o700});
    try{handle=await fs.open(lockPath(owner),"wx",0o600);}
    catch{throw new ImprovementError("Performance ledger writer busy; retry later",409);}
    return await fn();
  }finally{
    if(handle){await handle.close();await fs.rm(lockPath(owner),{force:true}).catch(()=>{});}
    release();
    if(queues.get(key)===tail)queues.delete(key);
  }
}
async function read(owner){
  try{
    const raw=await fs.readFile(ledger(owner),"utf8");
    if(Buffer.byteLength(raw)>1024*1024)throw new ImprovementError("Performance ledger too large",503);
    const doc=JSON.parse(raw);
    if(doc.version!==1||!Array.isArray(doc.samples)||doc.samples.length>MAX_SAMPLES)
      throw new ImprovementError("Performance ledger corrupt",503);
    return doc.samples;
  }catch(error){
    if(error?.code==="ENOENT")return [];
    if(error instanceof ImprovementError)throw error;
    throw new ImprovementError("Performance ledger unavailable or corrupt",503);
  }
}
async function write(owner,samples){
  const target=ledger(owner),temp=target+".tmp-"+crypto.randomBytes(8).toString("hex");
  try{
    await fs.writeFile(temp,JSON.stringify({version:1,samples}),{mode:0o600,flag:"wx"});
    await fs.rename(temp,target);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
function normalizeObjective(value){
  if(typeof value!=="string"||!value.trim()||value.length>5000)
    throw new ImprovementError("Bounded task objective required");
  return value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
}
function safeInteger(value,label,max){
  if(!Number.isInteger(value)||value<0||value>max)
    throw new ImprovementError("Invalid "+label);
  return value;
}
function normalizeSample(owner,raw){
  ownerKey(owner);
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||
     Object.keys(raw).some(k=>!["taskId","objective","skillId","status","stepCount","elapsedMs","failureCount","uncertainEffects","verified"].includes(k)))
    throw new ImprovementError("Unexpected performance sample fields");
  if(typeof raw.taskId!=="string"||!UUID.test(raw.taskId))
    throw new ImprovementError("Valid source task UUID required");
  const objectiveHash=hash(normalizeObjective(raw.objective));
  const skillId=raw.skillId===null||raw.skillId===undefined?null:raw.skillId;
  if(skillId!==null&&(typeof skillId!=="string"||!SKILL.test(skillId)))
    throw new ImprovementError("Invalid approved skill reference");
  if(!STATUSES.has(raw.status))throw new ImprovementError("Unsupported terminal task status");
  const stepCount=safeInteger(raw.stepCount,"step count",10000);
  const elapsedMs=safeInteger(raw.elapsedMs,"elapsed time",7*24*60*60*1000);
  const failureCount=safeInteger(raw.failureCount,"failure count",10000);
  const uncertainEffects=safeInteger(raw.uncertainEffects,"uncertain effect count",10000);
  if(typeof raw.verified!=="boolean")throw new ImprovementError("Verification flag required");
  if(raw.verified&&(raw.status!=="completed"||uncertainEffects>0))
    throw new ImprovementError("Only completed tasks without uncertain effects can be verified");
  return {taskId:raw.taskId,objectiveHash,skillId,status:raw.status,stepCount,elapsedMs,
    failureCount,uncertainEffects,verified:raw.verified,recordedAt:new Date().toISOString()};
}
const median=values=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
};
const rate=(samples,predicate)=>samples.length?samples.filter(predicate).length/samples.length:0;

/** Store one actual Core-settled outcome; idempotent by task UUID. */
export async function recordTaskOutcome(owner,raw){
  const sample=normalizeSample(owner,raw);
  return serialized(owner,async()=>{
    const samples=await read(owner),existing=samples.find(x=>x.taskId===sample.taskId);
    if(existing){
      const comparable=x=>JSON.stringify({taskId:x.taskId,objectiveHash:x.objectiveHash,skillId:x.skillId,
        status:x.status,stepCount:x.stepCount,elapsedMs:x.elapsedMs,failureCount:x.failureCount,
        uncertainEffects:x.uncertainEffects,verified:x.verified});
      if(comparable(existing)!==comparable(sample))
        throw new ImprovementError("Task performance outcome is immutable once recorded",409);
      return {recorded:false,alreadyRecorded:true,objectiveHash:sample.objectiveHash.slice(0,16)};
    }
    samples.push(sample);
    await write(owner,samples.slice(-MAX_SAMPLES));
    return {recorded:true,alreadyRecorded:false,objectiveHash:sample.objectiveHash.slice(0,16)};
  });
}

/** Compare at least three same-owner, same-objective baseline and skill runs. */
export async function evaluateSkillPerformance(owner,skillId,objective){
  ownerKey(owner);
  if(typeof skillId!=="string"||!SKILL.test(skillId))
    throw new ImprovementError("Valid skill ID required");
  const objectiveHash=hash(normalizeObjective(objective));
  const samples=await read(owner);
  const baseline=samples.filter(x=>x.objectiveHash===objectiveHash&&x.skillId===null);
  const candidate=samples.filter(x=>x.objectiveHash===objectiveHash&&x.skillId===skillId);
  const summary={
    schemaVersion:1,skillId,objectiveHash:objectiveHash.slice(0,16),
    baselineRuns:baseline.length,candidateRuns:candidate.length,
    minimumRunsPerGroup:3,status:"insufficient_evidence",
    baselineSuccessRate:rate(baseline,x=>x.verified),
    candidateSuccessRate:rate(candidate,x=>x.verified),
    baselineUncertainRate:rate(baseline,x=>x.uncertainEffects>0),
    candidateUncertainRate:rate(candidate,x=>x.uncertainEffects>0),
    baselineMedianSteps:median(baseline.filter(x=>x.verified).map(x=>x.stepCount)),
    candidateMedianSteps:median(candidate.filter(x=>x.verified).map(x=>x.stepCount)),
    baselineMedianElapsedMs:median(baseline.filter(x=>x.verified).map(x=>x.elapsedMs)),
    candidateMedianElapsedMs:median(candidate.filter(x=>x.verified).map(x=>x.elapsedMs)),
    approvalChanged:false,skillModified:false,
  };
  if(baseline.length<3||candidate.length<3)
    return {...summary,recommendation:"Collect at least three matched baseline runs and three candidate runs; no improvement is claimed."};
  if(summary.candidateSuccessRate<summary.baselineSuccessRate||
     summary.candidateUncertainRate>summary.baselineUncertainRate){
    return {...summary,status:"regression",
      recommendation:"Candidate underperformed or increased uncertain effects. Review the skill and consider owner-authorized disable; no automatic change was made."};
  }
  const stepsImproved=summary.baselineMedianSteps!==null&&summary.candidateMedianSteps!==null&&
    summary.candidateMedianSteps<=summary.baselineMedianSteps*0.9;
  const timeImproved=summary.baselineMedianElapsedMs!==null&&summary.candidateMedianElapsedMs!==null&&
    summary.candidateMedianElapsedMs<=summary.baselineMedianElapsedMs*0.9;
  if(summary.candidateSuccessRate>summary.baselineSuccessRate||stepsImproved||timeImproved)
    return {...summary,status:"improved",
      recommendation:"Candidate shows measured improvement on matched owner task outcomes. Retain only subject to owner review; no approval or permission changed."};
  return {...summary,status:"no_material_improvement",
    recommendation:"Candidate has not demonstrated a material improvement over baseline. Keep the baseline strategy; no automatic change was made."};
}

/**
 * Derive a privacy-minimized performance sample from the real durable Core
 * journal. No model-supplied metric or completion assertion is accepted.
 */
export async function recordTaskPerformanceFromJournal(owner,taskId,db,settledStatus){
  if(typeof taskId!=="string"||!UUID.test(taskId)||!STATUSES.has(settledStatus))
    throw new ImprovementError("Valid settled task reference required");
  const task=await db.agentTask.findFirst({
    where:{id:taskId,ownerId:owner},
    select:{id:true,ownerId:true,objective:true,status:true,createdAt:true,updatedAt:true},
  });
  if(!task||task.ownerId!==owner||task.status!==settledStatus)
    return {recorded:false,reason:"owner_task_or_settlement_mismatch"};
  const [steps,effects]=await Promise.all([
    db.agentStep.findMany({
      where:{taskId},
      orderBy:[{seq:"asc"},{createdAt:"asc"}],take:512,
      select:{seq:true,kind:true,tool:true,argsJson:true,resultJson:true},
    }),
    db.effectRecord.findMany({
      where:{taskId},
      select:{status:true},
    }),
  ]);
  const calls=steps.filter(x=>x.kind==="tool_call");
  if(!calls.length)return {recorded:false,reason:"no_tool_execution"};
  const results=new Map();
  for(const row of steps.filter(x=>x.kind==="tool_result"))results.set(row.seq,row);
  let failureCount=steps.filter(x=>x.kind==="error"||x.kind==="guardian_deny").length;
  let completeReceipts=true;
  for(const call of calls){
    const receipt=results.get(call.seq);
    if(!receipt||receipt.tool!==call.tool){completeReceipts=false;failureCount++;continue;}
    try{const parsed=JSON.parse(receipt.resultJson||"{}");if(parsed.ok!==true)failureCount++;}
    catch{failureCount++;completeReceipts=false;}
  }
  const uncertainEffects=effects.filter(x=>x.status==="ADMITTED"||x.status==="EFFECT_UNKNOWN").length;
  const skillRuns=calls.filter(x=>x.tool==="evolution_skill_run");
  if(skillRuns.length>1)return {recorded:false,reason:"multiple_skill_runs_not_attributable"};
  let skillId=null;
  if(skillRuns.length===1){
    try{
      const args=JSON.parse(skillRuns[0].argsJson||"{}");
      if(typeof args.id!=="string"||!SKILL.test(args.id))
        return {recorded:false,reason:"skill_run_id_unverifiable"};
      skillId=args.id;
    }catch{return {recorded:false,reason:"skill_run_arguments_unreadable"};}
  }
  const created=task.createdAt instanceof Date?task.createdAt.getTime():Date.parse(task.createdAt);
  const updated=task.updatedAt instanceof Date?task.updatedAt.getTime():Date.parse(task.updatedAt);
  const elapsedMs=Number.isFinite(created)&&Number.isFinite(updated)?Math.max(0,Math.min(7*24*60*60*1000,updated-created)):0;
  const verified=settledStatus==="completed"&&completeReceipts&&uncertainEffects===0;
  const outcome=await recordTaskOutcome(owner,{
    taskId,objective:task.objective,skillId,status:settledStatus,stepCount:calls.length,
    elapsedMs,failureCount,uncertainEffects,verified,
  });
  const evaluation=skillId?await evaluateSkillPerformance(owner,skillId,task.objective):null;
  return {recorded:true,skillId,outcome,evaluation,
    evidence:{toolCalls:calls.length,completeReceipts,failures:failureCount,uncertainEffects,verified}};
}

/** Privacy-minimized owner summary for the evolution status endpoint. */
export async function getPerformanceSummary(owner){
  const samples=await read(owner);
  const bySkill=new Map();
  for(const sample of samples){
    const key=sample.skillId||"baseline";
    const item=bySkill.get(key)||{skillId:sample.skillId,runs:0,verified:0,failures:0,uncertainEffects:0};
    item.runs++;if(sample.verified)item.verified++;
    item.failures+=sample.failureCount;item.uncertainEffects+=sample.uncertainEffects;
    bySkill.set(key,item);
  }
  return {sampleCount:samples.length,skills:[...bySkill.values()].slice(0,32),
    privacy:{rawObjectivesStored:false,rawArgumentsStored:false,secretsStored:false}};
}
