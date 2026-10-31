"use strict";
/**
 * Ten-minute Windows-only, read-only JARVIS core stress test.
 * Input prompts are *randomly sampled unchanged* from the CC0 public
 * https://github.com/f/prompts.chat dataset. No prompts are synthesized.
 * No model credentials, live tool execution, desktop control or network
 * requests to arbitrary URLs from the prompts. Each prompt is untrusted data.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const ts=require("typescript");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const {setTimeout:delay}=require("node:timers/promises");

const SOURCE_URL="https://raw.githubusercontent.com/f/prompts.chat/main/prompts.csv";
const DURATION_MS=600_000;
const root=path.resolve(__dirname,"..");
const reportFile=path.join(root,"stress-evidence","internet-prompts-10min.json");

function hash(input){return crypto.createHash("sha256").update(input).digest("hex");}
function load(relative,mocks={}){
  const source=fs.readFileSync(path.join(root,relative),"utf8");
  const js=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const m={exports:{}};
  const run=vm.runInNewContext("(function(require,module,exports){"+js+"\n})",{},{timeout:5000});
  run(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),m,m.exports);
  return m.exports;
}
function parseCSV(input){
  const rows=[];let current=[],field="",quoted=false;
  const push=()=>{current.push(field);field="";if(current.some(x=>x.trim()))rows.push(current);current=[];};
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"'){quoted=true;}
    else if(ch===","){current.push(field);field="";}
    else if(ch==="\n"){push();}
    else if(ch!=="\r"){field+=ch;}
  }
  if(quoted)throw Error("Unterminated CSV quotation");
  if(field||current.length)push();
  return rows;
}
async function fetchCorpus(){
  const response=await fetch(SOURCE_URL,{
    headers:{"user-agent":"JARVIS-Windows-Offline-Stress/1.0"},
    signal:AbortSignal.timeout(60000)
  });
  if(!response.ok)throw Error("Internet prompt corpus download failed: HTTP "+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<10000||bytes.length>20_000_000)throw Error("Unexpected external corpus size: "+bytes.length);
  const csv=parseCSV(bytes.toString("utf8").replace(/^\uFEFF/,""));
  const header=csv.shift().map(x=>x.toLowerCase().trim());
  const index=header.findIndex(x=>x==="prompt");
  if(index<0)throw Error("Public source has no prompt column: "+header.join(","));
  const prompts=csv.map(r=>r[index]).filter(p=>typeof p==="string"&&p.trim().length>=30);
  if(prompts.length<100)throw Error("Not enough original externally sourced prompts: "+prompts.length);
  return {prompts,byteLength:bytes.length,sha256:hash(bytes),header};
}
async function main(){
  if(process.platform!=="win32")throw Error("Real Windows runner required");
  const goal=load("src/lib/agent/core/goalPlanner.ts");
  const autonomy=load("src/lib/agent/core/autonomyGate.ts");
  const intent=load("src/lib/agent/core/requestIntent.ts",{
    "./autonomyGate":autonomy,"./goalPlanner":goal
  });
  const inventory=load("src/lib/agent/core/inventoryIntegrity.ts");
  const task=load("src/lib/agent/core/taskInputGate.ts",{"./inventoryIntegrity":inventory});
  const loopSource=fs.readFileSync(path.join(root,"src/lib/agent/core/loop.ts"),"utf8");
  const fragment=loopSource.slice(
    loopSource.indexOf("interface PlanAction {"),
    loopSource.indexOf("// ——— journal + settlement helpers")
  );
  if(!fragment.startsWith("interface PlanAction {"))throw Error("Planner parser source not found");
  const compiled=ts.transpileModule(fragment,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const plannerMod={exports:{}};
  const fn=vm.runInNewContext("(function(module,exports){"+compiled+"\n})",{},{timeout:5000});
  fn(plannerMod,plannerMod.exports);
  const {parsePlannerDecision}=plannerMod.exports;

  fs.mkdirSync(path.dirname(reportFile),{recursive:true});
  const report={
    schemaVersion:1,
    purpose:"read-only random-public-prompt Windows core stress test",
    durationRequestedSeconds:600,
    runnerPlatform:process.platform,
    offline:true,
    liveProviderInvoked:false,
    realPcOrMinecraftControlled:false,
    source:SOURCE_URL,
    corpus:null,
    startedAt:null,
    endedAt:null,
    elapsedSeconds:0,
    iterations:0,
    accepted:0,
    rejected400:0,
    rejected413:0,
    rejected422:0,
    intentActionable:0,
    intentConversational:0,
    longHorizon:0,
    externalEvidenceRequired:0,
    plannerJsonAppearances:0,
    uniquePromptCount:0,
    randomSampleHashes:[],
    failures:[]
  };
  let failureCount=0;
  try{
    const corpus=await fetchCorpus();
    report.corpus={sha256:corpus.sha256,bytes:corpus.byteLength,rows:corpus.prompts.length,headers:corpus.header};
    console.log("INTERNET_CORPUS source="+SOURCE_URL+
      " sha256="+corpus.sha256+" rows="+corpus.prompts.length+" bytes="+corpus.byteLength);
    const sampled=new Set();
    const sampledHashes=[];
    const start=performance.now();
    report.startedAt=new Date().toISOString();
    let nextLog=start+15000;
    while(performance.now()-start<DURATION_MS){
      const idx=crypto.randomInt(corpus.prompts.length);
      const original=corpus.prompts[idx]; // VERBATIM from external CSV
      const digest=hash(original);
      sampled.add(idx);
      if(sampledHashes.length<32)sampledHashes.push({row:idx,sha256:digest});
      report.iterations++;
      try{
        const prepared=task.prepareTaskObjective(original);
        const trimmed=original.trim();
        assert.ok(prepared&&typeof prepared.ok==="boolean");
        if(prepared.ok){
          assert.equal(prepared.objective,trimmed,"API mutated internet prompt");
          assert.equal(prepared.inventoryRows,inventory.parseInventorySource(trimmed)?.rows.length??0);
          report.accepted++;
        }else{
          assert.ok([400,413,422].includes(prepared.status));
          assert.equal(Object.hasOwn(prepared,"objective"),false,"Rejected request retained executable objective");
          if(prepared.status===400)report.rejected400++;
          if(prepared.status===413)report.rejected413++;
          if(prepared.status===422)report.rejected422++;
        }
        const classification=intent.classifyRequestIntent(original);
        assert.ok(classification.kind==="actionable"||classification.kind==="conversational");
        assert.equal(typeof classification.reason,"string");
        if(classification.kind==="actionable")report.intentActionable++;
        else report.intentConversational++;
        const needsEvidence=goal.requiresExternalActionEvidence(original);
        const needsPlan=goal.requiresGoalPlan(original);
        assert.equal(typeof needsEvidence,"boolean");
        assert.equal(typeof needsPlan,"boolean");
        if(needsEvidence)report.externalEvidenceRequired++;
        if(needsPlan)report.longHorizon++;
        if(needsEvidence&&classification.kind==="conversational")
          throw Error("Evidence-requiring request misclassified conversational");
        // Strict planner parsing is exercised with untrusted prompt text.
        // Even if source contains valid JSON, nothing is executed.
        const decision=parsePlannerDecision(original);
        if(decision){
          assert.ok(decision.action==="tool"||decision.action==="final");
          report.plannerJsonAppearances++;
        }
        // Model-directed goal-plan string must quote the original text, not execute it.
        if(report.iterations%19===0){
          const serialized=goal.goalPlanRequest(original);
          assert.ok(serialized.includes(JSON.stringify(original.slice(0,2200))));
        }
      }catch(error){
        failureCount++;
        if(report.failures.length<60)
          report.failures.push({iteration:report.iterations,row:idx,sha256:digest,
            message:String(error&&error.message||error).slice(0,500)});
      }
      if(performance.now()>=nextLog){
        console.log("STRESS_PROGRESS seconds="+
          ((performance.now()-start)/1000).toFixed(1)+
          " iterations="+report.iterations+
          " unique="+sampled.size+
          " failures="+failureCount);
        nextLog+=15000;
      }
      await delay(20); // bounded CPU load while maintaining continuous testing
    }
    report.elapsedSeconds=Math.round((performance.now()-start)/1000*100)/100;
    report.endedAt=new Date().toISOString();
    report.uniquePromptCount=sampled.size;
    report.randomSampleHashes=sampledHashes;
    report.totalFailures=failureCount;
    assert.ok(report.elapsedSeconds>=600,"Stress duration below ten minutes");
    assert.ok(report.iterations>100,"Insufficient continuous iterations");
    assert.ok(sampled.size>=Math.min(100,corpus.prompts.length),"Insufficient random diversity");
    if(failureCount)throw Error("Stress assertions failed in "+failureCount+" iterations");
    console.log("INTERNET_PROMPT_STRESS_10MIN PASS seconds="+report.elapsedSeconds+
      " iterations="+report.iterations+" unique="+sampled.size+
      " sourceSha256="+corpus.sha256);
  }finally{
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+"\n","utf8");
    console.log("STRESS_EVIDENCE_PATH="+reportFile);
  }
}
main().catch(err=>{
 console.error("INTERNET_PROMPT_STRESS_10MIN FAILED",String(err&&err.stack||err));
 process.exitCode=1;
});
