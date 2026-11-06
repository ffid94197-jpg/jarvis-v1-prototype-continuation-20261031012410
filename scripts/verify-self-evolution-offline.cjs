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

(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"jarvis-self-evolution-"));
  const owner="self-evolution-owner-"+crypto.randomUUID();
  const taskA="00000000-0000-4000-8000-000000000001";
  const taskB="00000000-0000-4000-8000-000000000002";
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
    assert.equal(diagnosis.safety.readOnly,true);
    assert.equal(diagnosis.safety.rawObjectivesExposed,false);
    assert.equal(JSON.stringify(diagnosis).includes("TypeError: value"),false);
    assert.equal(JSON.stringify(diagnosis).includes("Guardian denied"),false);

    const repair=await import("../src/lib/agent/evolution/repairVault.mjs");
    const file=path.join(process.env.JARVIS_AGENT_WORKSPACE,"src","feature.js");
    const original="const value = 1;\n";
    await fs.writeFile(file,original,"utf8");
    const sha=crypto.createHash("sha256").update(original).digest("hex");
    const staged=await repair.stageRepair(owner,{
      path:"src/feature.js",expectedSha256:sha,oldText:"const value = 1;",
      newText:"const value = 2;",
      diagnosis:"Repeated runtime failure was reproduced and the exact safe source span was inspected.",
    },{taskId:taskA});
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
    },{taskId:taskA});
    await assert.rejects(repair.autoApplyRepair(owner,second.id,taskA),/one automatic repair per task/i);
    assert.equal(await fs.readFile(secondFile,"utf8"),"const second = 1;\n");

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
    assert.ok(guardian.includes('"evolution_diagnose"'));
    assert.ok(guardian.includes('"evolution_repair_apply"'));
    assert.ok(executor.includes('request.action==="diagnose"'));
    assert.ok(executor.includes('request.action==="auto_apply_repair"'));
    assert.ok(effects.includes('"evolution_repair_apply"'));
    assert.ok(effects.includes('eff.tool === "evolution_skill_learn"'));
    assert.ok(effects.includes("completedWithEvolutionResidue"));
    assert.ok(loop.includes("learnFromCompletedTask"));
    assert.ok(loop.includes("selfDiagnosisInjected"));
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
