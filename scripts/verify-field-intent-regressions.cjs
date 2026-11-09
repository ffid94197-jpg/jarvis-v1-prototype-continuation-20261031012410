#!/usr/bin/env node
'use strict';
/**
 * Offline regression for owner-observed Windows field defects:
 * 1) "create test.txt in D:\web" must not write workspace/test.txt;
 * 2) "crate a text file in desktop" (owner typo) must not redirect output;
 * 3) read-only Windows discovery must not require Minecraft spawn intent.
 * No real network, OS calls, writes, or API credentials.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const auditRows=[];
const effects=[{
  status:'SETTLED',tool:'write_file',
  argsJson:JSON.stringify({path:'test.txt',content:''}),
  receiptJson:JSON.stringify({ok:true,tool:'write_file',detail:{path:'test.txt',verified:true}}),
}];
const db={
  auditLog:{create:async ({data})=>{auditRows.push(data);return data;}},
  effectRecord:{findMany:async()=>effects},
};
const inventory={
  parseInventorySource:()=>null,
  inventoryArtifactKind:()=>null,
  verifyInventoryCsv:()=>null,
  verifyInventoryReport:()=>null,
};
const scoped={
  resolveScopedPath:(p)=>({ok:true,rel:p,abs:path.join(root,'agent-workspace',String(p))}),
  assertWithinRoot:async()=>({ok:true}),
};
function load(relative,imports){
  const name=path.join(root,relative);
  const compiled=ts.transpileModule(fs.readFileSync(name,'utf8'),{
    fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,esModuleInterop:true},reportDiagnostics:true,
  });
  const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,'syntax: '+relative);
  const mod={exports:{}};
  const req=(id)=>Object.prototype.hasOwnProperty.call(imports,id)?imports[id]:require(id);
  new Function('require','module','exports',compiled.outputText)(req,mod,mod.exports);
  return mod.exports;
}
const gate=load('src/lib/agent/core/taskInputGate.ts',{'./inventoryIntegrity':inventory});
const {unsupportedFileDestination,prepareTaskObjective}=gate;
for(const input of [
  'can u create a test.txt file in D:\\web location',
  'create D:/web/test.txt',
  'make file \\\\SERVER\\share\\test.txt',
  'crate a text file in desktop',
  'create a text file on my Desktop',
]){
  const result=prepareTaskObjective(input);
  assert.equal(result.ok,false,input);
  assert.equal(result.code,'FILE_TARGET_OUTSIDE_WORKSPACE',input);
}
for(const input of [
 'create test.txt in my permitted workspace',
 'create a folder called field_core',
]){
  assert.equal(prepareTaskObjective(input).ok,true,input);
}
assert.equal(unsupportedFileDestination('open terminal'),null);
const verifier=load('src/lib/agent/core/verifier.ts',{
  '@/lib/db':{db},'../guardian/policy':scoped,
  './inventoryIntegrity':inventory,'./taskInputGate':gate,
});
const guardian=load('src/lib/agent/guardian/guardian.ts',{
  '@/lib/db':{db},
  '../windows/policy':{validateDesktopTool:(tool,args)=>({
    ok:true,prepared:{operation:tool==='windows_find_capability'?'find_capability':'minecraft_spawn',
      ...(tool==='windows_find_capability'?{goal:args.goal}:{})},
  })},
  '../tools/localProjectBuild':{prepareLocalProjectBuild:async()=>({ok:false})},
  './policy':scoped,
});
(async()=>{
  const settled=await verifier.arbitrateCompletion({
    taskId:randomUUID(),
    objective:'can u create a test.txt file in D:\\web location',
    toolAssisted:true,
  });
  assert.equal(settled.verdict,'partial','workspace receipt cannot verify D:\\web');
  assert.match(settled.predicateLines.join(' '),/FILE_TARGET_OUTSIDE_WORKSPACE/);
  const ctx={taskId:randomUUID(),ownerId:'owner-verified-in-core'};
  const found=await guardian.authorizeToolCall(ctx,'windows_find_capability',{goal:'open terminal'});
  assert.equal(found.verdict,'allow','ordinary discovery does not need Minecraft spawn');
  assert.ok(found.auditId && found.auditedTaskId===ctx.taskId,'audited discovery');
  const denied=await guardian.authorizeToolCall(ctx,'minecraft_companion_spawn',{});
  assert.equal(denied.verdict,'deny','spawn is not implied by Windows discovery');
  assert.match(denied.reason,/explicit.*spawn intent/i);
  const spawned=await guardian.authorizeToolCall({...ctx,coreSpawnIntent:true},'minecraft_companion_spawn',{});
  assert.equal(spawned.verdict,'allow','explicit Core-authored spawn path remains available');
  assert.ok(spawned.auditId && auditRows.some(x=>x.id===spawned.auditId));
  console.log('FIELD_INTENT_REGRESSIONS PASS: external file targets blocked, verifier honest, Windows discovery allowed, spawn protected');
})().catch(e=>{console.error(e);process.exitCode=1;});
