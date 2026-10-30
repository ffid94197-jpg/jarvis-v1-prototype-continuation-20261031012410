/**
 * JARVIS PHASE 03 — COMPLETION-VERIFICATION PROBES (VER-01 … VER-06).
 *
 * The Core's completion arbitration is tested deterministically at the
 * arbiter level (unit) AND live end-to-end with REAL tasks where the
 * model CANNOT satisfy the objective (read-only poisoned files):
 *
 *   bun run scripts/verify-probe.ts unit   — VER-01, VER-06 (arbiter, no server)
 *   bun run scripts/verify-probe.ts live   — VER-02, VER-03, VER-04, VER-05
 */

import fs from "fs/promises";
import path from "path";
import { db } from "../src/lib/db";
import { arbitrateCompletion, extractPredicates } from "../src/lib/agent/core/verifier";

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

async function sse(body: unknown) {
  const res = await fetch(BASE + "/api/jarvis/task", {
    method: "POST",
    headers: { "content-type": "application/json", ...jar(OWNER_TOKEN) },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const m = raw.match(/event: final\ndata: (.*)\n/);
  let final = "";
  let text = "";
  let taskId = "";
  const tm = raw.match(/"taskId":"([^"]+)"/);
  if (tm) taskId = tm[1];
  if (m) {
    try {
      const f = JSON.parse(m[1]) as { status?: string; text?: string };
      final = f.status ?? "";
      text = f.text ?? "";
    } catch { /* ignore */ }
  }
  return { http: res.status, raw, final, text, taskId };
}

// ———————————————————————————————— unit (VER-01, VER-06)

async function unit() {
  // VER-01: model says "completed" (proposes final) before creating
  // anything; the arbiter must REFUSE success with zero effects.
  {
    const folder = `VER01_UNIT_${rand}`;
    const t = await db.agentTask.create({
      data: { objective: `Create a folder ${folder} with file proof.txt saying 'done'.`, status: "planning", stepsUsed: 0 },
    });
    const arb = await arbitrateCompletion({ taskId: t.id, objective: t.objective, toolAssisted: false });
    const onDisk = await fs.stat(path.join(WORKSPACE, folder)).then(() => true).catch(() => false);
    record(
      "VER-01",
      "final-without-effects rejected (no false completion)",
      arb.verdict === "failed" && !onDisk && arb.predicateLines.some((l) => l.includes("absent from disk")),
      `verdict=${arb.verdict} disk=${onDisk} predicates=${arb.predicateLines.length}`,
    );
    // Clean extraction sanity: the objective yields exactly 2 predicates.
    const preds = extractPredicates(t.objective);
    record(
      "VER-01b",
      "predicate extraction finds folder + file(content)",
      preds.length === 2 && preds.some((p) => p.kind === "folder") && preds.some((p) => p.kind === "file" && p.expectedContent === "done"),
      `predicates=${preds.map((p) => `${p.kind}:${p.relPath}`).join(",")}`,
    );
    await db.agentTask.delete({ where: { id: t.id } });
  }

  // VER-06: an EFFECT_UNKNOWN durable effect can never yield verified.
  {
    const folder = `VER06_UNIT_${rand}`;
    const t = await db.agentTask.create({
      data: { objective: `Create a folder ${folder} with file u.txt saying 'u'.`, status: "executing", stepsUsed: 1 },
    });
    await db.effectRecord.create({
      data: {
        taskId: t.id,
        effectKey: `0|write_file|${JSON.stringify({ content: "u", path: `${folder}/u.txt` })}`,
        status: "EFFECT_UNKNOWN",
        tool: "write_file",
        argsJson: JSON.stringify({ path: `${folder}/u.txt`, content: "u" }),
      },
    });
    const arb = await arbitrateCompletion({ taskId: t.id, objective: t.objective, toolAssisted: true });
    record(
      "VER-06",
      "uncertain effect ⇒ never a verified completion",
      arb.verdict === "effect_unknown",
      `verdict=${arb.verdict}`,
    );
    await db.effectRecord.deleteMany({ where: { taskId: t.id } });
    await db.agentTask.delete({ where: { id: t.id } });
  }

  // Conversational guard: a question-like objective must yield NO predicates.
  {
    const preds = extractPredicates("What would a file named notes.txt with content 'x' look like? Just answer, don't create anything.");
    record("VER-QA", "question-like objectives are conversational", preds.length === 0, `predicates=${preds.length}`);
  }
}

// ———————————————————————————————— live (VER-02/03/04/05)

// live(sections): run ALL live probes, or a subset when a section
// filter is passed (argv[3]): "ver34" = VER-03/04, "ver5" = VER-05.
async function live(only?: string) {
  if (!OWNER_TOKEN) {
    console.error("JARVIS_OWNER_TOKEN required for live probes");
    process.exit(2);
  }
  const want = (tag: string) => !only || only === tag;
  // Space the live tasks out — the planning channel is rate-limited and
  // honest 429 failures are runtime-correct but pollute THIS probe's signal.
  const breathe = (ms: number) => new Promise((r) => setTimeout(r, ms));

  if (want("ver34")) {
  // VER-03 + VER-04: golden path — every predicate passes; digest shows
  // RECEIPT paths only (no fabricated paths).
  {
    const folder = `VER03_${rand}`;
    const run = await sse({
      objective: `Create a folder ${folder} with file notes.txt saying 'verified golden', then read it back to verify.`,
    });
    const content = await fs.readFile(path.join(WORKSPACE, folder, "notes.txt"), "utf8").catch(() => null);
    const digestHasVerdict = run.text.includes("VERDICT: VERIFIED");
    const digestHasRelPath = run.text.includes(`${folder}/notes.txt`);
    const noFabricatedPath = !/\/etc\/|\.\.\//.test(run.text.replace(/notes\.txt/g, ""));
    record(
      "VER-03",
      "all predicates pass → VERIFIED → completed",
      run.final === "completed" && content === "verified golden" && digestHasVerdict,
      `final=${run.final} disk=${content === "verified golden"} digestVerdict=${digestHasVerdict}`,
    );
    record(
      "VER-04",
      "digest shows observed receipt paths, no fabrication",
      digestHasRelPath && noFabricatedPath,
      `relPathInDigest=${digestHasRelPath} noFabrication=${noFabricatedPath}`,
    );
    await breathe(25_000);
  }
  }

  if (want("ver2")) {
  // VER-02: exact content differs (poisoned read-only file) → PARTIAL.
  {
    const folder = `VER02_${rand}`;
    await fs.mkdir(path.join(WORKSPACE, folder), { recursive: true });
    const filePath = path.join(WORKSPACE, folder, "locked.txt");
    await fs.writeFile(filePath, "WRONG CONTENT", "utf8");
    await fs.chmod(filePath, 0o444); // read-only: the model CANNOT fix this
    const run = await sse({
      objective: `Create a folder ${folder} with file locked.txt saying 'the truth', then read it back.`,
    });
    const after = await fs.readFile(filePath, "utf8").catch(() => null);
    record(
      "VER-02",
      "content mismatch reported as PARTIAL (never completed)",
      run.final === "partial" && after === "WRONG CONTENT" && /content mismatch|✗ PREDICATE file/.test(run.text),
      `final=${run.final} diskUnchanged=${after === "WRONG CONTENT"} digestMentioned=${/✗ PREDICATE file/.test(run.text)}`,
    );
    await fs.chmod(filePath, 0o644).catch(() => {});
    await breathe(25_000);
  }
  }

  if (want("ver5")) {
  // VER-05: one of five required steps poisoned → cannot report full success.
  {
    const folder = `VER05_${rand}`;
    await fs.mkdir(path.join(WORKSPACE, folder), { recursive: true });
    const poisoned = path.join(WORKSPACE, folder, "c.txt");
    await fs.writeFile(poisoned, "poisoned", "utf8");
    await fs.chmod(poisoned, 0o444);
    const run = await sse({
      objective: `Create a folder ${folder} containing five files a.txt saying 'a', b.txt saying 'b', c.txt saying 'c', d.txt saying 'd', e.txt saying 'e', then list the folder.`,
      stepBudget: 24,
    });
    const expected: Record<string, string> = { a: "a", b: "b", d: "d", e: "e" };
    const checks = await Promise.all(
      Object.entries(expected).map(async ([n, want]) =>
        (await fs.readFile(path.join(WORKSPACE, folder, `${n}.txt`), "utf8").catch(() => null)) === want,
      ),
    );
    const fourOK = checks.every(Boolean);
    record(
      "VER-05",
      "1-of-5 missing/mismatched step → PARTIAL, not full success",
      run.final === "partial" &&
        run.text.includes("PARTIAL") &&
        fourOK &&
        /c\.txt/.test(run.text),
      `final=${run.final} fourOtherFilesOK=${fourOK} cTxtFlagged=${/c\.txt/.test(run.text)}`,
    );
    await fs.chmod(poisoned, 0o644).catch(() => {});
  }
  }
}

const fn: Record<string, () => Promise<void>> = {
  unit,
  live: () => live(process.argv[3]),
  "live-verified": () => live("ver34"),
  "live-partial": () => live("ver2"),
  "live-five": () => live("ver5"),
};
const chosen = cmd in fn ? cmd : "live";
await fn[chosen]?.();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== PHASE 03 VER PROBES (${cmd}) — ${results.length - failed.length}/${results.length} PASS ===`);
await db.$disconnect();
process.exit(failed.length === 0 ? 0 : 1);
