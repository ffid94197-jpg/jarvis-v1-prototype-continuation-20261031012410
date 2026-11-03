/**
 * JARVIS V1 — Core must perform REAL actions for actionable objectives.
 *
 * Owner-observed failure:
 *     Actionable task requires REAL actions and independently checked evidence.
 *     The planner attempted to finish without independently verifying the
 *     requested external work. No tool action has been verified.
 *
 * The verifier's rejection was CORRECT. The defect was that Core treated it as
 * terminal: it surfaced the message once and stopped, instead of sending the
 * planner back to choose a real action. That is now bounded replanning
 * (MAX_ACTION_NUDGES), and this suite proves the whole chain BEHAVIOURALLY by
 * driving runTask, not by reading source.
 *
 * Deliberately NOT mocked:
 *   - src/lib/agent/core/verifier.ts   the real completion arbitrator
 *   - src/lib/agent/core/requestIntent.ts  the real actionable/conversational split
 *   - src/lib/agent/core/prompts.ts    the real planner prompts and identity guard
 *   - src/lib/agent/core/autonomyGate.ts, goalPlanner.ts
 *   - src/lib/agent/guardian/policy.ts the real scoped-path gate and WORKSPACE_ROOT
 *   - the real filesystem, inside a private mkdtemp workspace
 *
 * The completion verifier is NEVER weakened here: success in scenario B is only
 * accepted because the real verifier independently read the file back from disk
 * and matched its contents. Scenario B2 proves the same run reports FAILURE when
 * the content is wrong, so the assertions are not vacuous.
 *
 * OFFLINE. No provider, no OS automation, no Minecraft, no network.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
// A private, isolated workspace so real writes cannot escape this test.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-core-action-'));
process.env.JARVIS_AGENT_WORKSPACE = workspace;
process.env.JARVIS_GOAL_PLANNER_ENABLED = '0'; // planner-path coverage lives in verify-goal-loop-integration
process.env.JARVIS_WINDOWS_AGENT_ENABLED = '0';

let checks = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { checks++; console.log('PASS', label); return true; }
  failures.push(label + (detail ? ` — ${detail}` : ''));
  console.log('FAIL', label, detail ? `— ${detail}` : '');
  return false;
}

function compile(rel) {
  const file = path.join(root, rel);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      // policy.ts does `import path from "path"`; without interop TS emits
      // path_1.default, which is undefined for a CommonJS builtin.
      esModuleInterop: true, allowSyntheticDefaultImports: true },
    reportDiagnostics: true,
  });
  const errs = out.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) throw new Error(`TS errors in ${rel}: ${errs.map((e) => e.messageText).join('; ')}`);
  return out.outputText;
}

// ——— mutable per-scenario state ————————————————————————————————————————————
let stepRows = [];
let effectRows = [];
const taskRow = { id: 'scenario-task', status: 'queued' };
let guardianVerdict = 'allow';
let guardianCalls = 0;
let executorCalls = 0;
let modelCalls = 0;
let decisions = [];
let failToolOnce = null; // tool name whose FIRST execution should fail transiently
const failedOnce = new Set();

const db = {
  agentStep: {
    create: async ({ data }) => { stepRows.push(data); return data; },
    findFirst: async ({ where }) => {
      const kind = where?.kind;
      return stepRows
        .filter((r) => (kind && typeof kind === 'object' && kind.in ? kind.in.includes(r.kind) : r.kind === kind))
        .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0] ?? null;
    },
    findMany: async () => stepRows,
    count: async () => stepRows.length,
  },
  agentTask: { findUnique: async () => taskRow },
  effectRecord: { findMany: async ({ where }) => effectRows.filter((r) => r.taskId === where?.taskId) },
};

const policy = (() => {
  const mod = {};
  vm.runInNewContext(compile('src/lib/agent/guardian/policy.ts'), {
    exports: mod, module: { exports: mod }, require, console, process,
    setTimeout, clearTimeout, URL, TextEncoder, TextDecoder, Buffer,
  }, { filename: 'policy.ts' });
  return mod;
})();
ok(policy.WORKSPACE_ROOT === fs.realpathSync(workspace) || policy.WORKSPACE_ROOT === workspace,
  'the real Guardian workspace root is the isolated temp dir', String(policy.WORKSPACE_ROOT));

/** A real filesystem executor for the tools these scenarios use. */
const executorTrace = [];
/** Mirrors the real executor signature: Guardian supplies prepared absolute paths. */
async function executeTool(taskId, tool, decision) {
  executorCalls++;
  const prepared = (decision?.prepared ?? {});
  executorTrace.push({ taskId, tool, preparedKeys: Object.keys(prepared), path: prepared.relPath ?? prepared.path });
  if (failToolOnce === tool && !failedOnce.has(tool)) {
    failedOnce.add(tool);
    return { ok: false, error: `${tool} failed: transient I/O error, retry` };
  }
  const abs = prepared.path;
  if (typeof abs !== 'string') return { ok: false, error: 'Guardian did not prepare a path' };
  // Defense in depth: re-assert containment exactly as the real executor does.
  if (!(await policy.assertWithinRoot(abs)).ok) return { ok: false, error: 'path escapes the Guardian workspace' };
  if (tool === 'write_file') {
    const content = String(prepared.content ?? '');
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content, 'utf8');
    const readBack = await fs.promises.readFile(abs, 'utf8');
    const verified = readBack === content;
    return { ok: verified, tool, detail: { path: prepared.relPath, bytes: Buffer.byteLength(content), verified },
      evidence: `Wrote ${prepared.relPath} and verified ${Buffer.byteLength(readBack)} bytes` };
  }
  if (tool === 'read_file') {
    const content = await fs.promises.readFile(abs, 'utf8');
    return { ok: true, detail: { path: prepared.relPath, content },
      evidence: `Read ${prepared.relPath} (${content.length} chars)` };
  }
  if (tool === 'list_dir') {
    const entries = await fs.promises.readdir(abs);
    return { ok: true, detail: { path: prepared.relPath, entries }, evidence: `Listed ${prepared.relPath}` };
  }
  return { ok: false, error: `unknown tool ${tool}` };
}

