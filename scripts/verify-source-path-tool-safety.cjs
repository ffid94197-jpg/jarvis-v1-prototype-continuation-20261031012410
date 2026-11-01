'use strict';
// Actual on-disk Windows source file creation, plus pure Guardian path rules.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const compile=(p)=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-real-files-'));
process.env.JARVIS_AGENT_WORKSPACE=tmp;
const policyModule={exports:{}};
vm.runInNewContext(compile('src/lib/agent/guardian/policy.ts'),
 {module:policyModule,exports:policyModule.exports,require,process,Buffer,console}, {timeout:3000});
const policy=policyModule.exports;
assert.equal(policy.isSourceFileTarget('src/App.tsx'),true);
assert.equal(policy.isSourceFileTarget('src/foo.json'),true);
assert.equal(policy.isSourceFileTarget('src'),false);
assert.equal(policy.isSourceFileTarget('.github'),false);
const exe={exports:{}};
const imports={
 '../guardian/policy':policy,
 '../windows/bridge':{companionAction:async()=>({ok:false})},
 '../windows/policy':{},
 '../guardian/guardian':{}
};
const req=(id)=>imports[id]??require(id);
vm.runInNewContext(compile('src/lib/agent/tools/executor.ts'),
 {module:exe,exports:exe.exports,require:req,process,Buffer,console,setTimeout,clearTimeout},
 {timeout:3500});
(async()=>{
 const rel='src/components/App.tsx';
 const abs=path.join(tmp,...rel.split('/'));
 const r=await exe.exports.executeTool('test','write_file',
 {verdict:'allow',prepared:{path:abs,relPath:rel,content:'export const App = () => "actual source";'}});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(fs.readFileSync(abs,'utf8'),'export const App = () => "actual source";');
 assert.ok(fs.statSync(path.dirname(abs)).isDirectory());
 const e=await exe.exports.executeTool('test','write_file',
 {verdict:'allow',prepared:{path:path.dirname(abs),relPath:'src/components',content:'bad'}});
 assert.equal(e.ok,false);
 assert.match(e.error,/TARGET_IS_DIRECTORY/);
 const pass=policy.resolveScopedPath('../outside.tsx');
 assert.equal(pass.ok,false);
 console.log('SOURCE_FILE_WINDOWS_REAL_FS_PASS 8 assertions');
})().catch(err=>{console.error(err);process.exitCode=1}).finally(()=>fsp.rm(tmp,{recursive:true,force:true}));
