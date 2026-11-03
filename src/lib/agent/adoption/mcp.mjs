/** MCP JSON-RPC adapter for managed integrations; SDK-free baseline.
 * Supports stdio JSON lines and POST Streamable HTTP JSON/SSE.
 * Server output is untrusted data. No arbitrary command construction.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import {AdoptionError,get} from './registry.mjs';
import {redactUntrustedToolData} from './redact.mjs';
const MAX_REPLY=1024*1024;
const PRIVATE=/^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|fc|fd|fe80:)/i;
export async function checkEndpoint(url){const u=new URL(url);if(u.username||u.password||u.hash||u.search)throw new AdoptionError('Credentials/fragments in endpoint are forbidden');
 if(u.protocol==='http:' && !['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new AdoptionError('HTTP only permitted for loopback');
 if(u.protocol!=='https:'&&u.protocol!=='http:')throw new AdoptionError('MCP endpoint must use HTTPS');
 if(u.protocol==='https:'){
  const ips=await dns.lookup(u.hostname,{all:true});if(!ips.length||ips.some(x=>PRIVATE.test(x.address)))throw new AdoptionError('MCP endpoint resolves to a restricted IP');
 }return u;
}
function parseReply(text,contentType,expectedId){
 if(Buffer.byteLength(text,'utf8')>MAX_REPLY)throw new AdoptionError('MCP reply exceeds limit',502);
 if(contentType.includes('text/event-stream')){
   // Do not accept an unrelated notification, or the last of several SSE events,
   // as proof that a tool call completed. Correlate exactly by JSON-RPC id.
   const lines=text.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim());
   for(const line of lines){if(line==='[DONE]')continue;let j;try{j=JSON.parse(line);}catch{continue;}
     if(j?.jsonrpc==='2.0' && j.id===expectedId)return j;
   }
   throw new AdoptionError('MCP SSE lacked matching JSON-RPC reply',502);
 }
 let parsed;try{parsed=JSON.parse(text);}catch{throw new AdoptionError('MCP returned invalid JSON',502);}
 if(parsed?.jsonrpc!=='2.0'||parsed.id!==expectedId)throw new AdoptionError('MCP response id mismatch',502);
 return parsed;
}
async function withHttp(endpoint,handler){
 const url=await checkEndpoint(endpoint);let seq=0,session='';
 // The 2026-07-28 MCP era is STATELESS and must not use initialize.
 // The 2025-11-25 era uses initialize/initialized and may use a session id.
 // Probe modern discovery, falling back only for protocol-unsupported replies.
 async function wire(era,method,params={},notification=false){
  const id=++seq;const modern=era==='modern';
  const meta={
   'io.modelcontextprotocol/protocolVersion':'2026-07-28',
   'io.modelcontextprotocol/clientCapabilities':{},
   'io.modelcontextprotocol/clientInfo':{name:'jarvis-agent',version:'1.0'}
  };
  const req={jsonrpc:'2.0',method,...(notification?{}:{id}),params:modern?{...params,_meta:{...(params._meta||{}),...meta}}:params};
  const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream',
   'MCP-Protocol-Version':modern?'2026-07-28':'2025-11-25',
   ...(modern?{'Mcp-Method':method,...(method==='tools/call'?{'Mcp-Name':String(params.name||'')}:{})}:{}),
   ...(!modern&&session?{'mcp-session-id':session}:{})};
  let r;try{r=await fetch(url,{method:'POST',headers,body:JSON.stringify(req),redirect:'error',signal:AbortSignal.timeout(10000)});}catch(e){throw new AdoptionError(`MCP endpoint unavailable: ${String(e.message||e).slice(0,150)}`,502);}
  if(!r.ok){const error=new AdoptionError(`MCP endpoint returned ${r.status}`,502);error.httpStatus=r.status;throw error;}
  if(!modern)session=r.headers.get('mcp-session-id')||session;
  if(notification)return null;
  let size=0;const chunks=[];for await(const part of r.body){size+=part.length;if(size>MAX_REPLY)throw new AdoptionError('MCP HTTP reply too large',502);chunks.push(part);}
  const body=Buffer.concat(chunks).toString('utf8');const parsed=parseReply(body,r.headers.get('content-type')||'',id);
  if(parsed.error){const error=new AdoptionError(`MCP error: ${String(parsed.error.message||'unknown').slice(0,220)}`,502);error.rpcCode=parsed.error.code;throw error;}
  return parsed.result;
 }
 const modernRequest=(method,params={},notification=false)=>wire('modern',method,params,notification);
 const legacyRequest=(method,params={},notification=false)=>wire('legacy',method,params,notification);
 try{
  const discover=await modernRequest('server/discover',{});
  // Any successful discovery is a sufficient modern-era negotiation.
  if(discover&&typeof discover==='object')return handler(modernRequest,discover);
  throw new AdoptionError('MCP discovery returned no result',502);
 }catch(e){
  // Authentication, server faults and network timeouts are not protocol fallbacks.
  if(!(e?.rpcCode===-32601||e?.rpcCode===-32600||[400,404,405,406,422,426].includes(e?.httpStatus)))throw e;
 }
 const hello=await legacyRequest('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'jarvis-agent',version:'1.0'}});
 if(!hello?.serverInfo)throw new AdoptionError('MCP handshake missing serverInfo',502);
 await legacyRequest('notifications/initialized',{},true);
 return handler(legacyRequest,hello);
}
async function withStdio(command,args,cwd,handler){
 return new Promise((resolve,reject)=>{let child,seq=0,buf='',total=0,closed=false;const pending=new Map();
  const abort=(err)=>{if(closed)return;closed=true;for(const p of pending.values())p.reject(err);pending.clear();try{child?.kill('SIGKILL');}catch{}reject(err);};
  const timer=setTimeout(()=>abort(new AdoptionError('MCP stdio command timed out',504)),13000);
  child=spawn(command,args,{cwd,shell:false,windowsHide:true,env:{PATH:process.env.PATH||'',SYSTEMROOT:process.env.SYSTEMROOT||'',TEMP:process.env.TEMP||'',HOME:cwd,USERPROFILE:cwd,PYTHONIOENCODING:'utf-8'}});
  child.once('error',e=>abort(new AdoptionError(`MCP process unavailable: ${e.message}`,502)));
  child.stdout.on('data',chunk=>{total+=chunk.length;if(total>MAX_REPLY)return abort(new AdoptionError('MCP stdout too large',502));buf+=chunk.toString('utf8');let idx;while((idx=buf.indexOf('\n'))>=0){const line=buf.slice(0,idx).trim();buf=buf.slice(idx+1);if(!line)continue;let j;try{j=JSON.parse(line);}catch{continue;}if(j.jsonrpc!=='2.0'||!pending.has(j.id))continue;const p=pending.get(j.id);pending.delete(j.id);if(j.error)p.reject(new AdoptionError('MCP server error: '+String(j.error.message||'unknown'),502));else p.resolve(j.result);}});
  child.once('exit',()=>{if(!closed&&pending.size)abort(new AdoptionError('MCP stdio process exited before response',502));});
  const request=(method,params={},notification=false)=>new Promise((res,rej)=>{if(closed)return rej(new AdoptionError('MCP channel closed',502));const id=++seq;const message={jsonrpc:'2.0',...(notification?{}:{id}),method,params};if(!notification)pending.set(id,{resolve:res,reject:rej});child.stdin.write(JSON.stringify(message)+'\n',e=>{if(e)rej(e);else if(notification)res(null);});});
  (async()=>{const hello=await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'jarvis-agent',version:'1.0'}});if(!hello?.serverInfo)throw new AdoptionError('MCP stdio handshake missing serverInfo',502);await request('notifications/initialized',{},true);return handler(request,hello);})().then(v=>{closed=true;clearTimeout(timer);child.kill();resolve(v);},e=>{clearTimeout(timer);abort(e);});
 });
}
async function resolveServer(item,serverName){
 if(item.kind==='remote-mcp')return {type:'http',url:item.endpoint};
 const config=item.capabilities?.mcp?.find(x=>x.serverNames.includes(serverName));if(!config)throw new AdoptionError('MCP configuration/instance not found',404);
 const file=path.resolve(item.root,config.path);if(!file.startsWith(path.resolve(item.root)+path.sep))throw new AdoptionError('MCP config escaped package');
 const raw=JSON.parse(await fs.readFile(file,'utf8'));const server=(raw.mcpServers||raw.servers||{})[serverName];if(!server||typeof server!=='object')throw new AdoptionError('Invalid MCP server config');
 if(server.url){await checkEndpoint(server.url);return {type:'http',url:server.url};}
 if(server.env&&Object.keys(server.env).length)throw new AdoptionError('MCP server needs environment/secrets: configure externally first');
 if(!['node','python','python3'].includes(server.command))throw new AdoptionError(`Runtime '${String(server.command).slice(0,50)}' not enabled for managed execution; additional installer required`);
 if(!Array.isArray(server.args)||server.args.length<1||server.args.length>12||server.args.some(x=>typeof x!=='string'||x.length>200))throw new AdoptionError('Unsupported MCP launch arguments');
 if(server.args.some(x=>/^(?:-e|-c|--eval|--require|--import)$/.test(x)))throw new AdoptionError('Inline execution flags are forbidden');
 // Only run an entrypoint that resides inside the installed package. No scripts from the network or system paths.
 const args=server.args.map((a,i)=>{if(i===0){const target=path.resolve(path.dirname(file),a);if(!target.startsWith(path.resolve(item.root)+path.sep)||!target.match(/\.(?:c?m?js|py)$/))throw new AdoptionError('MCP entrypoint must be a package script');return target;}if(/[;&|`$<>]/.test(a))throw new AdoptionError('Unsafe MCP argument');return a;});
 return {type:'stdio',command:server.command,args,cwd:path.dirname(file)};
}
export async function mcpOperation(owner,id,serverName,operation,name,args={}){
 const item=await get(owner,id);if(!item||item.status!=='enabled')throw new AdoptionError('MCP integration not enabled',403);
 const server=await resolveServer(item,serverName);
 const run=async request=>{
  if(operation==='list_tools'){
    const result=await request('tools/list',{});return {tools:(result?.tools||[]).slice(0,60).map(t=>({name:t.name,description:String(t.description||'').slice(0,320),inputSchema:t.inputSchema})),nextCursor:result?.nextCursor||null};
  }
  if(operation==='call_tool'){
    if(typeof name!=='string'||name.length>120||/[\x00-\x1f\x7f]/.test(name))throw new AdoptionError('Invalid MCP tool name');
    if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>9000)throw new AdoptionError('Invalid tool arguments');
    // Enforce that the target is currently advertised, never call a guessed tool.
    const listed=await request('tools/list',{});if(!(listed?.tools||[]).some(t=>t.name===name))throw new AdoptionError('MCP tool is not currently advertised');
    const result=await request('tools/call',{name,arguments:args});return {ok:result?.isError!==true,content:JSON.stringify(redactUntrustedToolData(result?.content||[])).slice(0,5500),isError:result?.isError===true};
  }
  if(operation==='list_resources'){const result=await request('resources/list',{});return {resources:(result?.resources||[]).slice(0,40).map(r=>({name:r.name,uri:r.uri,description:String(r.description||'').slice(0,200)}))};}
  if(operation==='list_prompts'){const result=await request('prompts/list',{});return {prompts:(result?.prompts||[]).slice(0,40).map(p=>({name:p.name,description:String(p.description||'').slice(0,200)}))};}
  throw new AdoptionError('Unsupported MCP operation');
 };
 return server.type==='http'?withHttp(server.url,run):withStdio(server.command,server.args,server.cwd,run);
}
