#!/usr/bin/env node
"use strict";
/**
 * Offline self-evolution contract. Uses only a disposable temp workspace and
 * fake owner-scoped Prisma receipts. No model provider, Windows, Minecraft,
 * GitHub Actions, external process, or production owner files are touched.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
let typescript;
try{typescript=require("typescript");}
catch{throw new Error("Self-repair verification requires the production TypeScript dependency; run npm ci before this contract.");}
assert.equal(typeof typescript.createSourceFile,"function",
  "Production TypeScript dependency must expose the source parser");

(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"jarvis-self-evolution-"));
  const owner="self-evolution-owner-"+crypto.randomUUID();
  const taskA="00000000-0000-4000-8000-000000000001";
  const taskB="00000000-0000-4000-8000-000000000002";
  const taskC="00000000-0000-4000-8000-000000000003";
  try{
    process.env.JARVIS_EVOLUTION_ROOT=path.join(root,"vault");
    process.env.JARVIS_AGENT_WORKSPACE=path.join(root,"workspace");
    process.env.JARVIS_SELF_REPAIR_AUTO_APPLY="0";
    await fs.mkdir(path.join(process.env.JARVIS_AGENT_WORKSPACE,"src"),{recursive:true});

    const {diagnoseOwnerRuntime}=await import("../src/lib/agent/evolution/diagnostics.mjs");
    const diagnosis=await diagnoseOwnerRuntime(owner,{
      agentTask:{findMany:async args=>{
        assert.equal(args.where.ownerId,owner);
        return [
          {id:taskA,status:"failed",stepsUsed:1,updatedAt:new Date("2026-11-06T10:00:00Z"),createdAt:new Date()},
          {id:taskB,status:"effect_unknown",stepsUsed:2,updatedAt:new Date("2026-11-06T11:00:00Z"),createdAt:new Date()},
        ];
      }},
      agentStep:{findMany:async()=>[
        {taskId:taskA,seq:1,kind:"tool_result",tool:"read_file",
          resultJson:JSON.stringify({ok:false,tool:"read_file",error:"TypeError: value is not a function"}),
          note:null,createdAt:new Date("2026-11-06T10:00:00Z")},
      ]},
      effectRecord:{findMany:async()=>[
        {taskId:taskB,status:"ADMITTED",tool:"write_file",admittedAt:new Date(),settledAt:null},
      ]},
      auditLog:{findMany:async()=>[
        {taskId:taskA,tool:"write_file",verdict:"DENY",reason:"Guardian denied",createdAt:new Date()},
      ]},
    });
    assert.equal(diagnosis.status,"diagnosed");
    assert.equal(diagnosis.summary.failedTasks,1);
    assert.equal(diagnosis.summary.uncertainTasks,1);
    assert.ok(diagnosis.patterns.some(x=>x.code==="RUNTIME_TYPE_ERROR"));
    assert.ok(diagnosis.patterns.some(x=>x.code==="UNCERTAIN_EFFECT"));
    assert.ok(diagnosis.patterns.some(x=>x.code==="AUTHORIZATION_DENIAL"));
    const runtimePattern=diagnosis.patterns.find(x=>x.code==="RUNTIME_TYPE_ERROR");
    const runtimePatternId=runtimePattern.id;
    assert.match(runtimePatternId,/^diag_[0-9a-f]{20}$/);
    assert.ok(runtimePattern.taskRefs.includes(taskA.slice(-8)));
    assert.equal(diagnosis.safety.readOnly,true);
    assert.equal(diagnosis.safety.rawObjectivesExposed,false);
    assert.equal(JSON.stringify(diagnosis).includes("TypeError: value"),false);
    assert.equal(JSON.stringify(diagnosis).includes("Guardian denied"),false);

    const repair=await import("../src/lib/agent/evolution/repairVault.mjs");
    for(const safe of ["staged","approved","verified","rolled_back"])
      assert.equal(repair.isRepairOutcomeUncertain(safe),false,`safe repair state ${safe}`);
    for(const uncertain of ["applying","applied","rolling_back","verification_failed","effect_unknown","unknown",null])
      assert.equal(repair.isRepairOutcomeUncertain(uncertain),true,`uncertain repair state ${uncertain}`);
    const file=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","feature.js");
    const original="const value = 1;\n";
    await fs.writeFile(file,original,"utf8");
    const sha=crypto.createHash("sha256").update(original).digest("hex");
    const staged=await repair.stageRepair(owner,{
      path:"src/feature.js",expectedSha256:sha,oldText:"const value = 1;",
      newText:"const value = 2;",
      diagnosis:"Repeated runtime failure was reproduced and the exact safe source span was inspected.",
    },{taskId:taskA,diagnosisPatternId:runtimePatternId});
    assert.equal(staged.state,"staged");
    await assert.rejects(repair.autoApplyRepair(owner,staged.id,taskA),/disabled by owner policy/);
    assert.equal(await fs.readFile(file,"utf8"),original);

    process.env.JARVIS_SELF_REPAIR_AUTO_APPLY="1";
    const applied=await repair.autoApplyRepair(owner,staged.id,taskA);
    assert.equal(applied.state,"verified");
    assert.equal(applied.verified,true);
    assert.equal(applied.verificationLevel,"static_syntax_only");
    assert.equal(applied.runtimeTestsExecuted,false);
    assert.equal(await fs.readFile(file,"utf8"),"const value = 2;\n");
    assert.equal(applied.approvalMode,"bounded_auto_policy");

    const secondFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","second.js");
    await fs.writeFile(secondFile,"const second = 1;\n","utf8");
    const secondOriginal=await fs.readFile(secondFile);
    const secondSha=crypto.createHash("sha256").update(secondOriginal).digest("hex");
    const second=await repair.stageRepair(owner,{
      path:"src/second.js",expectedSha256:secondSha,oldText:"const second = 1;",
      newText:"const second = 2;",
      diagnosis:"A second independently observed source issue requires a bounded correction.",
    },{taskId:taskA,diagnosisPatternId:runtimePatternId});
    await assert.rejects(repair.autoApplyRepair(owner,second.id,taskA),/one automatic repair per task/i);
    assert.equal(await fs.readFile(secondFile,"utf8"),"const second = 1;\n");

    const noPatternFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","no-pattern.js");
    const noPatternOriginal="const noPattern = 1;\n";
    await fs.writeFile(noPatternFile,noPatternOriginal,"utf8");
    const noPatternSha=crypto.createHash("sha256").update(noPatternOriginal).digest("hex");
    const noPattern=await repair.stageRepair(owner,{
      path:"src/no-pattern.js",expectedSha256:noPatternSha,oldText:"const noPattern = 1;",
      newText:"const noPattern = 2;",
      diagnosis:"A textual diagnosis without a repairable diagnosis pattern must not auto-apply.",
    },{taskId:taskB});
    await assert.rejects(repair.autoApplyRepair(owner,noPattern.id,taskB),/current repairable diagnosis pattern/i);
    assert.equal(await fs.readFile(noPatternFile,"utf8"),noPatternOriginal);

    const autoBrokenFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","auto-broken.js");
    const autoBrokenOriginal="const autoBroken = true;\n";
    await fs.writeFile(autoBrokenFile,autoBrokenOriginal,"utf8");
    const autoBrokenSha=crypto.createHash("sha256").update(autoBrokenOriginal).digest("hex");
    const autoBroken=await repair.stageRepair(owner,{
      path:"src/auto-broken.js",expectedSha256:autoBrokenSha,oldText:"true",newText:"=",
      diagnosis:"diag_"+runtimePatternId.slice(5)+": an intentionally invalid candidate tests preflight denial.",
    },{taskId:taskC,diagnosisPatternId:runtimePatternId});
    await assert.rejects(repair.autoApplyRepair(owner,autoBroken.id,taskC),
      /candidate failed static syntax preflight/i);
    assert.equal((await repair.getRepair(owner,autoBroken.id)).state,"staged");
    assert.equal(await fs.readFile(autoBrokenFile,"utf8"),autoBrokenOriginal);

    const brokenFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","broken.js");
    const brokenOriginal="const flag = true;\n";
    await fs.writeFile(brokenFile,brokenOriginal,"utf8");
    const brokenSha=crypto.createHash("sha256").update(brokenOriginal).digest("hex");
    const broken=await repair.stageRepair(owner,{
      path:"src/broken.js",expectedSha256:brokenSha,oldText:"true",newText:";",
      diagnosis:"The proposed replacement is intentionally malformed to verify safe rollback behaviour.",
    });
    await repair.approveRepair(owner,broken.id);
    assert.equal((await repair.applyRepair(owner,broken.id)).state,"applied");
    const verification=await repair.verifyRepair(owner,broken.id);
    assert.equal(verification.state,"rolled_back");
    assert.equal(verification.verified,false);
    assert.equal(verification.automaticRollback,true);
    assert.equal(await fs.readFile(brokenFile,"utf8"),brokenOriginal);

    // A corrupt backup must quarantine the repair rather than claim rollback.
    const backupRiskFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","backup-risk.js");
    const backupRiskOriginal="const backupRisk = true;\n";
    await fs.writeFile(backupRiskFile,backupRiskOriginal,"utf8");
    const backupRiskSha=crypto.createHash("sha256").update(backupRiskOriginal).digest("hex");
    const backupRisk=await repair.stageRepair(owner,{
      path:"src/backup-risk.js",expectedSha256:backupRiskSha,oldText:"true",newText:";",
      diagnosis:"A deliberately invalid edit verifies backup-integrity quarantine.",
    });
    await repair.approveRepair(owner,backupRisk.id);
    await repair.applyRepair(owner,backupRisk.id);
    const backupOwnerKey=crypto.createHash("sha256").update(owner).digest("hex").slice(0,40);
    const backupPath=path.join(process.env.JARVIS_EVOLUTION_ROOT,backupOwnerKey,backupRisk.id+".original");
    await fs.writeFile(backupPath,"corrupt backup","utf8");
    const backupRiskResult=await repair.verifyRepair(owner,backupRisk.id);
    assert.equal(backupRiskResult.state,"effect_unknown");
    assert.equal(backupRiskResult.effectUnknown,true);
    assert.equal(await fs.readFile(backupRiskFile,"utf8"),"const backupRisk = ;;\n");

    // Simulate a process crash after the file replacement but before the
    // repair ledger advances from "applying" to "applied".
    const crashFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","crash.js");
    const crashOriginal="const crashValue = 1;\n";
    await fs.writeFile(crashFile,crashOriginal,"utf8");
    const crashSha=crypto.createHash("sha256").update(crashOriginal).digest("hex");
    const crashCandidate=await repair.stageRepair(owner,{
      path:"src/crash.js",expectedSha256:crashSha,oldText:"const crashValue = 1;",
      newText:"const crashValue = 3;",
      diagnosis:"An exact bounded source defect was observed before the simulated crash.",
    });
    await repair.approveRepair(owner,crashCandidate.id);
    await repair.applyRepair(owner,crashCandidate.id);
    const ownerKey=crypto.createHash("sha256").update(owner).digest("hex").slice(0,40);
    const ledgerPath=path.join(process.env.JARVIS_EVOLUTION_ROOT,ownerKey,"repairs.json");
    const ledger=JSON.parse(await fs.readFile(ledgerPath,"utf8"));
    const crashRecord=ledger.repairs.find(x=>x.id===crashCandidate.id);
    crashRecord.state="applying";
    delete crashRecord.appliedAt;
    await fs.writeFile(ledgerPath,JSON.stringify(ledger),"utf8");
    const recovered=await repair.recoverRepair(owner,crashCandidate.id);
    assert.equal(recovered.kind,"verified");
    assert.equal(recovered.repair.state,"verified");
    assert.equal(await fs.readFile(crashFile,"utf8"),"const crashValue = 3;\n");

    // Simulate a crash after a failed static verification but before rollback.
    const verifyCrashFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","verify-crash.js");
    const verifyCrashOriginal="const verifyCrash = 1;\n";
    await fs.writeFile(verifyCrashFile,verifyCrashOriginal,"utf8");
    const verifyCrashSha=crypto.createHash("sha256").update(verifyCrashOriginal).digest("hex");
    const verifyCrashCandidate=await repair.stageRepair(owner,{
      path:"src/verify-crash.js",expectedSha256:verifyCrashSha,oldText:"const verifyCrash = 1;",
      newText:"const verifyCrash = 2;",
      diagnosis:"A valid patch is used to simulate interrupted failed-verification recovery.",
    });
    await repair.approveRepair(owner,verifyCrashCandidate.id);
    await repair.applyRepair(owner,verifyCrashCandidate.id);
    const verifyCrashLedger=JSON.parse(await fs.readFile(ledgerPath,"utf8"));
    const verifyCrashRecord=verifyCrashLedger.repairs.find(x=>x.id===verifyCrashCandidate.id);
    verifyCrashRecord.state="verification_failed";
    verifyCrashRecord.verification={passed:false,kind:"syntax"};
    await fs.writeFile(ledgerPath,JSON.stringify(verifyCrashLedger),"utf8");
    const verifyCrashRecovery=await repair.recoverRepair(owner,verifyCrashCandidate.id);
    assert.equal(verifyCrashRecovery.kind,"rolled_back");
    assert.equal(verifyCrashRecovery.repair.state,"rolled_back");
    assert.equal(await fs.readFile(verifyCrashFile,"utf8"),verifyCrashOriginal);

    // Simulate a crash after durable apply admission but before the file write.
    const noWriteFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","no-write.js");
    const noWriteOriginal="const noWrite = 1;\n";
    await fs.writeFile(noWriteFile,noWriteOriginal,"utf8");
    const noWriteSha=crypto.createHash("sha256").update(noWriteOriginal).digest("hex");
    const noWriteCandidate=await repair.stageRepair(owner,{
      path:"src/no-write.js",expectedSha256:noWriteSha,oldText:"const noWrite = 1;",
      newText:"const noWrite = 2;",
      diagnosis:"An exact candidate is admitted before the simulated pre-write crash.",
    });
    await repair.approveRepair(owner,noWriteCandidate.id);
    const noWriteLedger=JSON.parse(await fs.readFile(ledgerPath,"utf8"));
    noWriteLedger.repairs.find(x=>x.id===noWriteCandidate.id).state="applying";
    await fs.writeFile(ledgerPath,JSON.stringify(noWriteLedger),"utf8");
    const noWriteRecovery=await repair.recoverRepair(owner,noWriteCandidate.id);
    assert.equal(noWriteRecovery.kind,"rolled_back");
    assert.equal(noWriteRecovery.repair.state,"rolled_back");
    assert.equal(await fs.readFile(noWriteFile,"utf8"),noWriteOriginal);

    // A third-party edit is never overwritten by crash recovery.
    const externalFile=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","external.js");
    const externalOriginal="const externalValue = 1;\n";
    await fs.writeFile(externalFile,externalOriginal,"utf8");
    const externalSha=crypto.createHash("sha256").update(externalOriginal).digest("hex");
    const externalCandidate=await repair.stageRepair(owner,{
      path:"src/external.js",expectedSha256:externalSha,oldText:"const externalValue = 1;",
      newText:"const externalValue = 2;",
      diagnosis:"A source repair candidate is staged for external-writer safety testing.",
    });
    await repair.approveRepair(owner,externalCandidate.id);
    await repair.applyRepair(owner,externalCandidate.id);
    await fs.writeFile(externalFile,"const externalValue = 99;\n","utf8");
    const externalLedger=JSON.parse(await fs.readFile(ledgerPath,"utf8"));
    externalLedger.repairs.find(x=>x.id===externalCandidate.id).state="effect_unknown";
    await fs.writeFile(ledgerPath,JSON.stringify(externalLedger),"utf8");
    const externalRecovery=await repair.recoverRepair(owner,externalCandidate.id);
    assert.equal(externalRecovery.kind,"external_change");
    assert.equal(await fs.readFile(externalFile,"utf8"),"const externalValue = 99;\n");

    await assert.rejects(repair.stageRepair(owner,{
      path:"../outside.js",expectedSha256:brokenSha,oldText:"true",newText:"false",
      diagnosis:"A traversal attempt must be rejected before any filesystem read.",
    }),/safe workspace-relative/);
    await assert.rejects(repair.stageRepair(owner,{
      path:"src/lib/agent/core/loop.ts",expectedSha256:brokenSha,oldText:"x",newText:"y",
      diagnosis:"Protected Core orchestration must never be self-patched.",
    }),/protected configuration\/security file/);

    const guardian=await fs.readFile(path.join(__dirname,"../src/lib/agent/guardian/guardian.ts"),"utf8");
    const executor=await fs.readFile(path.join(__dirname,"../src/lib/agent/tools/executor.ts"),"utf8");
    const effects=await fs.readFile(path.join(__dirname,"../src/lib/agent/core/effects.ts"),"utf8");
    const loop=await fs.readFile(path.join(__dirname,"../src/lib/agent/core/loop.ts"),"utf8");
    const prompts=await fs.readFile(path.join(__dirname,"../src/lib/agent/core/prompts.ts"),"utf8");
    const repairSource=await fs.readFile(path.join(__dirname,"../src/lib/agent/evolution/repairVault.mjs"),"utf8");
    assert.ok(guardian.includes('"evolution_diagnose"'));
    assert.ok(guardian.includes('"evolution_repair_apply"'));
    assert.ok(executor.includes('request.action==="diagnose"'));
    assert.ok(executor.includes('request.action==="auto_apply_repair"'));
    assert.ok(executor.includes("currentPattern"));
    assert.ok(executor.includes("requiresSourceInspection"));
    assert.ok(executor.includes("taskRefs.includes(taskRef)"));
    assert.ok(executor.includes("isRepairOutcomeUncertain"));
    assert.ok(executor.includes('getRepairState(ownerId,request.id)'));
    assert.ok(repairSource.includes("Automatic repair syntax preflight unavailable"));
    assert.ok(repairSource.includes("candidate failed static syntax preflight"));
    assert.ok(repairSource.includes('"verification_failed"'));
    assert.ok(effects.includes('"verification_failed"'));
    assert.ok(effects.includes('"evolution_repair_apply"'));
    assert.ok(effects.includes('eff.tool === "evolution_skill_learn"'));
    assert.ok(effects.includes("recoverRepair"));
    assert.ok(loop.includes('result.detail?.effectUnknown === true ? "EFFECT_UNKNOWN" : "FAILED"'));
    assert.ok(loop.includes('if(result.detail?.effectUnknown===true)'));
    assert.ok(effects.includes("completedWithEvolutionResidue"));
    assert.ok(loop.includes("learnFromCompletedTask"));
    assert.ok(loop.includes("selfDiagnosisInjected"));
    assert.ok(loop.includes("priorRuntimeDiagnosis"));
    assert.ok(loop.includes("Prior runtime self-diagnosis"));
    assert.ok(loop.includes('injectSelfDiagnosis("planner_invalid_json")'));
    assert.ok(loop.includes('injectSelfDiagnosis("provider_failure")'));
    assert.ok(loop.includes('kind:"self_diagnosis"'));
    assert.ok(loop.includes("planner invalid JSON; raw model output not persisted"));
    assert.ok(prompts.includes("JARVIS_SELF_REPAIR_AUTO_APPLY=1"));

    console.log("PASS: owner-scoped read-only diagnosis and redaction");
    console.log("PASS: automatic learning wiring remains Core/effect-journal owned");
    console.log("PASS: opt-in bounded repair, one patch/task, exact SHA, syntax verification");
    console.log("PASS: syntax failure triggers exact-SHA rollback");
    console.log("PASS: traversal and protected control-plane edits are denied");
    console.log("LIMIT: this offline contract does not run the full project build, unit suites, Windows runtime, or live field acceptance.");
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
