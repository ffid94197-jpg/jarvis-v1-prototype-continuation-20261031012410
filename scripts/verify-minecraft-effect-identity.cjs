#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const p=path.join(__dirname,'../src/lib/agent/core/effects.ts');
const code=ts.transpileModule(fs.readFileSync(p,'utf8'),{fileName:p,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const m={exports:{}};
new Function('require','module','exports',code)((n)=>{
 if(n==='@/lib/db')return {db:{}};
 if(n==='../guardian/policy')return {};
 if(n==='./faults')return {injectedFault:()=>null};
 return require(n);
},m,m.exports);
const {isEffectfulToolInvocation,effectIdentity,STEP_SCOPED_EFFECTS}=m.exports;
let n=0;
function check(msg,fn){fn();n++;console.log('PASS',msg);}
for(const cmd of ['status','inventory','observe','auto_status','inspect_block']){
 check(`minecraft ${cmd} read-only and refreshable`,()=>assert.equal(isEffectfulToolInvocation('minecraft_companion_command',{command:cmd}),false));
}
for(const cmd of ['collect_wood','auto_goal','auto_stop','move','dig_block','craft_item','place_block','stay']){
 check(`minecraft ${cmd} treated as real effect`,()=>assert.equal(isEffectfulToolInvocation('minecraft_companion_command',{command:cmd}),true));
}
check('unknown Minecraft command fails closed as effect',()=>assert.equal(isEffectfulToolInvocation('minecraft_companion_command',{command:'unsupported'}),true));
check('filesystem write still effectful',()=>assert.equal(isEffectfulToolInvocation('write_file',{path:'x',content:'y'}),true));
check('filesystem read stays non-effectful',()=>assert.equal(isEffectfulToolInvocation('read_file',{path:'x'}),false));
check('gameplay command identities are step-scoped',()=>assert.equal(STEP_SCOPED_EFFECTS.has('minecraft_companion_command'),true));
const a={tool:'minecraft_companion_command',args:{command:'collect_wood'}};
check('same step retry retains identical effect identity',()=>assert.equal(effectIdentity(1,{...a,stepSeq:4}),effectIdentity(1,{...a,stepSeq:4})));
check('next Minecraft step receives distinct effect identity',()=>assert.notEqual(effectIdentity(1,{...a,stepSeq:4}),effectIdentity(1,{...a,stepSeq:5})));
check('other stable file writes still dedupe',()=>assert.equal(effectIdentity(1,{tool:'write_file',args:{path:'a',content:'b'},stepSeq:3}),effectIdentity(1,{tool:'write_file',args:{content:'b',path:'a'},stepSeq:9})));
const loop=fs.readFileSync(path.join(__dirname,'../src/lib/agent/core/loop.ts'),'utf8');
check('agent loop invokes effect-aware admission',()=>assert.match(loop,/if \(isEffectfulToolInvocation\(tool,args\)\)/));
check('agent loop skips old replay dedupe for step-scoped actions',()=>assert.match(loop,/!STEP_SCOPED_EFFECTS\.has\(tool\)/));
console.log(`MINECRAFT_EFFECT_IDENTITY ${n}/${n} PASS (offline policy code)`);
