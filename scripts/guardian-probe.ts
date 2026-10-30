/**
 * JARVIS GUARDIAN GATE PROBES — Session 3 falsification round.
 * Direct gate-level negative/positive probes for the command-args channel
 * (the file-args scope hole found during independent code audit).
 * Every probe passes through the REAL authorizeToolCall() (incl. audit trail).
 * Usage: bun run scripts/guardian-probe.ts   (NOT part of the Next app build)
 */
import { authorizeToolCall } from "../src/lib/agent/guardian/guardian";
import { executeTool } from "../src/lib/agent/tools/executor";
import { db } from "../src/lib/db";

// The runtime always authors audits under a REAL AgentTask row (FK-enforced).
// Reproduce that contract exactly: create the task first, like the route does.
const probeTask = await db.agentTask.create({
  data: {
    objective: "Guardian gate falsification probes (session 3 audit)",
    status: "failed",
    stepsUsed: 0,
  },
});
const PROBE_TASK_ID = probeTask.id;
console.log(`probe task: ${PROBE_TASK_ID}`);

const CASES: { name: string; tool: string; args: Record<string, unknown> }[] = [
  { name: "P1 absolute file arg (cat /etc/passwd)", tool: "run_command", args: { command: "cat", args: ["/etc/passwd"] } },
  { name: "P2 traversal file arg (cat ../../../etc/shadow)", tool: "run_command", args: { command: "cat", args: ["../../../etc/shadow"] } },
  { name: "P3 traversal dir arg (ls ../..)", tool: "run_command", args: { command: "ls", args: ["../.."] } },
  { name: "P4 windows path arg (cat C:\\Windows\\win.ini)", tool: "run_command", args: { command: "cat", args: ["C:\\Windows\\win.ini"] } },
  { name: "P5 non-array args (cat with string)", tool: "run_command", args: { command: "cat", args: "JARVIS_AGENT_TEST/result.txt" } },
  { name: "P6 null byte arg", tool: "run_command", args: { command: "cat", args: ["a\u0000../../etc/passwd"] } },
  { name: "N1 read_file absolute regression", tool: "read_file", args: { path: "/etc/shadow" } },
  { name: "N2 non-allowlisted binary regression", tool: "run_command", args: { command: "rm", args: ["-rf", "/"] } },
  // Positive controls — must ALLOW and execute correctly
  { name: "A1 legit cat of existing workspace file", tool: "run_command", args: { command: "cat", args: ["JARVIS_AGENT_TEST/result.txt"] } },
  { name: "A2 legit ls of existing workspace folder", tool: "run_command", args: { command: "ls", args: ["MULTI_STEP_TEST"] } },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const d = await authorizeToolCall({ taskId: PROBE_TASK_ID }, c.tool, c.args);
  const expectedDeny = c.name.startsWith("P") || c.name.startsWith("N");
  const isDeny = d.verdict === "deny";
  const verdictOk = expectedDeny ? isDeny : !isDeny;
  if (verdictOk) pass++; else fail++;
  console.log(
    `${verdictOk ? "OK " : "XX "} ${c.name}\n     → ${d.verdict.toUpperCase()}${d.reason ? ` (${d.reason})` : ""}${d.prepared?.args ? ` prepared=${JSON.stringify(d.prepared.args)} cmd=${d.prepared.command}` : ""}`,
  );
}

// Execute the two positive controls end-to-end at the executor boundary.
console.log("\n— executor boundary (positive controls) —");
const a1 = await authorizeToolCall({ taskId: PROBE_TASK_ID }, "run_command", { command: "cat", args: ["JARVIS_AGENT_TEST/result.txt"] });
if (a1.verdict === "allow") {
  const r = await executeTool(PROBE_TASK_ID, "run_command", a1);
  console.log(`A1 exec: ok=${r.ok} :: ${r.evidence.slice(0, 160)}`);
  if (!r.ok) fail++; else pass++;
}
const a2 = await authorizeToolCall({ taskId: PROBE_TASK_ID }, "run_command", { command: "ls", args: ["MULTI_STEP_TEST"] });
if (a2.verdict === "allow") {
  const r = await executeTool(PROBE_TASK_ID, "run_command", a2);
  console.log(`A2 exec: ok=${r.ok} :: ${r.evidence.slice(0, 160)}`);
  if (!r.ok) fail++; else pass++;
}

console.log(`\nPROBE SUMMARY: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
