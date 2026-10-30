#!/usr/bin/env node
'use strict';
/** LOCAL FIXTURE ONLY. This is NOT an LLM or Laya inference model. No network forwarding. */
const http=require('node:http');
const modelPort=Number(process.env.JARVIS_FIXTURE_MODEL_PORT||18765);
const layaPort=Number(process.env.JARVIS_FIXTURE_LAYA_PORT||18766);
function read(req){return new Promise((resolve,reject)=>{let body='';req.on('data',d=>{body+=d;if(body.length>250_000){req.destroy();reject(Error('request too large'));}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch(e){reject(e);}});req.on('error',reject);});}
function json(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
function answer(model){return `MOCK MODEL (${model}): connected successfully. This is a diagnostic fixture, not a real AI response.`;}
const models=http.createServer(async(req,res)=>{
 if(req.method==='GET'&&(req.url==='/health'||req.url==='/api/tags')){
   if(req.url==='/health')json(res,200,{ok:true,mode:'diagnostic-only'});
   else json(res,200,{models:[{name:'fixture-fast'},{name:'fixture-deep'},{name:'fixture-private'},{name:'fixture-coding'},{name:'fixture-vision'}]});return;
 }
 if(req.method!=='POST'||!['/v1/chat/completions','/api/chat'].includes(req.url)){json(res,404,{error:'not found'});return;}
 try{
   const data=await read(req),model=String(data.model||'fixture');
   if(!/^fixture-[a-z]+$/.test(model)){json(res,400,{error:'fixture models only'});return;}
   const t=answer(model);
   if(req.url==='/v1/chat/completions'){
     if(data.stream){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(`data: ${JSON.stringify({choices:[{delta:{content:t}}]})}\n\n`);res.end('data: [DONE]\n\n');}
     else json(res,200,{id:'fixture-completion',object:'chat.completion',model,choices:[{index:0,message:{role:'assistant',content:t},finish_reason:'stop'}]});
   }else{
     if(data.stream){res.writeHead(200,{'content-type':'application/x-ndjson'});res.end(JSON.stringify({message:{role:'assistant',content:t},done:true})+'\n');}
     else json(res,200,{model,message:{role:'assistant',content:t},done:true});
   }
 }catch(e){json(res,400,{error:String(e.message||e)});}
});
const laya=http.createServer(async(req,res)=>{
 if(req.method==='GET'&&['/health','/healthz'].includes(req.url)){json(res,200,{ok:true,mode:'mock-laya-not-real-inference'});return;}
 if(req.method!=='POST'||req.url!=='/v1/systemone'){json(res,404,{error:'not found'});return;}
 try{
  const data=await read(req),opts=data.questions?.model?.criteria||{};
  const entries=Object.entries(opts);
  if(!entries.length){json(res,400,{error:'missing candidates'});return;}
  // A deterministic hand-coded choice to validate the protocol, NOT the Laya model.
  const task=String(data.state?.task||'').toLowerCase();
  const preferred=task.includes('code')||task.includes('debug')?'coding':task.includes('screen')||task.includes('image')?'vision':task.includes('fast')?'fast':'private';
  const found=entries.find(([id,label])=>String(label).toLowerCase().includes(preferred))||entries[0];
  json(res,200,{model:'mock-only',answers:{model:{type:'choice',choice:found[0],confidence:0.9}}});
 }catch(e){json(res,400,{error:String(e.message||e)});}
});
models.listen(modelPort,'127.0.0.1',()=>console.log(`MOCK_MODEL_HTTP=http://127.0.0.1:${modelPort} (diagnostic only)`));
laya.listen(layaPort,'127.0.0.1',()=>console.log(`MOCK_LAYA_HTTP=http://127.0.0.1:${layaPort} (not real Laya)`));
process.on('SIGINT',()=>{models.close();laya.close();});