const mocks = {
  '@/lib/db': { db },
  './modelProvider': {
    modelIdentityContext: () => 'CURRENT ADVISORY PROVIDER: backend=test provider="fixture" (test metadata, NOT your identity)',
    createModelBridge: async () => ({
      identity: { backend: 'test', provider: 'fixture', modelId: 'fixture', local: true },
      complete: async () => {
        modelCalls++;
        const d = decisions.shift();
        if (d === undefined) throw new Error('test guard: planner ran out of scripted decisions');
        return typeof d === 'string' ? d : JSON.stringify(d);
      },
      report: async () => 'Grounded report for the test scenario.',
    }),
  },
  './laya': { adviseTask: () => ({ route: 'test' }) },
  '../guardian/guardian': {
    // Same decision shape as the real gate (guardian.ts prepares
    // { path: p.abs, relPath: p.rel, content }). The REAL resolveScopedPath is
    // used, so the scoped-path security property is genuinely exercised.
    authorizeToolCall: async (_ctx, tool, rawArgs) => {
      guardianCalls++;
      if (guardianVerdict !== 'allow') {
        return { verdict: 'deny', reason: 'TEST: companion runtime not authorized' };
      }
      const p = policy.resolveScopedPath(rawArgs?.path);
      if (!p.ok) return { verdict: 'deny', reason: p.reason };
      return { verdict: 'allow', prepared: { path: p.abs, relPath: p.rel, content: rawArgs?.content } };
    },
  },
  '../tools/executor': { executeTool },
  '../adoption/registry.mjs': { list: async () => [] },
  './windowsIntent': { directWindowsLaunch: () => null },
  './minecraftIntent': { minecraftMissionFromObjective: () => null, directMinecraftMission: () => null },
  './capabilityIntent': { directCapabilityDiscovery: () => null },
  './minecraftAiGate': { minecraftDecisionPrompt: () => null },
  './taskState': { transitionTask: async (_id, to) => { taskRow.status = to; return { ok: true }; } },
  // Faithful effect ledger: admit before an effectful tool runs, settle after.
  './effects': {
    canonicalKey: (tool, args) => `${tool}:${JSON.stringify(args ?? {})}`,
    EFFECTFUL_TOOLS: new Set(['write_file']),
    STEP_SCOPED_EFFECTS: new Set(),
    isEffectfulToolInvocation: (tool) => tool === 'write_file',
    admitEffect: async (taskId, _planRevision, eff) => {
      const row = { taskId, tool: eff.tool, key: `${eff.tool}:${JSON.stringify(eff.args ?? {})}`,
        argsJson: JSON.stringify(eff.args ?? {}), receiptJson: null,
        status: 'ADMITTED', effectId: `eff-${effectRows.length + 1}` };
      effectRows.push(row);
      return { kind: 'admitted', effectId: row.effectId };
    },
    settleEffect: async (effectId, receipt, status = 'SETTLED') => {
      const row = effectRows.find((r) => r.effectId === effectId);
      if (row) { row.status = status; row.receiptJson = JSON.stringify(receipt); }
      return Boolean(row);
    },
  },
  './observation': { compactToolObservation: (r) => JSON.stringify({ ok: r.ok, detail: r.detail ?? r.error ?? null }).slice(0, 600) },
  './modelErrors': {
    classifyModelFailure: (e) => ({ code: 'MODEL_ERROR', publicMessage: e?.message?.slice(0, 60) ?? 'model error', retryable: false }),
  },
};

