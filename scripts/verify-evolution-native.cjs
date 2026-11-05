#!/usr/bin/env node
"use strict";
/**
 * Offline-only contract for JARVIS native evolution. Does not invoke any LLM,
 * GitHub Actions, dynamic code, desktop APIs, or actual owner files.
 * Run deliberately: node scripts/verify-evolution-native.cjs
 */
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
const {pathToFileURL}=require("node:url");
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"jarvis-evolution-contract-"));
 try{
  process.env.JARVIS_EVOLUTION_ROOT=path.join(root,"vault");
  process.env.JARVIS_AGENT_WORKSPACE=path.join(root,"workspace");
  await fs.mkdir(process.env.JARVIS_AGENT_WORKSPACE,{recursive:true});
  const get=filename=>import(pathToFileURL(path.join(__dirname,
    "../src/lib/agent/evolution",filename)).href);
  const forge=await get("skillForge.mjs"),vault=await get("repairVault.mjs");
  const owner="test-owner-"+crypto.randomUUID();
  const manifest={name:"Inspect owner report",
    description:"Read one owner-scoped workspace report for a later authorized summary.",
    steps:[{tool:"read_file",args:{path:"{{target}}"},why:"Inspect actual owner file"}]};
  const staged=await forge.stageSkill(owner,manifest);
  assert.equal(staged.status,"staged");
  assert.equal(staged.crucible.passed,true);
  assert.equal(staged.crucible.codeExecuted,false);
  await assert.rejects(forge.expandSkill(owner,staged.id,{target:"report.txt"}),
    /not owner-approved/);
  assert.equal((await forge.changeSkill(owner,staged.id,"approve")).status,"approved");
  const approved=await forge.expandSkill(owner,staged.id,{target:"report.txt"});
  assert.equal(approved.executed,false);
  assert.equal(approved.authorizationGranted,false);
  assert.equal(approved.steps[0].args.path,"report.txt");
  await assert.rejects(forge.stageSkill(owner,{...manifest,
    steps:[{tool:"run_command",args:{command:"powershell"},why:"run arbitrary code"}]}),
    /Unknown\/unbounded/);
  assert.equal((await forge.changeSkill(owner,staged.id,"disable")).status,"disabled");
  await assert.rejects(forge.expandSkill(owner,staged.id,{}),/not owner-approved/);
  const filename=path.join(process.env.JARVIS_AGENT_WORKSPACE,"report.txt");
  await fs.writeFile(filename,"retries=0\n","utf8");
  const original=await fs.readFile(filename);
  const sha=crypto.createHash("sha256").update(original).digest("hex");
  const candidate=await vault.stageRepair(owner,{path:"report.txt",
    expectedSha256:sha,oldText:"retries=0",newText:"retries=1",
    diagnosis:"A bounded file value needs one explicitly reviewed correction"});
  assert.equal(candidate.state,"staged");
  assert.equal((await fs.readFile(filename,"utf8")),"retries=0\n");
  await assert.rejects(vault.applyRepair(owner,candidate.id),/Owner approval required/);
  await vault.approveRepair(owner,candidate.id);
  assert.equal((await vault.applyRepair(owner,candidate.id)).state,"applied");
  assert.equal((await fs.readFile(filename,"utf8")),"retries=1\n");
  assert.equal((await vault.rollbackRepair(owner,candidate.id)).state,"rolled_back");
  assert.equal((await fs.readFile(filename,"utf8")),"retries=0\n");
  assert.deepEqual(await vault.inspectRecovery(owner),[]);
  await assert.rejects(vault.stageRepair(owner,{
    path:"../outside.txt",expectedSha256:sha,oldText:"retries=0",
    newText:"retries=2",diagnosis:"Path traversal must be denied"}),/safe workspace-relative/);
  console.log("PASS: staged skills, owner approval, Crucible, exact patch, rollback, containment");
  console.log("No external action or owner workspace was touched.");
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
