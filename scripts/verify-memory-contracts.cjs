/* eslint-disable @typescript-eslint/no-require-imports */
// Offline contract tests: no DB, no credentials, no external network.
// This checks input/provenance policy but NOT Prisma migrations/API E2E.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/agent/memory/contracts.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, require, Date, console };
vm.runInNewContext(js, sandbox, { filename: 'contracts.js' });
const {parseMemoryInput, parseWorldInput, parseDeleteInput, boundedListLimit} = sandbox.exports;
let passed = 0;
function test(label, fn) { fn(); passed++; console.log('PASS', label); }
function rejects(fn) { assert.throws(fn); }
test('valid private opt-in record',()=>assert.deepEqual(JSON.parse(JSON.stringify(parseMemoryInput({key:'project.version',content:'v1'}))),{key:'project.version',content:'v1',dataClass:'LOCAL_PRIVATE'}));
test('explicit cloud classification remains explicit',()=>assert.equal(parseMemoryInput({key:'mode',content:'x',dataClass:'CLOUD_APPROVED'}).dataClass,'CLOUD_APPROVED'));
test('no empty memory key',()=>rejects(()=>parseMemoryInput({key:'',content:'ok'})));
test('no path/payload separators in memory key',()=>rejects(()=>parseMemoryInput({key:'x/y',content:'ok'})));
test('no oversized memory content',()=>rejects(()=>parseMemoryInput({key:'x',content:'a'.repeat(4001)})));
test('no forged cloud class',()=>rejects(()=>parseMemoryInput({key:'x',content:'ok',dataClass:'SECRET_EXPORTED'})));
test('no untrusted verified provenance',()=>rejects(()=>parseWorldInput({subject:'file',predicate:'exists',value:'true',source:'VERIFIED_TOOL'})));
test('no model forged provenance',()=>rejects(()=>parseWorldInput({subject:'file',predicate:'exists',value:'true',source:'MODEL_HYPOTHESIS'})));
test('user reporting stays unverified',()=>{const x=parseWorldInput({subject:'app',predicate:'open',value:'yes'});assert.equal(x.source,'USER_REPORTED');assert.equal(x.confidence,0.5)});
test('staleness expiry is bounded',()=>rejects(()=>parseWorldInput({subject:'a',predicate:'b',value:'c',expiresInSeconds:0})));
test('timestamp is based on current observation',()=>{const x=parseWorldInput({subject:'a',predicate:'b',value:'c',expiresInSeconds:120},new Date(1000));assert.equal(x.expiresAt.getTime(),121000)});
test('deletion denies invalid kinds',()=>rejects(()=>parseDeleteInput({kind:'task',id:'12345678'})));
test('deletion validates record identity',()=>rejects(()=>parseDeleteInput({kind:'memory',id:'../../etc/passwd'})));
test('list limit capped',()=>assert.equal(boundedListLimit('999999'),100));
test('list default',()=>assert.equal(boundedListLimit('bad'),20));
console.log(`MEMORY_CONTRACTS: ${passed}/${passed} passed (offline policy only)`);
