'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const src=fs.readFileSync(path.join(root,'src/lib/agent/core/capabilityIntent.ts'),'utf8');
const transpiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(transpiled.diagnostics.length,0);
const exp={};vm.runInNewContext(transpiled.outputText,{exports:exp},{timeout:500});const decide=exp.directCapabilityDiscovery;
let n=0;
for(const x of ['I need to edit','Edit my photo','I want to edit a PDF','Make a video','Design an architecture flowchart','Trim a movie clip','Find an app to edit a song','Which app can edit audio?','Please fix my program']){
 const got=decide(x);assert(got && got.tool==='windows_find_capability' && got.args.goal===x,x);n++;
}
for(const x of ['What is video editing?', 'How do I edit photos?', 'Explain the history of PDF','Open Windows Settings','Hello there','Apple is tasty','  x  ','create\nbat','x'.repeat(251)]){
 assert.equal(decide(x),null,x);n++;
}
const loop=fs.readFileSync(path.join(root,'src/lib/agent/core/loop.ts'),'utf8');
assert(loop.includes('directCapabilityDiscovery(objective)') && loop.includes('!localIntent ? directCapabilityDiscovery(objective)'), 'capability search is a deterministic first step');n++;
console.log(`CAPABILITY_DIRECT_INTENT: ${n}/${n} PASS`);