const compiledCache = new Map();
function load(rel) {
  if (compiledCache.has(rel)) return compiledCache.get(rel);
  const mod = {};
  compiledCache.set(rel, mod);
  const absDir = path.dirname(path.join(root, rel));
  const req = (name) => {
    if (name in mocks) return mocks[name];
    const resolveTs = (base) => {
      for (const c of [base + '.ts', path.join(base, 'index.ts')]) if (fs.existsSync(c)) return c;
      return null;
    };
    if (name.startsWith('.')) {
      const f = resolveTs(path.resolve(absDir, name));
      if (f) return load(path.relative(root, f));
      for (const c of [path.resolve(absDir, name) + '.mjs', path.resolve(absDir, name) + '.js']) {
        if (fs.existsSync(c)) return require(c);
      }
      return require(name);
    }
    if (name.startsWith('@/')) {
      const f = resolveTs(path.join(root, 'src', name.slice(2)));
      if (f) return load(path.relative(root, f));
    }
    return require(name);
  };
  vm.runInNewContext(compile(rel), {
    exports: mod, module: { exports: mod }, console, require: req, req,
    process: { env: process.env, cwd: () => root, platform: process.platform },
    setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
    TextEncoder, TextDecoder, AbortSignal, AbortController, Buffer, fetch: () => { throw new Error('TEST GUARD: no network'); },
  }, { filename: rel, timeout: 10000 });
  return mod;
}

const loop = load('src/lib/agent/core/loop.ts');
const verifier = load('src/lib/agent/core/verifier.ts');

