#!/usr/bin/env node
'use strict';
/**
 * Native Windows / REAL Ollama end-to-end acceptance of one file objective.
 * No scripted model decisions and no mock Guardian/Core/DB. A passing HTTP
 * response is insufficient: the durable result and real disk state must match.
 * Run exclusively on a disposable Windows CI runner with no production secrets.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const workspace = process.env.JARVIS_AGENT_WORKSPACE || '';
const runnerTemp = process.env.RUNNER_TEMP || '';
const fileRel = 'real_model_e2e/proof.txt';
const expected = 'JARVIS_REAL_OLLAMA_FILE_TASK_OK';
const objective = 'Create a folder named real_model_e2e, then create file real_model_e2e/proof.txt containing exactly "' + expected + '". Read back the file and verify the exact content before finishing.';
const model = process.env.JARVIS_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
const ollama = 'http://127.0.0.1:11434';
const host = 'http://127.0.0.1:3000';
const evidenceFile = process.env.JARVIS_LIVE_EVIDENCE || path.join(runnerTemp,'jarvis-real-ollama-file-proof.json');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const report = {startedAt:new Date().toISOString(),model,promptSha256:sha256(objective),toolCalls:[],statuses:[],inference:{},verdict:'NOT_ACCEPTED',errors:[]};
const requireTrue = (pass,reason) => { if (!pass) throw Error(reason); };
async function get(url,options) {
 const r=await fetch(url,options);
 const text=await r.text();
 if(!r.ok)throw Error('HTTP '+r.status+': '+text.slice(0,400));
 return {response:r,body:text?JSON.parse(text):{}};
}
async function save() {
 report.finishedAt=new Date().toISOString();
 await fs.mkdir(path.dirname(evidenceFile),{recursive:true});
 await fs.writeFile(evidenceFile,JSON.stringify(report,null,2)+'\n');
}
function parseEvent(raw) {
 const lines=raw.split(/\r?\n/);let kind='message',data='';
 for(const line of lines) {
  if(line.startsWith('event:'))kind=line.slice(6).trim();
  if(line.startsWith('data:'))data+=line.slice(5).trim();
 }
 if(!data)return;
 let payload;try{payload=JSON.parse(data)}catch{payload={invalidJson:true};}
 if(kind==='step' && payload.step?.kind==='tool_call')report.toolCalls.push({tool:payload.step.tool});
 if(kind==='final')report.final=payload;
 if(kind==='error')report.errors.push(JSON.stringify(payload).slice(0,500));
 if(kind==='status')report.statuses.push(String(payload.status||'').slice(0,80));
}
async function main() {
 try {
  requireTrue(process.platform==='win32' && process.env.GITHUB_ACTIONS==='true' && process.env.RUNNER_OS==='Windows','Disposable native Windows GitHub runner required');
  requireTrue(path.isAbsolute(workspace) && path.isAbsolute(runnerTemp),'Absolute runner/workspace roots required');
  const tmp=await fs.realpath(runnerTemp),scope=await fs.realpath(workspace);
  requireTrue(scope.startsWith(tmp+path.sep),'Workspace must be an isolated child of RUNNER_TEMP');
  const tags=(await get(ollama+'/api/tags')).body;
  requireTrue((tags.models||[]).some(m=>m.name===model||m.name.startsWith(model+':')),'Configured real model is not installed');
  const begun=Date.now();
  const warm=(await get(ollama+'/api/chat',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({model,messages:[{role:'user',content:'Answer ONLY with the word READY.'}],stream:false,keep_alive:'5m'}),
   signal:AbortSignal.timeout(300000)
  })).body;
  requireTrue(typeof warm.message?.content==='string'&&warm.message.content.trim().length>0,'Real Ollama inference did not respond');
  report.inference={durationMs:Date.now()-begun,responseSha256:sha256(warm.message.content),evalCount:warm.eval_count??null};
  const session=await fetch(host+'/api/jarvis/auth/session');
  const body=await session.json();
  requireTrue(session.ok&&body.authenticated===true,'Authenticated local developer session missing');
  const cookies=typeof session.headers.getSetCookie==='function'?session.headers.getSetCookie():[session.headers.get('set-cookie')].filter(Boolean);
  const cookie=cookies.map(s=>s.split(';',1)[0]).join('; ');
  requireTrue(cookie,'Local session cookie missing');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),35*60*1000);
  let result;
  try{
   result=await fetch(host+'/api/jarvis/task',{
    method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream',cookie},
    body:JSON.stringify({objective,stepBudget:16}),signal:controller.signal
   });
   requireTrue(result.ok,'Task endpoint returned HTTP '+result.status);
   requireTrue(result.body,'Task endpoint has no event stream');
   const reader=result.body.getReader(),decoder=new TextDecoder();
   let buffer='';
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
    let ix;
    while((ix=buffer.indexOf('\n\n'))>=0){parseEvent(buffer.slice(0,ix));buffer=buffer.slice(ix+2);}
   }
   if(buffer.trim())parseEvent(buffer);
  }finally{clearTimeout(timer);}
  requireTrue(report.final,'Core did not emit a final task event');
  requireTrue(report.final.status==='completed','Core final status was '+report.final.status);
  const called=new Set(report.toolCalls.map(t=>t.tool));
  requireTrue(called.has('write_file') && called.has('read_file'),'No real model-directed file write AND readback tools');
  const actual=await fs.readFile(path.join(workspace,fileRel),'utf8');
  requireTrue(actual===expected,'Actual disk file did not match exact expected content');
  report.artifact={path:fileRel,bytes:Buffer.byteLength(actual),sha256:sha256(actual)};
  report.verdict='PASS';
  console.log('REAL_OLLAMA_FILE_ACCEPTANCE PASS');
 }catch(e){report.errors.push(String(e?.stack||e));console.error('REAL_OLLAMA_FILE_ACCEPTANCE FAIL',e?.message||e);process.exitCode=1;}
 finally{await save();}
}
main();
