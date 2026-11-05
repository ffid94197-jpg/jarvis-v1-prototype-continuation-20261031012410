"use strict";
// JARVIS-owned, fail-closed client for a future Fabric 1.20.1 PlayerEngine IPC peer.
// Never dispatch directly from model text. Caller MUST pass an existing Guardian
// authorization receipt and verify final world-state separately.
const net = require("node:net");
const crypto = require("node:crypto");

const OPERATIONS = new Set(["gather","mine","craft","equip","build","travel","combat","inspect","stop","cancel","status"]);
const MAX_BYTES = 64 * 1024;
const MAX_AGE_MS = 30_000;
const MAX_TIMEOUT_MS = 30_000;
function canonical(x) { return JSON.stringify(x); }
function signature(secret, value) { return crypto.createHmac("sha256", secret).update(canonical(value)).digest("hex"); }
function reject(message) { throw new Error("AI_COMPANION_IPC_" + message); }
function uuid(s) { return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s); }
function parseLine(buffer) {
  if (buffer.length > MAX_BYTES) reject("OVERSIZE_RESPONSE");
  let value;
  try { value = JSON.parse(buffer.toString("utf8")); } catch { reject("MALFORMED_RESPONSE"); }
  if (!value || Array.isArray(value) || typeof value !== "object") reject("MALFORMED_RESPONSE");
  return value;
}
function validateRequest(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) reject("BAD_REQUEST");
  if (!uuid(r.taskId) || !uuid(r.idempotencyKey)) reject("BAD_IDENTITY");
  if (!OPERATIONS.has(r.operation)) reject("OPERATION_DENIED");
  if (typeof r.worldId !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(r.worldId)) reject("BAD_WORLD");
  if (!r.guardian || typeof r.guardian !== "object" || typeof r.guardian.receiptId !== "string" ||
      !uuid(r.guardian.receiptId) || r.guardian.approved !== true || r.guardian.taskId !== r.taskId ||
      r.guardian.worldId !== r.worldId || r.guardian.operation !== r.operation) reject("GUARDIAN_REQUIRED");
  if (!r.arguments || typeof r.arguments !== "object" || Array.isArray(r.arguments)) reject("BAD_ARGUMENTS");
  if (Buffer.byteLength(canonical(r.arguments),"utf8") > 16 * 1024) reject("OVERSIZE_ARGUMENTS");
  if (!Number.isSafeInteger(r.budgetMs) || r.budgetMs < 100 || r.budgetMs > MAX_TIMEOUT_MS) reject("BAD_BUDGET");
}
function createEnvelope(request, secret, now = Date.now()) {
  validateRequest(request);
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) reject("KEY_MISSING");
  const body = {version:1, taskId:request.taskId, idempotencyKey:request.idempotencyKey,
    operation:request.operation, worldId:request.worldId, arguments:request.arguments,
    guardian:request.guardian, budgetMs:request.budgetMs,
    issuedAt:now, nonce:crypto.randomBytes(16).toString("hex")};
  const frame = {body, mac:signature(secret,body)};
  if (Buffer.byteLength(canonical(frame),"utf8") + 1 > MAX_BYTES) reject("OVERSIZE_REQUEST");
  return frame;
}
function verifyReceipt(receipt, envelope, secret, now=Date.now()) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || typeof receipt.mac !== "string" ||
      !receipt.body || typeof receipt.body !== "object" || Array.isArray(receipt.body)) reject("BAD_RECEIPT");
  const expected = signature(secret,receipt.body);
  if (!/^[0-9a-f]{64}$/.test(receipt.mac) ||
      !crypto.timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(receipt.mac,"hex"))) reject("RECEIPT_AUTH");
  const b=receipt.body;
  if (b.version !== 1 || b.taskId !== envelope.body.taskId || b.idempotencyKey !== envelope.body.idempotencyKey ||
      b.nonce !== envelope.body.nonce || b.worldId !== envelope.body.worldId) reject("RECEIPT_MISMATCH");
  if (!Number.isSafeInteger(b.observedAt) || Math.abs(now-b.observedAt)>MAX_AGE_MS) reject("RECEIPT_STALE");
  if (!["accepted","running","failed","cancelled","observed"].includes(b.status)) reject("RECEIPT_STATUS");
  // "observed" means telemetry returned, NOT verified completion. Core must check postconditions.
  return b;
}
async function sendAuthorizedObjective(request, options={}) {
  const {socketPath, secret, timeoutMs=request?.budgetMs} = options;
  if (typeof socketPath !== "string" || !socketPath || socketPath.length>256) reject("SOCKET_PATH");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs>MAX_TIMEOUT_MS) reject("TIMEOUT");
  const frame=createEnvelope(request,secret);
  return new Promise((resolve,rejectPromise)=>{
    let done=false, buffer=Buffer.alloc(0);
    const socket=net.createConnection({path:socketPath});
    function finish(err,result) {if(done)return;done=true;socket.destroy();if(err)rejectPromise(err);else resolve(result);}
    socket.setTimeout(timeoutMs,()=>finish(new Error("AI_COMPANION_IPC_TIMEOUT")));
    socket.on("error",err=>finish(new Error("AI_COMPANION_IPC_TRANSPORT_"+err.code)));
    socket.on("connect",()=>socket.write(canonical(frame)+"\n"));
    socket.on("data",chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>MAX_BYTES)return finish(new Error("AI_COMPANION_IPC_OVERSIZE_RESPONSE"));
      const end=buffer.indexOf(10);
      if(end<0)return;
      if(buffer.subarray(end+1).some(byte=>byte!==10 && byte!==13))return finish(new Error("AI_COMPANION_IPC_EXTRA_RESPONSE"));
      try {finish(null,verifyReceipt(parseLine(buffer.subarray(0,end)),frame,secret));}
      catch(err){finish(err);}
    });
    socket.on("end",()=>finish(new Error("AI_COMPANION_IPC_DISCONNECTED")));
  });
}
module.exports={OPERATIONS,createEnvelope,verifyReceipt,sendAuthorizedObjective};
