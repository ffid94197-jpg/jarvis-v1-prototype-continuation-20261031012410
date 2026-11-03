/**
 * Typed trust and privacy contracts for JARVIS memory and the World Model.
 * The HTTP API never grants VERIFIED_TOOL provenance: trusted effect receipts
 * must be admitted by an internal, server-only service (not implemented here).
 * No memory is forwarded to a model by default.
 */
export interface MemoryInput {
  key: string;
  content: string;
  dataClass: "LOCAL_PRIVATE" | "CLOUD_APPROVED";
}
export interface WorldInput {
  subject: string;
  predicate: string;
  value: string;
  source: "USER_REPORTED";
  provenance: "owner_api";
  confidence: number;
  expiresAt: Date | null;
}
export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function textField(obj: Record<string, unknown>, name: string, max: number): string {
  const v = obj[name];
  if (typeof v !== "string") throw new InputValidationError(`${name} must be text`);
  const normalized = v.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u0008\u000e-\u001f]/.test(normalized)) {
    throw new InputValidationError(`${name} is empty, too long or contains control characters`);
  }
  return normalized;
}
export function parseMemoryInput(input: unknown): MemoryInput {
  if (!isRecord(input)) throw new InputValidationError("Memory input must be an object");
  const key = textField(input, "key", 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(key)) {
    throw new InputValidationError("Memory key must be a simple identifier");
  }
  const content = textField(input, "content", 4000);
  const dataClass = input.dataClass ?? "LOCAL_PRIVATE";
  if (dataClass !== "LOCAL_PRIVATE" && dataClass !== "CLOUD_APPROVED") {
    throw new InputValidationError("Invalid data classification");
  }
  return { key, content, dataClass };
}
export function parseWorldInput(input: unknown, now = new Date()): WorldInput {
  if (!isRecord(input)) throw new InputValidationError("Observation must be an object");
  if (input.source !== undefined && input.source !== "USER_REPORTED") {
    throw new InputValidationError("Only trusted internal executors can assert verified observations");
  }
  const subject = textField(input, "subject", 128);
  const predicate = textField(input, "predicate", 128);
  const value = textField(input, "value", 2000);
  // User reports must never be called 'verified' even when confidence is high.
  const expiresInSeconds = input.expiresInSeconds ?? 3600;
  if (typeof expiresInSeconds !== "number" || !Number.isSafeInteger(expiresInSeconds) ||
      expiresInSeconds < 60 || expiresInSeconds > 30 * 24 * 3600) {
    throw new InputValidationError("expiresInSeconds must be between 60 and 2592000");
  }
  return {
    subject, predicate, value,
    source: "USER_REPORTED",
    provenance: "owner_api",
    confidence: 0.5, // never pretend a user report was independently validated
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
  };
}
/** Mem0-inspired retrieval over JARVIS's existing owner-scoped records.
 * This never invokes a model, exports data, or labels memories as verified.
 */
export function parseOwnerMemoryQuery(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string" || input.trim().length < 2 ||
      input.length > 160 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new InputValidationError("Memory query must be 2–160 printable characters");
  }
  return input.trim();
}
export function rankOwnerMemoryRows<T extends {key:string;content:string}>(rows:T[],query:string,limit:number):T[] {
  const phrase=query.toLocaleLowerCase("en-US");
  const words=Array.from(new Set(phrase.match(/[a-z0-9_]+/g)??[])).slice(0,24);
  if (!words.length) return [];
  return rows.map((row,index)=>{
    const key=row.key.toLocaleLowerCase("en-US");
    const content=row.content.toLocaleLowerCase("en-US");
    const all=key+" "+content;
    const hits=words.reduce((n,w)=>n+Number(all.includes(w)),0);
    const score=(key===phrase?100:0)+(key.includes(phrase)?40:0)+
      (content.includes(phrase)?20:0)+hits*3;
    return {row,index,score,hits};
  }).filter(x=>x.hits>0).sort((a,b)=>b.score-a.score || a.index-b.index)
    .slice(0,Math.min(Math.max(limit,1),100)).map(x=>x.row);
}
export function boundedListLimit(input: unknown): number {
  const n = typeof input === "string" && /^\d+$/.test(input) ? Number(input) : 20;
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, 100) : 20;
}
export function parseDeleteInput(input: unknown): { kind: "memory" | "observation"; id: string } {
  if (!isRecord(input)) throw new InputValidationError("Deletion request must be an object");
  if (input.kind !== "memory" && input.kind !== "observation") {
    throw new InputValidationError("Invalid deletion kind");
  }
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(input.id)) {
    throw new InputValidationError("Invalid record identifier");
  }
  return { kind: input.kind, id: input.id };
}
