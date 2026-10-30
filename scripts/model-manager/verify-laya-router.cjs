/** Offline integration tests of real encrypted vault, actual task router and mocked Laya HTTP protocol. */
const fs=require('node:fs'), os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ts=require('typescript'); const root=path.resolve(__dirname,'../..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {validateRoutingSettings}=require(path.join(root,'src/lib/agent/models/contracts.ts'));
const vault=require(path.join(root,'src/lib/agent/models/vault.ts'));
const {classifyPrivacy,classifyTask,rateModel,selectTaskModel,PrivacyRouteError}=require(path.join(root,'src/lib/agent/models/layaRouter.ts'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-laya-test-')); process.chdir(tmp);
let n=0;async function check(msg,func){await func();n++;console.log('PASS '+msg);}
const route={mode:'auto',privacy:'auto',layaEnabled:false,layaUrl:'http://127.0.0.1:8000',weights:{quality:5,speed:3,cost:2}};
const base=(label,location,ratings)=>({label,location,protocol:'openai-compatible',baseUrl:location==='local'?'http://127.0.0.1:1234/v1':'https://api.example.com/v1',model:'a-model',apiKey:location==='local'?'':'dummy-key',ratings,enabled:true});
const quick={reasoning:2,coding:2,vision:2,speed:5,cost:5};
const strong={reasoning:5,coding:5,vision:5,speed:1,cost:1};
let count=0;
async function run(){
await check('routing settings validation',()=>{assert.equal(validateRoutingSettings(route).mode,'auto');});
await check('refuse cloud remote Laya SSRF URL',()=>{assert.throws(()=>validateRoutingSettings({...route,layaUrl:'https://evil.com'}));});
await check('refuse LAN Laya endpoint',()=>{assert.throws(()=>validateRoutingSettings({...route,layaUrl:'http://192.168.1.2:8000'}));});
await check('refuse URL userinfo, query, fragment',()=>{for (const u of ['http://u:p@localhost:8000','http://localhost:8000/?x=1','http://localhost:8000/#x'])assert.throws(()=>validateRoutingSettings({...route,layaUrl:u}));});
await check('sensitive classification defaults to local',()=>{for(const s of ['Inspect my API key','Open my medical notes','Check my private document'])assert.equal(classifyPrivacy(s,route),'local-only');});
await check('explicit local privacy always local',()=>assert.equal(classifyPrivacy('hello',{...route,privacy:'local-only'}),'local-only'));
await check('explicit cloud allowed overrides auto privacy heuristic',()=>assert.equal(classifyPrivacy('private notes',{...route,privacy:'cloud-allowed'}),'cloud-allowed'));
await check('task type and workload classification',()=>{assert.deepEqual(classifyTask('debug the entire typescript application architecture'),{category:'coding',complexity:'heavy'});assert.equal(classifyTask('move my mouse').category,'computer_use');});
await check('no-profile regular task uses legacy .env',async()=>assert.equal((await selectTaskModel('empty','hello')).pinnedId,'legacy-env'));
await check('no-profile sensitive task uses configured legacy provider',async()=>assert.equal((await selectTaskModel('empty','open my password vault')).pinnedId,'legacy-env'));
const q=await vault.saveModel('owner',base('Fast cloud','api',quick));
await check('single profile always chosen for ordinary request',async()=>{const d=await selectTaskModel('owner','tell me a joke');assert.equal(d.modelId,q.id);assert.equal(d.source,'single-model');});
await check('only connected cloud model used for sensitive task',async()=>{const d=await selectTaskModel('owner','read my confidential file');assert.equal(d.modelId,q.id);assert.equal(d.privacy,'cloud-allowed');});
const l=await vault.saveModel('owner',base('Strong local','local',strong));
await check('private request only selects local model',async()=>{const d=await selectTaskModel('owner','open my private document');assert.equal(d.modelId,l.id);assert.equal(d.privacy,'local-only');});
await check('heavy code work prioritizes rated reasoning/coding',async()=>{const d=await selectTaskModel('owner','debug the entire typescript architecture');assert.equal(d.modelId,l.id);});
await vault.setRouting('owner',{...route,weights:{quality:1,speed:5,cost:5}});
await check('light task values speed/cost when weights adjusted',async()=>{const d=await selectTaskModel('owner','hello');assert.equal(d.modelId,q.id);});
await vault.setRouting('owner',{...route,mode:'manual'});
await vault.activateModel('owner',q.id);
await check('manual mode respects selected cloud model',async()=>{const d=await selectTaskModel('owner','hello');assert.equal(d.modelId,q.id);assert.equal(d.source,'manual');});
await check('multiple profiles manual/cloud under auto privacy requires explicit override',async()=>assert.rejects(()=>selectTaskModel('owner','my API key is private'),PrivacyRouteError));
await vault.setRouting('owner',{...route,mode:'auto'});
await vault.saveModel('owner',{...base('Fast cloud','api',quick),id:q.id,enabled:false});
await check('disabled profile not eligible',async()=>{const d=await selectTaskModel('owner','hello');assert.equal(d.modelId,l.id);});
await vault.saveModel('owner',{...base('Fast cloud','api',quick),id:q.id,enabled:true});
// Start in-process local Laya server using documented POST /v1/systemone.
const server=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/systemone'){res.writeHead(404);res.end();return;}
  let str='';for await (const chunk of req)str+=chunk;
  const data=JSON.parse(str);
  assert.equal(Object.keys(data.questions).join(','),'model');
  assert.equal(data.questions.model.type,'choice');
  count++;
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({model:'english',answers:{model:{type:'choice',choice:'m0',confidence:0.92}}}));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
try{
  const address=`http://127.0.0.1:${server.address().port}`;
  await vault.setRouting('owner',{...route,layaEnabled:true,layaUrl:address,weights:{quality:1,speed:5,cost:5}});
  await check('real local Laya HTTP response affects selection',async()=>{const d=await selectTaskModel('owner','hello');assert.equal(d.source,'laya-inference');assert.equal(d.modelId,q.id);assert.ok(count>0);});
  await check('malformed or low confidence Laya falls back',async()=>{const d=await selectTaskModel('owner','hello',{fetcher:async()=>new Response(JSON.stringify({answers:{model:{choice:'m0',confidence:0.11}}}),{status:200})});assert.equal(d.source,'deterministic-fallback');});
  await check('refused external fetch does not stop routing',async()=>{const d=await selectTaskModel('owner','hello',{fetcher:async()=>{throw Error('connection refused')}});assert.equal(d.source,'deterministic-fallback');});
  await check('privacy filtered before sending task to Laya',async()=>{let called=false;const d=await selectTaskModel('owner','read my password',{fetcher:async()=>{called=true;throw Error('should not call')}});assert.equal(d.modelId,l.id);assert.equal(called,false);});
  await check('owner route settings persist encrypted',async()=>{const b=await vault.listModels('owner');assert.equal(b.routing.layaUrl,address);const data=fs.readdirSync(path.join(tmp,'.jarvis-private/model-vault')).filter(f=>f.endsWith('.enc')).map(f=>fs.readFileSync(path.join(tmp,'.jarvis-private/model-vault',f),'utf8')).join('');assert.ok(!data.includes(address));});
  await check('untrusted model cannot select ineligible ID',async()=>{const d=await selectTaskModel('owner','hello',{fetcher:async()=>new Response(JSON.stringify({answers:{model:{choice:'m99',confidence:1}}}))});assert.equal(d.source,'deterministic-fallback');});
} finally{await new Promise(done=>server.close(done));}
console.log('LAYA_ROUTER:',n+'/'+n,'PASS');
}
run().then(()=>fs.rmSync(tmp,{recursive:true,force:true})).catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
