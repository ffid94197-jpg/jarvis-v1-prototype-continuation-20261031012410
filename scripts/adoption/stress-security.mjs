/** Hostile MCP and concurrent owner-registry suite. Fixture servers run on loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';
const base=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-security-'));
process.env.JARVIS_ADOPTION_ROOT=path.join(base,'registry');
const {stageFromDirectory,stageRemote,update,list,get,githubSpec,inspect}=await import('../../src/lib/agent/adoption/registry.mjs');
const {mcpOperation,checkEndpoint}=await import('../../src/lib/agent/adoption/mcp.mjs');
let checks=0;const ok=(test,msg)=>{assert.ok(test,msg);checks++};const deny=async(fn,msg)=>{let rejected=false;try{await fn();}catch{rejected=true;}ok(rejected,msg);};
const fixture=path.join(base,'source');await fs.mkdir(fixture);await fs.writeFile(path.join(fixture,'SKILL.md'),'---\nname: harmless\ndescription: completely portable fixture\n---\n# Harmless instructions');
let httpCount=0;const server=http.createServer(async(req,res)=>{httpCount++;let body='';for await(const c of req)body+=c;let q={};try{q=JSON.parse(body)}catch{};
 const error=(status,msg)=>{res.writeHead(status);res.end(msg);};
 if(q.method==='server/discover'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{capabilities:{tools:{}}}}));}
 if(q.method==='tools/list'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{tools:[{name:'test',inputSchema:{type:'object'}}]}}));}
 if(q.method!=='tools/call')return error(400,'unknown');
 if(q.params.name==='test'){
  const mode=q.params.arguments.mode;
  if(mode==='oversized'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{content:[{type:'text',text:'a'.repeat(1100000)}]}}));}
  if(mode==='bad-id'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id+1000,result:{content:[]}}));}
  if(mode==='sse-mismatch'){res.writeHead(200,{'Content-Type':'text/event-stream'});return res.end('data: '+JSON.stringify({jsonrpc:'2.0',id:q.id+20,result:{content:[]}})+'\n\n');}
  if(mode==='malformed'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('not valid JSON');}
  if(mode==='rpc-error'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32001,message:'intentional tool failure'}}));}
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{content:[{type:'text',text:'ok'}]}}));
 }
 error(400,'unknown name');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 // Prove quota is enforced without orphaned package copies (including concurrent request races).
 const attempts=Array.from({length:135},()=>stageFromDirectory('quota-owner',fixture,'fixture').then(x=>({ok:true,id:x.id}),e=>({ok:false,error:e.message})));
 const outcomes=await Promise.all(attempts);ok(outcomes.filter(x=>x.ok).length===50,'exactly fifty concurrent admissions');ok(outcomes.filter(x=>!x.ok).length===85,'exactly 85 rejected');
 const hash=(await fs.readdir(process.env.JARVIS_ADOPTION_ROOT))[0];const ownerItems=await list('quota-owner');ok(ownerItems.length===50,'registry contains fifty');
 const packages=await fs.readdir(path.join(process.env.JARVIS_ADOPTION_ROOT,hash,'packages'));ok(packages.length===50,'no orphaned package copies');
 for(let n=0;n<25;n++)await deny(()=>stageFromDirectory('quota-owner',fixture,'fixture'),'no disk leak after full quota');
 const after=await fs.readdir(path.join(process.env.JARVIS_ADOPTION_ROOT,hash,'packages'));ok(after.length===50,'no new orphan after repeated quota errors');
 for(const x of outcomes.filter(x=>x.ok)){await update('quota-owner',x.id,'remove');}ok((await list('quota-owner')).length===0,'all entries removed');
 // Attempt path traversal and rejected symlink sources.
 const symlink=path.join(base,'source-link');try{await fs.symlink(fixture,symlink,'dir');await deny(()=>stageFromDirectory('symlink-owner',symlink,'fixture'),'symlink selected source rejected');}catch(e){if(e.code!=='EPERM'&&e.code!=='EACCES')throw e;}
 const remote=await stageRemote('owner',`http://127.0.0.1:${server.address().port}/mcp`,'hostile');await update('owner',remote.id,'approve');
 for(let n=0;n<100;n++){
  const result=await mcpOperation('owner',remote.id,'','call_tool','test',{mode:'ok'});ok(result.ok&&JSON.parse(result.content)[0].text==='ok','valid MCP call');
  for(const mode of ['oversized','bad-id','sse-mismatch','malformed','rpc-error'])await deny(()=>mcpOperation('owner',remote.id,'','call_tool','test',{mode}),'reject hostile MCP reply '+mode);
 }
 for(let n=0;n<15000;n++){
  const candidate=`https://github.com/ORG_${n%9}/repo_${n%90}`;
  ok(githubSpec(candidate).repo.startsWith('repo_'),'good GitHub URL');
  if(n%11===0)await deny(()=>githubSpec('https://github.com/org/repo/tree/main/..%2f..%2ftmp'),'encoded traversal');
 }
 const res={status:'PASS',checks,concurrentStagingAttempts:135,admitted:50,rejected:85,hostileMcpRejections:500,normalMcpCalls:100,actualHttpRequests:httpCount,githubUrlSamples:15000,timestamp:new Date().toISOString()};console.log(JSON.stringify(res));
}catch(e){console.error(JSON.stringify({status:'FAIL',error:String(e.stack||e),checks}));process.exitCode=1;}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(base,{recursive:true,force:true});}
