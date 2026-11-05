#!/usr/bin/env node
"use strict";
/**
 * Offline-only syntax & functional fixture for owner-approved Skill Forge
 * Core intent and queue. No Core runtime, GUI, Minecraft, GitHub Actions,
 * model providers or production workspace are accessed.
 */
const assert=require("node:assert/strict");
const path=require("node:path");
const fs=require("node:fs");
const vm=require("node:vm");
const crypto=require("node:crypto");
const ts=require("typescript");
const root=path.resolve(__dirname,"..");
const files=[
  "src/lib/agent/core/skillIntent.ts",
  "src/lib/agent/core/approvedSkillQueue.ts",
  "src/lib/agent/core/loop.ts",
  "src/lib/agent/guardian/guardian.ts",
  "src/lib/agent/tools/executor.ts"
];
for(const rel of files){
  const s=fs.readFileSync(path.join(root,rel),"utf8");
  const ast=ts.createSourceFile(rel,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.deepEqual(ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),
    [],"TypeScript parser errors in "+rel);
}
function load(rel,requireStub){
  const source=fs.readFileSync(path.join(root,rel),"utf8");
  const transformed=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,
    esModuleInterop:true}});
  const mod={exports:{}};
  const context=vm.createContext({module:mod,exports:mod.exports,require:requireStub,console});
  new vm.Script(transformed.outputText,{filename:rel}).runInContext(context);
  return mod.exports;
}
const intent=load(files[0],()=>{throw Error("Unexpected import");});
const id="sk_"+crypto.randomBytes(16).toString("hex");
const cmd="Run my approved JARVIS skill "+id+' with inputs {"folder":"reports"}';
assert.equal(intent.directApprovedSkillIntent(cmd).args.id,id);
assert.equal(intent.directApprovedSkillIntent(cmd).args.inputs.folder,"reports");
assert.equal(intent.directApprovedSkillIntent("Show my skill "+id),null);
assert.equal(intent.directApprovedSkillIntent(
  "Run my approved JARVIS skill "+id+' with inputs {"folder":{}}'),null);
assert.equal(intent.directApprovedSkillIntent(
  "Run my approved JARVIS skill "+id+' with inputs {"constructor":0}'),null);
const queue=load(files[1],name=>{
  if(name==="../guardian/guardian")
    return {GUARDIAN_KNOWN_TOOLS:["read_file","write_file","evolution_skill_run"]};
  throw Error("Unexpected dependency "+name);
});
const good={ok:true,detail:{
  skillId:id,digest:"a".repeat(64),name:"Owner report",
  advisoryOnly:true,executed:false,authorizationGranted:false,
  requiresPerStepGuardianAudit:true,requiresCoreDurableEffectAdmission:true,
  stageCount:1,steps:[{tool:"read_file",args:{path:"reports"},why:"Inspect actual file"}]
}};
assert.equal(queue.acceptedSkillQueue(id,good).next,0);
assert.equal(queue.acceptedSkillQueue(id,good).steps[0].tool,"read_file");
assert.equal(queue.acceptedSkillQueue("sk_"+"0".repeat(32),good),null);
assert.equal(queue.acceptedSkillQueue(id,{...good,detail:{...good.detail,digest:"wrong"}}),null);
assert.equal(queue.acceptedSkillQueue(id,{...good,detail:{...good.detail,
  steps:[{tool:"evolution_skill_run",args:{id},why:"Recursive self invocation"}]}}),null);
assert.equal(queue.acceptedSkillQueue(id,{...good,detail:{...good.detail,
  requiresPerStepGuardianAudit:false}}),null);
console.log("PASS: deterministic skill command, bounded approved queue, no nested run, TypeScript grammar");
console.log("This does NOT establish live Windows, Guardian, filesystem, or provider acceptance.");
