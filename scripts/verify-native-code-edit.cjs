/* Real temporary-filesystem checks of guarded native coding edits.
 * Does not run commands or access owner files. Works without GitHub Actions.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-native-edit-'));
const workspace=path.join(temp,'workspace');
const outside=path.join(temp,'outside');
fs.mkdirSync(workspace);fs.mkdirSync(outside);
const oldWorkspace=process.env.JARVIS_AGENT_WORKSPACE;
process.env.JARVIS_AGENT_WORKSPACE=workspace;
function load(rel,mocks={}) {
 const source=fs.readFileSync(path.join(root,rel),'utf8');
 const compiled=ts.transpileModule(source,{fileName:rel,compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true
 }}).outputText;
 const mod={exports:{}};
 const req=(id)=>Object.prototype.hasOwnProperty.call(mocks,id)?mocks[id]:require(id);
 new Function('require','module','exports','process','Buffer',compiled)(
  req,mod,mod.exports,process,Buffer);
 return mod.exports;
}
const policy=load('src/lib/agent/guardian/policy.ts');
const edits=load('src/lib/agent/tools/edit.ts',{'../guardian/policy':policy});
const effects=load('src/lib/agent/core/effects.ts',{
  '@/lib/db':{db:{}},
  '../guardian/policy':policy,
  './faults':{injectedFault:()=>null},
});
let audited=[];
const guardian=load('src/lib/agent/guardian/guardian.ts',{
  '@/lib/db':{db:{auditLog:{create:async ({data})=>{audited.push(data);return {id:'record'}}}}},
  './policy':policy,
  '../windows/policy':{validateDesktopTool:()=>({ok:false,reason:'no desktop action in this test'})},
  '../tools/localProjectBuild':{prepareLocalProjectBuild:async()=>({ok:false,reason:'sandbox build disabled in this fixture'})}
});
let checks=0;
async function check(label,action) {
 await action();checks++;console.log('PASS',label);
}
function digest(t){return crypto.createHash('sha256').update(t,'utf8').digest('hex')}
async function run() {
 await check('Target edit is a real known Guardian tool',async()=>{
   assert.ok(guardian.GUARDIAN_KNOWN_TOOLS.includes('edit_file'));
 });
 await check('Edit is admitted as a durable effect, never an untracked write',async()=>{
   assert.equal(effects.isEffectfulToolInvocation('edit_file',
     {path:'source.ts',expectedSha256:'a'.repeat(64)}),true);
 });
 const file=path.join(workspace,'source.ts');
 await fsp.writeFile(file,'const answer = 41;\n');
 const req={path:'source.ts',expectedSha256:digest('const answer = 41;\n'),
  oldText:'41',newText:'42'};
 let prepared;
 await check('Only exact scoped and fully hashed edit is authorized',async()=>{
   const a=await guardian.authorizeToolCall({taskId:'native-edit',ownerId:'owner'},'edit_file',req);
   assert.equal(a.verdict,'allow');
   assert.equal(a.prepared.path,file);
   prepared=a.prepared;
 });
 await check('Actually edits one occurrence, atomically stages and verifies bytes',async()=>{
   const x=await edits.editWorkspaceTextFile(prepared);
   assert.ok(x.ok,x.error);
   assert.equal(await fsp.readFile(file,'utf8'),'const answer = 42;\n');
   assert.equal(x.detail.sha256,digest('const answer = 42;\n'));
 });
 await check('Stale observed SHA refuses overwrite',async()=>{
   const x=await edits.editWorkspaceTextFile(prepared);
   assert.equal(x.ok,false);assert.match(x.error,/stale/i);
 });
 await check('Ambiguous find refuses unintended edits',async()=>{
   const x=await edits.editWorkspaceTextFile({...prepared,
    expectedSha256:digest('const answer = 42;\n'),oldText:' ',newText:'_'});
   assert.equal(x.ok,false);
   assert.equal(await fsp.readFile(file,'utf8'),'const answer = 42;\n');
 });
 await check('Null-byte, path traversal and invalid hashes denied by Guardian',async()=>{
   for(const x of [
    {...req,path:'../outside/other.ts'},
    {...req,expectedSha256:'guessed'},
    {...req,newText:'bad\0str'},
    {...req,unexpected:'shell'}
   ]){
    const verdict=await guardian.authorizeToolCall({taskId:'n',ownerId:'owner'},'edit_file',x);
    assert.equal(verdict.verdict,'deny');
   }
 });
 await check('Cancellation blocks mutation',async()=>{
   const x=await edits.editWorkspaceTextFile({...prepared,
    expectedSha256:digest('const answer = 42;\n'),oldText:'42',newText:'99'},()=>true);
   assert.equal(x.ok,false);
   assert.equal(await fsp.readFile(file,'utf8'),'const answer = 42;\n');
 });
 await check('Duplicate target is not guessed',async()=>{
   await fsp.writeFile(file,'test test');
   const x=await edits.editWorkspaceTextFile({...prepared,expectedSha256:digest('test test'),
    oldText:'test',newText:'fixed'});
   assert.equal(x.ok,false);
   assert.equal(await fsp.readFile(file,'utf8'),'test test');
 });
 await check('Oversized resulting edit does not modify file',async()=>{
   const x=await edits.editWorkspaceTextFile({...prepared,expectedSha256:digest('test test'),
    oldText:'test test',newText:'z'.repeat(policy.MAX_WRITE_BYTES+1)});
   assert.equal(x.ok,false);
   assert.equal(await fsp.readFile(file,'utf8'),'test test');
 });
 await check('Binary input is rejected',async()=>{
   await fsp.writeFile(file,Buffer.from([255,0,13,10]));
   const hash=crypto.createHash('sha256').update(Buffer.from([255,0,13,10])).digest('hex');
   const x=await edits.editWorkspaceTextFile({...prepared,expectedSha256:hash,
    oldText:'not present',newText:'bad'});
   assert.equal(x.ok,false);
 });
 await check('No contents or secrets leaked into Guardian audit',async()=>{
   const redacted=JSON.stringify(audited);
   assert.ok(redacted.includes('redacted'));
   assert.ok(!redacted.includes('const answer'));
   assert.ok(!redacted.includes('newText":"42'));
 });
 let symlinked=false;
 try{
   const external=path.join(outside,'secret.ts');
   await fsp.writeFile(external,'SECRET');
   await fsp.symlink(outside,path.join(workspace,'external'),process.platform==='win32'?'junction':'dir');
   symlinked=true;
   const result=await guardian.authorizeToolCall({taskId:'n',ownerId:'owner'},'edit_file',
    {...req,path:'external/secret.ts',expectedSha256:digest('SECRET')});
   assert.equal(result.verdict,'deny');
   checks++;console.log('PASS symlink breakout refused before executor');
 } catch(err) {
   if(symlinked)throw err;
   console.log('SKIP OS denied symlink fixture; separate path containment tests required');
 }
 console.log('NATIVE_EDIT_REAL_FS',checks,'PASS. Not a live Windows/LLM acceptance.');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 if(oldWorkspace===undefined)delete process.env.JARVIS_AGENT_WORKSPACE;
 else process.env.JARVIS_AGENT_WORKSPACE=oldWorkspace;
 fs.rmSync(temp,{recursive:true,force:true});
});
