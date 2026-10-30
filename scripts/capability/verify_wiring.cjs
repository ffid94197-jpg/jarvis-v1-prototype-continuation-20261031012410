'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('src/lib/agent/windows/policy.ts');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics.length,0);
const extracted={};vm.runInNewContext(compiled.outputText,{exports:extracted,URL,process:{platform:'win32',env:{JARVIS_WINDOWS_AGENT_ENABLED:'1',JARVIS_LOCAL_DEV_NO_LOGIN:'1',JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_WINDOWS_COMPANION_TOKEN:'a'.repeat(64)},cwd:()=>root},require},{timeout:500});
const validate=extracted.validateDesktopTool;let checks=0;
function ok(value,label){assert(value,label);checks++}
const good=validate('windows_find_capability',{goal:'Edit a family photo'});
ok(good.ok && good.prepared.operation==='find_capability' && good.prepared.goal==='Edit a family photo','policy admits a bounded goal');
for(const goal of ['', ' x ', 'x'.repeat(251),'edit\nall','edit\u0000bad',null,{}]){
 const r=validate('windows_find_capability',{goal});ok(!r.ok,'reject malformed goal '+String(goal).slice(0,20));
}
for(const p of ['src/lib/agent/guardian/guardian.ts','src/lib/agent/tools/executor.ts','src/lib/agent/core/prompts.ts']){
 ok(read(p).includes('windows_find_capability'),p+' wiring');
}
ok(read('windows-companion/companion.py').includes("elif operation == 'find_capability'"),'companion dispatch');
ok(read('windows-companion/companion.py').includes("elif op == 'find_capability'"),'companion validation');
ok(!read('src/lib/agent/core/effects.ts').includes('"windows_find_capability"'),'discovery is read-only, no effect admission');
const c=read('windows-companion/capability_discovery.py');
ok(c.includes('def _registry_apps(') && c.includes('def inventory('),'installed-app inventory');
ok(c.includes('launchable\':False') && c.includes('verifiedExecuted\':False'),'unverified work cannot be claimed completed');
console.log(`CAPABILITY_WIRING: ${checks}/${checks} PASS`);
