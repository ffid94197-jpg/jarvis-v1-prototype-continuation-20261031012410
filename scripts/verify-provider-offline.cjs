/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @next/next/no-assign-module-variable */
/* Offline tests only: no API keys or network access required. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');

const sourceRoot = path.join(__dirname, '..', 'src', 'lib', 'agent', 'core');
function load(file) {
  const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {exports:module.exports,module,require,URL,AbortSignal,TextDecoder,Uint8Array,Buffer,process,console,fetch,Error,JSON,Number,String}, { filename:file });
  return module.exports;
}
const {getCompatibleSettings, createCompatibleBridge} = load('compatProvider.ts');
const {adviseTask} = load('laya.ts');
let count=0;
async function test(name, fn){ await fn(); ++count; console.log('PASS',name); }
function env(url='https://models.example.com/v1') {return {JARVIS_COMPAT_BASE_URL:url,JARVIS_COMPAT_MODEL:'test-model',JARVIS_COMPAT_API_KEY:'test-only-key'};}
function mockResponse(status, chunks) {
  const stream = new ReadableStream({start(controller){for(const s of chunks)controller.enqueue(new TextEncoder().encode(s));controller.close();}});
  return new Response(stream,{status,headers:{'content-type':'application/json'}});
}
(async ()=>{
  await test('provider public https config',()=>{const s=getCompatibleSettings(env());assert.equal(s.url,'https://models.example.com/v1/chat/completions');});
  for(const invalid of ['http://models.example.com','https://localhost/v1','https://127.0.0.1','https://192.168.1.2/v1','https://bad.internal','https://user:pw@models.example.com','https://models.example.com/?token=x']) {
    await test('provider rejects '+invalid,()=>{assert.throws(()=>getCompatibleSettings(env(invalid)));});
  }
  await test('model completion sends key to exact endpoint without redirects',async()=>{
    const settings=getCompatibleSettings(env());
    const bridge=createCompatibleBridge(settings,async(url,opts)=>{
      assert.equal(url,settings.url); assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer test-only-key');
      const body=JSON.parse(opts.body);assert.equal(body.model,'test-model');assert.equal(body.stream,false);
      return mockResponse(200,[JSON.stringify({choices:[{message:{content:'{"action":"final","answer":"ok"}'}}]})]);
    });
    const content=await bridge.complete([{role:'user',content:'hello'}]);assert.ok(content.includes('"final"'));
  });
  await test('stream fragmented across chunks is joined correctly',async()=>{
    const events=['data: {"choices":[{"delta":{"content":"HEL"}}]}\n\n','data: {"choices":[{"delta":{"content":"LO"}}]}\n\n','data: [DONE]\n\n'];
    const payload=events.join('');const splits=[payload.slice(0,24),payload.slice(24,71),payload.slice(71)];
    const bridge=createCompatibleBridge(getCompatibleSettings(env()),async()=>mockResponse(200,splits));const got=[];
    const full=await bridge.report([{role:'user',content:'hello'}],d=>got.push(d));
    assert.equal(full,'HELLO');assert.deepEqual(got,['HEL','LO']);
  });
  await test('model error carries normalized status without secrets',async()=>{
    const bridge=createCompatibleBridge(getCompatibleSettings(env()),async()=>mockResponse(429,['{"error":"secret"}']));
    await assert.rejects(()=>bridge.complete([{role:'user',content:'hi'}]),e=>e.status===429&&!e.message.includes('secret'));
  });
  await test('laya is deterministic bounded advisory',()=>{
    assert.equal(adviseTask('create a folder').classification,'file_task');
    assert.equal(adviseTask('private password').privacy,'requires_user_review');
    assert.equal(adviseTask('open app').classification,'computer_use');
    assert.equal(adviseTask('search the web').classification,'research');
  });
  console.log(`${count}/${count} offline provider and LAYA checks PASS`);
})().catch(e=>{console.error(e);process.exitCode=1;});
