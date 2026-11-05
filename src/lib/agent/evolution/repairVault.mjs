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
  rolledBackAt:r.rolledBackAt||null});
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
export async function stageRepair(owner,raw){
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
      createdAt:new Date().toISOString()};
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
    item.state="approved";item.approvedAt=new Date().toISOString();
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
export async function rollbackRepair(owner,id){
  validId(id);
  return serialized(owner,async()=>{
    const items=await load(owner),item=items.find(r=>r.id===id);
    if(!item||!["applied","applying","effect_unknown","rolling_back"].includes(item.state))
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
