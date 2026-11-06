/**
 * JARVIS native repair vault: prepare -> owner approve -> apply -> rollback.
 * Original implementation of Brahma-inspired self-heal/boot-sentry concepts.
 * NO Brahma Evo/Echo source is embedded. No autonomous executable code or
 * changes outside JARVIS_AGENT_WORKSPACE. Failure => effect_unknown/quarantine.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {constants as FS} from "node:fs";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);

export class RepairError extends Error {
  constructor(message,status=400){super(message);this.name="RepairError";this.status=status;}
}
const ROOT=path.resolve(process.env.JARVIS_EVOLUTION_ROOT ||
  path.join(process.cwd(),"data","jarvis-evolution"));
const WORKSPACE=path.resolve(process.env.JARVIS_AGENT_WORKSPACE ||
  path.join(process.cwd(),"agent-workspace"));
const LIMIT=64*1024, MAX_REPAIRS=48, MAX_TEXT=4096;
const digest=data=>crypto.createHash("sha256").update(data).digest("hex");
const ownerKey=owner=>{
  if(typeof owner!=="string"||owner.length<3||owner.length>250)
    throw new RepairError("Authenticated owner required",403);
  return digest(owner).slice(0,40);
};
const dir=owner=>path.join(ROOT,ownerKey(owner));
const file=owner=>path.join(dir(owner),"repairs.json");
const uuid=()=>crypto.randomUUID();
const validId=id=>{
  if(typeof id!=="string"||!/^rp_[0-9a-f]{32}$/.test(id))
    throw new RepairError("Invalid repair ID");
  return id;
};
const isObject=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const HEX=/^[a-f0-9]{64}$/;
const allowedPath=p=>{
  if(typeof p!=="string"||!p||p.length>300||/[\\\x00-\x1f\x7f]/.test(p)||
     p.startsWith("/")||p.includes(":")||
     p.split("/").some(part=>!part||part==="."||part===".."||
       !/^[a-zA-Z0-9._ -]{1,80}$/.test(part)))
    throw new RepairError("Only a safe workspace-relative file path is permitted");
  const parts=p.toLowerCase().split("/");
  const blocked=new Set(["node_modules",".git",".github",".next","dist","build",
    "package.json","package-lock.json","pnpm-lock.yaml","yarn.lock",
    "tsconfig.json","next.config.ts","next.config.js"]);
  if(parts.some(part=>part.startsWith(".")||blocked.has(part)) ||
     ["src/lib/agent/guardian/","src/lib/agent/auth/",
      "src/lib/agent/evolution/","src/app/api/jarvis/",
      "src/lib/agent/core/loop.ts","src/lib/agent/core/effects.ts",
      "src/lib/agent/core/taskState.ts","src/lib/agent/core/verifier.ts",
      "src/lib/agent/core/autonomyPolicy.ts","src/lib/agent/core/approvedSkillQueue.ts",
      "src/lib/agent/core/skillIntent.ts","src/lib/agent/core/modelProvider.ts",
      "src/lib/agent/tools/","src/lib/agent/windows/"].some(prefix=>
        p.toLowerCase().startsWith(prefix)))
    throw new RepairError("JARVIS protected configuration/security file is immune to self-repair");
  return p;
};
async function boundedFile(rel){
  const clean=allowedPath(rel);
  const rootReal=await fs.realpath(WORKSPACE).catch(()=>null);
  if(!rootReal)throw new RepairError("Guardian workspace unavailable",503);
  const target=path.join(WORKSPACE,...clean.split("/"));
  const root=path.relative(WORKSPACE,target);
  if(root.startsWith("..")||path.isAbsolute(root))
    throw new RepairError("Workspace escape denied");
  const parentReal=await fs.realpath(path.dirname(target)).catch(()=>null);
  if(!parentReal||!(parentReal===rootReal||parentReal.startsWith(rootReal+path.sep)))
    throw new RepairError("Workspace parent outside allowed root");
  const st=await fs.lstat(target).catch(()=>null);
  if(!st||!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)
    throw new RepairError("Target must be a bounded regular non-symlink file");
  const targetReal=await fs.realpath(target);
  if(!targetReal.startsWith(rootReal+path.sep))
    throw new RepairError("Resolved file escaped workspace");
  const bytes=await fs.readFile(target);
  if(bytes.length>LIMIT||!Buffer.from(bytes.toString("utf8"),"utf8").equals(bytes))
    throw new RepairError("Only bounded UTF-8 text repairs are supported");
  return {target,bytes,hash:digest(bytes),st};
}
function proposedPatch(spec){
  if(!isObject(spec)||Object.keys(spec).some(k=>
    !["path","expectedSha256","oldText","newText","diagnosis"].includes(k)))
    throw new RepairError("Unexpected repair field");
  allowedPath(spec.path);
  if(typeof spec.expectedSha256!=="string"||!HEX.test(spec.expectedSha256) ||
     typeof spec.oldText!=="string" || !spec.oldText.length ||
     typeof spec.newText!=="string" || spec.newText===spec.oldText ||
     typeof spec.diagnosis!=="string" || spec.diagnosis.length<12 ||
     spec.diagnosis.length>400 ||
     Buffer.byteLength(spec.oldText)>MAX_TEXT || Buffer.byteLength(spec.newText)>MAX_TEXT)
    throw new RepairError("Repair requires bounded diagnosis, exact SHA and edit");
  return {path:spec.path,expectedSha256:spec.expectedSha256,
    oldText:spec.oldText,newText:spec.newText,diagnosis:spec.diagnosis};
}
function replaceExact(original,oldText,newText){
  const first=original.indexOf(oldText);
  if(first<0||original.indexOf(oldText,first+oldText.length)>=0)
    throw new RepairError("Repair must match exactly one source span",409);
  const after=original.slice(0,first)+newText+original.slice(first+oldText.length);
  if(Buffer.byteLength(after)>LIMIT)
    throw new RepairError("Repaired file exceeds allowed bytes");
  return after;
}
async function load(owner){
  try {
    const raw=await fs.readFile(file(owner),"utf8");
    if(raw.length>2*1024*1024)throw new RepairError("Repair ledger too large",503);
    const data=JSON.parse(raw);
    if(data.version!==1||!Array.isArray(data.repairs)||data.repairs.length>MAX_REPAIRS)
      throw new RepairError("Repair ledger corrupt",503);
    return data.repairs;
  }catch(e){
    if(e?.code==="ENOENT")return [];
    if(e instanceof RepairError)throw e;
    throw new RepairError("Repair ledger unavailable",503);
  }
}
async function save(owner,items){
  await fs.mkdir(dir(owner),{recursive:true,mode:0o700});
  const target=file(owner),temp=target+".tmp-"+crypto.randomBytes(8).toString("hex");
  try {
    const handle=await fs.open(temp,"wx",0o600);
    try{await handle.writeFile(JSON.stringify({version:1,repairs:items}));await handle.sync();}
    finally{await handle.close();}
    await fs.rename(temp,target);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
const queue=new Map();
async function serialized(owner,fn){
  const key=ownerKey(owner),prev=queue.get(key)||Promise.resolve();
  let release;const pending=new Promise(r=>release=r);
  const tail=prev.catch(()=>{}).then(()=>pending);queue.set(key,tail);
  await prev.catch(()=>{});
  let lock;
  try {
    await fs.mkdir(dir(owner),{recursive:true,mode:0o700});
    try{lock=await fs.open(path.join(dir(owner),"repairs.lock"),"wx",0o600);}
    catch{throw new RepairError("Repair vault writer busy",409);}
    return await fn();
  }finally{
    if(lock){await lock.close();await fs.rm(path.join(dir(owner),"repairs.lock"),{force:true}).catch(()=>{});}
    release();if(queue.get(key)===tail)queue.delete(key);
  }
}
const summary=r=>({id:r.id,path:r.path,state:r.state,diagnosis:r.diagnosis,
  beforeSha256:r.beforeSha256,afterSha256:r.afterSha256,createdAt:r.createdAt,
  approvedAt:r.approvedAt||null,appliedAt:r.appliedAt||null,
  rolledBackAt:r.rolledBackAt||null,approvalMode:r.approvalMode||"owner",
  autoApplyTaskId:r.autoApplyTaskId||null,stagedByTaskId:r.stagedByTaskId||null,
  verification:r.verification||null});
export async function listRepairs(owner){
  return (await load(owner)).map(summary);
}
/** Fail-closed boot-sentry diagnostic. NEVER mutates a patch or auto-runs code. */
export async function inspectRecovery(owner){
  const entries=(await load(owner)).filter(x=>
    ["applying","rolling_back","effect_unknown"].includes(x.state)).slice(0,32);
  const recovery=[];
  for(const entry of entries){
    let observed="unreadable";
    try{
      const file=await boundedFile(entry.path);
      observed=file.hash===entry.beforeSha256?"original":
        file.hash===entry.afterSha256?"candidate":"externally_changed";
    }catch{}
    recovery.push({id:entry.id,path:entry.path,state:entry.state,
      observed,requiresOwnerReconciliation:true,
      automaticExecution:false,willNotBlindlyRetry:true});
  }
  return recovery;
}
export async function getRepair(owner,id){
  validId(id);
  const item=(await load(owner)).find(r=>r.id===id);
  if(!item)throw new RepairError("Repair candidate not found",404);
  // Only the authenticated OWNER route calls getRepair; do not expose this
  // diff to the planner without an explicit owner disclosure decision.
  return {...summary(item),oldText:item.oldText,newText:item.newText};
}
export async function stageRepair(owner,raw,metadata={}){
  const stagedByTaskId=metadata?.taskId;
  if(stagedByTaskId!==undefined&&(typeof stagedByTaskId!=="string"||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(stagedByTaskId)))
    throw new RepairError("Invalid Core task provenance",403);
  const spec=proposedPatch(raw);
  return serialized(owner,async()=>{
    const {bytes,hash}=await boundedFile(spec.path);
    if(hash!==spec.expectedSha256)
      throw new RepairError("Source changed since observation; proposal denied",409);
    const revised=replaceExact(bytes.toString("utf8"),spec.oldText,spec.newText);
    const afterHash=digest(Buffer.from(revised,"utf8"));
    const items=await load(owner);
    if(items.length>=MAX_REPAIRS)throw new RepairError("Repair vault capacity reached",409);
    const candidate={id:"rp_"+crypto.randomBytes(16).toString("hex"),
      ...spec,beforeSha256:hash,afterSha256:afterHash,state:"staged",
      stagedByTaskId:stagedByTaskId||null,createdAt:new Date().toISOString()};
    items.push(candidate);await save(owner,items);
    return summary(candidate);
  });
}
export async function approveRepair(owner,id){
  validId(id);
  return serialized(owner,async()=>{
    const items=await load(owner),item=items.find(r=>r.id===id);
    if(!item)throw new RepairError("Repair not found",404);
    if(item.state!=="staged")throw new RepairError("Only staged candidate may be approved",409);
    const existing=await boundedFile(item.path);
    if(existing.hash!==item.beforeSha256)
      throw new RepairError("Repair source changed before approval",409);
    item.state="approved";item.approvedAt=new Date().toISOString();item.approvalMode="owner";
    await save(owner,items);return summary(item);
  });
}
async function atomicReplace(target,newText){
  const st=await fs.lstat(target);
  if(!st.isFile()||st.isSymbolicLink())throw new RepairError("Target changed type");
  const temp=target+".jarvis-repair-"+crypto.randomBytes(10).toString("hex");
  try {
    const mode=st.mode & 0o777;
    const handle=await fs.open(temp,"wx",mode || 0o600);
    try{await handle.writeFile(newText,"utf8");await handle.sync();}
    finally{await handle.close();}
    // No directory walk or shell command is ever delegated to the patch.
    await fs.rename(temp,target);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
async function backup(owner,item,bytes){
  const target=path.join(dir(owner),item.id+".original");
  let handle;
  try{handle=await fs.open(target,"wx",0o600);}
  catch(e){
    if(e?.code!=="EEXIST")throw e;
    const existing=await fs.readFile(target);
    if(digest(existing)!==item.beforeSha256)
      throw new RepairError("Existing source backup failed integrity validation",503);
    return;
  }
  try{await handle.writeFile(bytes);await handle.sync();}
  finally{await handle.close();}
}
export async function applyRepair(owner,id){
  validId(id);
  return serialized(owner,async()=>{
    const items=await load(owner),item=items.find(r=>r.id===id);
    if(!item||item.state!=="approved")
      throw new RepairError("Owner approval required before applying repair",403);
    const original=await boundedFile(item.path);
    if(original.hash!==item.beforeSha256)
      throw new RepairError("Repair target SHA changed; no write performed",409);
    const after=replaceExact(original.bytes.toString("utf8"),item.oldText,item.newText);
    if(digest(Buffer.from(after))!==item.afterSha256)
      throw new RepairError("Candidate digest mismatch",503);
    await backup(owner,item,original.bytes);
    item.state="applying";await save(owner,items); // durable admission BEFORE effect
    try {
      const recheck=await boundedFile(item.path);
      if(recheck.hash!==item.beforeSha256)
        throw new RepairError("Target changed before replacement",409);
      await atomicReplace(original.target,after);
      const observed=await boundedFile(item.path);
      if(observed.hash!==item.afterSha256)
        throw new RepairError("Post-write content mismatch",503);
      item.state="applied";item.appliedAt=new Date().toISOString();
      await save(owner,items);
      return {...summary(item),applied:true,readbackMatched:true};
    }catch(e){
      // A partial or interrupted external mutation is UNKNOWN. The explicit
      // owner rollback route can reconcile it using the preserved backup.
      item.state="effect_unknown";await save(owner,items);
      throw new RepairError("Repair outcome unknown; owner rollback required: "+
        (e instanceof Error?e.message:"unknown"),503);
    }
  });
}

function syntaxCheck(rel,text){
  const ext=path.extname(rel).toLowerCase();
  if(ext===".json"){
    try{JSON.parse(text);return {available:true,passed:true,kind:"json_parse",diagnostics:[]};}
    catch(e){return {available:true,passed:false,kind:"json_parse",
      diagnostics:[String(e instanceof Error?e.message:"invalid JSON").slice(0,240)]};}
  }
  const kinds={".ts":"TS",".tsx":"TSX",".js":"JS",".jsx":"JSX",".mjs":"JS",
    ".cjs":"JS"};
  const kindName=kinds[ext];
  if(!kindName)return {available:false,passed:false,kind:"unsupported",
    diagnostics:["No static syntax verifier is configured for this file type"]};
  try{
    const ts=require("typescript");
    const kind=ts.ScriptKind[kindName];
    const source=ts.createSourceFile(rel,text,ts.ScriptTarget.Latest,true,kind);
    const diagnostics=(source.parseDiagnostics||[]).slice(0,8).map(d=>
      String(ts.flattenDiagnosticMessageText(d.messageText," ")).slice(0,240));
    return {available:true,passed:diagnostics.length===0,kind:"typescript_parser",
      diagnostics};
  }catch{
    return {available:false,passed:false,kind:"unavailable",
      diagnostics:["TypeScript parser is not installed in this runtime"]};
  }
}

/**
 * Static post-apply verification. This parses source; it does NOT execute code,
 * run the project's test suite, or certify runtime behaviour. Syntax failure
 * triggers rollback only while the target still exactly matches our patch.
 */
export async function verifyRepair(owner,id){
  validId(id);
  const initial=(await load(owner)).find(r=>r.id===id);
  if(!initial)throw new RepairError("Repair candidate not found",404);
  if(!["applied","verified"].includes(initial.state))
    throw new RepairError("Only an applied repair can be verified",409);
  const current=await boundedFile(initial.path);
  if(current.hash!==initial.afterSha256)
    return {...summary(initial),verified:false,verification:{
      available:true,passed:false,kind:"readback",diagnostics:["Current file no longer matches the exact repair SHA"]},
      rollbackAvailable:false,requiresOwnerReview:true};
  const checked=syntaxCheck(initial.path,current.bytes.toString("utf8"));
  if(!checked.available)
    return {...summary(initial),verified:false,verification:{
      available:false,passed:false,kind:checked.kind,diagnostics:checked.diagnostics},
      rollbackAvailable:true,requiresOwnerReview:true};
  if(checked.passed){
    return serialized(owner,async()=>{
      const items=await load(owner),item=items.find(r=>r.id===id);
      if(!item||!["applied","verified"].includes(item.state))
        throw new RepairError("Repair state changed before verification",409);
      const observed=await boundedFile(item.path);
      if(observed.hash!==item.afterSha256)
        throw new RepairError("Repair target changed during verification",409);
      item.state="verified";
      item.verification={kind:checked.kind,passed:true,checkedAt:new Date().toISOString(),
        sourceSha256:observed.hash,diagnostics:[]};
      await save(owner,items);
      return {...summary(item),verified:true,verificationLevel:"static_syntax_only",
        runtimeTestsExecuted:false};
    });
  }
  await serialized(owner,async()=>{
    const items=await load(owner),item=items.find(r=>r.id===id);
    if(!item||!["applied","verified"].includes(item.state))
      throw new RepairError("Repair state changed before failed verification was recorded",409);
    const observed=await boundedFile(item.path);
    if(observed.hash!==item.afterSha256)
      throw new RepairError("Repair target changed; refusing automatic rollback",409);
    item.state="verification_failed";
    item.verification={kind:checked.kind,passed:false,checkedAt:new Date().toISOString(),
      sourceSha256:observed.hash,diagnostics:checked.diagnostics};
    await save(owner,items);
  });
  try{
    const rolled=await rollbackRepair(owner,id);
    return {...rolled,verified:false,verification:{
      kind:checked.kind,passed:false,diagnostics:checked.diagnostics},
      automaticRollback:true,runtimeTestsExecuted:false};
  }catch(e){
    const latest=(await load(owner)).find(r=>r.id===id);
    return {...summary(latest||initial),verified:false,verification:{
      kind:checked.kind,passed:false,diagnostics:checked.diagnostics},
      automaticRollback:false,rollbackError:e instanceof Error?e.message:"rollback failed"};
  }
}

/**
 * Bounded autonomous repair. It is disabled unless the trusted server operator
 * sets JARVIS_SELF_REPAIR_AUTO_APPLY=1. The task ID is supplied by Core, not
 * model arguments. At most one repair is auto-applied per task, only inside
 * the configured workspace and only for statically parseable safe files.
 */
export async function autoApplyRepair(owner,id,taskId){
  validId(id);
  if(process.env.JARVIS_SELF_REPAIR_AUTO_APPLY!=="1")
    throw new RepairError("Bounded automatic repair is disabled by owner policy",403);
  if(typeof taskId!=="string"||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(taskId))
    throw new RepairError("Core task identity required for bounded automatic repair",403);
  await serialized(owner,async()=>{
    const items=await load(owner),item=items.find(r=>r.id===id);
    if(!item||item.state!=="staged")
      throw new RepairError("Only a fresh staged repair can enter bounded auto-apply",409);
    if(item.stagedByTaskId!==taskId)
      throw new RepairError("Automatic repair must use a candidate staged by this exact Core task",403);
    if(items.some(r=>r.autoApplyTaskId===taskId))
      throw new RepairError("One automatic repair per task is the configured limit",409);
    const original=await boundedFile(item.path);
    if(original.hash!==item.beforeSha256)
      throw new RepairError("Repair source SHA changed; automatic apply refused",409);
    const candidate=replaceExact(original.bytes.toString("utf8"),item.oldText,item.newText);
    const preflight=syntaxCheck(item.path,candidate);
    if(!preflight.available||!preflight.passed)
      throw new RepairError("Automatic repair requires a passing static syntax preflight",409);
    item.state="approved";
    item.approvedAt=new Date().toISOString();
    item.approvalMode="bounded_auto_policy";
    item.autoApplyTaskId=taskId;
    item.verification={kind:preflight.kind,passed:true,checkedAt:new Date().toISOString(),
      sourceSha256:item.afterSha256,diagnostics:[],phase:"preflight"};
    await save(owner,items);
  });
  const applied=await applyRepair(owner,id);
  if(applied.state!=="applied")
    return {...applied,automaticApproval:true,verified:false};
  const verified=await verifyRepair(owner,id);
  return {...verified,automaticApproval:true,verificationLevel:
    verified.verified?"static_syntax_only":"not_verified",runtimeTestsExecuted:false};
}

export async function rollbackRepair(owner,id){
  validId(id);
  return serialized(owner,async()=>{
    const items=await load(owner),item=items.find(r=>r.id===id);
    if(!item||!["applied","verified","verification_failed","applying","effect_unknown","rolling_back"].includes(item.state))
      throw new RepairError("Only an applied or ambiguous patch can be rolled back",409);
    const before=await fs.readFile(path.join(dir(owner),item.id+".original")).catch(()=>null);
    if(!before||digest(before)!==item.beforeSha256)
      throw new RepairError("Original backup missing or corrupt",503);
    const current=await boundedFile(item.path);
    if(current.hash===item.beforeSha256){
      item.state="rolled_back";item.rolledBackAt=new Date().toISOString();
      await save(owner,items);
      return {...summary(item),alreadyRestored:true};
    }
    if(current.hash!==item.afterSha256)
      throw new RepairError("File changed after patch; refusing destructive rollback",409);
    item.state="rolling_back";await save(owner,items);
    try {
      const recheck=await boundedFile(item.path);
      if(recheck.hash!==item.afterSha256)
        throw new RepairError("Target changed during rollback",409);
      await atomicReplace(current.target,before.toString("utf8"));
      if((await boundedFile(item.path)).hash!==item.beforeSha256)
        throw new RepairError("Restoration readback mismatch",503);
      item.state="rolled_back";item.rolledBackAt=new Date().toISOString();
      await save(owner,items);
      return {...summary(item),rolledBack:true,readbackMatched:true};
    }catch(e){
      item.state="effect_unknown";await save(owner,items);
      throw new RepairError("Rollback outcome unknown; manual recovery: "+
        (e instanceof Error?e.message:"unknown"),503);
    }
  });
}
