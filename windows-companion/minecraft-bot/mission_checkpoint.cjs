'use strict';
/** Durable owner-authorized mission intent, never durable game-world proof.
 * Restart requires a fresh owner/Guardian auto_resume. Dragon, inventory and
 * stage evidence MUST be freshly acquired from the real server afterward.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateCommand}=require('./friend_protocol.cjs');
const MAX_LEASE_MS=43200*1000;
const MAX_FILE_BYTES=16384;
function fingerprint(identity){
 if(!identity || typeof identity.host!=='string'||!identity.host||
    typeof identity.owner!=='string'||!identity.owner||
    !Number.isInteger(identity.port)||identity.port<1||identity.port>65535)
   throw Error('Missing validated Minecraft connection identity');
 return crypto.createHash('sha256').update(JSON.stringify([
   identity.host.toLowerCase(),identity.port,identity.owner.toLowerCase()
 ])).digest('hex');
}
function extractGoal(state){
 if(!state || state.status!=='running'||!Number.isSafeInteger(state.deadline))return null;
 const goal=state.goal;
 // Entity IDs are session-local and can be recycled after disconnect. Never
 // persist an old hostile identity across a fresh Minecraft process.
 if(['defeat_hostile','transfer','farm_crop'].includes(goal))return null;
 const spec={goal};
 if(goal==='gather'){
   spec.resource=state.resource;spec.targetCount=state.targetCount;
 }else if(goal==='craft'||goal==='smelt'){
   spec.item=state.item;spec.targetCount=state.targetCount;
 }else if(goal==='equip'){
   spec.item=state.item;spec.destinationSlot=state.destination;
 }else if(goal==='travel'){
   spec.destination=state.destination;spec.arrivalRange=state.arrivalRange;
 }else if(goal==='build'){
   spec.position=state.position;spec.block=state.block;spec.axis=state.axis;spec.length=state.length;
 }else if(goal==='build_volume'){
   spec.position=state.position;spec.block=state.block;
   spec.width=state.width;spec.depth=state.depth;
   spec.height=state.height;spec.shape=state.shape;
 }else if(goal==='farm_wheat'){
   spec.position=state.position;spec.width=state.width;spec.depth=state.depth;
   spec.targetCount=state.targetCount;
 }else if(goal==='shelter'){
   spec.width=state.width;spec.depth=state.depth;
 }else if(goal==='sequence')spec.steps=state.sequence;
 if(validateCommand({command:'auto_goal',...spec})!==null)return null;
 return JSON.parse(JSON.stringify(spec));
}
function makeLease(state,identity,now=Date.now()){
 const spec=extractGoal(state);
 if(!spec || !Number.isSafeInteger(now)||state.deadline-now<10000||
    state.deadline-now>MAX_LEASE_MS)return null;
 return {version:1,connection:fingerprint(identity),deadline:state.deadline,spec};
}
function validateLease(data,identity,now=Date.now()){
 if(!data||typeof data!=='object'||Array.isArray(data)||
    data.version!==1||data.connection!==fingerprint(identity)||
    !Number.isSafeInteger(data.deadline)||data.deadline-now<10000||
    data.deadline-now>MAX_LEASE_MS)
   return {ok:false,reason:'Missing, expired or mismatched mission lease'};
 if(!data.spec||typeof data.spec!=='object'||Array.isArray(data.spec)||
    Object.keys(data.spec).some(k=>!['goal','resource','targetCount','destination','arrivalRange','steps','position','block','axis','length','width','depth','height','shape','item','destinationSlot'].includes(k))||
    validateCommand({command:'auto_goal',...data.spec})!==null)
   return {ok:false,reason:'Checkpoint contains unsupported goal parameters'};
 const remainingSeconds=Math.floor((data.deadline-now)/1000);
 if(remainingSeconds<10)return {ok:false,reason:'Mission lease has expired'};
 return {ok:true,spec:JSON.parse(JSON.stringify(data.spec)),remainingSeconds};
}
function createCheckpoint(filePath,identity,{clock=Date.now}={}){
 if(typeof filePath!=='string'||!path.isAbsolute(filePath))
   throw Error('Checkpoint path must be absolute');
 const connection=fingerprint(identity);
 function save(state){
   const lease=makeLease(state,identity,clock());
   if(!lease)return false;
   const tmp=filePath+'.'+process.pid+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
   try{
     fs.writeFileSync(tmp,JSON.stringify(lease)+'\n',{flag:'wx',mode:0o600});
     fs.renameSync(tmp,filePath);
     return true;
   }finally{try{fs.unlinkSync(tmp);}catch{}}
 }
 function load(){
   try{
     const info=fs.lstatSync(filePath);
     if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_FILE_BYTES)
       return {ok:false,reason:'Checkpoint is not a bounded regular file'};
     const data=JSON.parse(fs.readFileSync(filePath,'utf8'));
     if(data.connection!==connection)return {ok:false,reason:'Different Minecraft server/owner identity'};
     return validateLease(data,identity,clock());
   }catch(e){return {ok:false,reason:e?.code==='ENOENT'?'No saved mission':'Invalid or unreadable checkpoint'};}
 }
 function clear(){
   try{
     const info=fs.lstatSync(filePath);
     if(!info.isFile()||info.isSymbolicLink())return false;
     fs.unlinkSync(filePath);return true;
   }catch(e){return e?.code==='ENOENT';}
 }
 return {save,load,clear};
}
module.exports={fingerprint,extractGoal,makeLease,validateLease,createCheckpoint};
