/**
 * JARVIS PHASE 02 — DURABLE-EFFECT PROBES (DUR-01 … DUR-08).
 *
 * Real probes: real tasks over the real API, real server restarts with
 * REAL fault injection (JARVIS_TEST_FAULT env, see core/faults.ts),
 * real crash-recovery reconciliation, verified against the durable DB
 * rows AND the actual disk.
 *
 * Driven by scripts/durable-suite.sh (server lifecycle orchestration):
 *   bun run scripts/durable-probe.ts unit          — DUR-05/06/07 (no server)
 *   bun run scripts/durable-probe.ts dur01         — admission fault  (faulted server)
 *   bun run scripts/durable-probe.ts dur02         — settlement fault + reconciliation
 *   bun run scripts/durable-probe.ts dur03-setup    — pause + journal commit
 *   bun run scripts/durable-probe.ts dur03-verify  — restart continuity + DUR-08
 *   bun run scripts/durable-probe.ts dur04          — ghost effect, no blind replay
 */

import fs from "fs/promises";
import path from "path";
import { db } from "../src/lib/db";
import { transitionTask } from "../src/lib/agent/core/taskState";
import { reconcileCrashedTasks } from "../src/lib/agent/core/effects";
import { authorizeToolCall } from "../src/lib/agent/guardian/guardian";

const BASE = "http://localhost:3000";
const OWNER_TOKEN = process.env.JARVIS_OWNER_TOKEN ?? "";
const WORKSPACE = "/home/z/my-project/agent-workspace";
const cmd = process.argv[2] ?? "unit";
const rand = Math.random().toString(36).slice(2, 8);

