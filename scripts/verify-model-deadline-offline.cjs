#!/usr/bin/env node
'use strict';
// Offline contract checks, no provider network and no actual elapsed wait.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'src/lib/agent/core/modelDeadline.ts'),'utf8');
const out=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('module','exports',out)(mod,mod.exports);
const choose=mod.exports.modelRequestDeadlineMs;
let checks=0;
function equal(value,expected){assert.equal(value,expected);checks++;}
function rejects(value){assert.throws(()=>choose({JARVIS_MODEL_REQUEST_TIMEOUT_MS:value}),/30000 to 300000/);checks++;}
equal(choose({}),90000);
for(const i of [30000,45000,60000,90000,120000,180000,240000,300000])equal(choose({JARVIS_MODEL_REQUEST_TIMEOUT_MS:String(i)}),i);
for(const i of ['0','29000','300001','999999','NaN','90s','90000.0','-90000',' 90000','90000 ','1e5'])rejects(i);
const files=['src/lib/agent/core/modelProvider.ts','src/lib/agent/core/compatProvider.ts','src/lib/agent/models/bridge.ts'];
for(const f of files){
 const t=fs.readFileSync(path.join(root,f),'utf8');
 assert.ok(t.includes('AbortSignal.timeout(modelRequestDeadlineMs())'),f);
 checks++;
}
const error=fs.readFileSync(path.join(root,'src/lib/agent/core/modelErrors.ts'),'utf8');
assert.ok(error.includes('TimeoutError'));checks++;
console.log(`MODEL_TIMEOUT_POLICY ${checks}/${checks} PASS (offline bounds and integration wiring)`);
