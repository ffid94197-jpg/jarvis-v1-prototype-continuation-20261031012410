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
/** Deterministic multi-signal retrieval adapted from PropMem/SimpleMem ideas.
 * This is lexical ranking only: it does not claim semantic/vector search.
 * Owner, deletion and data-class filters must be applied in Prisma BEFORE
 * this function receives candidate rows.
 */
const MEMORY_STOPWORDS=new Set([
  "a","an","and","are","as","at","be","by","for","from","how","i","in",
  "is","it","me","my","of","on","or","the","to","was","what","when",
  "where","which","with","you","your"
]);
function memoryTokens(value:string):string[] {
  return (value.normalize("NFKC").toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}_]+/gu)??[]);
}
function memoryPhrase(value:string):string {
  return memoryTokens(value).join(" ");
}
function memoryRecencyBonus(value:unknown):number {
  const date=value instanceof Date?value:
    typeof value==="string"?new Date(value):null;
  if(!date || !Number.isFinite(date.getTime()))return 0;
  const ageDays=Math.max(0,(Date.now()-date.getTime())/86_400_000);
  return ageDays<=1?4:ageDays<=7?3:ageDays<=30?1:0;
}
export function rankOwnerMemoryRows<T extends {
  key:string;content:string;updatedAt?:Date|string
}>(rows:T[],query:string,limit:number):T[] {
  const phrase=memoryPhrase(query);
  const words=Array.from(new Set(memoryTokens(query)
    .filter(w=>!MEMORY_STOPWORDS.has(w)))).slice(0,24);
  if(!words.length)return [];
  const scored=rows.map((row,index)=>{
    const key=memoryPhrase(row.key);
    const content=memoryPhrase(row.content);
    const keyTokens=new Set(memoryTokens(row.key));
    const contentTokens=new Set(memoryTokens(row.content));
    const keyHits=words.filter(w=>keyTokens.has(w)).length;
    const contentHits=words.filter(w=>contentTokens.has(w)).length;
    const matched=keyHits+contentHits;
    const keyCoverage=keyHits/words.length;
    const contentCoverage=contentHits/words.length;
    const exactKey=key===phrase;
    const keyPhrase=key.includes(phrase);
    const contentPhrase=content.includes(phrase);
    const score=(exactKey?1000:0)+(keyPhrase?120:0)+
      (contentPhrase?60:0)+keyCoverage*24+contentCoverage*12+
      matched*2+memoryRecencyBonus(row.updatedAt);
    return {row,index,score,matched};
  });
  const bounded=Number.isFinite(limit)?Math.min(Math.max(Math.floor(limit),1),100):20;
  return scored.filter(x=>x.matched>0)
    .sort((a,b)=>b.score-a.score||a.index-b.index)
    .slice(0,bounded).map(x=>x.row);
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
