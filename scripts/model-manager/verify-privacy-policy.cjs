#!/usr/bin/env node
'use strict';
/** Real encrypted model-vault route tests, offline profiles and no network I/O. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const vault=require(path.join(root,'src/lib/agent/models/vault.ts'));
const {selectTaskModel,PrivacyRouteError}=require(path.join(root,'src/lib/agent/models/layaRouter.ts'));
const previousWorkingDirectory=process.cwd();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-privacy-policy-'));
process.chdir(tmp);
let n=0;
async function check(name,f){await f();n++;console.log('PASS',name);}
const route=(privacy,mode='auto')=>({mode,privacy,layaEnabled:false,layaUrl:'http://127.0.0.1:8000',weights:{quality:5,speed:3,cost:2}});
const profile=(label,location)=>({label,location,protocol:'openai-compatible',baseUrl:location==='local'?'http://127.0.0.1:1234/v1':'https://example.com/v1',model:'fake-model',apiKey:location==='api'?'fake-test-key':'',enabled:true});
async function main(){
 try {
  const owner='privacy';
  await vault.setRouting(owner,route('local-only'));
  await check('explicit local-only fails closed without local profiles',async()=>{
   const backend=process.env.JARVIS_MODEL_BACKEND;delete process.env.JARVIS_MODEL_BACKEND;
   try{await assert.rejects(()=>selectTaskModel(owner,'say hi'),PrivacyRouteError);}
   finally{if(backend===undefined)delete process.env.JARVIS_MODEL_BACKEND;else process.env.JARVIS_MODEL_BACKEND=backend;}
  });
  const cloud=await vault.saveModel(owner,profile('cloud API','api'));
  await check('sole enabled cloud model denied by explicit local-only',async()=>assert.rejects(()=>selectTaskModel(owner,'say hi'),PrivacyRouteError));
  await check('explicit cloud request cannot bypass hard local-only policy',async()=>assert.rejects(()=>selectTaskModel(owner,'use cloud model to play minecraft'),PrivacyRouteError));
  const local=await vault.saveModel(owner,profile('local runtime','local'));
  await check('local-only chooses local for ordinary request',async()=>assert.equal((await selectTaskModel(owner,'say hi')).modelId,local.id));
  await check('local-only chooses local even with strongest request',async()=>assert.equal((await selectTaskModel(owner,'use strongest model for coding')).modelId,local.id));
  await check('local-only rejects explicit cloud with both providers',async()=>assert.rejects(()=>selectTaskModel(owner,'use cloud model for game'),PrivacyRouteError));
  await vault.setRouting(owner,route('cloud-allowed'));
  await check('owner changing policy restores cloud availability',async()=>assert.equal((await selectTaskModel(owner,'use cloud model for game')).modelId,cloud.id));
  await vault.setRouting(owner,route('auto'));
  await check('automatic privacy still routes private task locally',async()=>assert.equal((await selectTaskModel(owner,'read my confidential document')).modelId,local.id));
  await check('explicit owner cloud routing works with auto policy',async()=>assert.equal((await selectTaskModel(owner,'use cloud model for code')).modelId,cloud.id));
  await vault.setRouting(owner,route('local-only','manual'));
  await vault.activateModel(owner,cloud.id);
  await check('manual cloud selection blocked under local-only policy',async()=>assert.rejects(()=>selectTaskModel(owner,'hello'),PrivacyRouteError));
  console.log(`PRIVACY_ROUTE_POLICY ${n}/${n} PASS (offline)`);
 }finally {
  // Windows refuses to delete a directory while the Node process is inside it.
  // Restore the original directory first, then clean up with bounded retries for
  // short-lived Windows antivirus/indexer handles. Never hide test failures.
  process.chdir(previousWorkingDirectory);
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
}
main().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
