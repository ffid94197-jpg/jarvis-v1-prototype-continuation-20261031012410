'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
let n=0;
function check(x,label){if(!x)throw new Error('FAIL '+label);n++;console.log('PASS',label)}
function tsExports(file,mocks={},runtimeEnv={}){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const js=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const errors=(js.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 check(!errors.length,file+' parses');
 const exports={};
 vm.runInNewContext(js.outputText,{exports,console,process:{env:runtimeEnv,platform:'win32',cwd:()=>root},require:(id)=>{
  if(mocks[id]) return mocks[id];
  if(id==='fs/promises')return {};
  if(id==='path')return require('path');
  if(id==='@/lib/db')return {db:{}};
  if(id==='../guardian/policy')return {resolveScopedPath:()=>({ok:false}),assertWithinRoot:async()=>({ok:false})};
  if(id==='./faults')return {injectedFault:()=>null};
  throw new Error('unmocked import: '+id)
 }},{timeout:3000});return exports;
}
const {compactToolObservation}=tsExports('src/lib/agent/core/observation.ts');
const scene=Array.from({length:40},(_,i)=>({name:'Control '+i,type:'Button',bounds:{left:i*2,top:0,right:i*2+50,bottom:50}}));
const compact=compactToolObservation({ok:true,tool:'windows_desktop_observe',detail:{foregroundControls:scene,foregroundWindow:'Notepad'}},2400);
check(compact.length<=2400,'large UIA tree fits bounded model budget');
check(JSON.parse(compact).ok===true,'large structured observation remains valid JSON');
check(compact.includes('foregroundControls'),'bounded observation retains useful UI structure');
check(JSON.parse(compactToolObservation({ok:false,error:'denied',tool:'windows_native_action'})).ok===false,'tool failure remains explicit after formatting');
const {AutonomyGate,desktopObjectiveRequiresActions,REPEATABLE_INPUT_TOOLS}=tsExports('src/lib/agent/core/autonomyGate.ts');
check(desktopObjectiveRequiresActions('Open Windows Settings'),'actual desktop action requested');
check(desktopObjectiveRequiresActions('JARVIS, please open Chrome'),'prefixed desktop task');
check(desktopObjectiveRequiresActions('Find MrBeast oldest video on YouTube'),'search-and-play task is actual work');
check(!desktopObjectiveRequiresActions('How to open Chrome?'),'conversational question not treated as action');
check(!desktopObjectiveRequiresActions('hi'),'greeting not an action');
const gate=new AutonomyGate();
check(!gate.completionWarning(),'empty task has no false pending proof');
check(new AutonomyGate(2).pendingGuiVerification===2,'unverified GUI proof debt restored after resume');
check(new AutonomyGate(2).completionWarning()!==null,'resumed GUI task cannot falsely complete');
const reordered=new AutonomyGate();
const orderedA={window:'Notepad',element:'save',clickCount:1};
const orderedB={clickCount:1,element:'save',window:'Notepad'};
for(const args of [orderedA,orderedB])
 reordered.observe('windows_desktop_click',args,{ok:true,detail:{uiEffectVerified:false}});
const duplicate=reordered.observe('windows_desktop_click',orderedA,
 {ok:true,detail:{uiEffectVerified:false}});
check(duplicate.stalled,'Reordered identical desktop action must stall after three unverified attempts');
check(reordered.repeatedAttempts===3,'Canonical GUI action identity does not depend on JSON key order');
const resumed=new AutonomyGate(2);
resumed.observe('windows_native_verify',{titleContains:'Notepad'},{ok:true,detail:{proofVerified:true}});
check(resumed.pendingGuiVerification===1,'one resumed UI proof clears only one outstanding action');
const open=gate.observe('windows_native_open_url',{url:'https://youtube.com'},{ok:true,detail:{launchRequested:true,pageLoadVerified:false}});
check(gate.pendingGuiVerification===1,'URL dispatch creates GUI proof debt');
check(open.guidance.includes('proof'),'launch does not fabricate success');
check(!!gate.completionWarning(),'unverified launch prevents complete verdict');
const bad=gate.observe('windows_native_verify',{titleContains:'MrBeast'},{ok:false,error:'not visible'});
check(!bad.stalled&&gate.pendingGuiVerification===1,'failed verification does not clear proof');
const valid=gate.observe('windows_native_verify',{titleContains:'YouTube'},{ok:true,detail:{proofVerified:true}});
check(gate.pendingGuiVerification===0&&valid.guidance.includes('verified'),'live UIA proof clears one pending action');
check(gate.completionWarning()===null,'verified effect eligible for completion arbitration');
const txt=gate.observe('windows_native_action',{elementId:'a'.repeat(24),action:'set_text',text:'hello'},{ok:true,detail:{textVerifiedByUIA:true}});
check(!gate.completionWarning() && !txt.stalled,'UIA exact text readback counts as proof');
const spins=new AutonomyGate();
check(!spins.observe('windows_desktop_click',{x:5,y:8,button:'left'},{ok:true,detail:{uiEffectVerified:false}}).stalled,'first unverified click allowed');
check(!spins.observe('windows_desktop_click',{x:5,y:8,button:'left'},{ok:true,detail:{uiEffectVerified:false}}).stalled,'second unverified click warns');
check(spins.observe('windows_desktop_click',{x:5,y:8,button:'left'},{ok:true,detail:{uiEffectVerified:false}}).stalled,'third unverified repeat halts');
const distinct=new AutonomyGate();
for(const x of [10,20,30])check(!distinct.observe('windows_desktop_click',{x,y:8,button:'left'},{ok:true}).stalled,'distinct click not falsely stalled');
check(REPEATABLE_INPUT_TOOLS.has('windows_desktop_click'),'repeated clicks have per-step effect identity');
check(!REPEATABLE_INPUT_TOOLS.has('write_file'),'workspace write identity remains stable');
const {effectIdentity, EFFECTFUL_TOOLS}=tsExports('src/lib/agent/core/effects.ts');
check(EFFECTFUL_TOOLS.has('windows_native_action')&&EFFECTFUL_TOOLS.has('windows_native_open_url'),'native GUI effects now durable before dispatch');
const eff={tool:'windows_desktop_click',args:{x:55,y:90,button:'left'}};
check(effectIdentity(1,{...eff,stepSeq:5}) !== effectIdentity(1,{...eff,stepSeq:6}),'distinct click steps get distinct durable IDs');
check(effectIdentity(1,{...eff,stepSeq:5}) === effectIdentity(1,{...eff,stepSeq:5}),'same replayed step deterministically deduplicates');
check(effectIdentity(1,{tool:'write_file',args:{path:'a',content:'b'},stepSeq:1}) === effectIdentity(1,{tool:'write_file',args:{path:'a',content:'b'},stepSeq:2}),'file writes still deduplicate by effect content');
const env={JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'1',JARVIS_WINDOWS_AGENT_ENABLED:'1',JARVIS_LOCAL_DEV_NO_LOGIN:'1',JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_WINDOWS_COMPANION_TOKEN:'a'.repeat(40)};
const policy=tsExports('src/lib/agent/windows/policy.ts',{'node:fs':{readFileSync:()=>"{}"},'node:path':{join:(...p)=>p.join('/')}},env);
const allowed=policy.validateDesktopTool;
check(allowed('windows_native_verify',{titleContains:'YouTube'}).ok,'Guardian accepts bounded title proof');
check(allowed('windows_native_verify',{textEquals:'Exact text'}).ok,'Guardian accepts exact text proof');
check(!allowed('windows_native_verify',{titleContains:'Notepad',controlContains:'Save'}).ok,'Guardian rejects ambiguous proof');
check(!allowed('windows_native_verify',{titleContains:'x'}).ok,'Guardian rejects one-letter proof');
check(allowed('windows_desktop_observe',{}).ok,'Guardian accepts combined real desktop scene');
env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL='0';
check(!allowed('windows_native_verify',{titleContains:'YouTube'}).ok,'Guardian blocks native proof outside test opt-in');
check(!allowed('windows_desktop_observe',{}).ok,'Guardian blocks desktop scene outside test opt-in');
env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL='1';
for(const file of ['src/lib/agent/guardian/guardian.ts','src/lib/agent/tools/executor.ts','windows-companion/companion.py']){
 const s=fs.readFileSync(path.join(root,file),'utf8');
 check(s.includes('windows_native_verify')||s.includes('native_verify'),file+' native proof route present');
 check(s.includes('windows_desktop_observe')||s.includes('desktop_observe'),file+' unified desktop scene route present');
}
check(typeof policy.validateDesktopTool === "function",'Guardian policy exports the real validation function');
check(env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL==='1','explicit local opt-in fixture used');
const coreLoop=fs.readFileSync(path.join(root,'src/lib/agent/core/loop.ts'),'utf8');
check(coreLoop.indexOf('arbitration.verdict === "failed"') < coreLoop.indexOf('else if (guiWarning) finalStatus = "partial"'),
      'failed durable file predicates outrank GUI partial status');
check(coreLoop.includes('pendingGuiVerification: proofDebt.pendingGuiVerification'),
      'persisted steps reconstruct GUI proof debt for paused task resume');
console.log(`AUTONOMY_SUPERVISOR: ${n}/${n} passed (offline, no actual Windows GUI)`);