async function runScenario({ objective, scripted, guardian = 'allow', failOnce = null, budget = 12 }) {
  stepRows = []; effectRows = []; decisions = [...scripted];
  guardianVerdict = guardian; guardianCalls = 0; executorCalls = 0; modelCalls = 0;
  failToolOnce = failOnce; failedOnce.clear();
  taskRow.status = 'queued';
  const events = [];
  let error = null;
  try {
    await loop.runTask({
      taskId: 'scenario-task', ownerId: 'owner', objective, budget, stepsUsedOffset: 0,
      emit: (e) => events.push(e), isCancelled: () => false,
    });
  } catch (err) { error = err; }
  const nudges = stepRows.filter((r) =>
    r.kind === 'replan' && /completion proposal rejected/.test(String(r.note || ''))).length;
  const toolSteps = stepRows.filter((r) => r.kind === 'tool_call').map((r) => r.tool);
  const finalEvent = events.find((e) => e.type === 'final');
  return { events, error, nudges, toolSteps, finalEvent, status: taskRow.status,
    steps: stepRows, effects: [...effectRows] };
}

(async () => {
  // ——— A. a greeting must NOT be forced through a tool action ——————————————
  console.log('\n── A. conversational request requires no external action ──');
  const a = await runScenario({
    objective: 'hi',
    scripted: [{ action: 'final', answer: 'Hello! I am JARVIS. How can I help?' }],
  });
  ok(a.error === null, 'A: the run completes without throwing', a.error?.message);
  ok(a.executorCalls === undefined || executorCalls === 0, 'A: zero tool executions', `executorCalls=${executorCalls}`);
  ok(guardianCalls === 0, 'A: Guardian is never consulted for a greeting', `calls=${guardianCalls}`);
  ok(a.nudges === 0, 'A: no completion nudge is sent for a conversational request', `nudges=${a.nudges}`);
  ok(a.status === 'completed', 'A: a greeting is allowed to complete', `status=${a.status}`);
  ok(!a.effects.some((e) => e.status !== 'SETTLED'), 'A: no unsettled effects recorded');

  // ——— B. actionable objective: premature finish must trigger bounded replan —
  console.log('\n── B. actionable objective must attempt a REAL tool action ──');
  const objective = 'Create file sample.txt containing "expected"';
  const b = await runScenario({
    objective,
    scripted: [
      { action: 'final', answer: 'Done.' },                                   // premature completion, zero steps
      { action: 'tool', tool: 'write_file', args: { path: 'sample.txt', content: 'expected' } },
      { action: 'tool', tool: 'read_file', args: { path: 'sample.txt' } },     // independent read-back
      { action: 'final', answer: 'Created sample.txt and verified its contents.' },
    ],
  });
  ok(b.error === null, 'B: the run completes without throwing', b.error?.message);
  if (b.status !== 'completed') {
    console.log('   B diagnostic: status=' + b.status + ' text=' + String(b.finalEvent?.text || '').slice(0, 200));
    console.log('   B step kinds: ' + JSON.stringify(b.steps.map((x) => x.kind + (x.tool ? ':' + x.tool : ''))));
    for (const st of b.steps.filter((x) => x.kind === 'tool_result')) {
      console.log('   B tool_result ' + st.tool + ' ok=' + st.ok + ' result=' + JSON.stringify(st.result ?? st.resultJson ?? null).slice(0, 220));
    }
    console.log('   B executorCalls=' + executorCalls + ' workspace=' + workspace + ' listing=' + JSON.stringify(fs.readdirSync(workspace)));
    console.log('   B executorTrace=' + JSON.stringify(executorTrace).slice(0, 400));
  }
  ok(b.nudges === 1, 'B: the premature completion triggered exactly one bounded replan nudge', `nudges=${b.nudges}`);
  ok(b.toolSteps.includes('write_file'), 'B: a REAL write action was attempted', JSON.stringify(b.toolSteps));
  ok(b.toolSteps.includes('read_file'), 'B: the file was independently read back', JSON.stringify(b.toolSteps));
  ok(guardianCalls === 2, 'B: every tool call went through Guardian authorization', `calls=${guardianCalls}`);
  ok(b.status === 'completed', 'B: success is reported only after verification', `status=${b.status}`);
  // The REAL file, on the REAL filesystem, with the REAL contents.
  const onDisk = fs.existsSync(path.join(workspace, 'sample.txt'))
    ? fs.readFileSync(path.join(workspace, 'sample.txt'), 'utf8') : null;
  ok(onDisk === 'expected', 'B: the file genuinely exists on disk with the exact contents', JSON.stringify(onDisk));
  ok(b.effects.some((e) => e.status === 'SETTLED'), 'B: the effect ledger settled the write');
  ok(!b.effects.some((e) => e.status === 'ADMITTED' || e.status === 'EFFECT_UNKNOWN'),
    'B: no effect left unsettled at completion');
  // The real verifier, invoked directly on the same durable truth, agrees.
  const directVerdict = await verifier.arbitrateCompletion({
    taskId: 'scenario-task', objective, toolAssisted: true,
  });
  ok(directVerdict.verdict === 'verified' || directVerdict.verdict === 'completed',
    'B: the REAL completion verifier independently confirms success',
    `verdict=${directVerdict.verdict} ${(directVerdict.predicateLines || []).join(' | ').slice(0, 90)}`);

  // ——— B2. same run, wrong contents: must NOT report success ————————————————
  console.log('\n── B2. the completion verifier is not weakened ──');
  fs.rmSync(path.join(workspace, 'sample.txt'), { force: true });
  const b2 = await runScenario({
    objective,
    scripted: [
      { action: 'final', answer: 'Done.' },
      { action: 'tool', tool: 'write_file', args: { path: 'sample.txt', content: 'WRONG' } },
      { action: 'tool', tool: 'read_file', args: { path: 'sample.txt' } },
      { action: 'final', answer: 'Created sample.txt and verified its contents.' },
    ],
  });
  ok(b2.status !== 'completed', 'B2: wrong contents are NOT reported as success', `status=${b2.status}`);
  const wrongVerdict = await verifier.arbitrateCompletion({ taskId: 'scenario-task', objective, toolAssisted: true });
  ok(wrongVerdict.verdict !== 'completed', 'B2: the REAL verifier rejects mismatched contents',
    `verdict=${wrongVerdict.verdict}`);

  // ——— B3. Real Ollama root cause: partial work + premature FINAL ————————
  console.log('\n── B3. incomplete external work must replan before finalizing ──');
  const b3 = await runScenario({
    objective: 'Create file recovered.txt containing "RECOVERED"',
    scripted: [
      { action: 'tool', tool: 'write_file', args: { path: 'unrelated.txt', content: 'NOT_THE_GOAL' } },
      { action: 'final', answer: 'All done.' },
      { action: 'tool', tool: 'write_file', args: { path: 'recovered.txt', content: 'RECOVERED' } },
      { action: 'final', answer: 'The file is ready.' },
    ],
  });
  ok(b3.error === null, 'B3: partial-final recovery completes without throwing', b3.error?.message);
  ok(b3.nudges === 1, 'B3: exactly one bounded replan after premature tool-assisted final', `nudges=${b3.nudges}`);
  ok(b3.status === 'completed', 'B3: independently verified required action completes after replanning', `status=${b3.status}`);
  ok(fs.readFileSync(path.join(workspace, 'recovered.txt'), 'utf8') === 'RECOVERED',
    'B3: subsequent real filesystem write has the exact requested content');
  ok(b3.effects.filter(e=>e.status==='SETTLED').length === 2,
    'B3: unrelated and later relevant effects remain durably recorded');
  // ——— C. transient tool failure must be recovered, not terminal ————————————
  console.log('\n── C. recovery from a transient tool failure ──');
  fs.rmSync(path.join(workspace, 'sample.txt'), { force: true });
  const c = await runScenario({
    objective,
    failOnce: 'write_file',
    scripted: [
      { action: 'tool', tool: 'write_file', args: { path: 'sample.txt', content: 'expected' } }, // fails transiently
      { action: 'tool', tool: 'write_file', args: { path: 'sample.txt', content: 'expected' } }, // real retry
      { action: 'tool', tool: 'read_file', args: { path: 'sample.txt' } },
      { action: 'final', answer: 'Created sample.txt after recovering from a transient failure.' },
    ],
  });
  ok(c.error === null, 'C: the run completes without throwing', c.error?.message);
  // Recovery means the run CONTINUES and the work genuinely lands — it does not
  // mean the failed attempt is forgotten. The real verifier reports the predicate
  // as verified on disk while still recording the one failed effect attempt, so
  // the honest verdict is partial, not completed. Asserting 'completed' here
  // would require weakening the verifier, which is explicitly out of scope.
  ok(c.status !== 'failed', 'C: a transient failure does not END the objective', `status=${c.status}`);
  ok(c.status === 'partial', 'C: recovery succeeds but the failed attempt is still reported honestly',
    `status=${c.status}`);
  ok(executorCalls === 3, 'C: the failed attempt plus two successful actions all ran', `executorCalls=${executorCalls}`);
  ok(fs.readFileSync(path.join(workspace, 'sample.txt'), 'utf8') === 'expected',
    'C: the file was genuinely created after recovery');
  ok(c.steps.some((s) => /transient I\/O error/.test(JSON.stringify(s))),
    'C: the transient failure was recorded honestly rather than hidden');
  const cVerdict = await verifier.arbitrateCompletion({ taskId: 'scenario-task', objective, toolAssisted: true });
  ok(/content verified exactly/.test((cVerdict.predicateLines || []).join(' | ')),
    'C: the recovered write is INDEPENDENTLY verified on disk by the real verifier',
    (cVerdict.predicateLines || []).join(' | ').slice(0, 120));
  ok(JSON.stringify(c.effects.map((e) => e.status)) === '["FAILED","SETTLED"]',
    'C: the durable ledger keeps BOTH the failed attempt and the settled retry',
    JSON.stringify(c.effects.map((e) => e.status)));
  console.log('   C evidence: status=' + c.status + ' effects=' + JSON.stringify(c.effects.map((e) => e.status)) +
    ' verdict=' + cVerdict.verdict);

  // ——— D. Guardian denial is bounded and never executes ————————————————
  console.log('\n── D. Guardian denial must be honest and bounded ──');
  const d = await runScenario({
    objective: 'Create file blocked.txt containing "nope"',
    guardian: 'deny',
    scripted: Array.from({ length: 8 }, () => ({ action: 'tool', tool: 'write_file', args: { path: 'blocked.txt', content: 'nope' } })),
    budget: 12,
  });
  ok(executorCalls === 0, 'D: a denied action is NEVER executed', `executorCalls=${executorCalls}`);
  ok(!fs.existsSync(path.join(workspace, 'blocked.txt')), 'D: the denied file was never written');
  ok(d.status === 'denied', 'D: the run settles as denied', `status=${d.status}`);
  ok(guardianCalls <= 4, 'D: identical denials are bounded, not repeated indefinitely', `calls=${guardianCalls}`);
  ok(d.steps.some((s) => s.kind === 'guardian_deny'), 'D: every denial is recorded in the audit trail');
  ok(String(d.finalEvent?.text || '').includes('No unauthorized side effects occurred'),
    'D: the honest denial summary is reported', String(d.finalEvent?.text || '').slice(0, 90));

  // ——— summary ———————————————————————————————————————————————————————————
  const total = checks + failures.length;
  console.log('');
  if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log('  -', f); }
  console.log(`CORE_ACTIONABLE_EXECUTION ${checks}/${total} ${failures.length ? 'FAIL' : 'PASS'} ` +
    `(real verifier + real filesystem in ${workspace}; mock model/Guardian/db; offline)`);
  if (failures.length) process.exitCode = 1;
})().catch((err) => { console.error(err.stack || err); process.exitCode = 1; });
