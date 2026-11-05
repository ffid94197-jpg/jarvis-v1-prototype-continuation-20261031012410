"use strict";
/* Execute locally with Node >=20: node verify-native-loopback.cjs
   This uses a loopback fixture, NOT real Minecraft or Fabric. */
const assert=require("node:assert/strict");
const net=require("node:net");
const crypto=require("node:crypto");
const {sendAuthorizedObjective,createEnvelope}=require("./guardian-ipc-client.cjs");
const secret=crypto.randomBytes(32).toString("hex");
const taskId=crypto.randomUUID(),receiptId=crypto.randomUUID();
const coreTaskId=crypto.randomUUID(),ownerUuid=crypto.randomUUID(),companionUuid=crypto.randomUUID();
const request={taskId,idempotencyKey:crypto.randomUUID(),operation:"inspect",worldId:"minecraft:overworld",
  arguments:{ownerUuid,companionUuid},budgetMs:2000,
  guardian:{approved:true,receiptId,coreTaskId,taskId,worldId:"minecraft:overworld",operation:"inspect"}};
function mac(payload){return crypto.createHmac("sha256",secret).update(payload,"ascii").digest("hex");}
async function exercise(mode) {
  const server=net.createServer(socket=>{
    let data=Buffer.alloc(0);
    socket.on("data",chunk=>{
      data=Buffer.concat([data,chunk]);
      const end=data.indexOf(10);
      if(end<0)return;
      const incoming=JSON.parse(data.subarray(0,end).toString("utf8"));
      assert.equal(incoming.mac,mac(incoming.payload),"exact signed request bytes");
      const body=JSON.parse(Buffer.from(incoming.payload,"base64url").toString("utf8"));
      assert.equal(body.guardian.receiptId,receiptId);
      assert.equal(body.guardian.coreTaskId,coreTaskId);
      assert.equal(body.worldId,"minecraft:overworld");
      const proof={version:1,taskId:body.taskId,idempotencyKey:body.idempotencyKey,
        nonce:body.nonce,worldId:body.worldId,coreTaskId,
        guardianReceiptId:receiptId,observedAt:Date.now(),status:"observed",
        observations:{companionUuid,x:0,y:65,z:0,health:20,hunger:20,
          inventory:[],armor:[],armorSlots:["","","",""],mainHand:""}};
      if(mode==="stale") proof.observedAt=0;
      if(mode==="wrongTask") proof.taskId=crypto.randomUUID();
      const payload=Buffer.from(JSON.stringify(proof)).toString("base64url");
      const response={payload,mac:mode==="badMac"?"0".repeat(64):mac(payload)};
      socket.end(JSON.stringify(response)+"\n");
    });
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try {
    const port=server.address().port;
    if(mode==="good"){
      const result=await sendAuthorizedObjective(request,{port,host:"127.0.0.1",secret,timeoutMs:2000});
      assert.equal(result.status,"observed");
      assert.equal(result.guardianReceiptId,receiptId);
    }else{
      await assert.rejects(sendAuthorizedObjective(request,{port,host:"127.0.0.1",secret,timeoutMs:2000}),
        mode==="stale"?/RECEIPT_STALE/:mode==="badMac"?/RECEIPT_AUTH/:/RECEIPT_MISMATCH/);
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}
(async()=>{
  assert.equal(createEnvelope(request,secret).body.guardian.coreTaskId,coreTaskId);
  for(const mode of ["good","badMac","stale","wrongTask"])await exercise(mode);
  await assert.rejects(sendAuthorizedObjective(request,{port:1,host:"0.0.0.0",secret,timeoutMs:2000}),/LOOPBACK_ONLY/);
  console.log("PASS: local byte-authenticated IPC fixture (NOT Fabric acceptance)");
})().catch(e=>{console.error(e);process.exitCode=1});
