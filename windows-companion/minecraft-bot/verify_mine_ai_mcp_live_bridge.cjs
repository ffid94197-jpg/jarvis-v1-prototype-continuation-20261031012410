'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
const script=path.resolve(__dirname,'mine_ai_mcp_bot.cjs');
const tools=['view_status','wait_for_action','cancel_foreground_action','navigate','collect_block'];
let pos={x:10,y:64,z:10};let logCount=0;let gotoCount=0;const calls=[];
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
  }else if(t==='wait_for_action'){if(j.params.arguments.action_id==='test-collect')logCount+=1;result={structuredContent:{response:{format:'json',data:{state:'settled',output:{action:'navigate',result:{status:'succeeded'}}}}}};}
  else if(t==='cancel_foreground_action')result={structuredContent:{response:{format:'json',data:{requested:true}}}};
 }
 const body=JSON.stringify({jsonrpc:'2.0',id:j.id,result});res.writeHead(200,{'content-type':'application/json'});res.end(body);
});
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
 try{
  assert.match(await wait(s=>s.startsWith('MINECRAFT_MCP_JOINED')),/live connected status observed/);
  console.log('PASS live-status gate for companion join');
  child.stdin.write(JSON.stringify({id:'one',command:'status'})+'\n');
  const status=JSON.parse((await wait(s=>s.startsWith('BOT_ACK ')&&s.includes('"one"'))).slice(8));
  assert.equal(status.ok,true);assert.equal(JSON.parse(status.status).ownerVisible,true);
  console.log('PASS JARVIS owner detection via upstream observation');
  child.stdin.write(JSON.stringify({id:'three',command:'follow'})+'\n');
  const follow=JSON.parse((await wait(s=>s.startsWith('BOT_ACK ')&&s.includes('"three"'))).slice(8));
  assert.equal(follow.ok,true);assert.equal(gotoCount,1);
  console.log('PASS real tool navigate settle plus observed teammate proximity');
  child.stdin.write(JSON.stringify({id:'two',command:'auto_goal',goal:'netherite_dragon_run',durationSeconds:120})+'\n');
  const dragon=JSON.parse((await wait(s=>s.startsWith('BOT_ACK ')&&s.includes('"two"'))).slice(8));
  assert.equal(dragon.ok,true);assert.match(dragon.status,/accepted, NOT completed/);
  console.log('PASS high-level dragon mission admitted without claiming victory');
  await new Promise(r=>setTimeout(r,1000));
  child.stdin.write(JSON.stringify({id:'four',command:'auto_status'})+'\n');
  const state=JSON.parse((await wait(s=>s.startsWith('BOT_ACK ')&&s.includes('"four"'))).slice(8));
  assert.equal(state.ok,true);
  assert.ok(logCount>0,'MCP mission must issue physical resource collection');
  assert.notEqual(JSON.parse(state.status).status,'complete');
  console.log('PASS mission took real MCP action, no fabricated victory');
  child.stdin.write(JSON.stringify({id:'five',command:'auto_stop'})+'\n');
  const stopped=JSON.parse((await wait(s=>s.startsWith('BOT_ACK ')&&s.includes('"five"'))).slice(8));
  assert.equal(stopped.ok,true);
  console.log('PASS authorized stop response');
  console.log('MINE_AI_MCP_BRIDGE_E2E 6 PASS (mock MCP host only)');
 }finally{child.kill();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1});
