#!/usr/bin/env node
'use strict';
/**
 * Prototype JARVIS post-merge Windows offline acceptance.
 * Runs real repository regression scripts, not fake test counts.
 * Preserves all failures and a receipt for every attempted case.
 * DOES NOT certify Windows Sandbox, live Minecraft, a real LLM, or V1 release.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const evidence=path.join(root,'artifacts','postmerge-windows');
fs.mkdirSync(evidence,{recursive:true});
const logs=path.join(evidence,'logs');
fs.mkdirSync(logs,{recursive:true});
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-postmerge-test-'));
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const cases=[];
function add(group,command,file,args=[],timeoutMs=120000){
  cases.push({group,command,file,args,timeoutMs});
}
const excludeScripts=new Set([
  'verify-v1-gates.mjs', // deliberately fails without independent real release gates
  'verify-local-project-build-windows-live.cjs', // requires owner-PC Windows Sandbox
  'verify-cua-driver-windows-live.mjs', // requires owner-PC interactive desktop
  'verify-production-build.mjs', // run explicitly with --self-test
]);
for(const name of fs.readdirSync(path.join(root,'scripts')).sort()){
  if(!/^verify-.*\.(cjs|mjs)$/.test(name)||excludeScripts.has(name))continue;
  const group=/(minecraft|companion|game)/i.test(name)?'minecraft-core':
    /(model|provider|laya|goal|autonomy|outcome|identity|long|recovery|file-catalog|corpus)/i.test(name)?'intelligence-core':
    /(windows|desktop|cua|guardian|path|browser|native|local-project|adoption|inventory)/i.test(name)?'security-integrations':'other-system';
  add(group,'node','scripts/'+name,[],/(mass-simulation|deep-windows|longrun)/.test(name)?480000:150000);
}
for(const folder of ['scripts/autonomy','scripts/adoption','scripts/capability','scripts/longrun']){
 const dir=path.join(root,folder);
 if(!fs.existsSync(dir))continue;
 for(const name of fs.readdirSync(dir).sort()){
   if(!/^verify[-_].*\.(cjs|mjs)$/.test(name))continue;
   add(folder.includes('autonomy')?'internet-corpus':'intelligence-core','node',folder+'/'+name,[],180000);
 }
}
const mcDir=path.join(root,'windows-companion/minecraft-bot');
for(const name of fs.readdirSync(mcDir).sort()){
  if(!/^verify_.*\.cjs$/.test(name)||name.startsWith('verify_real_java_'))continue;
  add('minecraft-offline','node','windows-companion/minecraft-bot/'+name,[],180000);
}
const pyDir=path.join(root,'windows-companion');
for(const name of fs.readdirSync(pyDir).sort()){
  if(!/^verify_.*\.py$/.test(name))continue;
  if(/windows_live|live_server/.test(name))continue;
  add('windows-python','python','windows-companion/'+name,[],180000);
}
add('release-gate','node','scripts/verify-v1-gates.mjs',['--self-test'],90000);
add('build-gate','node','scripts/verify-production-build.mjs',['--self-test'],90000);
add('capability-discovery','python','scripts/capability/verify_discovery.py',['--rounds','12','--cases','2500'],180000);
const seen=new Set();
const unique=cases.filter(t=>{const k=[t.command,t.file,...t.args].join('|');if(seen.has(k))return false;seen.add(k);return true;});
const started=new Date().toISOString();
const rows=[];
const env={...process.env,JARVIS_AGENT_WORKSPACE:workspace,JARVIS_SIM_ROUNDS:'60000',JARVIS_MC_SIM_SEEDS:'60',JARVIS_SIM_OUTPUT:path.join(evidence,'mass-simulation.json'),JARVIS_LOCAL_PROJECT_BUILD_ENABLED:'0'};
for(let i=0;i<unique.length;i++){
  const t=unique[i];
  const source=path.join(root,t.file);
  const fileName=String(i+1).padStart(3,'0')+'-'+t.file.replace(/[^a-z0-9]+/gi,'-').slice(0,95)+'.log';
  const logPath=path.join(logs,fileName);
  let r={status:null,signal:null,error:null,stdout:'',stderr:''};
  const t0=Date.now();
  if(!fs.existsSync(source)){
    r.error={message:'TEST_SOURCE_MISSING'};
  }else{
    try{
      r=spawnSync(t.command==='node'?process.execPath:'python',[t.file,...t.args],{
        cwd:root,env,encoding:'utf8',windowsHide:true,
        timeout:t.timeoutMs,maxBuffer:8*1024*1024
      });
    }catch(e){r.error=e;}
  }
  const status=r.error?'FAIL':r.status===0?'PASS':'FAIL';
  const output='COMMAND: '+t.command+' '+[t.file,...t.args].join(' ')+'\n'+
    'EXIT: '+r.status+' SIGNAL: '+r.signal+'\n'+
    'ERROR: '+(r.error?String(r.error):'none')+'\n'+(r.stdout||'')+'\n'+(r.stderr||'');
  fs.writeFileSync(logPath,output,'utf8');
  const row={id:i+1,group:t.group,file:t.file,args:t.args,
    status,exitCode:r.status,signal:r.signal,ms:Date.now()-t0,
    log:path.relative(evidence,logPath).replace(/\\/g,'/'),
    logSha256:sha256(output),error:r.error?String(r.error).slice(0,300):null};
  rows.push(row);
  console.log(status+' '+t.group+' '+t.file+' ('+row.ms+'ms)');
}
const failures=rows.filter(x=>x.status!=='PASS');
const summary={schema:'jarvis.postmerge.windows.offline.v1',startedAt:started,finishedAt:new Date().toISOString(),
  platform:process.platform,githubSha:process.env.GITHUB_SHA||'unknown',
  source:'actual merged Prototype JARVIS checkout',
  total:rows.length,passed:rows.length-failures.length,failed:failures.length,
  status:failures.length?'FAIL':'PASS',cases:rows,
  limits:'Offline regression and mechanical simulations only; not live model/game/Windows Sandbox certification.'};
fs.writeFileSync(path.join(evidence,'runner-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log('POSTMERGE_WINDOWS_OFFLINE '+summary.status+' '+summary.passed+'/'+summary.total);
if(failures.length)console.error('FAILURES:',failures.map(x=>x.file).join(', '));
process.exitCode=failures.length?1:0;
