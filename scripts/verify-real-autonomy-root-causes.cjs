"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),ts=require("typescript");
const root=path.resolve(__dirname,"..");
function load(file,deps={}){
 const s=fs.readFileSync(path.join(root,file),"utf8");
 const code=ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 const fn=vm.runInNewContext("(function(require,module,exports){"+code+"\n})",{},{timeout:4000});
 fn(name=>name in deps?deps[name]:require(name),module,module.exports);
 return module.exports;
}
const pathGate={
 resolveScopedPath(p){if(typeof p!=="string"||p.includes("..")||path.isAbsolute(p))return {ok:false};return {ok:true,rel:p,abs:path.join(root,"agent-workspace",p)};},
 assertWithinRoot:async()=>({ok:true})
};
const v=load("src/lib/agent/core/verifier.ts",{"fs/promises":require("node:fs/promises"),"../guardian/policy":pathGate,"@/lib/db":{db:{effectRecord:{findMany:async()=>[]}}},"./inventoryIntegrity":{}});
const g=load("src/lib/agent/core/goalPlanner.ts");
const loop=fs.readFileSync(path.join(root,"src/lib/agent/core/loop.ts"),"utf8");
const prompts=fs.readFileSync(path.join(root,"src/lib/agent/core/prompts.ts"),"utf8");
const checks=[
 ["generic folder structure is NOT a path",()=>assert.equal(v.extractPredicates("Build a production-ready React website. Include a clean folder structure and backend.").length,0)],
 ["explicit named folder accepted",()=>assert.ok(v.extractPredicates("Create a folder named inventory_v5_live_test").some(p=>p.relPath==="inventory_v5_live_test"))],
 ["explicit bare create folder accepted",()=>assert.ok(v.extractPredicates("Create folder project_v1").some(p=>p.relPath==="project_v1"))],
 ["quoted folder accepted",()=>assert.ok(v.extractPredicates('Build a file and create folder "tvs-showroom"').some(p=>p.relPath==="tvs-showroom"))],
 ["directory layout not interpreted literally",()=>assert.equal(v.extractPredicates("Build a production-ready website with directory layout guidance.").length,0)],
 ["goal planning preserves all 3954 original chars",()=>{
  const obj="Build a production-ready website and deploy it. "+("a".repeat(3906));
  const request=g.goalPlanRequest(obj);assert.ok(request.includes(JSON.stringify(obj)));assert.ok(g.requiresGoalPlan(obj));
 }],
 ["long actionable work needs real proof",()=>assert.equal(g.requiresExternalActionEvidence("Build an application "+("b".repeat(6000))),true)],
 ["invalid JSON repair does NOT seed folder named name",()=>assert.doesNotMatch(loop,/INVALID FORMAT\. Reply[^\n]+create_folder/)],
 ["catalog forbids sample paths as actual tasks",()=>assert.match(prompts,/Never copy placeholder paths/)],
 ["full-stack app cannot pass from a folder",async()=>{
  const result=await v.arbitrateCompletion({taskId:"unused",toolAssisted:true,objective:"Build a production-ready React showroom website including frontend, backend and database."});
  assert.equal(result.verdict,"partial");assert.match(result.predicateLines.join(" "),/SOFTWARE_ACCEPTANCE_UNVERIFIED/);
 }]
];
(async()=>{let ok=0;for(const [name,fn] of checks){await fn();console.log("PASS "+name);ok++}console.log("LIVE_AUTONOMY_ROOT_CAUSES "+ok+"/"+checks.length+" PASS")})().catch(e=>{console.error(e.stack);process.exitCode=1});
