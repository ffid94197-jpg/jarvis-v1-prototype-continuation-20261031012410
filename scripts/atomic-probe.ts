/**
 * JARVIS PHASE 04 — ATOMIC EFFECT + CANCELLATION PROBES (EFF-01…04, CAN-01…05).
 *
 * Engineered for determinism under an upstream-throttled planning channel:
 *  - admission/lease atomicity probed at the REAL durable gates (no model)
 *  - in-flight process-tree termination probed with REAL child processes
 *    (allowlisted `sleep`) through the REAL cancel registry
 *  - stop-before-admission + concurrent-resume races run against the LIVE
 *    API using fixture-paused tasks (real rows, real routes, real auth)
 *
 *   bun run scripts/atomic-probe.ts unit     — admission/redo/duplicate/reconcile/guardian
 *   bun run scripts/atomic-probe.ts can02    — real in-flight kill
 *   bun run scripts/atomic-probe.ts can01    — live: stop blocks admission (server)
 *   bun run scripts/atomic-probe.ts eff01    — live: concurrent resumes (server)
 *   bun run scripts/atomic-probe.ts can05verify — post-restart: stop durable, no resurrection
 */

import fs from "fs/promises";
import { db } from "../src/lib/db";
import { admitEffect, canonicalKey, reconcileCrashedTasks, settleEffect } from "../src/lib/agent/core/effects";
import { requestCancel, clearCancel } from "../src/lib/agent/core/cancelRegistry";
import { authorizeToolCall } from "../src/lib/agent/guardian/guardian";
import { executeTool, killInFlightChildren } from "../src/lib/agent/tools/executor";
import { hashToken } from "../src/lib/agent/auth/session";
import { transitionTask } from "../src/lib/agent/core/taskState";

const BASE = "http://localhost:3000";
const OWNER_TOKEN = process.env.JARVIS_OWNER_TOKEN ?? "";
const cmd = process.argv[2] ?? "unit";
const rand = Math.random().toString(36).slice(2, 8);