const results: Array<{ id: string; name: string; pass: boolean; detail: string }> = [];
function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id} ${name} — ${detail}`);
}

const jar = (token?: string): Record<string, string> =>
  token ? { cookie: `jarvis_session=${token}` } : {};

async function sse(body: unknown, token = OWNER_TOKEN) {
  const res = await fetch(BASE + "/api/jarvis/task", {
    method: "POST",
    headers: { "content-type": "application/json", ...jar(token) },
    body: JSON.stringify(body),
  });
  const raw = res.status === 200 ? await res.text() : await res.text();
  const m = raw.match(/event: final\ndata: (.*)\n/);
  let final = "";
  let taskId = "";
  const tm = raw.match(/"taskId":"([^"]+)"/);
  if (tm) taskId = tm[1];
  if (m) {
    try {
      final = ((JSON.parse(m[1]) as { status?: string }).status) ?? "";
    } catch { /* ignore */ }
  }
  return { http: res.status, raw, final, taskId };
}

// ———————————————————————————————— unit (DUR-05/06/07)

async function unit() {
  // DUR-05: concurrent status updates obey version checks (CAS).
  {
    const t = await db.agentTask.create({
      data: { objective: `DUR-05 CAS probe ${rand}`, status: "planned", stepsUsed: 0 },
    });
    const [a, b] = await Promise.all([
      transitionTask(t.id, "planning"),
      transitionTask(t.id, "planning"),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    const after = await db.agentTask.findUnique({ where: { id: t.id } });
    record(
      "DUR-05",
      "concurrent transitions: exactly one CAS wins",
      wins === 1 && a.ok !== b.ok && after?.status === "planning" && after.version === 1,
      `wins=${wins} status=${after?.status} version=${after?.version}`,
    );
    await db.agentTask.delete({ where: { id: t.id } });
  }

  // DUR-06: malformed persisted state is detected, never silently reset.
  {
    const t = await db.agentTask.create({
      data: { objective: `DUR-06 malformed probe ${rand}`, status: "planned", stepsUsed: 0 },
    });
    await db.agentTask.update({ where: { id: t.id }, data: { status: "bogus-state" } });
    const r = await transitionTask(t.id, "paused");
    const after = await db.agentTask.findUnique({ where: { id: t.id } });
    record(
      "DUR-06",
      "malformed persisted state detected and refused",
      !r.ok && r.reason === "unknown_state" && after?.status === "bogus-state",
      `reason=${r.reason} db-status-untouched=${after?.status === "bogus-state"}`,
    );
    await db.agentTask.delete({ where: { id: t.id } });
  }

  // DUR-07: audit-trail failure can never authorize an effect (fail-closed).
  {
    process.env.JARVIS_TEST_FAULT = "audit";
    const denied = await authorizeToolCall({ taskId: null }, "list_dir", { path: "DUR07_PROBE" });
    process.env.JARVIS_TEST_FAULT = "";
    const allowed = await authorizeToolCall({ taskId: null }, "list_dir", { path: "DUR07_PROBE" });
    record(
      "DUR-07",
      "audit write failure flips to DENY; clean audit allows",
      denied.verdict === "deny" && allowed.verdict === "allow",
      `faulted=${denied.verdict}(${(denied.reason ?? "").slice(0, 40)}) clean=${allowed.verdict}`,
    );
  }
}

// ———————————————————————————————— dur01 (admission fault)

async function dur01() {
  const folder = `DUR01_${rand}`;
  const run = await sse({
    objective: `Create a folder ${folder} containing x.txt with content 'dur01', then read it back.`,
  });
  const onDisk = await fs.stat(path.join(WORKSPACE, folder)).then(() => true).catch(() => false);
  const row = run.taskId ? await db.agentTask.findUnique({ where: { id: run.taskId }, include: { effects: true } }) : null;
  const settledOrExecuted = row?.effects.filter((e) => e.status !== "ADMITTED").length ?? -1;
  record(
    "DUR-01",
    "admission failure blocks the effect entirely",
    run.final === "failed" &&
      !onDisk &&
      (row?.effects.length ?? 0) === 0 &&
      settledOrExecuted === 0,
    `final=${run.final} onDisk=${onDisk} effectRows=${row?.effects.length ?? "?"} (expect failed/absent/0)`,
  );
  if (row && row.effects.length === 0) {
    record("DUR-01b", "task failed honestly with admission-refused text",
      (row.finalText ?? "").includes("REFUSED") || run.raw.includes("REFUSED"),
      `finalText mentions refusal: ${(row.finalText ?? "").slice(0, 90)}`);
  }
}

// ———————————————————————————————— dur02 (settlement fault + reconciliation)

async function dur02() {
  const folder = `DUR02_${rand}`;
  const run = await sse({
    objective: `Create a folder ${folder} containing y.txt with content 'dur02', then read it back.`,
  });
  const filePath = path.join(WORKSPACE, folder, "y.txt");
  const onDisk = await fs.readFile(filePath, "utf8").catch(() => null);
  const row = run.taskId ? await db.agentTask.findUnique({ where: { id: run.taskId }, include: { effects: true } }) : null;

  record(
    "DUR-02",
    "settlement failure: effect happened but NO false completion",
    onDisk === "dur02" &&
      run.final === "effect_unknown" &&
      row?.status !== "completed" &&
      !!row && ["executing", "effect_unknown"].includes(row.status),
    `disk=${onDisk === "dur02" ? "effect-present" : onDisk} sseFinal=${run.final} dbStatus=${row?.status}`,
  );

  // ——— crash recovery: shift the task stale and reconcile (§5.5) ———
  if (row) {
    await db.agentTask.update({
      where: { id: row.id },
      data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    await reconcileCrashedTasks();
    const rec = await db.agentTask.findUnique({ where: { id: row.id }, include: { effects: true } });
    const settled = rec?.effects.filter((e) => e.status === "SETTLED").length ?? 0;
    record(
      "DUR-02b",
      "reconciliation verifies effects on disk → honest PARTIAL (not completed)",
      rec?.status === "partial" && settled === (rec?.effects.length ?? -1),
      `status=${rec?.status} effectsSettled=${settled}/${rec?.effects.length ?? "?"}`,
    );
  }
}

// ———————————————————————————————— dur03 (restart continuity + DUR-08)

async function dur03Setup() {
  const folder = `DUR03_${rand}`;
  const run = await sse({
    objective: `Create a folder ${folder} containing r1.txt with content 'r1' and r2.txt with content 'r2', then list the folder.`,
    stepBudget: 1,
  });
  await fs.writeFile("/tmp/dur03.json", JSON.stringify({ taskId: run.taskId, folder, final: run.final }));
  record("DUR-03-setup", "task durably paused at budget 1", run.final === "paused" && !!run.taskId,
    `final=${run.final} id=${run.taskId?.slice(0, 8)}`);
}

async function dur03Verify() {
  const ctx = JSON.parse(await fs.readFile("/tmp/dur03.json", "utf8")) as { taskId: string; folder: string };

  // Resume through the real API after the real restart.
  const run = await sse({ resumeTaskId: ctx.taskId, stepBudget: 12 });
  const row = await db.agentTask.findUnique({ where: { id: ctx.taskId }, include: { effects: true } });

  // Zero re-execution evidence (deterministic):
  //  1. exactly ONE create_folder effect row in the durable admission table
  //  2. the resume trace contains NO real create-folder execution receipt
  //     ("directory created and verified on disk" is only ever emitted by
  //     the executor itself; skip paths say "NOT re-executed")
  //  3. the objective is actually achieved (r1.txt + r2.txt, exact content)
  const creates = row?.effects.filter((e) => e.tool === "create_folder") ?? [];
  const realCreateInResume = /directory created and verified on disk/.test(run.raw);
  const r1 = await fs.readFile(path.join(WORKSPACE, ctx.folder, "r1.txt"), "utf8").catch(() => null);
  const r2 = await fs.readFile(path.join(WORKSPACE, ctx.folder, "r2.txt"), "utf8").catch(() => null);
  record(
    "DUR-03",
    "restart continuity: resume with zero re-execution",
    run.final === "completed" &&
      creates.length === 1 &&
      !realCreateInResume &&
      r1 === "r1" &&
      r2 === "r2",
    `final=${run.final} createEffectRows=${creates.length} realCreateReExecuted=${realCreateInResume} r1=${r1 === "r1"} r2=${r2 === "r2"}`,
  );

  // DUR-08: NEXUS status channel agrees with the durable backend.
  const statusRes = await fetch(`${BASE}/api/jarvis/task/status?taskId=${ctx.taskId}`, {
    headers: jar(OWNER_TOKEN),
  });
  const sj = (await statusRes.json()) as { task?: { status: string; effects: { settled: number } } };
  record(
    "DUR-08",
    "status route agrees with durable backend after reconnection",
    statusRes.status === 200 && sj.task?.status === row?.status && sj.task?.status === "completed" && sj.task.effects.settled >= 2,
    `route=${sj.task?.status} db=${row?.status} settled=${sj.task?.effects.settled}`,
  );
}

// ———————————————————————————————— dur04 (uncertain effect; no blind replay)

async function dur04() {
  const folder = `DUR04_${rand}`;
  // Ghost effect: ADMITTED write of a file that NEVER existed (a crash
  // between admission and execution). Injected directly into the DB.
  const t = await db.agentTask.create({
    data: { objective: `DUR-04 ghost effect probe ${rand}`, status: "executing", stepsUsed: 0 },
  });
  const ghostRel = `${folder}/ghost.txt`;
  await db.effectRecord.create({
    data: {
      taskId: t.id,
      effectKey: `0|write_file|${JSON.stringify({ content: "ghost", path: ghostRel })}`,
      status: "ADMITTED",
      tool: "write_file",
      argsJson: JSON.stringify({ path: ghostRel, content: "ghost" }),
    },
  });
  await db.agentTask.update({
    where: { id: t.id },
    data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) },
  });

  await reconcileCrashedTasks();

  const ghostOnDisk = await fs.readFile(path.join(WORKSPACE, ghostRel), "utf8").catch(() => null);
  const row = await db.agentTask.findUnique({ where: { id: t.id }, include: { effects: true } });
  const effectRow = row?.effects[0];
  record(
    "DUR-04",
    "uncertain effect: no blind replay, honest EFFECT_UNKNOWN",
    row?.status === "effect_unknown" &&
      effectRow?.status === "EFFECT_UNKNOWN" &&
      ghostOnDisk === null,
    `task=${row?.status} effect=${effectRow?.status} ghostFileCreated=${ghostOnDisk !== null}`,
  );
  await db.agentTask.delete({ where: { id: t.id } });
}

// ———————————————————————————————— dispatch

const fn: Record<string, () => Promise<void>> = {
  unit,
  dur01,
  dur02,
  "dur03-setup": dur03Setup,
  "dur03-verify": dur03Verify,
  dur04,
};

const which = fn[cmd];
if (!which) {
  console.error(`unknown probe '${cmd}'`);
  process.exit(2);
}
if (cmd !== "unit" && !OWNER_TOKEN) {
  console.error("JARVIS_OWNER_TOKEN env var required for this probe");
  process.exit(2);
}

await which();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== PHASE 02 DUR PROBES (${cmd}) — ${results.length - failed.length}/${results.length} PASS ===`);
await db.$disconnect();
process.exit(failed.length === 0 ? 0 : 1);
