/* eslint-disable @typescript-eslint/no-require-imports */
/** Isolated API-route contract suite. This is NOT real Prisma/Next E2E proof. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname,'../src/app/api/jarvis/memory/route.ts'),'utf8');
const contractsSrc=fs.readFileSync(path.join(__dirname,'../src/lib/agent/memory/contracts.ts'),'utf8');
function transpile(s,p){const out=ts.transpileModule(s,{fileName:p,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});return out.outputText}
const contracts = {exports:{}};vm.runInNewContext(transpile(contractsSrc,'contracts.ts'),{exports:contracts.exports,require,console,Date});
let memory=[],world=[];let nextId=0;let currentRole='OWNER';let currentPrincipal='owner1';let originAllowed=true;
function mapped(obj){return {...obj,id:obj.id||'id000000'+(++nextId),createdAt:new Date(),updatedAt:new Date(),observedAt:new Date()}}
const db={
 jarvisMemory:{
   findMany:async ({where,take})=>memory.filter(r=>r.principalId===where.principalId&&!r.deletedAt).slice(0,take),
   upsert:async ({where,create,update})=>{let row=memory.find(x=>x.key===where.principalId_key.key&&x.principalId===where.principalId_key.principalId);if(row){row={...row,...update,version:row.version+1};memory=memory.map(x=>x.id===row.id?row:x)}else{row=mapped({...create,version:0});memory.push(row)}return row},
   updateMany:async ({where,data})=>{let found=memory.filter(x=>x.principalId===where.principalId&&x.id===where.id&&!x.deletedAt);found.forEach(x=>{x.deletedAt=data.deletedAt;x.version++});return {count:found.length}},
 },
 jarvisWorldObservation:{
   findMany:async ({where,take})=>world.filter(x=>x.principalId===where.principalId&&!x.retractedAt).slice(0,take),
   create:async ({data})=>{const row=mapped(data);world.push(row);return row},
   updateMany:async ({where,data})=>{let found=world.filter(x=>x.principalId===where.principalId&&x.id===where.id&&!x.retractedAt);found.forEach(x=>x.retractedAt=data.retractedAt);return {count:found.length}},
 }
};
const mod={exports:{}};
const sandbox={exports:mod.exports,require:(id)=>{
 if(id==='@/lib/db')return {db};
 if(id==='@/lib/agent/auth/session')return {getAuthContext:async()=>currentRole===null?null:{principalId:currentPrincipal,role:currentRole,status:'ACTIVE'}};
 if(id==='@/lib/agent/auth/origin')return {mutationOriginError:()=>originAllowed?null:'Foreign origin'};
 if(id==='@/lib/agent/memory/contracts')return contracts.exports;
 throw Error(id);
},Date,Response,URL,console};
vm.runInNewContext(transpile(src,'route.ts'),sandbox);
const {GET,POST,DELETE}=mod.exports;
const request=(url,payload)=>({url,headers:new Headers(),json:async()=>payload});
async function run(){let n=0;const test=async(name,fn)=>{await fn();console.log('PASS',name);n++};
 await test('owner creates local-private memory',async()=>{let r=await POST(request('http://localhost/api/jarvis/memory',{kind:'memory',key:'project.goal',content:'Build V1'}));assert.equal(r.status,200);assert.equal(memory[0].source,'OWNER_EXPLICIT')});
 await test('owner reads private memory',async()=>{const r=await GET(request('http://localhost/api/jarvis/memory?kind=memory'));const b=await r.json();assert.equal(b.records.length,1);assert.equal(b.records[0].content,'Build V1')});
 await test('unauthenticated caller denied',async()=>{currentRole=null;const r=await GET(request('http://localhost/api/jarvis/memory'));assert.equal(r.status,401);currentRole='OWNER'});
 await test('device caller denied',async()=>{currentRole='DEVICE';const r=await GET(request('http://localhost/api/jarvis/memory'));assert.equal(r.status,403);currentRole='OWNER'});
 await test('foreign-origin mutation denied',async()=>{originAllowed=false;const r=await POST(request('http://localhost/api/jarvis/memory',{kind:'memory',key:'x',content:'x'}));assert.equal(r.status,403);originAllowed=true});
 await test('cross-owner memory isolated',async()=>{currentPrincipal='owner2';const r=await GET(request('http://localhost/api/jarvis/memory?kind=memory'));assert.equal((await r.json()).records.length,0);currentPrincipal='owner1'});
 await test('fake verified observation denied',async()=>{const r=await POST(request('http://localhost/api/jarvis/memory',{kind:'world',subject:'f',predicate:'exists',value:'yes',source:'VERIFIED_TOOL'}));assert.equal(r.status,400)});
 await test('owner-reported observation created with unverified provenance',async()=>{const r=await POST(request('http://localhost/api/jarvis/memory',{kind:'world',subject:'app',predicate:'open',value:'yes'}));assert.equal(r.status,201);assert.equal(world[0].source,'USER_REPORTED')});
 await test('foreign-owner deletion does not leak record',async()=>{currentPrincipal='owner2';const r=await DELETE(request('http://localhost/api/jarvis/memory',{kind:'memory',id:memory[0].id}));assert.equal(r.status,404);currentPrincipal='owner1'});
 await test('owner can retract observation',async()=>{const r=await DELETE(request('http://localhost/api/jarvis/memory',{kind:'observation',id:world[0].id}));assert.equal(r.status,200);assert(world[0].retractedAt)});
 await test('world view omits retracted observations',async()=>{const r=await GET(request('http://localhost/api/jarvis/memory?kind=world'));assert.equal((await r.json()).records.length,0)});
 await test('invalid kind is rejected',async()=>{const r=await GET(request('http://localhost/api/jarvis/memory?kind=admin'));assert.equal(r.status,400)});
 console.log(`MEMORY_ROUTE_FIXTURE: ${n}/${n} passed (isolated mocks, not live Prisma)`);
}
run().catch(e=>{console.error(e);process.exitCode=1});
