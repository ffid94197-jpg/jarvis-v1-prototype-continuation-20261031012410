/** Mock owner session, real encrypted vault and real API handler / HTTP fixture. */
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),Module=require('module');
const ts=require('typescript');
const assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
require.extensions['.ts']=function(m,f){m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);};
let principal={role:'OWNER',status:'ACTIVE',principalId:'owner1'};
const oldResolve=Module._resolveFilename, oldLoad=Module._load;
Module._resolveFilename=function(n,parent,...r){if(n.startsWith('@/lib/agent/'))return oldResolve.call(this,path.join(root,'src',n.slice(2)+'.ts'),parent,...r);return oldResolve.call(this,n,parent,...r)};
Module._load=function(n,parent,...r){if(n==='@/lib/agent/auth/session')return {getAuthContext:async()=>principal};return oldLoad.call(this,n,parent,...r);};
process.env.JARVIS_PUBLIC_ORIGIN='http://127.0.0.1:3000';
const route=require(path.join(root,'src/app/api/jarvis/models/route.ts'));
const previousCwd=process.cwd();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-model-route-'));process.chdir(tmp);
let count=0;async function check(label,fn){await fn();count++;console.log('PASS '+label);}
function req(method,data,origin='http://127.0.0.1:3000'){
 return {url:'http://127.0.0.1:3000/api/jarvis/models',headers:new Headers({'host':'127.0.0.1:3000','origin':origin,'sec-fetch-site':origin.endsWith('3000')?'same-origin':'cross-site'}),text:async()=>JSON.stringify(data??{})};
}
async function run(){
await check('GET requires a session',async()=>{principal=null;assert.equal((await route.GET(req('GET'))).status,401);principal={role:'OWNER',status:'ACTIVE',principalId:'owner1'};});
await check('GET denies non-owner',async()=>{principal={role:'DEVICE',status:'ACTIVE',principalId:'dev'};assert.equal((await route.GET(req('GET'))).status,403);principal={role:'OWNER',status:'ACTIVE',principalId:'owner1'};});
await check('POST denies foreign origin',async()=>assert.equal((await route.POST(req('POST',{action:'save'},'https://evil.com'))).status,403));
await check('POST rejects bad JSON settings',async()=>assert.equal((await route.POST(req('POST',{action:'save',profile:{}}))).status,400));
const profile={label:'Fixture Local',location:'local',protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1234/v1',model:'test',apiKey:''};
let id;
await check('POST saves a real profile',async()=>{const r=await route.POST(req('POST',{action:'save',profile}));assert.equal(r.status,200);const b=await r.json();id=b.profile.id;assert.ok(id);assert.equal('apiKey' in b.profile,false);});
await check('GET lists only owner sanitized metadata',async()=>{const r=await route.GET(req('GET'));const b=await r.json();assert.equal(b.profiles.length,1);assert.equal(b.profiles[0].model,'test');assert.equal('apiKey' in b.profiles[0],false);});
await check('POST activates profile',async()=>{const r=await route.POST(req('POST',{action:'activate',id}));assert.equal(r.status,200);assert.equal((await r.json()).activeId,id);});
await check('POST wrong-owner cannot activate',async()=>{principal={role:'OWNER',status:'ACTIVE',principalId:'owner2'};assert.equal((await route.POST(req('POST',{action:'activate',id}))).status,400);principal={role:'OWNER',status:'ACTIVE',principalId:'owner1'};});
await check('routing settings saved through authenticated API',async()=>{const routing={mode:'auto',privacy:'auto',layaEnabled:true,layaUrl:'http://127.0.0.1:8000',weights:{quality:5,speed:3,cost:2}};const r=await route.POST(req('POST',{action:'routing',routing}));assert.equal(r.status,200);const b=await (await route.GET(req('GET'))).json();assert.equal(b.routing.mode,'auto');assert.equal(b.routing.privacy,'auto');});
await check('routing settings reject non-loopback Laya endpoint',async()=>{const routing={mode:'auto',privacy:'auto',layaEnabled:true,layaUrl:'https://remote.example.com',weights:{quality:5,speed:3,cost:2}};assert.equal((await route.POST(req('POST',{action:'routing',routing}))).status,400);});
await check('Laya health probe stays loopback and returns safe result',async()=>{const old=global.fetch;try{global.fetch=async(url,opts)=>{assert.equal(url,'http://127.0.0.1:8000/healthz');assert.equal(opts.method,'GET');return new Response('ok',{status:200});};const r=await route.POST(req('POST',{action:'laya-test'}));const b=await r.json();assert.equal(b.ok,true);assert.equal(b.kind,'LOCAL_LAYA_SERVER_REACHABLE');}finally{global.fetch=old;}});
await check('foreign account cannot change Laya routing settings',async()=>{principal={role:'DEVICE',status:'ACTIVE',principalId:'dev'};assert.equal((await route.POST(req('POST',{action:'laya-test'}))).status,403);principal={role:'OWNER',status:'ACTIVE',principalId:'owner1'};});
await check('routing preview returns selected model without secrets',async()=>{const r=await route.POST(req('POST',{action:'preview',objective:'hello'}));assert.equal(r.status,200);const b=await r.json();assert.equal(b.selectedLabel,'Fixture Local');assert.equal('apiKey' in b,false);});
await check('routing preview validates length',async()=>{assert.equal((await route.POST(req('POST',{action:'preview',objective:'x'.repeat(501)}))).status,400);});
await check('POST delete removes profile',async()=>{const r=await route.POST(req('POST',{action:'delete',id}));assert.equal(r.status,200);assert.equal((await (await route.GET(req('GET'))).json()).profiles.length,0);});
await check('POST test does not accept an arbitrary direct URL',async()=>{assert.equal((await route.POST(req('POST',{action:'test',id:'missing',baseUrl:'http://127.0.0.1:1234'}))).status,404);});
console.log('MODEL_ROUTE:',count+'/'+count,'PASS');
}
// Windows does not allow removing a directory that is the current working directory.
 // Restore cwd before closing the fixture, even when an assertion throws.
async function main(){
 let failure=null;
 try{await run();}
 catch(e){failure=e;}
 finally{
  try{
   process.chdir(previousCwd);
   Module._resolveFilename=oldResolve;
   Module._load=oldLoad;
   fs.rmSync(tmp,{force:true,recursive:true,maxRetries:8,retryDelay:125});
   if(fs.existsSync(tmp))throw Error('Model routing fixture directory not cleaned');
   console.log('MODEL_ROUTE_FIXTURE_CLEANUP PASS');
  }catch(e){
   if(failure)console.error('Fixture cleanup also failed:',e.stack||e);
   else failure=e;
  }
 }
 if(failure)throw failure;
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
