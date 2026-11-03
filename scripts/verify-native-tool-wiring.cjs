'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const files=['src/lib/agent/guardian/guardian.ts','src/lib/agent/tools/executor.ts','src/lib/agent/core/prompts.ts','src/lib/agent/windows/policy.ts','windows-companion/companion.py'];
const all=files.map(f=>fs.readFileSync(path.join(root,f),'utf8'));
let n=0;function check(ok,note){if(!ok)throw new Error('FAIL '+note);n++;console.log('PASS',note)}
for(const tool of ['windows_native_open_url','windows_native_inspect','windows_native_action']){
 for(let i=0;i<4;i++) check(all[i].includes(tool),tool+' wired '+files[i]);
}
for(const tool of ['native_open_url','native_inspect','native_action'])check(all[4].includes(tool),tool+' companion handler');
const policy=ts.transpileModule(all[3],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
check(!policy.diagnostics?.length,'native policy TypeScript transpiles');
const testExports={}; const env={JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'1',JARVIS_WINDOWS_AGENT_ENABLED:'1',JARVIS_LOCAL_DEV_NO_LOGIN:'1',JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_WINDOWS_COMPANION_TOKEN:'a'.repeat(40)};
vm.runInNewContext(policy.outputText,{exports:testExports,URL,process:{platform:'win32',env,cwd:()=>root},require},{timeout:2000});
const gate=testExports.validateDesktopTool;
const permit=(name,args)=>gate(name,args).ok;
check(permit('windows_native_inspect',{}),'UIA inspection accepted in isolated test mode');
const grounded=gate('windows_native_inspect',{query:'Save'});
check(grounded.ok && grounded.prepared.query==='Save','UFO2 read-only control query stays in native Guardian contract');
check(!permit('windows_native_inspect',{query:' '}) &&
      !permit('windows_native_inspect',{query:'x'.repeat(161)}) &&
      !permit('windows_native_inspect',{query:'Save\\nsecret'}),
      'Empty, oversized, and control-character UIA query denied');
check(!permit('windows_native_inspect',{query:'Save',shell:'cmd'}),
      'No alternate unapproved effect parameters may accompany UIA query');
check(permit('windows_native_open_url',{url:'https://www.youtube.com/@MrBeast/videos'}),'native browser opens public site');
check(!permit('windows_native_open_url',{url:'http://127.0.0.1:20189'}),'native browser rejects local backend');
check(permit('windows_native_action',{elementId:'f'.repeat(24),action:'set_text',text:'hello'}),'UIA text tool accepts bounded input');
check(!permit('windows_native_action',{elementId:'f'.repeat(24),action:'set_text',text:'X'.repeat(700)}),'UIA text oversized denied');
check(!permit('windows_native_action',{elementId:'wrong',action:'invoke'}),'invalid UIA token denied');
check(!permit('windows_native_action',{elementId:'f'.repeat(24),action:'focus',text:'leak'}),'invalid UIA action payload denied');
env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL='0';
check(!permit('windows_native_inspect',{}),'UIA inspection opt-out enforced');
check(!permit('windows_native_action',{elementId:'f'.repeat(24),action:'invoke'}),'UIA action opt-out enforced');
console.log(`NATIVE_WIRING: ${n}/${n} PASS (offline, no Windows runtime)`);
