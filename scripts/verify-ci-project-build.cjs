#!/usr/bin/env node
'use strict';
/** Native Windows CI-only authorization/build integration; not LPAC proof. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
if(process.platform!=='win32' || !process.env.RUNNER_TEMP)throw Error('Native Windows runner required');
const temp=fs.realpathSync(process.env.RUNNER_TEMP);
const sandbox=fs.mkdtempSync(path.join(temp,'jarvis-ci-build-gate-'));
const workspace=path.join(sandbox,'workspace');
const site=path.join(workspace,'site');
fs.mkdirSync(path.join(site,'node_modules','vite','bin'),{recursive:true});
fs.writeFileSync(path.join(site,'package.json'),JSON.stringify({name:'mock-fixture-vite',version:'0.0.1'}));
fs.writeFileSync(path.join(site,'package-lock.json'),JSON.stringify({name:'mock-fixture-vite',lockfileVersion:3,packages:{'':{name:'mock-fixture-vite',version:'0.0.1'}}}));
fs.writeFileSync(path.join(site,'node_modules','vite','bin','vite.js'),
 'const fs=require("fs");fs.mkdirSync("dist",{recursive:true});fs.writeFileSync("dist/index.html","<!doctype html><html><body>CI_ONLY_VERIFIED_ARTIFACT</body></html>");');
const previous={};
for(const k of ['GITHUB_ACTIONS','RUNNER_OS','RUNNER_TEMP','JARVIS_AGENT_WORKSPACE','JARVIS_CI_PROJECT_BUILD_ENABLED'])previous[k]=process.env[k];
process.env.GITHUB_ACTIONS='true';process.env.RUNNER_OS='Windows';
process.env.JARVIS_AGENT_WORKSPACE=workspace;
process.env.JARVIS_CI_PROJECT_BUILD_ENABLED='1';
function compile(relative,mocks={}) {
 const file=path.join(root,relative),module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{
   target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,
 }}).outputText;
 const requireInside=id=>id in mocks?mocks[id]:require(id);
 vm.runInNewContext(code,{module,exports:module.exports,require:requireInside,process,Buffer,
  setTimeout,clearTimeout,setInterval,clearInterval,console}, {filename:file,timeout:12000});
 return module.exports;
}
let passed=0;
function ok(value,label){assert.ok(value,label);passed++;console.log('PASS',label);}
(async()=>{
 try{
  const policy=compile('src/lib/agent/guardian/policy.ts');
  const tool=compile('src/lib/agent/tools/ciProjectBuild.ts',{'../guardian/policy':policy});

  const audited=[];
  const guardian=compile('src/lib/agent/guardian/guardian.ts',{
   '@/lib/db':{db:{auditLog:{create:async ({data})=>{audited.push(data);return {id:String(audited.length)};}}}},
   '../windows/policy':{validateDesktopTool:()=>({ok:false,reason:'unavailable in isolated test'})},
   './policy':policy,
   '../tools/ciProjectBuild':tool,
  });
  let admitted=await guardian.authorizeToolCall({taskId:'ci-test',ownerId:'owner'},'ci_project_build',{project:'site',action:'build'});
  ok(admitted.verdict==='allow' && admitted.prepared.projectBuild.rel==='site',
    'Guardian approved only the prepared workspace project');
  ok(audited.at(-1).verdict==='ALLOW' && audited.at(-1).argsJson.includes('redacted'),
    'Guardian durably audited allow without persisting raw inputs');
  admitted=await guardian.authorizeToolCall({taskId:'ci-test',ownerId:'owner'},'ci_project_build',{project:'../site',action:'build'});
  ok(admitted.verdict==='deny' && audited.at(-1).verdict==='DENY',
    'Guardian audit retains rejected traversal intent');
  admitted=await guardian.authorizeToolCall({taskId:'ci-test'},'ci_project_build',{project:'site',action:'build'});
  ok(admitted.verdict==='deny','CI build cannot be authorized without an authenticated owner');
  let d=await tool.prepareCIProjectBuild({project:'site',action:'build'});
  ok(d.ok===true,'fixed Vite build authorized in isolated runner');
  ok(d.prepared.rel==='site','Guardian normalized project path');
  const receipt=await tool.executeCIProjectBuild(d.prepared,()=>false,()=>{});
  ok(receipt.ok===true && receipt.detail?.buildArtifactVerified===true,'actual Node child created independently verified dist artifact');
  ok(typeof receipt.detail?.artifactSha256==='string'&&receipt.detail.artifactSha256.length===64,'build artifact SHA-256 recorded');
  const cancelled=await tool.executeCIProjectBuild(d.prepared,()=>true,()=>{});
  ok(cancelled.ok===false && /cancelled/.test(cancelled.error),'pre-execution cancellation stops effects');
  d=await tool.prepareCIProjectBuild({project:'../site',action:'build'});
  ok(!d.ok,'path traversal denied');
  d=await tool.prepareCIProjectBuild({project:'site',action:'powershell'});
  ok(!d.ok,'arbitrary command action denied');
  d=await tool.prepareCIProjectBuild({project:'site',action:'install'});
  ok(d.ok,'fixed install action requires lock file');
  fs.unlinkSync(path.join(site,'package-lock.json'));
  d=await tool.prepareCIProjectBuild({project:'site',action:'install'});
  ok(!d.ok,'install without pinning lock file denied');
  process.env.JARVIS_CI_PROJECT_BUILD_ENABLED='0';
  d=await tool.prepareCIProjectBuild({project:'site',action:'build'});
  ok(!d.ok,'normal disabled flag denies build');
  process.env.JARVIS_CI_PROJECT_BUILD_ENABLED='1';
  process.env.GITHUB_ACTIONS='false';
  d=await tool.prepareCIProjectBuild({project:'site',action:'build'});
  ok(!d.ok,'non-CI process denied even with opt-in flag');
  process.env.GITHUB_ACTIONS='true';
  // Project root may never be outside the configured workspace.
  fs.mkdirSync(path.join(sandbox,'other'),{recursive:true});
  d=await tool.prepareCIProjectBuild({project:'other',action:'build'});
  ok(!d.ok,'unowned project folder denied');
  console.log('CI_PROJECT_BUILD_SECURITY '+passed+'/'+passed+' PASS (disposable Windows runner; no owner PC)');
 }finally{
  for(const [key,val] of Object.entries(previous)){
   if(val===undefined)delete process.env[key];else process.env[key]=val;
  }
  fs.rmSync(sandbox,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
