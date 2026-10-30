/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname,'../src/lib/agent/core');
function compiled(filename, deps) {
  const m={exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path.join(root,filename),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(js,{exports:m.exports,require:(name)=>deps[name] || require(name),console,Error});
  return m.exports;
}
const errs=compiled('modelErrors.ts',{});
const {withLocalQuotaFallback}=compiled('localFallback.ts',{'./modelErrors':errs});
const quota=()=>Object.assign(new Error('quota exhausted'),{status:429});
let n=0;
async function test(name,fn){await fn();n++;console.log('PASS',name)}
(async()=>{
 await test('falls back on planning 429',async()=>{let cloud=0,local=0;const b=withLocalQuotaFallback({complete:async()=>{cloud++;throw quota()},report:async()=>''},{complete:async()=>{local++;return 'local'},report:async()=>''});assert.equal(await b.complete([]),'local');assert.equal(cloud,1);assert.equal(local,1)});
 await test('sticks to local after successful failover',async()=>{let cloud=0;const b=withLocalQuotaFallback({complete:async()=>{cloud++;throw quota()},report:async()=>''},{complete:async()=> 'ok',report:async()=> 'stream'});await b.complete([]);assert.equal(await b.complete([]),'ok');assert.equal(cloud,1);assert.equal(await b.report([],()=>{}),'stream')});
 await test('never falls back on authentication errors',async()=>{let local=0;const b=withLocalQuotaFallback({complete:async()=>{throw Object.assign(new Error('401'),{status:401})},report:async()=>''},{complete:async()=>{local++;return ''},report:async()=>''});await assert.rejects(()=>b.complete([]));assert.equal(local,0)});
 await test('quota during stream before data can fall back',async()=>{const b=withLocalQuotaFallback({complete:async()=>'',report:async()=>{throw quota()}},{complete:async()=>'',report:async(_m,onDelta)=>{onDelta('local');return 'local'}});let output='';assert.equal(await b.report([],c=>output+=c),'local');assert.equal(output,'local')});
 await test('never mixes streams after partial data',async()=>{let local=0, out='';const b=withLocalQuotaFallback({complete:async()=>'',report:async(_m,onDelta)=>{onDelta('cloud');throw quota()}},{complete:async()=>'',report:async()=>{local++;return 'local'}});await assert.rejects(()=>b.report([],d=>out+=d));assert.equal(out,'cloud');assert.equal(local,0)});
 await test('failed local fallback does not mask failure',async()=>{const b=withLocalQuotaFallback({complete:async()=>{throw quota()},report:async()=>''},{complete:async()=>{throw Error('local offline')},report:async()=>''});await assert.rejects(()=>b.complete([]),/local offline/)});
 console.log(`LOCAL_FALLBACK: ${n}/${n} passed (offline simulation)`);
})().catch(e=>{console.error(e);process.exitCode=1});
