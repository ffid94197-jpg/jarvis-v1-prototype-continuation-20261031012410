#!/usr/bin/env node
"use strict";
/** Offline self-improvement contract. Uses disposable owner-scoped ledgers and fake Core receipts. */
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");

(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"jarvis-self-improvement-"));
  try{
    process.env.JARVIS_EVOLUTION_ROOT=root;
    const improvement=await import("../src/lib/agent/evolution/selfImprovement.mjs");
    const owner="improvement-owner-"+crypto.randomUUID();
    const otherOwner="improvement-other-"+crypto.randomUUID();
    const objective="Create the quarterly operations report";
    const skillId="sk_0123456789abcdef0123456789abcdef";
    const baselineIds=[
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
      "00000000-0000-4000-8000-000000000103"
    ];
    const candidateIds=[
      "00000000-0000-4000-8000-000000000111",
      "00000000-0000-4000-8000-000000000112",
      "00000000-0000-4000-8000-000000000113"
    ];
    for(const taskId of baselineIds){
      await improvement.recordTaskOutcome(owner,{
        taskId,objective,skillId:null,status:"completed",stepCount:10,
        elapsedMs:10000,failureCount:1,uncertainEffects:0,verified:true
      });
    }
    for(const taskId of candidateIds){
      await improvement.recordTaskOutcome(owner,{
        taskId,objective,skillId,status:"completed",stepCount:8,
        elapsedMs:9000,failureCount:0,uncertainEffects:0,verified:true
      });
    }
    const evaluated=await improvement.evaluateSkillPerformance(owner,skillId,objective);
    assert.equal(evaluated.status,"observed_improvement");
    assert.equal(evaluated.causalClaim,false);
    assert.equal(evaluated.baselineRuns,3);
    assert.equal(evaluated.candidateRuns,3);
    assert.equal(evaluated.baselineMedianFailures,1);
    assert.equal(evaluated.candidateMedianFailures,0);
    assert.equal(evaluated.approvalChanged,false);
    assert.equal(evaluated.skillModified,false);

    const duplicate=await improvement.recordTaskOutcome(owner,{
      taskId:candidateIds[0],objective,skillId,status:"completed",stepCount:8,
      elapsedMs:9000,failureCount:0,uncertainEffects:0,verified:true
    });
    assert.equal(duplicate.alreadyRecorded,true);
    await assert.rejects(improvement.recordTaskOutcome(owner,{
      taskId:candidateIds[0],objective,skillId,status:"completed",stepCount:9,
      elapsedMs:9000,failureCount:0,uncertainEffects:0,verified:true
    }),/immutable once recorded/);

    const regressionSkill="sk_abcdef0123456789abcdef0123456789";
    const regressionObjective="Complete the daily data sync";
    for(let i=0;i<3;i++){
      await improvement.recordTaskOutcome(owner,{
        taskId:"00000000-0000-4000-8000-00000000012"+i,
        objective:regressionObjective,skillId:null,status:"completed",stepCount:6,
        elapsedMs:6000,failureCount:0,uncertainEffects:0,verified:true
      });
      await improvement.recordTaskOutcome(owner,{
        taskId:"00000000-0000-4000-8000-00000000013"+i,
        objective:regressionObjective,skillId:regressionSkill,
        status:i===0?"completed":"failed",stepCount:8,elapsedMs:8000,
        failureCount:i===0?0:2,uncertainEffects:i===2?1:0,verified:i===0
      });
    }
    const regression=await improvement.evaluateSkillPerformance(owner,regressionSkill,regressionObjective);
    assert.equal(regression.status,"regression");
    assert.ok(regression.candidateMedianFailures>regression.baselineMedianFailures);
    assert.equal(regression.approvalChanged,false);

    const noSuccessOwner="unverified-candidate-"+crypto.randomUUID();
    const noSuccessSkill="sk_33333333333333333333333333333333";
    for(let i=0;i<3;i++){
      await improvement.recordTaskOutcome(noSuccessOwner,{
        taskId:"00000000-0000-4000-8000-00000000040"+i,
        objective:"Repair failing build",skillId:null,status:"failed",
        stepCount:40,elapsedMs:40000,failureCount:4,uncertainEffects:0,verified:false
      });
      await improvement.recordTaskOutcome(noSuccessOwner,{
        taskId:"00000000-0000-4000-8000-00000000041"+i,
        objective:"Repair failing build",skillId:noSuccessSkill,status:"failed",
        stepCount:1,elapsedMs:1000,failureCount:0,uncertainEffects:0,verified:false
      });
    }
    const noSuccess=await improvement.evaluateSkillPerformance(
      noSuccessOwner,noSuccessSkill,"Repair failing build");
    assert.equal(noSuccess.status,"no_verified_success",
      "A candidate that only fails cannot claim efficiency-based success");
    assert.equal(noSuccess.candidateSuccessRate,0);
    assert.equal(noSuccess.approvalChanged,false);

    const insufficient=await improvement.evaluateSkillPerformance(owner,
      "sk_fedcba9876543210fedcba9876543210","A task with no matched baseline");
    assert.equal(insufficient.status,"insufficient_evidence");

    const neutralSkill="sk_22222222222222222222222222222222";
    const neutralObjective="Check the same stable service health";
    for(let i=0;i<3;i++){
      await improvement.recordTaskOutcome(owner,{
        taskId:"00000000-0000-4000-8000-00000000014"+i,
        objective:neutralObjective,skillId:null,status:"completed",stepCount:5,
        elapsedMs:5000,failureCount:0,uncertainEffects:0,verified:true
      });
      await improvement.recordTaskOutcome(owner,{
        taskId:"00000000-0000-4000-8000-00000000015"+i,
        objective:neutralObjective,skillId:neutralSkill,status:"completed",
        stepCount:5,elapsedMs:5000,failureCount:0,uncertainEffects:0,verified:true
      });
    }
    const neutral=await improvement.evaluateSkillPerformance(owner,neutralSkill,neutralObjective);
    assert.equal(neutral.status,"no_material_improvement");

    const journalObjective="Read a report and summarize it";
    const journalSkill="sk_11111111111111111111111111111111";
    const journalTask="00000000-0000-4000-8000-000000000201";
    const journalDb={
      agentTask:{findFirst:async()=>({
        id:journalTask,ownerId:otherOwner,objective:journalObjective,status:"completed",
        createdAt:new Date("2026-11-07T10:00:00Z"),updatedAt:new Date("2026-11-07T10:00:04Z")
      })},
      agentStep:{findMany:async()=>[
        {seq:1,kind:"tool_call",tool:"evolution_skill_run",argsJson:JSON.stringify({id:journalSkill})},
        {seq:1,kind:"tool_result",tool:"evolution_skill_run",resultJson:JSON.stringify({
          ok:true,detail:{queueRequested:true,skillId:journalSkill,stageCount:1,steps:[{tool:"read_file"}]}
        })},
        {seq:2,kind:"tool_call",tool:"read_file",argsJson:JSON.stringify({path:"reports/q4.txt"})},
        {seq:2,kind:"tool_result",tool:"read_file",resultJson:JSON.stringify({ok:true,tool:"read_file"})}
      ]},
      effectRecord:{findMany:async()=>[]}
    };
    const journalResult=await improvement.recordTaskPerformanceFromJournal(
      otherOwner,journalTask,journalDb,"completed");
    assert.equal(journalResult.recorded,true);
    assert.equal(journalResult.skillId,journalSkill);
    assert.equal(journalResult.evidence.verified,true);
    assert.equal(journalResult.evaluation.status,"insufficient_evidence");

    const incompleteTask="00000000-0000-4000-8000-000000000202";
    const incompleteDb={
      agentTask:{findFirst:async()=>({
        id:incompleteTask,ownerId:otherOwner,objective:journalObjective,status:"completed",
        createdAt:new Date("2026-11-07T10:00:00Z"),updatedAt:new Date("2026-11-07T10:00:02Z")
      })},
      agentStep:{findMany:async()=>[
        {seq:1,kind:"tool_call",tool:"evolution_skill_run",argsJson:JSON.stringify({id:journalSkill})},
        {seq:1,kind:"tool_result",tool:"evolution_skill_run",resultJson:JSON.stringify({
          ok:true,detail:{queueRequested:true,skillId:journalSkill,stageCount:1,steps:[{tool:"read_file"}]}
        })}
      ]},
      effectRecord:{findMany:async()=>[]}
    };
    const incomplete=await improvement.recordTaskPerformanceFromJournal(
      otherOwner,incompleteTask,incompleteDb,"completed");
    assert.equal(incomplete.recorded,true);
    assert.equal(incomplete.evidence.verified,false);
    assert.equal((await improvement.getPerformanceSummary(otherOwner)).sampleCount,2);

    // Approved Forge skills can contain sixteen reviewed stages. Attribute
    // only if every durable execution receipt is matched unambiguously.
    const fullOwner="full-skill-owner-"+crypto.randomUUID();
    const fullTask="00000000-0000-4000-8000-000000000501";
    const fullSkill="sk_44444444444444444444444444444444";
    const fullSteps=[
      {seq:1,kind:"tool_call",tool:"evolution_skill_run",
        argsJson:JSON.stringify({id:fullSkill})},
      {seq:1,kind:"tool_result",tool:"evolution_skill_run",
        resultJson:JSON.stringify({ok:true,detail:{queueRequested:true,
          skillId:fullSkill,stageCount:16,
          steps:Array.from({length:16},()=>({tool:"read_file"}))}})},
      ...Array.from({length:16},(_,i)=>[
        {seq:i+2,kind:"tool_call",tool:"read_file",
          argsJson:JSON.stringify({path:"source/file"+i})},
        {seq:i+2,kind:"tool_result",tool:"read_file",
          resultJson:JSON.stringify({ok:true,tool:"read_file"})}
      ]).flat()
    ];
    const fullDb={
      agentTask:{findFirst:async()=>({id:fullTask,ownerId:fullOwner,
        objective:"Read sixteen authorized files",status:"completed",
        createdAt:new Date("2026-11-09T10:00:00Z"),
        updatedAt:new Date("2026-11-09T10:00:08Z")})},
      agentStep:{findMany:async()=>fullSteps},
      effectRecord:{findMany:async()=>[]}
    };
    const fullResult=await improvement.recordTaskPerformanceFromJournal(
      fullOwner,fullTask,fullDb,"completed");
    assert.equal(fullResult.evidence.verified,true,
      "All sixteen exactly paired approved stages must be attributable");
    assert.equal(fullResult.skillId,fullSkill);

    const duplicateOwner="duplicate-receipt-owner-"+crypto.randomUUID();
    const ambiguousTask="00000000-0000-4000-8000-000000000502";
    const ambiguousDb={
      agentTask:{findFirst:async()=>({id:ambiguousTask,ownerId:duplicateOwner,
        objective:"Read the requested file",status:"completed",
        createdAt:new Date("2026-11-09T10:00:00Z"),
        updatedAt:new Date("2026-11-09T10:00:02Z")})},
      agentStep:{findMany:async()=>[
        {seq:1,kind:"tool_call",tool:"read_file",argsJson:'{}'},
        {seq:1,kind:"tool_result",tool:"read_file",resultJson:'{"ok":true}'},
        {seq:1,kind:"tool_result",tool:"read_file",resultJson:'{"ok":true}'}
      ]},
      effectRecord:{findMany:async()=>[]}
    };
    const ambiguous=await improvement.recordTaskPerformanceFromJournal(
      duplicateOwner,ambiguousTask,ambiguousDb,"completed");
    assert.equal(ambiguous.evidence.verified,false,
      "Two identical receipt rows may not certify one external action");

    const summary=await improvement.getPerformanceSummary(owner);
    assert.equal(summary.sampleCount,18);
    assert.equal(summary.privacy.rawObjectivesStored,false);
    const ownerFolder=crypto.createHash("sha256").update(owner).digest("hex").slice(0,40);
    const ledger=await fs.readFile(path.join(root,ownerFolder,"performance.json"),"utf8");
    assert.equal(ledger.includes(objective),false);
    assert.equal(ledger.includes("reports/q4.txt"),false);

    const corruptOwner="corrupt-owner-"+crypto.randomUUID();
    const corruptFolder=crypto.createHash("sha256").update(corruptOwner).digest("hex").slice(0,40);
    await fs.mkdir(path.join(root,corruptFolder),{recursive:true});
    await fs.writeFile(path.join(root,corruptFolder,"performance.json"),
      JSON.stringify({version:1,samples:[{taskId:"bad",objectiveHash:"untrusted",verified:true}]}),"utf8");
    await assert.rejects(improvement.getPerformanceSummary(corruptOwner),/Performance ledger corrupt/);

    await assert.rejects(improvement.recordTaskOutcome(owner,{
      taskId:"00000000-0000-4000-8000-000000000301",objective,skillId,
      status:"completed",stepCount:1,elapsedMs:1,failureCount:0,
      uncertainEffects:1,verified:true
    }),/Only completed tasks without uncertain effects/);

    console.log("PASS: baseline-versus-candidate measurement from matched owner tasks");
    console.log("PASS: improvement and regression classification require three runs per group");
    console.log("PASS: task outcomes are immutable and idempotent");
    console.log("PASS: Core journal attribution verifies approved skill receipts");
    console.log("PASS: owner isolation and objective/argument privacy");
    console.log("PASS: performance evaluation never changes skill approval or contents");
  }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
