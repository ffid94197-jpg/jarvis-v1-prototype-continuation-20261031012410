#!/usr/bin/env node
"use strict";
/** Offline source-learning contract; fake completed Core receipts only.
 * No GitHub Actions, Windows, Minecraft, provider or actual owner data.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
const {pathToFileURL}=require("node:url");
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"jarvis-skill-learning-"));
  try {
    process.env.JARVIS_EVOLUTION_ROOT=path.join(root,"registry");
    const source=pathToFileURL(path.join(__dirname,
      "../src/lib/agent/evolution/learnFromTask.mjs")).href;
    const forge=await import(pathToFileURL(path.join(__dirname,
      "../src/lib/agent/evolution/skillForge.mjs")).href);
    const {learnFromCompletedTask}=await import(source);
    const owner="owner-"+crypto.randomUUID(),id=crypto.randomUUID();
    const task={id,ownerId:owner,status:"completed"};
    const rows=[
      {seq:1,kind:"tool_call",tool:"list_dir",
       argsJson:JSON.stringify({path:"reports"})},
      {seq:1,kind:"tool_result",tool:"list_dir",
       resultJson:JSON.stringify({ok:true,tool:"list_dir",detail:{count:2}})}
    ];
    let rejected=0;
    const db={
      agentTask:{
        findFirst:async()=>task,
        findUnique:async()=>task
      },
      agentStep:{
        count:async()=>rejected,
        findMany:async()=>rows
      },
      effectRecord:{findMany:async()=>[]}
    };
    const staged=await learnFromCompletedTask(owner,db);
    assert.equal(staged.status,"staged");
    assert.equal(staged.fromActualToolReceipts,true);
    assert.equal(staged.ownerApprovalRequired,true);
    await assert.rejects(forge.expandSkill(owner,staged.id,{}),/not owner-approved/);
    const learnedRecord=await forge.getSkill(owner,staged.id);
    assert.ok(learnedRecord.sourceTaskIds.includes(id));
    const manifest=learnedRecord.manifest;
    assert.equal(manifest.steps.length,1);
    assert.equal(manifest.steps[0].tool,"list_dir");
    await forge.changeSkill(owner,staged.id,"approve");
    const expanded=await forge.expandSkill(owner,staged.id,{});
    assert.equal(expanded.steps[0].args.path,"reports");
    rejected=1;
    await assert.rejects(learnFromCompletedTask(owner,db),
      /denied\/failed steps/);
    rejected=0;
    rows[1].resultJson=JSON.stringify({ok:false,tool:"list_dir"});
    await assert.rejects(learnFromCompletedTask(owner,db),
      /did not succeed/);
    rows[1].resultJson=JSON.stringify({ok:true,tool:"list_dir"});
    task.ownerId="someone-else";
    await assert.rejects(learnFromCompletedTask(owner,db),/Owned source task not found/);
    console.log("PASS: receipt-bound skill learning, owner scope, deny/failure rejection, staged approval");
    console.log("This is a mock task fixture, NOT independent Windows/AI field acceptance.");
  }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
