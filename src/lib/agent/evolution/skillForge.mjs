/**
 * JARVIS V1 — native skill forge and hot-readable skill registry.
 * Original implementation inspired by the *concept* of Brahma Evo's Skill
 * Forge/Crucible/Dynamic Registry; NO Brahma Evo/Echo source is copied here.
 *
 * A skill is DECLARATIVE data, never Python/JS or an independently executing
 * agent. Stage => OWNER approves => Core may expand it into advisory steps.
 * Every subsequent action still needs its own Guardian audit + Core admission.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {assessSkill} from "./crucible.mjs";

export class EvolutionError extends Error {
  constructor(message, status=400){super(message);this.name="EvolutionError";this.status=status;}
}
const ROOT=path.resolve(process.env.JARVIS_EVOLUTION_ROOT ||
  path.join(process.cwd(),"data","jarvis-evolution"));
const MAX_SKILLS=64,MAX_STEPS=8,MAX_MANIFEST_BYTES=2800;
const SAFE_TOOLS=new Set([
  "create_folder","read_file","list_dir","write_file","edit_file",
  "memory_recall","world_recall","windows_discover_apps","windows_find_capability",
  "windows_open_url","windows_open_app","windows_open_settings",
  "windows_browser_search","windows_browser_inspect","windows_browser_read_page",
  "windows_browser_click_link","windows_browser_fill_search","windows_browser_scroll",
  "windows_list_windows","windows_desktop_observe","windows_desktop_windows",
  "windows_desktop_state","windows_desktop_focus","windows_desktop_click",
  "windows_desktop_type","windows_desktop_keys","windows_desktop_scroll",
  "windows_native_inspect","windows_native_action","windows_native_verify",
  "minecraft_companion_command","minecraft_companion_join","minecraft_companion_stop"
]);
const uuid=()=>crypto.randomUUID();
const hash=s=>crypto.createHash("sha256").update(s).digest("hex");
const ownerKey=owner=>{
  if(typeof owner!=="string"||owner.length<3||owner.length>250)
    throw new EvolutionError("Authenticated owner required",403);
  return hash(owner).slice(0,40);
};
const directory=owner=>path.join(ROOT,ownerKey(owner));
const registryPath=owner=>path.join(directory(owner),"skills.json");
const validateId=id=>{
  if(typeof id!=="string"||!/^sk_[0-9a-f]{32}$/.test(id))
    throw new EvolutionError("Invalid skill identifier");
  return id;
};
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const plain=(v,depth=0)=>{
  if(depth>5)throw new EvolutionError("Skill data nesting too deep");
  if(v===null||typeof v==="string"||typeof v==="boolean"||
      (typeof v==="number"&&Number.isFinite(v)))return;
  if(Array.isArray(v)){
    if(v.length>32)throw new EvolutionError("Skill argument array too large");
    for(const x of v)plain(x,depth+1);return;
  }
  if(!object(v))throw new EvolutionError("Skill arguments must be JSON");
  if(Object.keys(v).length>20)throw new EvolutionError("Too many argument fields");
  for(const [k,x] of Object.entries(v)){
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(k) ||
       ["__proto__","constructor","prototype"].includes(k))
      throw new EvolutionError("Forbidden argument key");
    plain(x,depth+1);
  }
};
export function normalizeSkillDraft(raw){
  if(!object(raw))throw new EvolutionError("Skill draft must be an object");
  if(Object.keys(raw).some(k=>!["name","description","steps"].includes(k)))
    throw new EvolutionError("Unexpected skill draft field");
  const name=raw.name,description=raw.description,steps=raw.steps;
  if(typeof name!=="string"||!name.trim()||name.length>70||
      /[\x00-\x1f\x7f]/.test(name))
    throw new EvolutionError("Short printable skill name required");
  if(typeof description!=="string"||description.length<12||description.length>400||
      /[\x00-\x08\x0b-\x1f\x7f]/.test(description))
    throw new EvolutionError("Short bounded description required");
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_STEPS)
    throw new EvolutionError("Skill must contain 1–8 stages");
  const normalized=steps.map((step,i)=>{
    if(!object(step)||Object.keys(step).some(k=>!["tool","args","why"].includes(k))||
       typeof step.tool!=="string"||!SAFE_TOOLS.has(step.tool)||!object(step.args)||
       typeof step.why!=="string"||step.why.length<3||step.why.length>160)
      throw new EvolutionError("Unknown/unbounded skill stage "+i);
    plain(step.args);
    if(JSON.stringify(step.args).length>1200)
      throw new EvolutionError("Skill stage arguments too large");
    return {tool:step.tool,args:JSON.parse(JSON.stringify(step.args)),why:step.why};
  });
  const result={schemaVersion:1,name:name.trim(),description:description.trim(),steps:normalized};
  if(Buffer.byteLength(JSON.stringify(result))>MAX_MANIFEST_BYTES)
    throw new EvolutionError("Skill exceeds manifest size");
  return result;
}
async function read(owner){
  try {
    const raw=await fs.readFile(registryPath(owner),"utf8");
    if(Buffer.byteLength(raw)>2*1024*1024)throw new EvolutionError("Skill registry too large",503);
    const doc=JSON.parse(raw);
    if(doc.version!==1||!Array.isArray(doc.skills)||doc.skills.length>MAX_SKILLS)
      throw new EvolutionError("Skill registry corrupt",503);
    return doc.skills;
  }catch(e){
    if(e?.code==="ENOENT")return [];
    if(e instanceof EvolutionError)throw e;
    throw new EvolutionError("Skill registry unavailable or corrupt",503);
  }
}
async function write(owner,items){
  const folder=directory(owner);
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const file=registryPath(owner),temp=file+".tmp-"+crypto.randomBytes(8).toString("hex");
  try{
    await fs.writeFile(temp,JSON.stringify({version:1,skills:items}),{mode:0o600,flag:"wx"});
    await fs.rename(temp,file);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
const inProcess=new Map();
async function serialized(owner,fn){
  const k=ownerKey(owner),prior=inProcess.get(k)||Promise.resolve();
  let release;
  const current=new Promise(resolve=>{release=resolve;});
  const tail=prior.catch(()=>{}).then(()=>current);
  inProcess.set(k,tail);
  await prior.catch(()=>{});
  const folder=directory(owner),lock=path.join(folder,"skills.lock");
  let handle;
  try{
    await fs.mkdir(folder,{recursive:true,mode:0o700});
    // Cross-process exclusive lock. A stale lock intentionally requires
    // owner/admin recovery: never auto-steal another writer's authority.
    try{handle=await fs.open(lock,"wx",0o600);}
    catch{throw new EvolutionError("Skill registry writer busy; retry later",409);}
    return await fn();
  }finally{
    if(handle){await handle.close();await fs.rm(lock,{force:true}).catch(()=>{});}
    release();
    if(inProcess.get(k)===tail)inProcess.delete(k);
  }
}
const summary=item=>({id:item.id,name:item.manifest.name,
  description:item.manifest.description,status:item.status,
  version:item.manifest.schemaVersion,digest:item.digest,createdAt:item.createdAt,
  approvedAt:item.approvedAt||null,stageCount:item.manifest.steps.length,
  crucible:item.crucible||null});
export async function listSkills(owner,{includeDrafts=false}={}){
  const items=await read(owner);
  return items.filter(x=>includeDrafts||x.status==="approved").map(summary);
}
export async function getSkill(owner,id){
  validateId(id);
  const item=(await read(owner)).find(x=>x.id===id);
  if(!item)throw new EvolutionError("Skill not found",404);
  return {...summary(item),manifest:item.manifest};
}
export async function stageSkill(owner,raw){
  const manifest=normalizeSkillDraft(raw),crucible=assessSkill(manifest),
    digest=hash(JSON.stringify(manifest));
  return serialized(owner,async()=>{
    const items=await read(owner);
    const existing=items.find(x=>x.digest===digest&&x.status!=="disabled");
    if(existing)return {...summary(existing),alreadyExists:true};
    if(items.length>=MAX_SKILLS)throw new EvolutionError("Skill capacity reached",409);
    const item={id:"sk_"+crypto.randomBytes(16).toString("hex"),
      status:"staged",manifest,digest,crucible,createdAt:new Date().toISOString()};
    items.push(item);await write(owner,items);
    return summary(item);
  });
}
export async function changeSkill(owner,id,action){
  validateId(id);
  if(!["approve","disable"].includes(action))throw new EvolutionError("Unsupported action");
  return serialized(owner,async()=>{
    const items=await read(owner),item=items.find(x=>x.id===id);
    if(!item)throw new EvolutionError("Skill not found",404);
    if(action==="approve"){
      if(item.status!=="staged")throw new EvolutionError("Only staged skills can be approved",409);
      if(!item.crucible?.passed||assessSkill(item.manifest).passed!==true)
        throw new EvolutionError("Static Crucible preflight required before approval",409);
      item.status="approved";item.approvedAt=new Date().toISOString();
    }else{
      if(item.status!=="approved")throw new EvolutionError("Only active skills can be disabled",409);
      item.status="disabled";
    }
    await write(owner,items);
    return summary(item);
  });
}
function interpolate(v,inputs){
  if(typeof v==="string"){
    const result=v.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g,(_,key)=>{
      if(!Object.prototype.hasOwnProperty.call(inputs,key))
        throw new EvolutionError("Missing skill input "+key);
      const val=inputs[key];
      if(!["string","number","boolean"].includes(typeof val))
        throw new EvolutionError("Skill input must be scalar");
      return String(val);
    });
    if(result.length>4000||result.includes("{{"))
      throw new EvolutionError("Skill input expansion incomplete or oversized");
    return result;
  }
  if(Array.isArray(v))return v.map(x=>interpolate(x,inputs));
  if(object(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,interpolate(x,inputs)]));
  return v;
}
/** Returns ADVISORY commands. This function NEVER executes, audits or authorizes a tool. */
export async function expandSkill(owner,id,inputs={}){
  validateId(id);
  if(!object(inputs)||Object.keys(inputs).length>8)
    throw new EvolutionError("Invalid skill inputs");
  for(const [k,v] of Object.entries(inputs)){
    if(!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)||
       !["string","number","boolean"].includes(typeof v)||
       String(v).length>240)
      throw new EvolutionError("Invalid skill input");
  }
  const item=(await read(owner)).find(x=>x.id===id&&x.status==="approved");
  if(!item)throw new EvolutionError("Skill is not owner-approved",403);
  const digest=hash(JSON.stringify(item.manifest));
  if(digest!==item.digest)throw new EvolutionError("Skill registry digest mismatch",503);
  const crucible=assessSkill(item.manifest);
  if(!item.crucible?.passed)throw new EvolutionError("Missing skill Crucible admission",503);
  const plan=item.manifest.steps.map(s=>({tool:s.tool,args:interpolate(s.args,inputs),why:s.why}));
  if(Buffer.byteLength(JSON.stringify(plan))>MAX_MANIFEST_BYTES)
    throw new EvolutionError("Expanded skill exceeds limit");
  return {name:item.manifest.name,skillId:id,digest:item.digest,steps:plan,stageCount:plan.length,
    crucible,
    advisoryOnly:true,executed:false,authorizationGranted:false,
    requiresPerStepGuardianAudit:true,requiresCoreDurableEffectAdmission:true};
}
