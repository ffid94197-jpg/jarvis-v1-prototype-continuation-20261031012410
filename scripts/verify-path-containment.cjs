/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-verify-'));
const root=path.join(dir,'workspace'),outside=path.join(dir,'outside');
fs.mkdirSync(root);fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside,'secret.txt'),'DISPOSABLE FIXTURE');
fs.writeFileSync(path.join(root,'ok.txt'),'ok');
fs.symlinkSync(outside,path.join(root,'escape'),process.platform === 'win32' ? 'junction' : 'dir');
const old=process.env.JARVIS_AGENT_WORKSPACE;
process.env.JARVIS_AGENT_WORKSPACE=root;
const src=fs.readFileSync(path.join(__dirname,'../src/lib/agent/guardian/policy.ts'),'utf8');
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const mod={exports:{}};
vm.runInNewContext(compiled,{exports:mod.exports,require,process,console,Buffer});
const {resolveScopedPath,assertWithinRoot}=mod.exports;
(async()=>{
 let n=0;async function check(label,fn){await fn();n++;console.log('PASS',label)}
 await check('regular workspace file allowed',async()=>{const p=resolveScopedPath('ok.txt');assert(p.ok);assert((await assertWithinRoot(p.abs)).ok)});
 await check('symlink outward refused',async()=>{const p=resolveScopedPath('escape/secret.txt');assert(p.ok);const a=await assertWithinRoot(p.abs);assert.equal(a.ok,false)});
 await check('nonexistent descendant of outward symlink refused',async()=>{const p=resolveScopedPath('escape/new.txt');assert(p.ok);assert.equal((await assertWithinRoot(p.abs)).ok,false)});
 await check('parent traversal refused before file access',async()=>assert.equal(resolveScopedPath('../outside/secret.txt').ok,false));
 console.log(`PATH_CONTAINMENT: ${n}/${n} passed (real temporary filesystem)`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(old===undefined)delete process.env.JARVIS_AGENT_WORKSPACE;else process.env.JARVIS_AGENT_WORKSPACE=old;fs.rmSync(dir,{recursive:true,force:true})});
