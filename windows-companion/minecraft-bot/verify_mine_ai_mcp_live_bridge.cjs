'use strict';
/* End-to-end protocol fixture for the optional Mine AI MCP bridge.
 * Mock MCP host on loopback only. NOT real Minecraft gameplay and NOT proof
 * that any upstream Mine AI MCP server behaves this way.
 *
 * The follow action is deliberately GATED inside the mock host so that the
 * bridge's busy window is deterministic instead of a race. That lets this file
 * assert the real concurrency contract: while a physical action is in flight
 * the bridge acknowledges early with {state:'pending'}, refuses competing BODY
 * actions fail-safe, and keeps read-only observation plus cancellation live.
 */
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
const script=path.resolve(__dirname,'mine_ai_mcp_bot.cjs');
const tools=['view_status','wait_for_action','cancel_foreground_action','navigate','collect_block'];
let pos={x:10,y:64,z:10};let logCount=0;let gotoCount=0;let cancelCount=0;const calls=[];
// One-shot gate holding the follow's foreground action in flight.
let releaseFollow=()=>{};
const followGate=new Promise(resolve=>{releaseFollow=resolve;});
let gateUsed=false;
const server=http.createServer(async(req,res)=>{
 let data='';for await(const part of req)data+=part;
 const j=JSON.parse(data);calls.push(j);
 let result;
 if(j.method==='initialize')result={protocolVersion:'2025-11-25',serverInfo:{name:'Mine AI MCP'}};
 else if(j.method==='tools/list')result={tools:tools.map(name=>({name}))};
 else if(j.method==='tools/call'){
  const t=j.params.name;
  if(t==='view_status')result={structuredContent:{response:{format:'json',data:{
    status:'succeeded',situation:{botId:'MineAI',observedAt:new Date().toISOString(),
      dimension:'minecraft:overworld',position:pos,
      nearby:{players:[{username:'aslam0704',distance:12,position:{x:22,y:64,z:10}}]},
      vitals:{health:20,food:20},inventory:{stacks:logCount?[{name:'oak_log',count:logCount,location:'main'}]:[]}}
  }}}};
  else if(t==='collect_block'){result={structuredContent:{response:{format:'json',data:{state:'accepted',actionId:'test-collect'}}}};}
  else if(t==='navigate'){
   gotoCount++;pos={x:21,y:64,z:10};result={structuredContent:{response:{format:'json',data:{state:'accepted',actionId:'test-move'}}}};
  }else if(t==='cancel_foreground_action'){cancelCount++;result={structuredContent:{response:{format:'json',data:{requested:true}}}};}
  else if(t==='wait_for_action'){
   const actionId=j.params.arguments.action_id;
   // Hold ONLY the first follow settlement so the busy window is observable.
   if(actionId==='test-move'&&!gateUsed){gateUsed=true;await followGate;}
   if(actionId==='test-collect')logCount+=1;
   result={structuredContent:{response:{format:'json',data:{state:'settled',output:{action:'navigate',result:{status:'succeeded'}}}}}};
  }
 }
 const body=JSON.stringify({jsonrpc:'2.0',id:j.id,result});res.writeHead(200,{'content-type':'application/json'});res.end(body);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise((resolve,reject)=>server.listen(25575,'127.0.0.1',err=>err?reject(err):resolve()));
 const child=spawn(process.execPath,[script],{env:{...process.env,JARVIS_MINECRAFT_PLAYER:'aslam0704'},stdio:['pipe','pipe','pipe']});
 const logs=[],waiters=[];let stderr='';child.stderr.on('data',d=>stderr+=String(d));
 function addLine(line){logs.push(line);for(const f of [...waiters]){if(f.test(line)){waiters.splice(waiters.indexOf(f),1);f.resolve(line);}}}
 readline.createInterface({input:child.stdout}).on('line',addLine);
 const wait=(test,ms=7000)=>new Promise((resolve,reject)=>{
   const previous=logs.find(test);if(previous)return resolve(previous);
   const w={test,resolve};waiters.push(w);setTimeout(()=>{const ix=waiters.indexOf(w);if(ix!==-1){waiters.splice(ix,1);reject(Error('No matching bot response: '+stderr+' '+logs.join('|')));}},ms);
 });
 let seq=0;
 const send=async(command,extra={})=>{
   const id='id'+(++seq)+Math.random().toString(16).slice(2,8);
   child.stdin.write(JSON.stringify({id,command,...extra})+'\n');
   return JSON.parse((await wait(s=>s.startsWith('BOT_ACK ')&&s.includes('"'+id+'"'))).slice(8));
 };
 try{
  assert.match(await wait(s=>s.startsWith('MINECRAFT_MCP_JOINED')),/live connected status observed/);
  console.log('PASS live-status gate for companion join');
  const status=await send('status');
  assert.equal(status.ok,true);assert.equal(JSON.parse(status.status).ownerVisible,true);
  console.log('PASS JARVIS owner detection via upstream observation');
  const follow=await send('follow');
  assert.equal(follow.ok,true);assert.equal(gotoCount,1);
  assert.equal(JSON.parse(follow.status).state,'pending');
  assert.equal(JSON.parse(follow.status).verified,false);
  console.log('PASS real tool navigate acknowledged as pending, never as completed');

  // ---- Busy window is now deterministically open (follow action is gated).
  const competing=await send('auto_goal',{goal:'wood',durationSeconds:60});
  assert.equal(competing.ok,false,'a competing body action must be refused while one is in flight');
  assert.match(competing.error,/bridge busy/);
  console.log('PASS competing body action refused fail-safe while a physical action is in flight');
  const whileBusy=await send('status');
  assert.equal(whileBusy.ok,true,'read-only observation must stay available while busy');
  console.log('PASS read-only observation stays available while the bridge is busy');

  // ---- Release the gate and wait for the bridge to become idle (bounded).
  releaseFollow();
  let idle=false;
  for(let i=0;i<40&&!idle;i++){
   await sleep(100);
   const probe=await send('status');
   const la=JSON.parse(probe.status).lastAction||'';
   idle=/^follow (moved|near_owner|unverified|blocked|failed|waiting_for_owner)/.test(la);
  }
  assert.ok(idle,'the follow settled and the bridge released its busy latch');
  const settled=await send('status');
  assert.match(JSON.parse(settled.status).lastAction,/^follow moved/);
  console.log('PASS settled follow reports an independently observed outcome');

  const dragon=await send('auto_goal',{goal:'netherite_dragon_run',durationSeconds:120});
  assert.equal(dragon.ok,true);assert.match(dragon.status,/accepted, NOT completed/);
  console.log('PASS high-level dragon mission admitted without claiming victory');
  await sleep(1500);
  const state=await send('auto_status');
  assert.equal(state.ok,true);
  assert.ok(logCount>0,'MCP mission must issue physical resource collection');
  assert.notEqual(JSON.parse(state.status).status,'complete');
  console.log('PASS mission took real MCP action, no fabricated victory');
  const stopped=await send('auto_stop');
  assert.equal(stopped.ok,true);
  console.log('PASS authorized stop response');
  console.log('MINE_AI_MCP_BRIDGE_E2E 9 PASS (mock MCP host only; NOT real Minecraft)');
 }finally{
  // Always unblock the gated request, or the mock host would keep a socket
  // open and server.close() would never complete.
  releaseFollow();child.kill();
  server.closeAllConnections?.();server.close();
 }
})().catch(err=>{console.error(err);try{releaseFollow();server.closeAllConnections?.();server.close();}catch{}process.exitCode=1});
