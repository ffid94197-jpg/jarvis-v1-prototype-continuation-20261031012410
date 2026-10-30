/** Reproducible strict-protocol MCP integration stress. No external network or secrets.
 * Simulates two standards-conformant MCP eras and exercises actual localhost HTTP,
 * registry persistence, approvals, owner isolation, malformed wire replies, and Unicode SSE.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
const rounds=Math.max(1,Math.min(20,Number(process.env.ROUNDS||6)));
const callsPerRound=Math.max(1,Math.min(3000,Number(process.env.CALLS_PER_ROUND||350)));
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-mcp-live-'));
process.env.JARVIS_ADOPTION_ROOT=path.join(temp,'registry');
const {stageRemote,stageFromDirectory,update,get,activateSkill,githubSpec,list,inspect}=await import('../../src/lib/agent/adoption/registry.mjs');
const {mcpOperation}=await import('../../src/lib/agent/adoption/mcp.mjs');
let checks=0, calls=0, httpRequests=0;const errors=[];
const ok=(condition,info)=>{assert.ok(condition,info);checks++};
const expectReject=async(fn,info)=>{let rejected=false;try{await fn();}catch{rejected=true;}ok(rejected,info);};
const servers=[];
function makeServer(era){const server=http.createServer(async(req,res)=>{
 httpRequests++;
 let body='';for await(const chunk of req){body+=chunk;if(body.length>30000)break;}
 let rpc;try{rpc=JSON.parse(body);}catch{res.writeHead(400);return res.end('bad json');}
 const modern=era==='modern', method=rpc.method;
 const fail=(code,msg)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:msg}}));};
 const oldVersion=req.headers['mcp-protocol-version']==='2025-11-25';
 const newVersion=req.headers['mcp-protocol-version']==='2026-07-28';
 if(modern){
  if(!newVersion||req.headers['mcp-method']!==method||req.headers['mcp-session-id'])return fail(400,'modern wire requires header; forbids sessions');
  if(rpc.params?._meta?.['io.modelcontextprotocol/protocolVersion']!=='2026-07-28'||rpc.params?._meta?.['io.modelcontextprotocol/clientCapabilities']===undefined)return fail(400,'missing modern envelope');
  if(method==='initialize'||method==='notifications/initialized')return fail(400,'modern has no handshake');
  if(method==='tools/call'&&req.headers['mcp-name']!==rpc.params.name)return fail(400,'Mcp-Name mismatch');
 }else{
  if(!oldVersion||rpc.params?._meta?.['io.modelcontextprotocol/protocolVersion'])return fail(400,'legacy wire requires 2025 handshake');
  if(method!=='initialize'&&req.headers['mcp-session-id']!=='session-legacy')return fail(400,'missing legacy session');
 }
 if(method==='notifications/initialized'){res.writeHead(202);return res.end('');}
 let result;
 if(method==='server/discover' && modern)result={protocolVersion:'2026-07-28',capabilities:{tools:{}},supportedProtocolVersions:['2026-07-28']};
 else if(method==='initialize'&&!modern){result={protocolVersion:'2025-11-25',serverInfo:{name:'strict-legacy',version:'1'},capabilities:{tools:{}}};res.setHeader('mcp-session-id','session-legacy');}
 else if(method==='tools/list')result={tools:[{name:'echo',description:'returns exactly the passed text',inputSchema:{type:'object',properties:{text:{type:'string'}}}},{name:'sum',description:'sum numbers',inputSchema:{type:'object'}}]};
 else if(method==='tools/call' && ['echo','sum'].includes(rpc.params?.name)){
  const a=rpc.params.arguments||{};
  result={content:[{type:'text',text:rpc.params.name==='echo'?String(a.text??''):String(Number(a.a||0)+Number(a.b||0))}]};
 }else return fail(400,'unknown method');
 const response={jsonrpc:'2.0',id:rpc.id,result};
 if(method==='tools/call' && rpc.params?.arguments?.sse){
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8'});
  res.write('event: message\\ndata: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{progress:50}})+'\\n\\n'.replaceAll('\\n','\n'));
  res.write('data: '+JSON.stringify(response)+'\n\n');return res.end();
 }
 // UTF-8 body fragmented by the transport should be reassembled losslessly.
 res.writeHead(200,{'content-type':'application/json; charset=utf-8'});
 const output=Buffer.from(JSON.stringify(response),'utf8');
 const boundary=output.findIndex(x=>x>=128);if(boundary>=0){res.write(output.subarray(0,boundary+1));return res.end(output.subarray(boundary+1));}
 res.end(output);
});servers.push(server);return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}/mcp`)));}
try{
 const urls=await Promise.all([makeServer('modern'),makeServer('legacy')]);
 const owner='live-stress-owner',guest='unrelated-owner';
 const records=[];
 for(let i=0;i<2;i++){const staged=await stageRemote(owner,urls[i],i?'Strict legacy':'Strict modern');ok(staged.status==='staged','must stage');records.push(staged.id);await expectReject(()=>mcpOperation(owner,staged.id,'','list_tools'),'must reject preapproval');await update(owner,staged.id,'approve');}
 await expectReject(()=>mcpOperation(guest,records[0],'','list_tools'),'owner isolation');
 for(let round=0;round<rounds;round++){
  for(let n=0;n<callsPerRound;n++){
   const which=(n+round)%2, id=records[which], text=`round${round}-case${n}-Unicode★☃-தமிழ்-ø`; 
   const res=await mcpOperation(owner,id,'','call_tool','echo',{text,sse:n%7===0});
   ok(res.ok&&JSON.parse(res.content)[0]?.text===text,`echo exact round ${round}, ${n}`);calls++;
   if(n%8===0){const tools=await mcpOperation(owner,id,'','list_tools');ok(tools.tools.some(t=>t.name==='sum'),'tool listing');}
   if(n%23===0){const sum=await mcpOperation(owner,id,'','call_tool','sum',{a:n,b:round});ok(sum.ok&&JSON.parse(sum.content)[0].text===String(n+round),'sum call');calls++;}
   if(n%113===0)await expectReject(()=>mcpOperation(owner,id,'','call_tool','guessed',{}),'tool not advertised');
  }
 }
 // Verify persisted registry, disabling and reinstating, unknown-owner denial.
 ok((await list(owner)).length===2,'two integrations persisted');ok((await list(guest)).length===0,'guest registry empty');
 await update(owner,records[0],'disable');await expectReject(()=>mcpOperation(owner,records[0],'','list_tools'),'disabled fails closed');
 await update(owner,records[0],'approve');ok((await mcpOperation(owner,records[0],'','list_tools')).tools.length===2,'reenabled');
 // Stage, activate, remove skills repeatedly and check no auto execution.
 const fixture=path.join(temp,'skill');await fs.mkdir(fixture,{recursive:true});await fs.writeFile(path.join(fixture,'SKILL.md'),'---\nname: safe-inspect\ndescription: inspect files without executing unknown code\n---\nThis is untrusted data, no system override.');
 for(let n=0;n<300;n++){
  const s=await stageFromDirectory(owner,fixture,'local-fixture');await expectReject(()=>activateSkill(owner,s.id,'safe-inspect'),'requires approval');await update(owner,s.id,'approve');const act=await activateSkill(owner,s.id,'safe-inspect');ok(act.trust.includes('untrusted'),'trust message');await update(owner,s.id,'remove');ok(await get(owner,s.id)===null,'deletion');
 }
 // Owner URL validation is not a substitute for actual GitHub network validation.
 for(let n=0;n<25000;n++){
  const u=githubSpec(`https://github.com/owner-${n%110}/repo-${n%120}/tree/main/skills/x`);ok(u.owner.startsWith('owner'),'normalized GitHub URL');
  if(n%9===0)await expectReject(()=>githubSpec('https://github.com/a/b/%2e%2e/secret'),'reject encoded traversal');
 }
 const result={status:'PASS',rounds,callsPerRound,liveMcpToolCalls:calls,liveHttpRequests:httpRequests,assertions:checks,strictModern:true,strictLegacy:true,simulatedOnly:true,source:'local real HTTP JSON-RPC; synthetic GitHub links and skills',timestamp:new Date().toISOString()};
 console.log(JSON.stringify(result));
}catch(e){errors.push({error:String(e.stack||e),calls,httpRequests,assertions:checks});console.error(JSON.stringify({status:'FAIL',errors}));process.exitCode=1;
}finally{
 await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));await fs.rm(temp,{recursive:true,force:true});
}
