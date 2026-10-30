/**
 * JARVIS PHASE 01 — AUTHORIZATION PROBES (AUTH-01 … AUTH-10).
 *
 * Real HTTP probes against the running dev server with REAL sessions:
 *   - the OWNER is the browser-enrolled principal (token from env)
 *   - a second DEVICE pairs via the real pairing endpoint
 *   - every expectation is asserted against actual status codes and,
 *     where ownership matters, against the durable database rows.
 *
 * Usage:
 *   JARVIS_OWNER_TOKEN=<token> bun run scripts/auth-probe.ts phase1
 *   # … restart the dev server …
 *   JARVIS_OWNER_TOKEN=<token> bun run scripts/auth-probe.ts phase2
 *
 * Evidence: prints a PASS/FAIL table and exits non-zero on any FAIL.
 */

import { db } from "../src/lib/db";
import { hashToken } from "../src/lib/agent/auth/session";

const BASE = "http://localhost:3000";
const OWNER_TOKEN = process.env.JARVIS_OWNER_TOKEN ?? "";
if (!OWNER_TOKEN) {
  console.error("JARVIS_OWNER_TOKEN env var required");
  process.exit(2);
}
const phase = process.argv[2] === "phase2" ? "phase2" : "phase1";

interface Row {
  id: string;
  name: string;
  expect: string;
  actual: string;
  pass: boolean;
}
const results: Row[] = [];
function record(id: string, name: string, expect: string, actual: string, pass: boolean) {
  results.push({ id, name, expect, actual, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id} ${name} — expect ${expect}; got ${actual}`);
}

const jar = (token?: string): Record<string, string> =>
  token ? { cookie: `jarvis_session=${token}` } : {};
const JSONH = { "content-type": "application/json" };

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string; type: string }> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { ...JSONH, ...jar(headers.__token), ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, type: res.headers.get("content-type") ?? "" };
}

/** Read an SSE task stream to completion; return its final status + text. */
interface SseOutcome {
  status: number;
  final: string;
  text: string;
  raw?: string;
  type: string;
}
async function runSse(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<SseOutcome> {
  const res = await fetch(BASE + "/api/jarvis/task", {
    method: "POST",
    headers: { ...JSONH, ...jar(headers.__token), ...headers },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) {
    const text = await res.text();
    return { status: res.status, final: "", text, type: res.headers.get("content-type") ?? "" };
  }
  const raw = await res.text();
  const m = raw.match(/event: final\ndata: (.*)\n/);
  let final = "";
  let text = "";
  if (m) {
    try {
      const f = JSON.parse(m[1]) as { status?: string; text?: string };
      final = f.status ?? "";
      text = f.text ?? "";
    } catch {
      /* keep empty */
    }
  }
  return { status: res.status, final, text, raw, type: "sse" };
}

const rand = Math.random().toString(36).slice(2, 8);

async function phase1() {
  // ——— identify the owner principal (from the real session) ———
  const me = await fetch(BASE + "/api/jarvis/auth/session", { headers: jar(OWNER_TOKEN) });
  const meJson = (await me.json()) as { principal?: { principalId: string; role: string } };
  const ownerId = meJson.principal?.principalId ?? "";
  record("AUTH-00", "owner session introspection", "200 + OWNER", `${me.status} ${meJson.principal?.role ?? "none"}`, me.status === 200 && meJson.principal?.role === "OWNER");

  // ——— AUTH-01: valid owner creates an authorized test task ———
  {
    const sse = await runSse({ objective: `Reply with exactly the word ACK and nothing else. (probe ${rand})` }, { __token: OWNER_TOKEN });
    const ok = sse.status === 200 && (sse.final === "completed" || sse.text.includes("ACK"));
    // Ownership verified against the durable row:
    let dbOwner = "(none)";
    const taskMatch = sse.raw?.match(/"taskId":"([^"]+)"/);
    if (taskMatch) {
      const row = await db.agentTask.findUnique({ where: { id: taskMatch[1] } });
      dbOwner = row?.ownerId ?? "(null)";
    }
    record("AUTH-01", "owner creates authorized task", "200 SSE + DB ownerId=owner", `${sse.status}/${sse.final} DB owner=${dbOwner === ownerId ? "owner" : dbOwner}`, ok && dbOwner === ownerId);
  }

  // ——— AUTH-02: anonymous requests rejected ———
  {
    const a = await post("/api/jarvis/task", { objective: "hi" });
    const b = await post("/api/jarvis/task/cancel", { taskId: "whatever" });
    const c = await post("/api/jarvis/auth/devices", { action: "approve", principalId: "x" });
    record("AUTH-02", "anonymous task/cancel/devices rejected", "401/401/401", `${a.status}/${b.status}/${c.status}`, a.status === 401 && b.status === 401 && c.status === 401);
  }

  // ——— create the cross-user target: a PAUSED owner task ———
  let ownerTaskId = "";
  {
    const sse = await runSse(
      {
        objective: `Create a folder AUTH_PROBE_${rand} containing two files a.txt with content 'alpha' and b.txt with content 'beta', then list the folder.`,
        stepBudget: 1,
      },
      { __token: OWNER_TOKEN },
    );
    const m = sse.raw?.match(/"taskId":"([^"]+)"/);
    ownerTaskId = m?.[1] ?? "";
    record("PREP", "owner task paused at budget 1", "final=paused", `final=${sse.final} id=${ownerTaskId.slice(0, 8)}`, sse.final === "paused" && !!ownerTaskId);
  }

  // ——— pair a second device ———
  let deviceToken = "";
  let deviceId = "";
  {
    const res = await fetch(BASE + "/api/jarvis/auth/pair", { method: "POST" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    deviceToken = /jarvis_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
    const body = (await res.json()) as { principal?: { id: string; status: string; label: string } };
    deviceId = body.principal?.id ?? "";
    record("PREP", "device paired as PENDING", "PENDING + session cookie", `${body.principal?.status ?? "?"} token=${deviceToken ? "yes" : "NO"}`, body.principal?.status === "PENDING" && !!deviceToken);
  }

  // ——— PENDING device is quarantined from task operations ———
  {
    const r = await post("/api/jarvis/task", { objective: "hi" }, { __token: deviceToken });
    record("PENDING-Q", "PENDING device cannot create tasks", "403", `${r.status}`, r.status === 403);
  }

  // ——— owner approves the device ———
  {
    const r = await post("/api/jarvis/auth/devices", { principalId: deviceId, action: "approve" }, { __token: OWNER_TOKEN });
    record("PREP", "owner approves device", "200 ACTIVE", `${r.status} ${r.text.slice(0, 60)}`, r.status === 200);
  }

  // ——— AUTH-03/04/05/08: ACTIVE foreign principal vs owner's task ———
  {
    // 03: cannot VIEW (resume channel would disclose objective/journal via SSE)
    const view = await post("/api/jarvis/task", { resumeTaskId: ownerTaskId }, { __token: deviceToken });
    const discloses = view.text.includes("AUTH_PROBE_") || view.text.includes("a.txt");
    record("AUTH-03", "foreign principal cannot view/resume task data", "404, no disclosure", `${view.status}${discloses ? " (LEAKED!)" : ""}`, view.status === 404 && !discloses);

    // 04: cannot CANCEL
    const cancel = await post("/api/jarvis/task/cancel", { taskId: ownerTaskId }, { __token: deviceToken });
    record("AUTH-04", "foreign principal cannot cancel task", "404", `${cancel.status}`, cancel.status === 404);

    // 05: owner CAN still resume (positive control) → re-pauses at budget 1
    const resume = await runSse({ resumeTaskId: ownerTaskId, stepBudget: 1 }, { __token: OWNER_TOKEN });
    record("AUTH-05", "owner can resume; foreign cannot", "owner 200 paused again", `owner final=${resume.final}`, resume.final === "paused");

    // 08: the device's request never opened a task-event stream (JSON 404, not SSE)
    record("AUTH-08", "cross-session event stream cannot disclose", "JSON 404 (no SSE)", `content-type=${view.type.split(";")[0]}`, view.status === 404 && !view.type.includes("event-stream"));
  }

  // ——— AUTH-06: expired session rejected ———
  {
    await db.session.update({
      where: { tokenHash: hashToken(deviceToken) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const r = await post("/api/jarvis/task", { objective: "hi" }, { __token: deviceToken });
    record("AUTH-06", "expired session rejected", "401", `${r.status}`, r.status === 401);
  }

  // ——— AUTH-07: tampered session + client-supplied ownerId ignored ———
  {
    const tampered = await post("/api/jarvis/task", { objective: "hi" }, { __token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const sse = await runSse({ objective: "Reply with exactly ACK.", ownerId: "attacker-forged-id-123" }, { __token: OWNER_TOKEN });
    let dbOwner = "(none)";
    const m = sse.raw?.match(/"taskId":"([^"]+)"/);
    if (m) {
      const row = await db.agentTask.findUnique({ where: { id: m[1] } });
      dbOwner = row?.ownerId ?? "(null)";
    }
    record("AUTH-07", "tampered token 401; body ownerId ignored", `401; DB owner=owner`, `${tampered.status}; DB owner=${dbOwner === ownerId ? "owner (forged id ignored)" : dbOwner}`, tampered.status === 401 && dbOwner === ownerId);
  }

  // ——— AUTH-10: repeated requests cannot escalate ———
  // (uses a FRESH approved device — AUTH-06 already invalidated device 1's
  //  session, and a dead token must 401 at the auth layer, not 403)
  {
    let d2token = "";
    let d2id = "";
    const pair2 = await fetch(BASE + "/api/jarvis/auth/pair", { method: "POST" });
    d2token = /jarvis_session=([^;]+)/.exec(pair2.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const d2body = (await pair2.json()) as { principal?: { id: string } };
    d2id = d2body.principal?.id ?? "";
    const approve2 = await post("/api/jarvis/auth/devices", { principalId: d2id, action: "approve" }, { __token: OWNER_TOKEN });
    const approved = approve2.status === 200;

    const anonBoot = await post("/api/jarvis/auth/bootstrap", {});
    const devBoot = await post("/api/jarvis/auth/bootstrap", {}, { __token: OWNER_TOKEN });
    const devApproveSelf = await post("/api/jarvis/auth/devices", { principalId: d2id, action: "approve" }, { __token: d2token });
    const devList = await fetch(BASE + "/api/jarvis/auth/devices", { headers: jar(d2token) });
    record("AUTH-10", "no escalation via bootstrap/approve/list", `403/403/403/403 (device2 approved=${approved})`, `${anonBoot.status}/${devBoot.status}/${devApproveSelf.status}/${devList.status}`, approved && anonBoot.status === 403 && devBoot.status === 403 && devApproveSelf.status === 403 && devList.status === 403);
  }

  // ——— CSRF: foreign Origin rejected even with a valid session ———
  {
    const r = await post("/api/jarvis/task/cancel", { taskId: ownerTaskId }, { __token: OWNER_TOKEN, origin: "https://evil.example.com" });
    record("CSRF", "cross-origin state change rejected", "403", `${r.status}`, r.status === 403);
  }

  // ——— stash context for phase 2 (AUTH-09) ———
  const { writeFileSync } = await import("fs");
  writeFileSync(
    "/tmp/auth-phase2.json",
    JSON.stringify({ ownerTaskId, deviceId, expiredDeviceToken: deviceToken, ownerId }),
  );
}

async function phase2() {
  const { readFileSync } = await import("fs");
  const ctx = JSON.parse(readFileSync("/tmp/auth-phase2.json", "utf8")) as {
    ownerTaskId: string;
    deviceId: string;
    expiredDeviceToken: string;
    ownerId: string;
  };

  // owner session survives the restart (sessions are durable rows)
  const me = await fetch(BASE + "/api/jarvis/auth/session", { headers: jar(OWNER_TOKEN) });
  record("AUTH-09a", "owner session valid after restart", "200", `${me.status}`, me.status === 200);

  // ownership rows intact
  const row = await db.agentTask.findUnique({ where: { id: ctx.ownerTaskId } });
  record("AUTH-09b", "task ownership intact after restart", "ownerId unchanged", `ownerId=${row?.ownerId === ctx.ownerId ? "owner" : "CHANGED"}`, row?.ownerId === ctx.ownerId);

  // expired device session STAYS rejected (revocation/expiry is durable)
  const exp = await post("/api/jarvis/task", { objective: "hi" }, { __token: ctx.expiredDeviceToken });
  record("AUTH-09c", "expired session stays rejected after restart", "401", `${exp.status}`, exp.status === 401);

  // owner still cannot be impersonated on the paused task by a fresh anonymous client
  const anon = await post("/api/jarvis/task/cancel", { taskId: ctx.ownerTaskId });
  record("AUTH-09d", "anonymous still rejected after restart", "401", `${anon.status}`, anon.status === 401);

  // owner can still act on their own task (positive control)
  const cancel = await post("/api/jarvis/task/cancel", { taskId: ctx.ownerTaskId }, { __token: OWNER_TOKEN });
  record("AUTH-09e", "owner can still cancel own task", "200", `${cancel.status}`, cancel.status === 200);
}

if (phase === "phase1") await phase1();
else await phase2();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== PHASE 01 AUTH PROBES (${phase}) — ${results.length - failed.length}/${results.length} PASS ===`);
await db.$disconnect();
process.exit(failed.length === 0 ? 0 : 1);
