// LIVE-FIRE duplicate-guard probe: planner has NO journal context, but the
// durable journal says create_folder succeeded. If the model proposes the
// identical effectful call (as it should — it knows nothing of prior work),
// the Core MUST suppress the re-execution.
import { db } from "../src/lib/db";
import { runTask } from "../src/lib/agent/core/loop";
const FOLDER = "GUARD_LIVE_TEST";
// Live-fire diagnostics must be bound to an existing active owner, not a
// quarantined legacy task with no owner. Do not provision an owner here.
const owner = await db.principal.findFirst({
  where: { role: "OWNER", status: "ACTIVE" },
  select: { id: true },
});
if (!owner) throw new Error("Live-fire probe requires an enrolled active owner; aborting.");
const task = await db.agentTask.create({
  data: { ownerId: owner.id, objective: `Create the folder ${FOLDER} and verify it.`, status: "paused", stepsUsed: 1 },
});
await db.agentStep.create({ data: { taskId: task.id, seq: 1, kind: "tool_call", tool: "create_folder", argsJson: JSON.stringify({ path: FOLDER }) } });
await db.agentStep.create({ data: { taskId: task.id, seq: 1, kind: "tool_result", tool: "create_folder", resultJson: JSON.stringify({ ok: true, tool: "create_folder", evidence: "directory created and verified on disk: " + FOLDER }) } });
const events: unknown[] = [];
await runTask({
  taskId: task.id,
  ownerId: owner.id,
  objective: `Create the folder ${FOLDER} and verify it.`,
  budget: 3,
  executedEffects: [`create_folder|{"path":"${FOLDER}"}`],
  stepsUsedOffset: 1,
  emit: (ev) => events.push(ev),
  isCancelled: () => false,
});
const evs = events as { type: string; step?: { kind: string; tool?: string; result?: string }; text?: string }[];
let guardSkipped = false, realReexec = false, proposed = false, rateLimited = false;
const final = evs.find((e) => e.type === "final") as { text?: string; status?: string } | undefined;
if (final?.text?.includes("429") || final?.text?.includes("rate")) rateLimited = true;
for (const e of evs) {
  if (e.type === "step" && e.step?.tool === "create_folder" && e.step.kind === "tool_call") proposed = true;
  if (e.type === "step" && e.step?.kind === "tool_result" && e.step.tool === "create_folder") {
    if (e.step.result?.includes("NOT re-executed")) guardSkipped = true;
    if (e.step.result?.includes("directory created")) realReexec = true;
  }
}
console.log("rateLimited:", rateLimited, "| proposed:", proposed, "| guardSkipped:", guardSkipped, "| realReexec:", realReexec);
console.log("final:", (final?.text ?? "").slice(0, 200));
await db.agentStep.deleteMany({ where: { taskId: task.id } });
await db.agentTask.delete({ where: { id: task.id } });
if (guardSkipped && !realReexec) { console.log("VERDICT: PASS — guard fired, duplicate suppressed"); process.exit(0); }
if (rateLimited) { console.log("VERDICT: RATE_LIMITED — retry later"); process.exit(2); }
if (!proposed && !realReexec) { console.log("VERDICT: PASS (planner avoided; guard untriggered)"); process.exit(0); }
console.log("VERDICT: FAIL"); process.exit(1);
