#!/usr/bin/env node
/** Real encrypted-vault + task-router stress, fake cloud/local model identities. No API keys or real traffic. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const router=require(path.join(root,'src/lib/agent/models/layaRouter.ts'));
const vault=require(path.join(root,'src/lib/agent/models/vault.ts'));
const {createProfileBridge}=require(path.join(root,'src/lib/agent/models/bridge.ts'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-owner-model-'));
process.chdir(dir);
const ROUND=Math.max(1,Number(process.env.LAYA_OWNER_ROUND||1));
const DECISIONS=Math.max(1,Number(process.env.LAYA_OWNER_DECISIONS||4000));
const seed=(20261028+ROUND*239)|0; let state=seed;
function rand(){state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;}
function pick(a){return a[Math.floor(rand()*a.length)];}
const route={mode:'auto',privacy:'auto',layaEnabled:true,layaUrl:'http://127.0.0.1:1',weights:{quality:5,speed:3,cost:2}};
const model=(label,location,ratings)=>({label,location,protocol:'openai-compatible',baseUrl:location==='api'?'https://model.example.com/v1':'http://127.0.0.1:18333/v1',model:'fixture-model',apiKey:location==='api'?'FAKE_SECRET_DO_NOT_USE':'',ratings,enabled:true});
const kinds=['coding','computer_use','research','creative','conversation'];
const tasks={
 coding:'debug the entire typescript architecture and fix bugs',computer_use:'use my mouse and screen to play Minecraft',
 research:'research and compare scientific papers',creative:'write a creative short story',conversation:'hello',
};
let total=0,assertions=0,failures=[],requests=0,cases={};
const check=(condition,msg)=>{assertions++;if(!condition)throw Error(msg);};
const mark=(what)=>cases[what]=(cases[what]||0)+1;
async function main(){
 try {
  // Use three genuine separated source-configured stores to prove singleton behaviour.
  let soloCloud=await vault.saveModel('solo-cloud',model('Solo Cloud','api',{reasoning:1,coding:1,vision:1,speed:1,cost:1}));
  let soloLocal=await vault.saveModel('solo-local',model('Solo Local','local',{reasoning:1,coding:1,vision:1,speed:1,cost:1}));
  let oneEnabled=await vault.saveModel('one-enabled',model('Only Enabled Cloud','api',{reasoning:1,coding:1,vision:1,speed:1,cost:1}));
  const disabled=await vault.saveModel('one-enabled',model('Disabled Local','local',{reasoning:5,coding:5,vision:5,speed:5,cost:5}));
  await vault.saveModel('one-enabled',{...model('Disabled Local','local',{reasoning:5,coding:5,vision:5,speed:5,cost:5}),id:disabled.id,enabled:false});
  const profiles=[];
  for(let i=0;i<24;i++) profiles.push(await vault.saveModel('many',model('Fixture '+i,i%2?'local':'api',{
   reasoning:1+(i%5),coding:1+((i*3+2)%5),vision:1+((i*7+1)%5),
   speed:1+((i*11+4)%5),cost:1+((i*13+3)%5),
  })));
  await vault.setRouting('many',{...route,privacy:'cloud-allowed',mode:'manual',weights:{quality:1,speed:5,cost:5}});
  await vault.activateModel('many',profiles[1].id);
  for(const [input,expected] of [
    ['Use the strongest model for the task','strongest'],['Use the strongest cloud model','strongest-cloud'],
    ['Use the strongest local LLM','strongest-local'],['Use cloud model','cloud'],
    ['Use a cloud model','cloud'],['Use could model','cloud'],['Use API model','cloud'],
    ['Use local llm','local'],['Use only cloud model','cloud'],
    ['Select the best model','strongest'],['Choose the most capable model','strongest'],
    ['Do not use cloud model',null],['Never use a cloud model',null],
    ['Explain how to use cloud model',null],['Write the phrase "use cloud model"',null],['Include `use strongest model` in docs',null],
  ])check(router.parseOwnerModelDirective(input)===expected,'directive parse '+input+' => '+router.parseOwnerModelDirective(input));
  const cloud=profiles.filter(p=>p.location==='api');
  const local=profiles.filter(p=>p.location==='local');
  const categoryCases=Object.entries(tasks);
  for(const [category,task] of categoryCases){
    const cls=router.classifyTask(task).category;
    check(cls===category,`category classifier expected ${category}, got ${cls}`);
    const expected=(list)=>[...list].sort((a,b)=>router.strengthScore(b,category)-router.strengthScore(a,category)||a.id.localeCompare(b.id))[0];
    for(const [directive,pool] of [['use the strongest model',profiles],['use strongest cloud model',cloud],['use strongest local model',local],['use cloud model',cloud],['use local llm',local]]){
      const d=await router.selectTaskModel('many',`${directive}. ${task}`,{fetcher:async()=>{requests++;throw Error('Laya must not be called for owner instruction');}});
      check(d.modelId===expected(pool).id,`${directive} ${category} expected ${expected(pool).label}, got ${d.modelId}`);
      check(d.source==='owner-instruction','owner instruction source should win');
      check(d.privacy==='cloud-allowed',`cloud-allowed owner policy for ${directive}`);
    }
  }
  // An explicit cloud request is permitted only while owner Settings allow cloud.
  const privateCloud=await router.selectTaskModel('many','Use cloud model to inspect my confidential medical file');
  check(profiles.find(p=>p.id===privateCloud.modelId).location==='api','privacy override cloud');
  check(privateCloud.privacy==='cloud-allowed','effective cloud privacy');
  await vault.setRouting('many',{...route,privacy:'auto'});
  const noExplicit=await router.selectTaskModel('many','Open my confidential medical file');
  check(profiles.find(p=>p.id===noExplicit.modelId).location==='local','automatic default privacy still local');
  for(const o of ['solo-cloud','solo-local','one-enabled']) {
    const selected=o==='solo-cloud'?soloCloud:o==='solo-local'?soloLocal:oneEnabled;
    for(const phrase of ['read my passport and private medical notes','use cloud model','use local llm','use strongest model']) {
      const d=await router.selectTaskModel(o,phrase,{fetcher:async()=>{requests++;throw Error('Laya called in singleton');}});
      check(d.modelId===selected.id,`singleton owner ${o} ${phrase}`);
      check(d.source==='single-model',`single source ${o}`);
    }
  }
  check((await router.selectTaskModel('legacy-only','read my API key')).pinnedId==='legacy-env','legacy env cannot be blocked');
  let emptyError=false;
  const dis=await vault.saveModel('all-disabled',model('No One','local',{reasoning:5,coding:5,vision:5,speed:5,cost:5}));
  await vault.saveModel('all-disabled',{...model('No One','local',{reasoning:5,coding:5,vision:5,speed:5,cost:5}),id:dis.id,enabled:false});
  try{await router.selectTaskModel('all-disabled','use the strongest model');}catch(e){emptyError=/disabled/.test(e.message);}
  check(emptyError,'disabled-only must return actionable error');
  // Real fake model HTTP response on local loopback: dispatch prompts after routing.
  const server=require('node:http').createServer(async(req,res)=>{
    let data='';for await(const c of req)data+=c;
    if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
    const b=JSON.parse(data);check(b.model==='fixture-model','mock model identifier');
    check(Array.isArray(b.messages),'model messages');mark('model-http');
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'SIMULATED_MODEL_RESPONSE'}}]}));
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try {
    const mock=await vault.saveModel('simulation',model('Live mock Local','local',{reasoning:1,coding:1,vision:1,speed:1,cost:1}));
    const fake=await vault.getModel('simulation',mock.id);
    fake.baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
    for(const prompt of ['Use the strongest model and reply with 123','Use cloud model to explain neural nets','Read private medical notes','Play Minecraft']){
      const d=await router.selectTaskModel('simulation',prompt);
      check(d.modelId===mock.id,'sim model singleton');
      check((await createProfileBridge(fake).complete([{role:'user',content:prompt}]))==='SIMULATED_MODEL_RESPONSE','mock endpoint response');
    }
  } finally{await new Promise(ok=>server.close(ok));}
  // Large-scale real encrypted vault reads per decision, randomized workload and directives.
  const prefixes=[
    ['Use the strongest model to ',profiles],['Use strongest cloud model to ',cloud],
    ['Use strongest local model to ',local],['Use cloud model to ',cloud],
    ['Use local llm to ',local],
  ];
  let currentPrivacy='auto';
  for(let i=0;i<DECISIONS;i++){
    let [prefix,pool]=pick(prefixes);let [category,task]=pick(categoryCases);
    const weights={quality:1+Math.floor(rand()*5),speed:1+Math.floor(rand()*5),cost:1+Math.floor(rand()*5)};
    if(i%123===0){
      currentPrivacy=i%3===0?'auto':'local-only';
      await vault.setRouting('many',{...route,mode:i%2?'auto':'manual',privacy:currentPrivacy,weights});
    }
    const objective=prefix+task+(i%7===0?' and read my private passport':'');
    if(currentPrivacy==='local-only' && pool===cloud){
      let denied=false;
      try { await router.selectTaskModel('many',objective,{fetcher:async()=>{requests++;return new Response('{}');}}); }
      catch(err){denied=err instanceof router.PrivacyRouteError;}
      check(denied,`decision ${i} forbidden cloud request was not denied`);
      total++;mark('explicit-cloud-denied');continue;
    }
    const d=await router.selectTaskModel('many',objective,{fetcher:async()=>{requests++;return new Response('{}');}});
    const kind=router.classifyTask(objective).category;
    const permittedPool=currentPrivacy==='local-only'&&pool===profiles?local:pool;
    const expected=[...permittedPool].sort((a,b)=>router.strengthScore(b,kind)-router.strengthScore(a,kind)||a.id.localeCompare(b.id))[0];
    check(d.modelId===expected.id,`decision ${i} model mismatch, got ${d.modelId}, expected ${expected.id}`);
    check(d.source==='owner-instruction',`decision ${i} ignored instruction`);
    if(pool===cloud) check(d.privacy==='cloud-allowed',`decision ${i} blocked cloud`);
    if(currentPrivacy==='local-only')check(d.privacy==='local-only',`decision ${i} violated local-only`);
    total++;
    mark(prefix.trim());
  }
  check(requests===0,'Owner requests must not invoke Laya HTTP');
  check((await vault.listModels('many')).profiles.length===24,'all models preserved');
  const vaultContents=fs.readdirSync(path.join(dir,'.jarvis-private/model-vault')).filter(f=>f.endsWith('.enc')).map(f=>fs.readFileSync(path.join(dir,'.jarvis-private/model-vault',f),'utf8')).join('');
  check(!vaultContents.includes('FAKE_SECRET_DO_NOT_USE'),'vault secrets protected');
 }catch(e){failures.push(String(e.stack||e));console.error('FAIL',e.stack||e);process.exitCode=1;}
 finally {
  const report={round:ROUND,decisions:total,planned:DECISIONS,assertions,failures,cases,unwantedLayaCalls:requests,node:process.version,environment:process.platform,realAI:false,realWindows:false,realMinecraft:false};
  const output=process.env.LAYA_OWNER_REPORT;
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(`OWNER_PRIORITY_ROUND=${ROUND} decisions=${total}/${DECISIONS} assertions=${assertions} failures=${failures.length} unintended_laya_calls=${requests}`);
  fs.rmSync(dir,{force:true,recursive:true});
 }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