const results: Array<{ id: string; name: string; pass: boolean; detail: string }> = [];
function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id} ${name} — ${detail}`);
}
const jar = (token?: string): Record<string, string> =>
  token ? { cookie: `jarvis_session=${token}` } : {};

async function ownerPrincipalId(): Promise<string> {
  const s = await db.session.findUnique({ where: { tokenHash: hashToken(OWNER_TOKEN) } });
  return s?.principalId ?? "";
}

/** Fixture: a genuinely paused task row (real schema, real replay sources). */
async function fixturePausedTask(prefix: string, withEffect: boolean) {
  const ownerId = await ownerPrincipalId();
  const t = await db.agentTask.create({
    data: {
      objective: `Fixture paused task ${prefix}_${rand}: create a folder ${prefix}_${rand} and write ${prefix}_${rand}/done.txt saying 'done', then list it.`,
      status: "paused",
      stepsUsed: 1,
      ownerId: ownerId || null,
    },
  });
  if (withEffect) {
    const args = { path: `${prefix}_${rand}` };
    const e = await db.effectRecord.create({
      data: {
        taskId: t.id,
        effectKey: `0|${canonicalKey("create_folder", args)}`,
        status: "SETTLED",
        tool: "create_folder",
        argsJson: JSON.stringify(args),
      },
    });
    await db.agentStep.create({
      data: { taskId: t.id, seq: 1, kind: "tool_call", tool: "create_folder", argsJson: JSON.stringify(args) },
    });
    await db.agentStep.create({
      data: { taskId: t.id, seq: 1, kind: "tool_result", tool: "create_folder", resultJson: JSON.stringify({ ok: true, evidence: "fixture: settled create" }) },
    });
    return { task: t, effectId: e.id };
  }
  return { task: t, effectId: "" };
}

// ———————————————————————————————— unit

async function unit() {
  const ownerId = await ownerPrincipalId();
  const t = await db.agentTask.create({
    data: { objective: `EFF unit probe ${rand}`, status: "executing", stepsUsed: 0, ownerId: ownerId || null },
  });

  // EFF-01: two CONCURRENT admissions of the same identity → exactly one.
  {
    const args = { path: `EFF01_${rand}`, content: "x" };
    const [a, b] = await Promise.all([
      admitEffect(t.id, 0, { tool: "write_file", args }),
      admitEffect(t.id, 0, { tool: "write_file", args }),
    ]);
    const admitted = [a, b].filter((r) => r.kind === "admitted").length;
    const dupOrRecon = [a, b].filter((r) => r.kind === "needs_reconciliation" || r.kind === "duplicate_settled").length;
    record(
      "EFF-01",
      "concurrent admissions of one effect identity → exactly one wins",
      admitted === 1 && dupOrRecon === 1,
      `admitted=${admitted} other=${dupOrRecon}`,
    );
  }

  // EFF-03: same target, DIFFERENT intentional content → a new identity, both admissible.
  {
    const a1 = await admitEffect(t.id, 0, { tool: "write_file", args: { path: `EFF03_${rand}`, content: "first" } });
    const a2 = await admitEffect(t.id, 0, { tool: "write_file", args: { path: `EFF03_${rand}`, content: "second-intentional-redo" } });
    record(
      "EFF-03",
      "intentional redo with different args gets its OWN effect identity",
      a1.kind === "admitted" && a2.kind === "admitted",
      `first=${a1.kind} redo=${a2.kind}`,
    );
    if (a1.kind === "admitted") await settleEffect(a1.effectId, { probe: true }, "SETTLED");
    if (a2.kind === "admitted") await settleEffect(a2.effectId, { probe: true }, "SETTLED");
  }

  // EFF-04: re-proposing a SETTLED effect → duplicate_settled, never replayed.
  {
    const args = { path: `EFF04_${rand}`, content: "settled-once" };
    const first = await admitEffect(t.id, 0, { tool: "write_file", args });
    if (first.kind === "admitted") await settleEffect(first.effectId, { ok: true }, "SETTLED");
    const again = await admitEffect(t.id, 0, { tool: "write_file", args });
    const dupeOnDisk = await db.effectRecord.count({ where: { taskId: t.id, effectKey: `0|${canonicalKey("write_file", args)}` } });
    record(
      "EFF-04",
      "completed effect is never replayed (duplicate_settled)",
      again.kind === "duplicate_settled" && dupeOnDisk === 1,
      `reAdmission=${again.kind} rowsForIdentity=${dupeOnDisk}`,
    );
  }

  // CAN-04 fixture: crashed cancel_requested + ADMITTED effect → reconciled
  // to CANCELLED with honest uncertainty, never resurrected.
  {
    const t2 = await db.agentTask.create({
      data: { objective: `CAN04 fixture ${rand}`, status: "cancel_requested", stepsUsed: 1, ownerId: ownerId || null },
    });
    await db.effectRecord.create({
      data: {
        taskId: t2.id,
        effectKey: `0|${canonicalKey("write_file", { path: `CAN04_${rand}/x.txt`, content: "maybe" })}`,
        status: "ADMITTED",
        tool: "write_file",
        argsJson: JSON.stringify({ path: `CAN04_${rand}/x.txt`, content: "maybe" }),
      },
    });
    await db.agentTask.update({ where: { id: t2.id }, data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) } });
    await reconcileCrashedTasks();
    const after = await db.agentTask.findUnique({ where: { id: t2.id }, include: { effects: true } });
    record(
      "CAN-04",
      "cancelled-crashed task reconciles to CANCELLED with uncertainty recorded",
      after?.status === "cancelled" && after.effects[0]?.status === "EFFECT_UNKNOWN",
      `status=${after?.status} effect=${after?.effects[0]?.status}`,
    );
    await db.agentTask.delete({ where: { id: t2.id } });
  }

  // Guardian: sleep allowlist — positive + negative controls.
  {
    const okCmd = await authorizeToolCall({ taskId: null }, "run_command", { command: "sleep", args: ["8"] });
    const badArg = await authorizeToolCall({ taskId: null }, "run_command", { command: "sleep", args: ["abc"] });
    const tooMany = await authorizeToolCall({ taskId: null }, "run_command", { command: "sleep", args: ["8", "9"] });
    record(
      "SLEEP-GATE",
      "sleep: numeric-only, single-arg, bounded",
      okCmd.verdict === "allow" && badArg.verdict === "deny" && tooMany.verdict === "deny",
      `ok=${okCmd.verdict} nonNumeric=${badArg.verdict} twoArgs=${tooMany.verdict}`,
    );
  }

  await db.agentTask.delete({ where: { id: t.id } }).catch(() => {});
}

// ———————————————————————————————— can02 (real in-flight kill, no LLM)

async function can02() {
  const ownerId = await ownerPrincipalId();
  const t = await db.agentTask.create({
    data: { objective: `CAN02 in-flight kill ${rand}`, status: "executing", stepsUsed: 0, ownerId: ownerId || null },
  });
  const decision = await authorizeToolCall({ taskId: t.id }, "run_command", { command: "sleep", args: ["8"] });
  if (decision.verdict !== "allow") {
    record("CAN-02", "guardian denied the sleep probe", false, decision.reason ?? "deny");
    return;
  }
  const start = Date.now();
  const run = executeTool(t.id, "run_command", decision);
  await new Promise((r) => setTimeout(r, 800)); // let it actually start
  const killed = killInFlightChildren(t.id);
  const result = await run;
  const elapsed = Date.now() - start;
  record(
    "CAN-02",
    "STOP terminates the ACTUAL in-flight process (not a Boolean)",
    killed >= 1 && result.ok === false && elapsed < 6000 && /TERMINATED|terminated/i.test(result.evidence + (result.error ?? "")),
    `killed=${killed} elapsed=${elapsed}ms ok=${result.ok} evidence=${result.evidence.slice(0, 60)}`,
  );
  await db.agentTask.delete({ where: { id: t.id } }).catch(() => {});
}

// ———————————————————————————————— can01 (live: stop blocks admission)

async function can01() {
  const { task } = await fixturePausedTask("CAN01", true);
  // Fire the resume, then STOP within the first planning window — the
  // loop's FIRST checkpoint (before any model work) must observe it.
  const runP = fetch(BASE + "/api/jarvis/task", {
    method: "POST",
    headers: { "content-type": "application/json", ...jar(OWNER_TOKEN) },
    body: JSON.stringify({ resumeTaskId: task.id, stepBudget: 12 }),
  }).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 120));
  await fetch(BASE + "/api/jarvis/task/cancel", {
    method: "POST",
    headers: { "content-type": "application/json", ...jar(OWNER_TOKEN) },
    body: JSON.stringify({ taskId: task.id }),
  });
  const raw = await runP;
  const final = raw.match(/event: final\ndata: (.*)\n/);
  const finalStatus = final ? ((JSON.parse(final[1]) as { status?: string }).status ?? "") : "(no final)";
  const effectsAfter = await db.effectRecord.count({ where: { taskId: task.id } });
  record(
    "CAN-01",
    "STOP blocks new effect admission (cancelled, zero new effects)",
    finalStatus === "cancelled" && effectsAfter === 1,
    `final=${finalStatus} effectRows=${effectsAfter} (expect cancelled, still 1 — the fixture's original)`,
  );
  record(
    "CAN-03",
    "late/no post-stop admissions occur",
    effectsAfter === 1,
    `effectCountUnchanged=${effectsAfter === 1}`,
  );
  clearCancel(task.id);
}

