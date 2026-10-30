#!/usr/bin/env node
'use strict';
// JARVIS LAYA reproducible stress harness. No real keys, Laya weights, cloud calls or PC access.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const installedRoot = path.resolve(__dirname,'../..');
const sourceRoot = process.env.JARVIS_SOURCE_ROOT || (fs.existsSync(path.join(installedRoot,'src/lib/agent/models/layaRouter.ts')) ? installedRoot : path.resolve(__dirname,'../workspace/JARVIS_V1_GPT6_LAYA_SETTINGS_ROUTER_2026-10-28'));
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {validateModelSettings} = require(path.join(sourceRoot,'src/lib/agent/models/contracts.ts'));
const vault = require(path.join(sourceRoot,'src/lib/agent/models/vault.ts'));
const router = require(path.join(sourceRoot,'src/lib/agent/models/layaRouter.ts'));
const {createProfileBridge} = require(path.join(sourceRoot,'src/lib/agent/models/bridge.ts'));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-laya-stress-'));
process.chdir(ROOT);
const SEED = Number(process.env.LAYA_STRESS_SEED || 20261028);
const ROUND = Number(process.env.LAYA_STRESS_ROUND || 1);
const DECISIONS = Number(process.env.LAYA_STRESS_DECISIONS || 1500);
let rng=SEED + ROUND;
function random(){ rng^=rng<<13; rng^=rng>>>17; rng^=rng<<5;return (rng>>>0)/0x100000000; }
function choose(xs){return xs[Math.floor(random()*xs.length)];}
const start=Date.now(),checks={passed:0,failed:0,failures:[]},counts={decisions:0,propertyPass:0,blocked:0,layaRequests:0,layaResponses:0,layaAccepted:0,fallbacks:0,modelHTTP:0,privacyCases:0};
async function check(name,fn){try{await fn();checks.passed++;}catch(e){checks.failed++;checks.failures.push({name,error:String(e.stack||e)});console.error('FAIL',name,e.message||e);}}
const route={mode:'auto',privacy:'auto',layaEnabled:false,layaUrl:'http://127.0.0.1:8000',weights:{quality:5,speed:3,cost:2}};
const base=(label,location,ratings,protocol='openai-compatible',u='')=>({label,location,protocol,baseUrl:u||(location==='local'?'http://127.0.0.1:1234/v1':'https://api.example.com/v1'),model:protocol==='ollama'?'fixture-qwen:latest':'fixture-model',apiKey:location==='local'?'':'fixture-key-NOT-REAL',ratings,enabled:true});
const Q={reasoning:2,coding:2,vision:2,speed:5,cost:5};
const D={reasoning:5,coding:5,vision:3,speed:2,cost:1};
const L={reasoning:3,coding:3,vision:2,speed:3,cost:4};
const C={reasoning:5,coding:5,vision:2,speed:2,cost:3};
const V={reasoning:4,coding:1,vision:5,speed:3,cost:2};
let layaMode='fixed-m0', lastPayload=null;
const layaServer=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/systemone'){res.writeHead(404);res.end();return;}
  counts.layaRequests++;
  let data='';for await(const chunk of req)data+=chunk;
  const parsed=JSON.parse(data);lastPayload=parsed;
  if(layaMode==='server-error'){res.writeHead(503);res.end('offline');return;}
  if(layaMode==='invalid-json'){res.writeHead(200,{'content-type':'application/json'});res.end('not-json');return;}
  const keys=Object.keys(parsed.questions.model.criteria);
  let choice='m0',confidence=0.94;
  if(layaMode==='last')choice=keys.at(-1);
  if(layaMode==='outside')choice='m99';
  if(layaMode==='low')confidence=0.2;
  if(layaMode==='wrong-object')choice='a-not-a-model';
  const response={model:'english',answers:{model:{type:'choice',choice,confidence}}};
  counts.layaResponses++;
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
});
const modelServer=http.createServer(async(req,res)=>{
  let data='';for await(const c of req)data+=c;
  counts.modelHTTP++;
  const body=JSON.parse(data);
  if(req.url==='/v1/chat/completions'){
    if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"MOCK_"}}]}\n\n');res.end('data: {"choices":[{"delta":{"content":"MODEL_OK"}}]}\n\ndata: [DONE]\n\n');}
    else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'MOCK_MODEL_OK'}}]}));}
  } else if(req.url==='/api/chat'){
    res.writeHead(200,{'content-type':'application/json'});
    if(body.stream)res.end('{"message":{"content":"MOCK_"}}\n{"message":{"content":"MODEL_OK"}}\n');
    else res.end(JSON.stringify({message:{content:'MOCK_MODEL_OK'}}));
  } else {res.writeHead(404);res.end();}
});
async function beginServer(s){await new Promise(ok=>s.listen(0,'127.0.0.1',ok));return `http://127.0.0.1:${s.address().port}`;}
async function stopServer(s){await new Promise(ok=>s.close(ok));}
async function main(){
  const layaUrl=await beginServer(layaServer),localUrl=await beginServer(modelServer);
  try{
    const pFast=await vault.saveModel('owner',base('Cloud Fast','api',Q));
    const pDeep=await vault.saveModel('owner',base('Cloud Deep','api',D));
    const pPrivate=await vault.saveModel('owner',base('Local Private','local',L,'openai-compatible',localUrl+'/v1'));
    const pCode=await vault.saveModel('owner',base('Local Code','local',C,'openai-compatible',localUrl+'/v1'));
    const pVision=await vault.saveModel('owner',base('Local Vision','local',V,'openai-compatible',localUrl+'/v1'));
    const profiles=(await vault.routingSnapshot('owner')).profiles;
    await vault.setRouting('owner',{...route,layaUrl});
    const safeTasks=['hello','search for cute cats on YouTube','open the settings app','compare several websites','write a poem about ocean','debug the entire typescript architecture','play Minecraft with me','autonomously inspect windows desktop','create a small game','review documentation'];
    const privateTasks=['open my password vault','read my API key','review private medical notes','check my bank account number','inspect confidential credentials','read my salary data','show my SSH key','show my passport','read credit card number','inspect Aadhaar number','reveal UPI PIN','review bank statement','check home address','review patient records'];
    for (const task of privateTasks){await check('private-classification: '+task,()=>{counts.privacyCases++;assert.equal(router.classifyPrivacy(task,route),'local-only');});}
    for (const task of safeTasks)await check('safe-classification: '+task,()=>assert.equal(router.classifyPrivacy(task,route),'cloud-allowed'));
    await check('encrypted vault and profile count',async()=>{const d=await vault.listModels('owner');assert.equal(d.profiles.length,5);assert.equal(d.profiles.some(p=>p.apiKey),false);const contents=fs.readdirSync(path.join(ROOT,'.jarvis-private/model-vault')).filter(f=>f.endsWith('.enc')).map(f=>fs.readFileSync(path.join(ROOT,'.jarvis-private/model-vault',f),'utf8')).join('');assert.ok(!contents.includes('fixture-key-NOT-REAL'));});
    await check('one-cloud-profile selected for all tasks, even private',async()=>{
      const one=await vault.saveModel('singleCloud',base('Cloud only','api',D));
      assert.equal((await router.selectTaskModel('singleCloud','hello')).source,'single-model');
      const d=await router.selectTaskModel('singleCloud','read my password');assert.equal(d.modelId,one.id);assert.equal(d.privacy,'cloud-allowed');
    });
    await check('one-local-profile used for both privacy classes',async()=>{
      let p=await vault.saveModel('singleLocal',base('Local only','local',L,'ollama',localUrl));
      for(const task of ['hello','read my private medical notes'])assert.equal((await router.selectTaskModel('singleLocal',task)).modelId,p.id);
    });
    await check('manual profile honors owner selection',async()=>{
      await vault.setRouting('owner',{...route,layaUrl,mode:'manual'});await vault.activateModel('owner',pFast.id);
      assert.equal((await router.selectTaskModel('owner','hello')).modelId,pFast.id);
      await vault.setRouting('owner',{...route,layaUrl});
    });
    await check('manual cloud request cannot override privacy',async()=>{
      await vault.setRouting('owner',{...route,layaUrl,mode:'manual'});await vault.activateModel('owner',pFast.id);
      await assert.rejects(()=>router.selectTaskModel('owner','read my password'),router.PrivacyRouteError);
      await vault.setRouting('owner',{...route,layaUrl});
    });
    await check('explicit local-only blocks every cloud selection',async()=>{
      await vault.setRouting('owner',{...route,layaUrl,privacy:'local-only'});
      let d=await router.selectTaskModel('owner','hello');assert.ok(profiles.find(p=>p.id===d.modelId).location==='local');
      await vault.setRouting('owner',{...route,layaUrl});
    });
    await check('heavy coding requires capability-weighted model',async()=>{
      const d=await router.selectTaskModel('owner','debug the entire typescript architecture');assert.equal(d.modelId,pCode.id);
    });
    await check('local-private request excludes all cloud candidates',async()=>{
      const d=await router.selectTaskModel('owner','read my private medical notes');assert.equal(d.privacy,'local-only');assert.equal(profiles.find(p=>p.id===d.modelId).location,'local');
    });
    await check('speed/cost weight changes preference',async()=>{
      await vault.setRouting('owner',{...route,layaUrl,weights:{quality:1,speed:5,cost:5}});
      const d=await router.selectTaskModel('owner','hello');assert.equal(d.modelId,pFast.id);
      await vault.setRouting('owner',{...route,layaUrl});
    });
    await check('Laya responds to real local HTTP and advice is accepted within score threshold',async()=>{
      layaMode='fixed-m0';await vault.setRouting('owner',{...route,layaUrl,layaEnabled:true,weights:{quality:1,speed:5,cost:5}});
      const d=await router.selectTaskModel('owner','hello');assert.equal(d.source,'laya-inference');assert.equal(d.modelId,pFast.id);assert.equal(lastPayload.questions.model.type,'choice');counts.layaAccepted++;
      await vault.setRouting('owner',{...route,layaUrl});
    });
    await check('Invalid Laya choices fall back, no model injection',async()=>{
      await vault.setRouting('owner',{...route,layaUrl,layaEnabled:true});
      for(const state of ['outside','low','wrong-object','invalid-json','server-error']){
        layaMode=state;
        const d=await router.selectTaskModel('owner','hello');assert.equal(d.source,'deterministic-fallback');counts.fallbacks++;
      }
      layaMode='fixed-m0';await vault.setRouting('owner',{...route,layaUrl});
    });
    await check('Laya candidates include top-rated model even when 24 models are configured',async()=>{
      const owner='largePool';
      const low={reasoning:1,coding:1,vision:1,speed:1,cost:1};
      for(let i=0;i<23;i++)await vault.saveModel(owner,base('weak-'+i,'api',low));
      await vault.saveModel(owner,base('superstar','local',{reasoning:5,coding:5,vision:5,speed:5,cost:5},'openai-compatible',localUrl+'/v1'));
      await vault.setRouting(owner,{...route,layaUrl,layaEnabled:true});
      layaMode='fixed-m0';await router.selectTaskModel(owner,'debug the entire typescript architecture');
      const all=Object.values(lastPayload.questions.model.criteria).join(' ');
      assert.ok(all.includes('superstar'),'Laya did not receive the best-ranked profile among 24 eligible models');
    });
    await check('Laya receives owner weighting context',async()=>{
      await vault.setRouting('owner',{...route,layaUrl,layaEnabled:true,weights:{quality:1,speed:5,cost:4}});
      layaMode='fixed-m0';await router.selectTaskModel('owner','hello');
      const sent=JSON.stringify(lastPayload);assert.ok(sent.includes('"quality":1') || /quality[^\d]*1/.test(sent),'owner model weights not supplied to local Laya');
    });
    await vault.setRouting('owner',{...route,layaUrl}); // Restore after negative-case checks, even on assertion failure.
    await check('Actual model HTTP completion, SSE, Ollama and streaming',async()=>{
      const local=await vault.getModel('owner',pPrivate.id);
      const bridge=createProfileBridge(local);
      assert.equal(await bridge.complete([{role:'user',content:'ping'}]),'MOCK_MODEL_OK');
      let fragments=[];assert.equal(await bridge.report([{role:'user',content:'ping'}],c=>fragments.push(c)),'MOCK_MODEL_OK');
      const localO=validateModelSettings(base('Ollama Test','local',L,'ollama',localUrl));
      const ob=createProfileBridge({...localO,id:crypto.randomUUID(),createdAt:'',updatedAt:''});
      assert.equal(await ob.complete([{role:'user',content:'ping'}]),'MOCK_MODEL_OK');
      assert.equal(await ob.report([{role:'user',content:'ping'}],()=>{}),'MOCK_MODEL_OK');
      assert.equal(counts.modelHTTP,4);
    });
    await check('Concurrent profile writes persist without loss',async()=>{
      await Promise.all(Array.from({length:18},(_,i)=>vault.saveModel('concurrent',base('model-'+i,'local',L,'openai-compatible',localUrl+'/v1'))));
      assert.equal((await vault.listModels('concurrent')).profiles.length,18);
    });
    await check('Enforce 24 model profile maximum',async()=>{
      let list=await vault.listModels('largePool');assert.equal(list.profiles.length,24);
      await assert.rejects(()=>vault.saveModel('largePool',base('too many','api',Q)));
    });
    await check('Owner profile isolation under repeated reads',async()=>{
      let a=await vault.listModels('owner'),b=await vault.listModels('largePool');assert.equal(a.profiles.length,5);assert.equal(b.profiles.length,24);
    });
    await check('disabled model never selected and recovers on re-enable',async()=>{
      await vault.saveModel('owner',{...base('Cloud Fast','api',Q),id:pFast.id,enabled:false});
      const d=await router.selectTaskModel('owner','hello');assert.notEqual(d.modelId,pFast.id);
      await vault.saveModel('owner',{...base('Cloud Fast','api',Q),id:pFast.id,enabled:true});
    });
    // High-volume property checks on real routingSnapshot->decrypt->score->selection flow.
    // Rotate operator priority weights regularly, proving dynamic routing reflects Settings.
    const weightPresets=[{quality:5,speed:3,cost:2},{quality:1,speed:5,cost:5},{quality:5,speed:1,cost:1},{quality:2,speed:4,cost:3},{quality:4,speed:2,cost:5}];
    let activeWeights=weightPresets[0];
    for(let i=0;i<DECISIONS;i++){
      if(i%137===0){activeWeights=weightPresets[(Math.floor(i/137))%weightPresets.length];await vault.setRouting('owner',{...route,layaUrl,weights:activeWeights});}
      const isPrivate=random()<0.35;
      const objective=choose(isPrivate?privateTasks.slice(0,7):safeTasks);
      let selected;
      try { selected=await router.selectTaskModel('owner',objective); counts.decisions++; }
      catch(e){counts.blocked++;checks.failed++;checks.failures.push({name:`stress-decision-${i}`,error:String(e)});continue;}
      const eligible=profiles.filter(p=>p.enabled!==false&&(!isPrivate||p.location==='local'));
      const {category,complexity}=router.classifyTask(objective);
      const scores=eligible.map(p=>[p,router.rateModel(p,category,complexity,{...route,weights:activeWeights})]).sort((a,b)=>b[1]-a[1]||a[0].id.localeCompare(b[0].id));
      if(!eligible.some(p=>p.id===selected.modelId) || selected.modelId!==scores[0][0].id || (isPrivate&&selected.privacy!=='local-only')){
        checks.failed++;checks.failures.push({name:`property-${i}`,error:`Expected eligible best ${scores[0][0].label}, got ${selected.modelId}`});
      } else counts.propertyPass++;
    }
    await check(`property-based selection over ${DECISIONS} independent tasks`,async()=>assert.equal(counts.decisions,DECISIONS));
    // Real local HTTP Laya concurrency, ensure no profile leakage and response stays eligible.
    await vault.setRouting('owner',{...route,layaUrl,layaEnabled:true});layaMode='fixed-m0';
    await check('Concurrent HTTP Laya route decisions (200)',async()=>{
      const results=await Promise.all(Array.from({length:200},(_,i)=>router.selectTaskModel('owner',safeTasks[i%safeTasks.length])));
      assert.equal(results.length,200);
      for(const d of results){assert.ok(profiles.some(p=>p.id===d.modelId));if(d.source==='laya-inference')counts.layaAccepted++;}
    });
    await check('All model responses and routing settings redact API keys',async()=>{
      const text=JSON.stringify(await vault.listModels('owner'));
      assert.ok(!text.includes('fixture-key-NOT-REAL'));
      const inspect=JSON.stringify(lastPayload);assert.ok(!inspect.includes('fixture-key-NOT-REAL'));
    });
  } finally {await stopServer(layaServer);await stopServer(modelServer);}
  const summary={round:ROUND,seed:SEED,decisionsPlanned:DECISIONS,checks,counts,elapsedMs:Date.now()-start,source:'JARVIS LAYA Settings Router',environment:{os:process.platform,node:process.version,realModelWeights:false,realCloudAPIs:false,realWindowsDesktop:false,realMinecraft:false}};
  const report=process.env.LAYA_STRESS_REPORT || path.join(__dirname,`stress_round_${ROUND}.json`);
  fs.writeFileSync(report,JSON.stringify(summary,null,2)+'\n');
  console.log(`LAYA_STRESS_ROUND=${ROUND} checked=${checks.passed+checks.failed} pass=${checks.passed} fail=${checks.failed} decisions=${counts.decisions} laya_http=${counts.layaRequests} model_http=${counts.modelHTTP} ms=${summary.elapsedMs}`);
  if(checks.failed)process.exitCode=1;
  fs.rmSync(ROOT,{recursive:true,force:true});
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=2;});
