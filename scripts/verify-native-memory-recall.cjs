/** Offline real Core/Guardian/executor memory-recall flow.
 * No actual Prisma network access or model egress; scopes and data class are
 * verified through the actual TypeScript module bodies using fake DB data.
 */
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(p,mocks={}) {
 const src=fs.readFileSync(path.join(root,p),'utf8');
 const js=ts.transpileModule(src,{fileName:p,compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true
 }}).outputText;
 const mod={exports:{}};
 const req=id=>Object.prototype.hasOwnProperty.call(mocks,id)?mocks[id]:require(id);
 new Function('require','module','exports','process','Buffer',js)(
  req,mod,mod.exports,process,Buffer);
 return mod.exports;
}
const memory=[
 {principalId:'owner-A',key:'editor',content:'VS Code is preferred for editing',
  dataClass:'CLOUD_APPROVED',source:'OWNER_EXPLICIT',version:1,deletedAt:null},
 {principalId:'owner-A',key:'editor.personal',content:'private secret preference',
  dataClass:'LOCAL_PRIVATE',source:'OWNER_EXPLICIT',version:2,deletedAt:null},
 {principalId:'owner-B',key:'editor.other',content:'never expose another owner preference',
  dataClass:'CLOUD_APPROVED',source:'OWNER_EXPLICIT',version:1,deletedAt:null},
 {principalId:'owner-A',key:'editor.deleted',content:'old deleted recommendation',
  dataClass:'CLOUD_APPROVED',source:'OWNER_EXPLICIT',version:1,deletedAt:new Date()},
];
const now=new Date();
const world=[
 {principalId:'owner-A',subject:'office door',predicate:'status',value:'closed',
  source:'USER_REPORTED',provenance:'owner_api',confidence:0.5,
  observedAt:new Date(now.getTime()-3600000),expiresAt:new Date(now.getTime()+3600000),retractedAt:null},
 {principalId:'owner-A',subject:'office door',predicate:'status',value:'was open',
  source:'USER_REPORTED',provenance:'owner_api',confidence:0.5,
  observedAt:new Date(now.getTime()-7200000),expiresAt:new Date(now.getTime()-1000),retractedAt:null},
 {principalId:'owner-A',subject:'office door',predicate:'status',value:'retracted state',
  source:'USER_REPORTED',provenance:'owner_api',confidence:0.5,
  observedAt:now,expiresAt:null,retractedAt:now},
 {principalId:'owner-B',subject:'office door',predicate:'status',value:'other owner secret',
  source:'USER_REPORTED',provenance:'owner_api',confidence:0.5,
  observedAt:now,expiresAt:null,retractedAt:null}
];
const audit=[];
const db={
 auditLog:{create:async({data})=>{audit.push(data);return{id:'audit'}}},
 jarvisMemory:{findMany:async({where,take})=>memory.filter(x=>
   x.principalId===where.principalId &&
   x.deletedAt===where.deletedAt &&
   x.dataClass===where.dataClass &&
   where.OR.some(row=>
     (row.key?.contains && x.key.includes(row.key.contains)) ||
     (row.content?.contains && x.content.includes(row.content.contains))
   )
 ).slice(0,take)},
 jarvisWorldObservation:{findMany:async({where,take})=>world.filter(x=>
   x.principalId===where.principalId && x.retractedAt===where.retractedAt &&
   where.AND.every(group=>group.OR.some(rule=>
     rule.expiresAt===null ? x.expiresAt===null :
       rule.expiresAt?.gt ? (x.expiresAt && x.expiresAt>rule.expiresAt.gt) : false
   )) &&
   where.OR.some(rule=>
     (rule.subject?.contains && x.subject.includes(rule.subject.contains)) ||
     (rule.predicate?.contains && x.predicate.includes(rule.predicate.contains)) ||
     (rule.value?.contains && x.value.includes(rule.value.contains))
   )
 ).slice(0,take)}
};
const modules={
 '@/lib/db':{db},
 './policy':{},
 '../windows/policy':{validateDesktopTool:()=>({ok:false,reason:'denied'})},
};
const guardian=load('src/lib/agent/guardian/guardian.ts',modules);
const contract=load('src/lib/agent/memory/contracts.ts');
const executor=load('src/lib/agent/tools/executor.ts',{
 '@/lib/db':{db},
 '../memory/contracts':contract,
 './edit':{editWorkspaceTextFile:async()=>{throw Error('wrong edit operation')}},
 '../guardian/policy':{MAX_READ_BYTES:65536,MAX_WRITE_BYTES:65536,WORKSPACE_ROOT:'/tmp/test',COMMAND_TIMEOUT_MS:1000},
 '../windows/bridge':{companionAction:async()=>{throw Error('unexpected OS operation')}},
});
let n=0;
async function verify(label,fn){await fn();n++;console.log('PASS',label)}
const before=process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED;
(async()=>{
 await verify('Owner recall disabled by default',async()=>{
   delete process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED;
   const x=await guardian.authorizeToolCall({taskId:'t',ownerId:'owner-A'},
     'memory_recall',{query:'editor',limit:3});
   const w=await guardian.authorizeToolCall({taskId:'t',ownerId:'owner-A'},
     'world_recall',{query:'office door',limit:3});
   assert.equal(x.verdict,'deny');
   assert.equal(w.verdict,'deny');
 });
 process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED='1';
 let prepared;
 await verify('Only authenticated owner can authorize recall',async()=>{
   assert.equal((await guardian.authorizeToolCall({taskId:'t'},
     'memory_recall',{query:'editor'})).verdict,'deny');
   const x=await guardian.authorizeToolCall({taskId:'t',ownerId:'owner-A'},
     'memory_recall',{query:'editor',limit:3});
   assert.equal(x.verdict,'allow');
   assert.equal(x.prepared.memory.ownerId,'owner-A');
   prepared=x;
 });
 await verify('No raw owner selection, oversized or control-character queries',async()=>{
   for(const input of [
    {query:'editor',ownerId:'owner-B'},
    {query:'x'.repeat(161)},
    {query:'editor\nsecret'},
    {query:'editor',limit:20}
   ]) assert.equal((await guardian.authorizeToolCall(
     {taskId:'t',ownerId:'owner-A'},'memory_recall',input)).verdict,'deny');
 });
 await verify('Only approved same-owner undeleted memory reaches executor',async()=>{
   const r=await executor.executeTool('t','memory_recall',prepared);
   assert.equal(r.ok,true);
   assert.equal(r.detail.records.length,1);
   assert.equal(r.detail.records[0].key,'editor');
   const all=JSON.stringify(r);
   for(const secret of ['private secret','another owner','deleted recommendation'])
     assert.ok(!all.includes(secret),secret);
   assert.equal(r.detail.classification,'CLOUD_APPROVED');
 });
 let worldPrepared;
 await verify('World recall is bound to authenticated owner and bounded query',async()=>{
   assert.equal((await guardian.authorizeToolCall({taskId:'t'},
     'world_recall',{query:'office door'})).verdict,'deny');
   const x=await guardian.authorizeToolCall({taskId:'t',ownerId:'owner-A'},
     'world_recall',{query:'office door',limit:3});
   assert.equal(x.verdict,'allow');
   assert.equal(x.prepared.world.ownerId,'owner-A');
   worldPrepared=x;
   for(const input of [
     {query:'office door',ownerId:'owner-B'},
     {query:'office door',limit:6},
     {query:'office\\ndoor'}
   ]) assert.equal((await guardian.authorizeToolCall(
     {taskId:'t',ownerId:'owner-A'},'world_recall',input)).verdict,'deny');
 });
 await verify('World recall filters foreign, expired and retracted observations',async()=>{
   const r=await executor.executeTool('t','world_recall',worldPrepared);
   assert.equal(r.ok,true);
   assert.equal(r.detail.records.length,1);
   assert.equal(r.detail.records[0].value,'closed');
   assert.equal(r.detail.records[0].source,'USER_REPORTED');
   assert.equal(r.detail.records[0].authority,'context_only');
   assert.equal(r.detail.records[0].neverAuthorizesActions,true);
   const all=JSON.stringify(r);
   for(const secret of ['other owner secret','was open','retracted state'])
     assert.ok(!all.includes(secret),secret);
 });
 await verify('World recall remains context-only and cancellation-safe',async()=>{
   assert.equal((await executor.executeTool('t','world_recall',worldPrepared,()=>true)).ok,false);
   assert.equal(JSON.stringify(worldPrepared).includes('owner-B'),false);
 });
 await verify('Disabling recall between authorization and execution blocks it',async()=>{
   delete process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED;
   assert.equal((await executor.executeTool('t','memory_recall',prepared)).ok,false);
   assert.equal((await executor.executeTool('t','world_recall',worldPrepared)).ok,false);
 });
 await verify('Cancellation prevents retrieval',async()=>{
   process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED='1';
   assert.equal((await executor.executeTool('t','memory_recall',prepared,()=>true)).ok,false);
 });
 await verify('Guardian audit does not contain private query text',async()=>{
   const txt=JSON.stringify(audit);
   assert.ok(!txt.includes('VS Code'));
   assert.ok(!txt.includes('private secret preference'));
   assert.ok(!txt.includes('office door'));
   assert.ok(!txt.includes('closed'));
 });
 console.log(`NATIVE_MEMORY_RECALL: ${n}/${n} PASS (mock data, no real Prisma/LLM)`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 if(before===undefined)delete process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED;
 else process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED=before;
});
