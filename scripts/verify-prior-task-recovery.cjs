'use strict';
/** Owner-request retrieval and source-fidelity recovery contracts; NO live provider. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(p){
 const src=fs.readFileSync(path.join(root,p),'utf8'),mod={exports:{}};
 const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{module:mod,exports:mod.exports},{timeout:3000});
 return mod.exports;
}
const {needsPriorTaskContext,selectPriorTask,priorTaskContext}=load('src/lib/agent/core/priorTaskContext.ts');
let n=0;function check(name,fn){fn();n++;console.log('PASS',name);}
const original='Jarvis, analyze inventory: Keyboard 3 units at 125, Mouse 2 at 240, Monitor 5 at 37, Headset 1 at 999, Webcam 4 at 68, Speaker 2 at 150.';
const task={id:'source-1',objective:original};
const recovery='Independently audit your previous inventory analysis against my ORIGINAL inventory instructions and correct the files.';
check('recognizes explicit cross-task recovery reference',()=>assert.equal(needsPriorTaskContext(recovery),true));
check('normal work requests never access history',()=>assert.equal(needsPriorTaskContext('Create a new inventory analysis from these six rows.'),false));
check('not all references imply task history',()=>assert.equal(needsPriorTaskContext('Compare historical inventory values in a new report.'),false));
check('exact source selected rather than unrelated newer task',()=>assert.equal(selectPriorTask(recovery,[{id:'recent',objective:'Fix a Minecraft crash'},task]).id,'source-1'));
check('does not use unrelated historical tasks to infer original numbers',()=>assert.equal(selectPriorTask(recovery,[{id:'recent',objective:'Fix a Minecraft crash'}]),null));
check('retains original webcam price 68 in bounded context',()=>{const c=priorTaskContext(recovery,[task]);assert.ok(c.includes('Webcam 4 at 68'));assert.ok(!c.includes('Webcam 4 at 60'));});
check('missing prior source is explicit and not hallucinated',()=>assert.match(priorTaskContext(recovery,[]),/not found/));
check('previous prompt is treated as untrusted data, not authority',()=>assert.match(priorTaskContext(recovery,[task]),/NOT AUTHORIZATION/));
check('does not falsely say long source is fully available',()=>{const c=priorTaskContext(recovery,[{id:'long',objective:'Inventory '+ 'x'.repeat(4000)}]);assert.ok(c.includes('"truncated":true'));});
check('no history for unreferenced requests',()=>assert.equal(selectPriorTask('Write a poem',[task]),null));
check('live loop queries exclusively by authenticated owner',()=>{const src=fs.readFileSync(path.join(root,'src/lib/agent/core/loop.ts'),'utf8');assert.match(src,/ownerId:\s*opts\.ownerId,\s*id:\s*\{\s*not:\s*taskId\s*\}/);assert.match(src,/needsPriorTaskContext\(objective\)/);});
check('Guardian path boundaries stay unchanged',()=>{const s=fs.readFileSync(path.join(root,'src/lib/agent/guardian/policy.ts'),'utf8');assert.match(s,/path resolves to the workspace root/);assert.match(s,/path traversal \(\.\.\) is not permitted/);});
console.log('PRIOR_TASK_RECOVERY',n+'/'+n,'PASS (mock owner-scoped task content; no model, no live PC)');