// ———————————————————————————————— eff01 (live: concurrent resumes)

async function eff01() {
  const { task } = await fixturePausedTask("EFF01L", true);
  const body = JSON.stringify({ resumeTaskId: task.id, stepBudget: 12 });
  const [ra, rb] = await Promise.all([
    fetch(BASE + "/api/jarvis/task", { method: "POST", headers: { "content-type": "application/json", ...jar(OWNER_TOKEN) }, body }),
    fetch(BASE + "/api/jarvis/task", { method: "POST", headers: { "content-type": "application/json", ...jar(OWNER_TOKEN) }, body }),
  ]);
  const [ta, tb] = await Promise.all([ra.text(), rb.text()]);
  const fa = /event: final\ndata: (.*)\n/.exec(ta);
  const fb = /event: final\ndata: (.*)\n/.exec(tb);
  const sa = fa ? ((JSON.parse(fa[1]) as { status?: string; text?: string }).status ?? "") : "";
  const sb = fb ? ((JSON.parse(fb[1]) as { status?: string; text?: string }).status ?? "") : "";
  const xa = fa ? ((JSON.parse(fa[1]) as { text?: string }).text ?? "") : "";
  const xb = fb ? ((JSON.parse(fb[1]) as { text?: string }).text ?? "") : "";
  const conflict = [xa, xb].some((x) => /lease conflict/i.test(x));
  const settledCreates = await db.effectRecord.count({
    where: { taskId: task.id, effectKey: `0|${canonicalKey("create_folder", { path: `EFF01L_${task.id.slice(0, 4)}` })}` },
  });
  const totalEffects = await db.effectRecord.count({ where: { taskId: task.id } });
  record(
    "EFF-01-live",
    "concurrent resumes: one lease, one admitted effect, loser executes NOTHING",
    conflict && totalEffects <= 2, // fixture's 1 + at most one new from the winner
    `winner/loser finals=${sa}/${sb} leaseConflictMsg=${conflict} totalEffectRows=${totalEffects} (fixture 1 + ≤1 new)`,
  );
  clearCancel(task.id);
}

