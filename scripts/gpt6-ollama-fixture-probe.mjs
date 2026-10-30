/** Local HTTP fixture for the *real* Ollama bridge (no LLM or internet).
 * node --experimental-strip-types scripts/gpt6-ollama-fixture-probe.mjs
 * This proves adapter framing only; it is NOT a live Ollama intelligence test.
 */
import http from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createModelBridge, resolveOllamaSettings } from '../src/lib/agent/core/modelProvider.ts';
let requests = 0;
const server = http.createServer(async (req,res)=>{
  let body='';for await(const part of req)body+=part.toString();
  const obj=JSON.parse(body);requests++;
  assert.equal(req.url,'/api/chat');
  assert.equal(obj.model,'fixture-model');
  assert.ok(Array.isArray(obj.messages));
  if(obj.stream===false){
    assert.equal(obj.format,'json');res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({message:{content:'{"action":"final","answer":"fixture response"}'},done:true}));
  } else {
    res.writeHead(200,{'Content-Type':'application/x-ndjson'});
    const chunks=[
      JSON.stringify({message:{content:'Verified '},done:false})+'\n',
      JSON.stringify({message:{content:'stream.'},done:false})+'\n',
      JSON.stringify({done:true})+'\n',
    ];
    // Deliberately split one JSON record across arbitrary TCP write boundaries.
    res.write(chunks[0].slice(0,13)); res.write(chunks[0].slice(13));
    for(const chunk of chunks.slice(1))res.write(chunk);
    res.end();
  }
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();
const previous={backend:process.env.JARVIS_MODEL_BACKEND,base:process.env.JARVIS_OLLAMA_BASE_URL,model:process.env.JARVIS_OLLAMA_MODEL};
let passed=0;
const check=(name,f)=>{f();passed++;console.log('PASS OLLAMA',name)};
try{
  process.env.JARVIS_MODEL_BACKEND='ollama';
  process.env.JARVIS_OLLAMA_BASE_URL=`http://127.0.0.1:${address.port}`;
  process.env.JARVIS_OLLAMA_MODEL='fixture-model';
  check('valid explicit loopback',()=>assert.match(resolveOllamaSettings().url,/127\.0\.0\.1/));
  for(const url of ['http://example.com:11434','http://169.254.169.254:80','http://127.0.0.1:1234/path','http://alice:password@127.0.0.1:1234']){
    assert.throws(()=>resolveOllamaSettings({...process.env,JARVIS_OLLAMA_BASE_URL:url}));
  }
  passed++;console.log('PASS OLLAMA rejects remote, path and credential URLs');
  const bridge=await createModelBridge();
  const msgs=[{role:'user',content:'fixture'}];
  const plan=await bridge.complete(msgs);
  check('planner receives real structured fixture response',()=>assert.match(plan,/"action":"final"/));
  const seen=[];const report=await bridge.report(msgs,c=>seen.push(c));
  check('streaming NDJSON reassembled across split writes',()=>{assert.equal(report,'Verified stream.');assert.deepEqual(seen,['Verified ','stream.'])});
  check('two real local HTTP requests dispatched',()=>assert.equal(requests,2));
  console.log(`OLLAMA ADAPTER FIXTURE: ${passed}/5 PASS; actual Ollama model not tested`);
}finally{
  server.close();
  for(const [k,v] of Object.entries({JARVIS_MODEL_BACKEND:previous.backend,JARVIS_OLLAMA_BASE_URL:previous.base,JARVIS_OLLAMA_MODEL:previous.model})){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
}
