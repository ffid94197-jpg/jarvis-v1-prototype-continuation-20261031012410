"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {createEnvelope,verifyReceipt,sendAuthorizedObjective}=require("./guardian-ipc-client.cjs");
const secret="a".repeat(64);
const taskId=crypto.randomUUID(),idempotencyKey=crypto.randomUUID(),receiptId=crypto.randomUUID();
const request={taskId,idempotencyKey,operation:"inspect",worldId:"owner.local",arguments:{target:"inventory"},budgetMs:2000,
 guardian:{approved:true,receiptId,coreTaskId:crypto.randomUUID(),taskId,worldId:"owner.local",operation:"inspect"}};
const frame=createEnvelope(request,secret);
assert.equal(frame.body.operation,"inspect");
assert.match(frame.mac,/^[0-9a-f]{64}$/);
assert.throws(()=>createEnvelope({...request,operation:"arbitrary_shell"},secret),/OPERATION_DENIED/);
assert.throws(()=>createEnvelope({...request,guardian:{...request.guardian,approved:false}},secret),/GUARDIAN_REQUIRED/);
assert.throws(()=>createEnvelope({...request,guardian:{...request.guardian,taskId:crypto.randomUUID()}},secret),/GUARDIAN_REQUIRED/);
assert.throws(()=>createEnvelope({...request,arguments:{payload:"x".repeat(20000)}},secret),/OVERSIZE_ARGUMENTS/);
assert.throws(()=>createEnvelope(request,"weak"),/KEY_MISSING/);
const body={version:1,taskId,idempotencyKey,nonce:frame.body.nonce,worldId:"owner.local",observedAt:Date.now(),status:"observed",
 guardianReceiptId:receiptId,coreTaskId:request.guardian.coreTaskId,
 observations:{inventory:[{item:"oak_log",count:1}]}};
const fixture=(b)=>{
 const payload=Buffer.from(JSON.stringify(b),"utf8").toString("base64url");
 return {payload,mac:crypto.createHmac("sha256",secret).update(payload,"ascii").digest("hex")};
};
assert.equal(verifyReceipt(fixture(body),frame,secret).status,"observed");
assert.throws(()=>verifyReceipt({...fixture(body),mac:"0".repeat(64)},frame,secret),/RECEIPT_AUTH/);
assert.throws(()=>verifyReceipt(fixture({...body,nonce:"wrong"}),frame,secret),/RECEIPT_MISMATCH/);
assert.throws(()=>verifyReceipt(fixture({...body,observedAt:0}),frame,secret),/RECEIPT_STALE/);
assert.throws(()=>verifyReceipt({...fixture(body),payload:"@invalid"},frame,secret),/RECEIPT_AUTH|BAD_PAYLOAD/);
sendAuthorizedObjective(request,{socketPath:"",secret}).then(()=>{throw Error("unexpected success")},e=>{
 assert.match(e.message,/SOCKET_PATH/);
 console.log("guardian IPC offline contract checks PASS");
}).catch(e=>{console.error(e);process.exitCode=1});