// ———————————————————————————————— can05verify (post-restart)

async function can05verify() {
  const taskId = (await fs.readFile("/tmp/can05.json", "utf8")).trim();
  const row = await db.agentTask.findUnique({ where: { id: taskId } });
  // 1) Resume must be REFUSED — the stop revoked execution authority.
  const resumeRes = await fetch(BASE + "/api/jarvis/task", {
    method: "POST",
    headers: { "content-type": "application/json", ...jar(OWNER_TOKEN) },
    body: JSON.stringify({ resumeTaskId: taskId, stepBudget: 12 }),
  });
  const resumeBody = await resumeRes.json().catch(() => ({}));
  const refused = resumeRes.status === 409;
  // 2) The STOP itself must be durable: cancel_requested survived restart.
  const stopDurable = row?.status === "cancel_requested";
  // 3) Reconciliation (once the residue goes stale) honors the stop → cancelled.
  await db.agentTask.update({
    where: { id: taskId },
    data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) },
  }).catch(() => {});
  await reconcileCrashedTasks();
  const settled = await db.agentTask.findUnique({ where: { id: taskId } });
  record(
    "CAN-05",
    "STOP survives restart: resume refused, stop durable, reconciled to CANCELLED",
    refused && stopDurable && settled?.status === "cancelled",
    `resumeHttp=${resumeRes.status} durableState=${row?.status} afterReconcile=${settled?.status}`,
  );
}

const fn: Record<string, () => Promise<void>> = {
  unit,
  can02,
  can01,
  eff01,
  can05verify,
};
if ((cmd === "can01" || cmd === "eff01" || cmd === "can05verify") && !OWNER_TOKEN) {
  console.error("JARVIS_OWNER_TOKEN required");
  process.exit(2);
}
await fn[cmd]?.();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== PHASE 04 PROBES (${cmd}) — ${results.length - failed.length}/${results.length} PASS ===`);
await db.$disconnect();
process.exit(failed.length === 0 ? 0 : 1);
