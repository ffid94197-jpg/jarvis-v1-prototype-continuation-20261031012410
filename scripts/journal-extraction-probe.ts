// Pure journal-side verification of the duplicate guard inputs (no LLM).
import { db } from "../src/lib/db";
import { buildReplayFromJournal } from "../src/lib/agent/core/loop";
const task = await db.agentTask.create({
  data: { objective: "probe", status: "paused", stepsUsed: 3 },
});
await db.agentStep.create({ data: { taskId: task.id, seq: 1, kind: "tool_call", tool: "create_folder", argsJson: `{"path":"A"}` } });
await db.agentStep.create({ data: { taskId: task.id, seq: 1, kind: "tool_result", tool: "create_folder", resultJson: JSON.stringify({ ok: true, evidence: "dir" }) } });
await db.agentStep.create({ data: { taskId: task.id, seq: 2, kind: "tool_call", tool: "write_file", argsJson: `{"path":"A/f.txt","content":"x"}` } });
await db.agentStep.create({ data: { taskId: task.id, seq: 2, kind: "tool_result", tool: "write_file", resultJson: JSON.stringify({ ok: true, evidence: "wrote" }) } });
await db.agentStep.create({ data: { taskId: task.id, seq: 3, kind: "tool_call", tool: "write_file", argsJson: `{"path":"A/g.txt","content":"y"}` } });
await db.agentStep.create({ data: { taskId: task.id, seq: 3, kind: "tool_result", tool: "write_file", resultJson: JSON.stringify({ ok: false, error: "ENOENT" }) } });
await db.agentStep.create({ data: { taskId: task.id, seq: 4, kind: "tool_call", tool: "read_file", argsJson: `{"path":"A/f.txt"}` } });
await db.agentStep.create({ data: { taskId: task.id, seq: 4, kind: "tool_result", tool: "read_file", resultJson: JSON.stringify({ ok: true, evidence: "read" }) } });

const j = await buildReplayFromJournal(task.id);
console.log("executedEffects:", JSON.stringify(j?.executedEffects));

// The SAME canonicalization the guard applies to live args (loop.ts canonicalKey).
const canonicalKey = (tool: string, args: Record<string, unknown>): string => {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = sortDeep((v as Record<string, unknown>)[k]); return acc; }, {});
    }
    return v;
  };
  return `${tool}|${JSON.stringify(sortDeep(args))}`;
};

let pass = true;
const set = new Set(j?.executedEffects ?? []);
// 1. successful effects present — lookup side canonicalizes, so keys must match
if (!set.has(canonicalKey("create_folder", { path: "A" }))) { console.log("XX missing create_folder"); pass = false; }
if (!set.has(canonicalKey("write_file", { content: "x", path: "A/f.txt" }))) { console.log("XX missing write_file"); pass = false; }
// 2. key-order independence: reversed arg order must canonicalize to the same key
if (!set.has(canonicalKey("write_file", { path: "A/f.txt", content: "x" }))) { console.log("XX key order not normalized"); pass = false; }
// 3. failed effect NOT protected (retry allowed)
if (set.has(canonicalKey("write_file", { content: "y", path: "A/g.txt" }))) { console.log("XX failed effect wrongly protected"); pass = false; }
// 4. read-only tools never protected
if (set.has(canonicalKey("read_file", { path: "A/f.txt" }))) { console.log("XX read-only wrongly protected"); pass = false; }

await db.agentStep.deleteMany({ where: { taskId: task.id } });
await db.agentTask.delete({ where: { id: task.id } });
console.log(pass ? "JOURNAL EXTRACTION PROBE: PASS" : "JOURNAL EXTRACTION PROBE: FAIL");
process.exit(pass ? 0 : 1);
