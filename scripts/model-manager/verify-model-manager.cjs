// Executable offline end-to-end fixture for the real encrypted store and bridges.
// Needs Node >=20 and global TypeScript; never calls cloud providers or prints keys.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const ts=require('typescript');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
require.extensions['.ts']=function(module,filename){const raw=fs.readFileSync(filename,'utf8');const text=ts.transpileModule(raw,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;module._compile(text,filename);};
const { validateModelSettings, modelRequestUrl, ModelSettingsError }=require(path.join(root,'src/lib/agent/models/contracts.ts'));
const vault=require(path.join(root,'src/lib/agent/models/vault.ts'));
const {createProfileBridge}=require(path.join(root,'src/lib/agent/models/bridge.ts'));
const {createModelBridge}=require(path.join(root,'src/lib/agent/core/modelProvider.ts'));
let count=0;
async function check(label,func) { await func();count++;console.log('PASS '+label); }
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-model-offline-'));
process.chdir(tmp);
const key='fixture-key-private-not-for-production';
const cloud={label:'Gemini',location:'api',protocol:'openai-compatible',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai/',model:'gemini-3.5-flash-lite',apiKey:key};
const local={label:'Local LM Studio',location:'local',protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1234/v1',model:'local-model',apiKey:''};
function invalid(o) { assert.throws(()=>validateModelSettings(o), ModelSettingsError); }
async function run() {
await check('Gemini compatibility endpoint accepted',()=>{let d=validateModelSettings(cloud);assert.equal(new URL(d.baseUrl).pathname,'/v1beta/openai');});
await check('Custom public HTTPS compatible API accepted',()=>{let d=validateModelSettings({...cloud,baseUrl:'https://example.provider.ai/custom/v2'});assert.equal(d.model,cloud.model);});
await check('Reject remote HTTP provider',()=>invalid({...cloud,baseUrl:'http://api.example.com/v1'}));
await check('Reject cloud loopback and private IPv4',()=>{for(const url of ['https://localhost/v1','https://127.0.0.1','https://10.0.0.1/v1','https://192.168.0.1/v1'])invalid({...cloud,baseUrl:url});});
await check('Reject credentialed and query-string base URLs',()=>{for(const url of ['https://a:b@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1#hash'])invalid({...cloud,baseUrl:url});});
await check('Reject API key with newline',()=>invalid({...cloud,apiKey:'a\nb'}));
await check('Reject unknown protocol and invalid model ID',()=>{invalid({...cloud,protocol:'anything'});invalid({...cloud,model:'bad model name'});});
await check('Local Ollama accepted',()=>assert.equal(validateModelSettings({label:'Ollama',location:'local',protocol:'ollama',baseUrl:'http://127.0.0.1:11434',model:'qwen3:4b',apiKey:''}).model,'qwen3:4b'));
await check('Local LM Studio/vLLM/llama.cpp accepted',()=>assert.equal(validateModelSettings(local).location,'local'));
await check('Local LAN unapproved and local cloud mismatch denied',()=>{invalid({...local,baseUrl:'http://192.168.0.2:1234/v1'});invalid({...cloud,location:'local'});});
await check('Cloud Anthropic accepted',()=>assert.equal(validateModelSettings({...cloud,protocol:'anthropic',baseUrl:'https://api.anthropic.com/v1'}).protocol,'anthropic'));
await check('Construct provider endpoint without duplicates',()=>{const p={...validateModelSettings(cloud),id:'x',createdAt:'',updatedAt:''};assert.equal(modelRequestUrl(p),'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');});
let profile;await check('Encrypted owner save succeeds',async()=>{profile=await vault.saveModel('owner1',cloud);assert.ok(profile.id);assert.equal(profile.hasApiKey,true);assert.equal('apiKey' in profile,false);});
await check('GET/list never exposes key',async()=>{let list=await vault.listModels('owner1');assert.equal(list.profiles.length,1);assert.ok(!JSON.stringify(list).includes(key));});
await check('Vault ciphertext contains no plaintext API key',async()=>{let dir=path.join(tmp,'.jarvis-private','model-vault');let files=fs.readdirSync(dir);assert.equal(files.filter(f=>f.endsWith('.enc')).length,1);for(let f of files)assert.ok(!fs.readFileSync(path.join(dir,f)).toString('utf8').includes(key));});
await check('Vault key generated with 32 bytes',async()=>{assert.equal(fs.readFileSync(path.join(tmp,'.jarvis-private/model-vault/master.key')).length,32);});
await check('Owner isolation',async()=>{let list=await vault.listModels('owner2');assert.equal(list.profiles.length,0);});
await check('Activate saved profile and reload',async()=>{await vault.activateModel('owner1',profile.id);assert.equal((await vault.selectedModel('owner1')).apiKey,key);});
await check('Edit leaves secret unchanged if password input empty',async()=>{await vault.saveModel('owner1',{...cloud,id:profile.id,label:'Gemini renamed',apiKey:''});assert.equal((await vault.selectedModel('owner1')).apiKey,key);});
await check('Unknown profile cannot activate or overwrite',async()=>{await assert.rejects(vault.activateModel('owner1','missing'));await assert.rejects(vault.saveModel('owner1',{...cloud,id:'missing'}));});
await check('Wrong-owner cannot retrieve profile',async()=>assert.equal(await vault.getModel('owner2',profile.id),null));
await check('Concurrent saves serialize without losing profiles',async()=>{await Promise.all(Array.from({length:6},(_,i)=>vault.saveModel('owner1',{...local,label:'Local '+i})));assert.equal((await vault.listModels('owner1')).profiles.length,7);});
await check('Core selects active profile, not stale .env',async()=>{process.env.JARVIS_MODEL_BACKEND='invalid-placeholder';let m=await createModelBridge('owner1');assert.equal(typeof m.complete,'function');});
await check('Durable model pin selects same profile',async()=>{
  const p=await vault.selectedModel('owner1');
  assert.equal(typeof (await createModelBridge('owner1',`${p.id}|${p.updatedAt}`)).complete,'function');
});
await check('Changed model profile blocks previously pinned task',async()=>{
  const p=await vault.selectedModel('owner1');
  await vault.saveModel('owner1',{...cloud,id:p.id,label:'changed',apiKey:''});
  await assert.rejects(()=>createModelBridge('owner1',`${p.id}|${p.updatedAt}`));
});
await check('Delete active resets to legacy fallback',async()=>{await vault.removeModel('owner1',profile.id);assert.equal((await vault.listModels('owner1')).activeId,null);});
await check('Vault refuses corrupted master key rather than resetting it',async()=>{const f=path.join(tmp,'.jarvis-private/model-vault/master.key');const original=fs.readFileSync(f);fs.writeFileSync(f,Buffer.alloc(16));await assert.rejects(()=>vault.saveModel('owner1',{...local,label:'After-corrupt'}));fs.writeFileSync(f,original);});
// Real loopback HTTP server fixtures. No external network.
const server=http.createServer(async(req,res)=>{
 let data='';for await(const c of req)data+=c;
 const body=JSON.parse(data);
 if(req.url==='/v1/chat/completions'){
   if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"JARVIS_"}}]}\n\n');res.write('data: {"choices":[{"delta":{"content":"MODEL_OK"}}]}\n\n');res.end('data: [DONE]\n\n');}
   else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'JARVIS_MODEL_OK'}}]}));}
 } else if(req.url==='/api/chat'){
  res.writeHead(200,{'content-type':'application/json'});
  if(body.stream)res.end('{"message":{"content":"JARVIS_"}}\n{"message":{"content":"MODEL_OK"}}\n');
  else res.end('{"message":{"content":"JARVIS_MODEL_OK"}}');
 } else {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
const port=server.address().port;
const oai={...validateModelSettings({...local,baseUrl:`http://127.0.0.1:${port}/v1`}),id:'test',createdAt:'',updatedAt:''};
await check('Live loopback OpenAI-compatible completion',async()=>{assert.equal(await createProfileBridge(oai).complete([{role:'user',content:'ping'}]),'JARVIS_MODEL_OK');});
await check('Live loopback OpenAI-compatible SSE streaming',async()=>{let parts=[];let text=await createProfileBridge(oai).report([{role:'user',content:'ping'}],p=>parts.push(p));assert.equal(text,'JARVIS_MODEL_OK');assert.equal(parts.join(''),'JARVIS_MODEL_OK');});
const ollama={...validateModelSettings({label:'Ollama',location:'local',protocol:'ollama',baseUrl:`http://127.0.0.1:${port}`,model:'qwen3:4b',apiKey:''}),id:'ollama',createdAt:'',updatedAt:''};
await check('Live loopback Ollama completion',async()=>assert.equal(await createProfileBridge(ollama).complete([{role:'user',content:'ping'}]),'JARVIS_MODEL_OK'));
await check('Live loopback Ollama streaming',async()=>{let chunks=[];assert.equal(await createProfileBridge(ollama).report([{role:'user',content:'ping'}],c=>chunks.push(c)),'JARVIS_MODEL_OK');assert.equal(chunks.join(''),'JARVIS_MODEL_OK');});
await check('Native Anthropic request shape and header',async()=>{
 const old=global.fetch;
 try {global.fetch=async(url,opts)=>{
  assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(opts.headers['anthropic-version'],'2023-06-01');assert.equal(opts.headers['x-api-key'],key);assert.equal(opts.headers.Authorization,undefined);
  return new Response(JSON.stringify({content:[{type:'text',text:'JARVIS_MODEL_OK'}]}),{status:200});};
 const bridge=createProfileBridge({...validateModelSettings({...cloud,protocol:'anthropic',baseUrl:'https://api.anthropic.com/v1'}),id:'a',createdAt:'',updatedAt:''});
 assert.equal(await bridge.complete([{role:'user',content:'ping'}]),'JARVIS_MODEL_OK');
 } finally {global.fetch=old;}
});
} finally{await new Promise(resolve=>server.close(resolve));}
console.log('MODEL_MANAGER_OFFLINE:',count+'/'+count,'PASS');
}
run().then(()=>{fs.rmSync(tmp,{recursive:true,force:true})}).catch(e=>{console.error('FAIL',e.stack);process.exitCode=1;});
