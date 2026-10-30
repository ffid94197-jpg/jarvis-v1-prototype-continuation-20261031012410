'use strict';
/** JARVIS-native client for the AI Bengineering Mine AI MCP host.
 * Upstream MIT (c) 2026 AI Bengineering; protocol adapter original to JARVIS.
 * Upstream source: https://github.com/aibengineering/mine-ai-mcp
 * Host process MUST be started and approved independently; this file never fetches code.
 */
const crypto = require('node:crypto');
const MAX_RESPONSE=1024*1024;
const DEFAULT_ENDPOINT='http://127.0.0.1:25575/mcp';
function localUrl(input=DEFAULT_ENDPOINT){
  const u=new URL(input);
  if(u.protocol!=='http:' || u.hostname!=='127.0.0.1' || u.port!=='25575' || u.pathname!=='/mcp' || u.search || u.hash || u.username || u.password)
    throw Error('Mine AI MCP must be the approved loopback host 127.0.0.1:25575/mcp');
  return u.href;
}
function parseRpc(body,contentType,id){
  const responses=[];
  if(/text\/event-stream/i.test(contentType)){
    for(const line of body.split(/\r?\n/)){
      if(line.startsWith('data:')){try{responses.push(JSON.parse(line.slice(5).trim()));}catch{}}
    }
  }else {try{responses.push(JSON.parse(body));}catch{throw Error('Invalid MCP JSON response');}}
  const p=responses.find(v=>v?.jsonrpc==='2.0'&&v.id===id);
  if(!p)throw Error('MCP response missing matching JSON-RPC id');
  if(p.error)throw Error('MCP error: '+String(p.error.message||'unknown').slice(0,240));
  return p.result;
}
function structuredResult(result){
  if(result?.isError)throw Error('Mine AI MCP tool failed: '+JSON.stringify(result.content||[]).slice(0,200));
  // Mine AI MCP's real JSON envelope is structuredContent.response.data.
  // Never mistake the transport wrapper for the physical action outcome.
  if(result?.structuredContent?.response?.format==='json')return result.structuredContent.response.data;
  if(result?.structuredContent?.response?.format==='markdown')throw Error('Mine AI MCP did not return requested structured JSON');
  if(result?.structuredContent && typeof result.structuredContent==='object')return result.structuredContent;
  const candidate=(result?.content||[]).find(x=>x?.type==='text'&&typeof x.text==='string');
  if(candidate){try{return JSON.parse(candidate.text);}catch{return {text:candidate.text.slice(0,8000)};}}
  return result;
}
class MineAiMcp {
  constructor({endpoint=DEFAULT_ENDPOINT,fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
    this.endpoint=localUrl(endpoint);this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.seq=0;this.session='';this.connected=false;
    this.protocol='2025-11-25';this.tools=new Map();
  }
  async rpc(method,params={},notification=false){
    const id=++this.seq;
    const request={jsonrpc:'2.0',method,...(!notification?{id}:{}),params};
    const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':this.protocol};
    if(this.session)headers['mcp-session-id']=this.session;
    const res=await this.fetch(this.endpoint,{method:'POST',headers,redirect:'error',body:JSON.stringify(request),signal:AbortSignal.timeout(this.timeoutMs)});
    if(!res.ok)throw Error(`Mine AI MCP HTTP ${res.status}`);
    const sid=res.headers.get('mcp-session-id');if(sid)this.session=sid;
    if(notification)return null;
    const body=await res.text();if(Buffer.byteLength(body,'utf8')>(method==='tools/list'?16*1024*1024:MAX_RESPONSE))throw Error('Oversized MCP response');
    return parseRpc(body,res.headers.get('content-type')||'application/json',id);
  }
  async connect(){
    if(!this.connected){
      const hello=await this.rpc('initialize',{protocolVersion:this.protocol,capabilities:{},clientInfo:{name:'jarvis-minecraft',version:'1.0'}});
      if(!hello?.serverInfo)throw Error('Mine AI MCP initialize failed');
      await this.rpc('notifications/initialized',{},true);
      this.connected=true;
    }
    const tools=await this.rpc('tools/list',{});
    this.tools=new Map((tools?.tools||[]).filter(t=>typeof t.name==='string').map(t=>[t.name,t]));
    if(!this.tools.has('view_status') || !this.tools.has('wait_for_action') || !this.tools.has('cancel_foreground_action'))
      throw Error('Mine AI MCP essential tools unavailable');
    return Array.from(this.tools.keys());
  }
  async call(name,args={}){
    if(!this.connected || !this.tools.has(name))throw Error('Unadvertised or disconnected MCP tool: '+name);
    if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>9000)throw Error('Invalid MCP arguments');
    return structuredResult(await this.rpc('tools/call',{name,arguments:{rationale:'JARVIS is observing or verifying Minecraft gameplay',...args,response_format:'json'}}));
  }
  async observe(){return this.call('view_status',{});}
  async action(name,args={}, {onUpdate=()=>{},signal,maxWaitMs=300000}={}){
    if(['view_status','wait_for_action','cancel_foreground_action'].includes(name))throw Error('Use the dedicated observation/control API');
    const submission_id=crypto.randomUUID();
    const value=await this.call(name,{...args,submission_id,wait_timeout_ms:2000});
    if(value?.state==='settled')return value;
    if(!['accepted','pending'].includes(value?.state) || !(value.actionId||value.action_id))
      throw Error('Action did not expose an accepted/pending handle or settled proof');
    const actionId=value.actionId||value.action_id;
    const deadline=Date.now()+maxWaitMs;
    onUpdate({state:value.state,actionId,progress:value.progress||null});
    let cancelIssued=false;
    while(Date.now()<deadline){
      if(signal?.aborted&&!cancelIssued){
        cancelIssued=true;
        // Explicit operator cancellation is distinct from a disconnected client.
        await this.call('cancel_foreground_action',{action_id:actionId,reason:'JARVIS operator requested cancellation'});
      }
      const wait=await this.call('wait_for_action',{action_id:actionId,timeout_ms:Math.min(10000,Math.max(0,deadline-Date.now())),rationale:'JARVIS is verifying the real Minecraft action'});
      if(wait?.state==='settled')return wait;
      if(wait?.state!=='pending')throw Error('Unexpected MCP foreground action state');
      onUpdate({state:'pending',actionId,progress:wait.progress||null});
    }
    // Tool remains active. Never retry automatically or claim the action stopped.
    return {state:'pending',actionId,why:'JARVIS observation window exhausted; Mine AI MCP execution may continue'};
  }
}
module.exports={MineAiMcp,localUrl,parseRpc,structuredResult,DEFAULT_ENDPOINT};
