/**
 * JARVIS V1 — owner autonomy tiers (Part 2).
 *
 * Proves three things at once:
 *   1. NON-REGRESSION — the default `normal` tier reproduces the previous
 *      hardcoded budget and replan behaviour exactly, so adopting tiers cannot
 *      shorten a run that works today.
 *   2. THE SETTING IS REAL — higher tiers genuinely raise the continuous step
 *      budget and the in-scope replan budget, and are consumed by the task
 *      route, the Core loop and GoalProgressWatchdog. Nothing here is a
 *      decorative toggle.
 *   3. IT GRANTS NOTHING — no profile can carry a permission, the anti-spin
 *      repeat limit is identical at every tier, absolute ceilings cannot be
 *      exceeded, and a memory row that was not written by an explicit owner
 *      action is IGNORED so untrusted text cannot raise JARVIS's own autonomy.
 *
 * OFFLINE ONLY: the database is mocked. This is not Windows-native acceptance
 * and not a live task run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const ts = require('typescript');

const root = path.join(__dirname, '..');
let checks = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { checks++; console.log('PASS', label); return true; }
  failures.push(label + (detail ? ` — ${detail}` : ''));
  console.log('FAIL', label, detail ? `— ${detail}` : '');
  return false;
}

// ——— mock database, mutable per scenario ————————————————————————————————————
let memoryRows = [];
const mockDb = {
  jarvisMemory: {
    async findFirst({ where }) {
      const match = memoryRows.filter((r) =>
        r.principalId === where.principalId &&
        r.key === where.key &&
        (where.deletedAt === null ? r.deletedAt === null : true));
      if (match.length === 0) return null;
      match.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return match[0];
    },
    async create({ data }) {
      const row = { id: `row-${memoryRows.length + 1}`, version: 0, deletedAt: null, updatedAt: new Date().toISOString(), ...data };
      memoryRows.push(row);
      return row;
    },
    async update({ where, data }) {
      const row = memoryRows.find((r) => r.id === where.id);
      if (!row) throw new Error('missing row');
      Object.assign(row, data, { updatedAt: new Date().toISOString() });
      return row;
    },
  },
};

// ——— transpiling loader with sibling + @/ alias resolution ————————————————
const cache = new Map();
const extensions = ['.ts', '.tsx', '.js', '.cjs', '.json'];
function resolveSibling(fromFile, specifier) {
  if (specifier.startsWith('@/')) return path.join(root, 'src', specifier.slice(2));
  if (!specifier.startsWith('.')) return null;
  return path.resolve(path.dirname(fromFile), specifier);
}
function load(rel) {
  const abs = path.resolve(root, rel);
  if (cache.has(abs)) return cache.get(abs).exports;
  const moduleExports = {};
  cache.set(abs, { exports: moduleExports });
  const source = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(source, {
    fileName: abs,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  if (out.diagnostics && out.diagnostics.length) throw new Error(`TS errors in ${rel}: ${out.diagnostics.map((d) => d.messageText).join('; ')}`);
  const localRequire = (spec) => {
    if (spec === '@/lib/db') return { db: mockDb };
    const base = resolveSibling(abs, spec);
    if (!base) return require(spec);
    let file = null;
    for (const cand of (extensions.includes(path.extname(base)) ? [base] : extensions.flatMap((e) => [base + e, path.join(base, 'index' + e)]))) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { file = cand; break; }
    }
    if (!file) return require(spec);
    return path.extname(file) === '.ts' ? load(path.relative(root, file)) : require(file);
  };
  vm.runInNewContext(out.outputText, {
    exports: moduleExports, module: { exports: moduleExports }, require: localRequire,
    process, console, URL, TextEncoder, TextDecoder, Module,
  }, { filename: rel });
  return moduleExports;
}

// Async main: the durable trust-model checks await the mocked database, and
// top-level await is not valid in CommonJS.
(async () => {

const ap = load('src/lib/agent/core/autonomyPolicy.ts');
const gp = load('src/lib/agent/core/goalPlanner.ts');
const loopSrc = fs.readFileSync(path.join(root, 'src/lib/agent/core/loop.ts'), 'utf8');
const routeSrc = fs.readFileSync(path.join(root, 'src/app/api/jarvis/task/route.ts'), 'utf8');
const apiSrc = fs.readFileSync(path.join(root, 'src/app/api/jarvis/autonomy/route.ts'), 'utf8');

// ——— 1. the tier table —————————————————————————————————————————————————————
console.log('\n── tier table ──');
ok(ap.AUTONOMY_TIERS.join(',') === 'normal,advanced,full',
  'exactly the three owner-configurable tiers exist', ap.AUTONOMY_TIERS.join(','));
const P = ap.AUTONOMY_PROFILES;
ok(P.normal.stepBudget < P.advanced.stepBudget && P.advanced.stepBudget < P.full.stepBudget,
  'step budget strictly increases with the tier');
ok(P.normal.replanBudget < P.advanced.replanBudget && P.advanced.replanBudget < P.full.replanBudget,
  'in-scope replan budget strictly increases with the tier');
ok(P.normal.repeatLimit === P.advanced.repeatLimit && P.advanced.repeatLimit === P.full.repeatLimit,
  'the anti-spin repeat limit is IDENTICAL at every tier (a safety property, not a knob)');
ok(P.normal.repeatLimit === ap.REPEAT_LIMIT_ALL_TIERS && ap.REPEAT_LIMIT_ALL_TIERS === 3,
  'and it matches the AutonomyGate watchdog threshold');
ok(P.full.stepBudget === ap.MAX_STEPS_HARD_CEILING &&
   P.full.replanBudget === gp.GOAL_WATCHDOG_MAX_REVISIONS,
  'no tier exceeds an absolute ceiling');

// ——— 2. NO permission can be carried ———————————————————————————————————————
console.log('\n── the profile grants nothing ──');
const FORBIDDEN = ['allow', 'permit', 'permitted', 'bypass', 'skipGuardian', 'skipAuthorization', 'tools', 'allowlist', 'scope', 'filesystem', 'network', 'devices', 'applications'];
for (const tier of ap.AUTONOMY_TIERS) {
  const keys = Object.keys(P[tier]);
  const bad = keys.filter((k) => FORBIDDEN.some((f) => k.toLowerCase().includes(f)));
  ok(bad.length === 0, `tier "${tier}" exposes no permission-like field`, bad.join(','));
  ok(keys.sort().join(',') === 'repeatLimit,replanBudget,stepBudget,tier',
    `tier "${tier}" exposes only the four runtime-consumed fields`, keys.sort().join(','));
}
const apSrc = fs.readFileSync(path.join(root, 'src/lib/agent/core/autonomyPolicy.ts'), 'utf8');
ok(!/export\s+(const|function|type)\s+\w*(allow|bypass|permit)/i.test(apSrc),
  'the autonomy module exports no allow/bypass/permit symbol');
ok(!/allow\s*:\s*true/i.test(apSrc), 'no hardcoded allow=true anywhere in the module');
ok(/Guardian/.test(apSrc) && /must never become one/.test(apSrc),
  'the module documents that it is not an authorization layer');
ok(/authorizeToolCall/.test(loopSrc),
  'the Core loop still calls Guardian authorizeToolCall (the tier does not replace it)');

// ——— 3. fail-closed resolution —————————————————————————————————————————————
console.log('\n── fail-closed resolution ──');
const R = ap.resolveAutonomyProfile;
ok(R(undefined).profile.tier === 'normal' && R({}).profile.tier === 'normal',
  'an absent tier resolves to the most restrictive tier');
ok(R({ tier: 'GODMODE' }).profile.tier === 'normal', 'an invented tier name resolves to normal');
ok(R({ tier: 'full', stepBudget: 99999 }).profile.stepBudget === ap.MAX_STEPS_HARD_CEILING,
  'a huge stepBudget is clamped to the absolute ceiling');
ok(R({ tier: 'normal', stepBudget: 99999 }).profile.stepBudget === P.normal.stepBudget,
  'a stored row cannot smuggle a budget larger than its own tier allows');
ok(R({ tier: 'normal', replanBudget: 50 }).profile.replanBudget === P.normal.replanBudget,
  'a stored row cannot smuggle a replan budget larger than its own tier allows');
ok(R({ tier: 'full', repeatLimit: 999 }).profile.repeatLimit === ap.REPEAT_LIMIT_ALL_TIERS,
  'repeatLimit is forced even when a row explicitly tries to raise it');
ok(R({ tier: 'full', repeatLimit: 999 }).warnings.some((w) => /safety property/.test(w)),
  'and the operator is told why it was ignored');
ok(R({ tier: 'advanced', stepBudget: 'not-a-number' }).profile.stepBudget === P.advanced.stepBudget,
  'a non-numeric value falls back to the tier value');
ok(R({ tier: 'advanced', stepBudget: 5 }).profile.stepBudget === 5,
  'narrowing WITHIN a tier is honoured (an owner may ask for less)');
ok(ap.isAutonomyTier('full') === true && ap.isAutonomyTier('Full') === false && ap.isAutonomyTier(42) === false,
  'tier validation is case-sensitive and type-checked');
const structuralCopy = ap.autonomyProfile('full');
structuralCopy.stepBudget = 1;
ok(ap.AUTONOMY_PROFILES.full.stepBudget === ap.MAX_STEPS_HARD_CEILING,
  'autonomyProfile() returns a copy, so the shared table cannot be mutated');

// ——— 4. durable trust model ————————————————————————————————————————————————
console.log('\n── durable trust model (untrusted text cannot raise autonomy) ──');
const OWNER = 'owner-principal-1';
memoryRows = [];
let rec = await ap.loadOwnerAutonomyProfile(OWNER, {});
ok(rec.profile.tier === 'normal' && rec.source === 'default',
  'with no stored row the default tier is normal');
memoryRows = [{ principalId: OWNER, key: ap.AUTONOMY_MEMORY_KEY, deletedAt: null, version: 0,
  source: 'MODEL_DERIVED', dataClass: 'LOCAL_PRIVATE', content: JSON.stringify({ tier: 'full' }),
  updatedAt: new Date().toISOString() }];
rec = await ap.loadOwnerAutonomyProfile(OWNER, {});
ok(rec.profile.tier === 'normal',
  'a MODEL_DERIVED row claiming tier=full is IGNORED, not applied', `got ${rec.profile.tier}`);
ok(rec.untrustedRowIgnored === true && rec.warnings.some((w) => /Ignored a stored autonomy row/.test(w)),
  'and the rejection is reported so NEXUS can show it');
memoryRows = [{ principalId: OWNER, key: ap.AUTONOMY_MEMORY_KEY, deletedAt: null, version: 0,
  source: 'TOOL_OBSERVED', dataClass: 'LOCAL_PRIVATE', content: JSON.stringify({ tier: 'full' }),
  updatedAt: new Date().toISOString() }];
ok((await ap.loadOwnerAutonomyProfile(OWNER, {})).profile.tier === 'normal',
  'a TOOL_OBSERVED row is also ignored (tool output cannot grant autonomy)');
memoryRows = [{ principalId: OWNER, key: ap.AUTONOMY_MEMORY_KEY, deletedAt: null, version: 0,
  source: 'OWNER_EXPLICIT', dataClass: 'LOCAL_PRIVATE', content: '{"tier":"full",',
  updatedAt: new Date().toISOString() }];
rec = await ap.loadOwnerAutonomyProfile(OWNER, {});
ok(rec.profile.tier === 'normal' && rec.warnings.some((w) => /not valid JSON/.test(w)),
  'a corrupt owner row fails closed to normal instead of throwing');
memoryRows = [{ principalId: OWNER, key: ap.AUTONOMY_MEMORY_KEY, deletedAt: new Date().toISOString(), version: 0,
  source: 'OWNER_EXPLICIT', dataClass: 'LOCAL_PRIVATE', content: JSON.stringify({ tier: 'full' }),
  updatedAt: new Date().toISOString() }];
ok((await ap.loadOwnerAutonomyProfile(OWNER, {})).profile.tier === 'normal',
  'a soft-deleted row is not resurrected');

// A genuine owner action IS applied, and is stamped correctly.
memoryRows = [];
const saved = await ap.saveOwnerAutonomyProfile(OWNER, { tier: 'full' });
ok(saved.profile.tier === 'full' && saved.source === 'owner-settings',
  'an explicit owner save applies the requested tier');
ok(memoryRows.length === 1 && memoryRows[0].source === 'OWNER_EXPLICIT' &&
   memoryRows[0].dataClass === 'LOCAL_PRIVATE',
  'the row is stamped OWNER_EXPLICIT / LOCAL_PRIVATE (never sent to a provider)');
ok(memoryRows[0].principalId === OWNER, 'the row is scoped to the owner principal');
rec = await ap.loadOwnerAutonomyProfile(OWNER, {});
ok(rec.profile.tier === 'full' && rec.source === 'owner-settings',
  'and it is read back on the next run');
const before = memoryRows[0].version;
await ap.saveOwnerAutonomyProfile(OWNER, { tier: 'advanced' });
ok(memoryRows.length === 1 && memoryRows[0].version === before + 1,
  're-saving updates the single row and bumps its version (no duplicate grants)');
ok(memoryRows[0].source === 'OWNER_EXPLICIT',
  'an update re-stamps OWNER_EXPLICIT even if a prior row had another source');
let threw = false;
try { await ap.saveOwnerAutonomyProfile(OWNER, { tier: 'unlimited' }); } catch { threw = true; }
ok(threw, 'saving an invalid tier throws rather than silently accepting it');

// Environment tier is honoured only when no owner row exists.
memoryRows = [];
ok((await ap.loadOwnerAutonomyProfile(OWNER, { JARVIS_AUTONOMY_TIER: 'advanced' })).source === 'environment',
  'the launcher environment can set a tier for isolated local development');
memoryRows = [];
await ap.saveOwnerAutonomyProfile(OWNER, { tier: 'normal' });
ok((await ap.loadOwnerAutonomyProfile(OWNER, { JARVIS_AUTONOMY_TIER: 'full' })).profile.tier === 'normal',
  'an explicit owner setting outranks the environment variable');
memoryRows = [];
ok((await ap.loadOwnerAutonomyProfile(OWNER, { JARVIS_AUTONOMY_TIER: 'BOGUS' })).profile.tier === 'normal',
  'a bogus environment tier falls closed to normal');

// ——— 5. budget derivation is non-regressive ————————————————————————————————
console.log('\n── budget derivation (non-regression) ──');
const D = (requested, tier, env) => ap.deriveStepBudget({ requested, profile: ap.autonomyProfile(tier), env: env || {} });
// Today's behaviour with no tier system: default 12, cap 24 (flag off).
ok(D(undefined, 'normal', {}).budget === 12 && D(undefined, 'normal', {}).ceiling === 24,
  'normal + no flag reproduces today\'s default budget 12 and cap 24');
ok(D(undefined, 'normal', { JARVIS_EXPERIMENTAL_DESKTOP_CONTROL: '1' }).budget === 24,
  'normal + experimental flag reproduces today\'s default budget 24');
ok(D(100, 'normal', { JARVIS_EXPERIMENTAL_DESKTOP_CONTROL: '1' }).budget === 48,
  'normal + experimental flag reproduces today\'s cap 48');
ok(D(6, 'normal', {}).budget === 6, 'an explicit smaller request is honoured');
// The tiers must actually buy something.
ok(D(undefined, 'advanced', {}).budget === 24, 'advanced raises the default budget to 24');
ok(D(undefined, 'full', {}).budget === 48, 'full raises the default budget to 48');
ok(D(1000, 'full', {}).budget === 48 && D(1000, 'full', {}).ceiling === 48,
  'full can never exceed the absolute ceiling, however large the request');
ok(D(1000, 'advanced', {}).budget === 24,
  'an explicit request is clamped DOWN to the tier ceiling');
ok(D(-5, 'full', {}).budget === 48 && D('12', 'full', {}).budget === 48 && D(null, 'full', {}).budget === 48,
  'invalid request values fall back to the tier default');
ok(D(undefined, 'normal', {}).budget <= D(undefined, 'full', {}).budget,
  'a higher tier never yields a smaller budget');

// ——— 6. the replan budget really reaches the watchdog ——————————————————————
console.log('\n── GoalProgressWatchdog replan budget ──');
const W = gp.GoalProgressWatchdog;
const fail = { ok: false, error: 'target block unreachable' };
function replansUntilBlocked(replanBudget) {
  const w = replanBudget === undefined ? new W() : new W(undefined, { replanBudget });
  let replans = 0;
  for (let i = 0; i < 60; i++) {
    // Alternate the arguments so each triple is a fresh identical-failure run.
    // Constant args: the fingerprint covers tool+args+error, so a varying arg
    // would reset the identical-failure streak and never reach the threshold.
    const verdict = w.observe('mine', { attempt: 1 }, fail);
    if (verdict === 'replan') { replans++; w.acknowledgeReplan(); }
    if (verdict === 'blocked') return { replans, blockedAt: i };
  }
  return { replans, blockedAt: -1 };
}
ok(replansUntilBlocked(undefined).replans === 2,
  'a default-constructed watchdog still allows exactly 2 replans (today\'s behaviour)');
ok(replansUntilBlocked(2).replans === 2, 'an explicit normal-tier budget allows 2 replans');
ok(replansUntilBlocked(3).replans === 3, 'an advanced-tier budget allows 3 replans');
ok(replansUntilBlocked(4).replans === 4, 'a full-tier budget allows 4 replans');
ok(replansUntilBlocked(99).replans === 4,
  'a budget above the absolute bound is clamped, so no setting can replan forever');
ok(replansUntilBlocked(0).replans === 0 && replansUntilBlocked(0).blockedAt >= 0,
  'a zero budget blocks after the first identical-failure triple instead of looping');
ok(replansUntilBlocked('nonsense').replans === 2,
  'a non-numeric budget falls back to the safe default');
const wSpin = new W(undefined, { replanBudget: 4 });
wSpin.observe('mine', { a: 1 }, fail);
wSpin.observe('mine', { a: 1 }, fail);
ok(wSpin.observe('mine', { a: 1 }, fail) === 'replan',
  'three identical failures still trigger a replan at every tier');
const wReset = new W(undefined, { replanBudget: 4 });
wReset.observe('mine', {}, fail);
wReset.observe('mine', {}, { ok: true });
ok(wReset.observe('mine', {}, fail) === 'continue',
  'a verified success still resets the failure streak at every tier');
ok(new W(undefined, { replanBudget: 4 }).replanBudget === 4,
  'the watchdog reports the budget actually in force');

// Durability bound is independent of the policy bound: a checkpoint persisted at
// a high tier must still load after the owner downgrades.
const highTier = new W(undefined, { replanBudget: 4 });
for (let i = 0; i < 12; i++) highTier.observe('mine', { a: 1 }, fail);
const snap = highTier.snapshot();
ok(snap.revisions > 2, 'a full-tier run can persist more than 2 revisions', `revisions=${snap.revisions}`);
let loaded = null;
try { loaded = new W(JSON.parse(JSON.stringify(snap))); } catch { loaded = null; }
ok(loaded !== null, 'that checkpoint still LOADS under the default (downgraded) tier');
ok(loaded.replanBudget === 2, 'but the downgraded tier\'s policy budget applies going forward');
let rejected = false;
try { new W({ schemaVersion: 1, lastFailureHash: '', failures: 0, revisions: 99, pendingReplan: false }); } catch { rejected = true; }
ok(rejected, 'a revision count above the absolute durability bound is still rejected');
rejected = false;
try { new W({ schemaVersion: 1, lastFailureHash: 'raw-secret-not-hex', failures: 0, revisions: 0, pendingReplan: false }); } catch { rejected = true; }
ok(rejected, 'the hashed-fingerprint validation is unchanged (no raw secrets in durable state)');

// ——— 7. runtime wiring —————————————————————————————————————————————————————
console.log('\n── runtime wiring (the setting must not be decorative) ──');
ok(/loadOwnerAutonomyProfile\(ctx\.principalId\)/.test(routeSrc),
  'the task route loads the tier from the SERVER-DERIVED principal');
ok(!/loadOwnerAutonomyProfile\(\s*body\.ownerId/.test(routeSrc),
  'never from the untrusted body.ownerId');
ok(/deriveStepBudget\(\{ requested: body\.stepBudget, profile: autonomy\.profile \}\)/.test(routeSrc),
  'both the new-task and resume paths derive the budget from the tier');
ok(!/\? 48 : 24\)/.test(routeSrc) && !/JARVIS_EXPERIMENTAL_DESKTOP_CONTROL === "1" \? 24 : 12/.test(routeSrc),
  'the previous hardcoded budget literals are gone from the route');
ok(/autonomy: autonomy\.profile/.test(routeSrc),
  'the resolved profile is passed into runTask');
ok(/autonomy\?: AutonomyProfile/.test(loopSrc),
  'RunTaskOptions accepts the profile, and it is optional');
ok(/opts\.autonomy \?\? AUTONOMY_PROFILES\.normal/.test(loopSrc),
  'callers that supply no profile get the most restrictive tier');
ok(/deriveStepBudget\(\{ requested: budget, profile: ownerAutonomy \}\)/.test(loopSrc),
  'the loop derives its ceiling from the same profile');
ok(/Math\.min\(budget, Math\.max\(MAX_STEPS_HARD, autonomyCeiling\)\)/.test(loopSrc),
  'the legacy environment ceiling is a FLOOR, so a full-tier budget of 48 is not clamped back to 24');
// Allow one level of nested parens: the resume site wraps JSON.parse(...).
const watchdogConstructions = loopSrc.match(/new GoalProgressWatchdog\((?:[^()]|\([^()]*\))*\)/g) || [];
ok(watchdogConstructions.length === 2 &&
   watchdogConstructions.every((c) => /autonomyLimits/.test(c)),
  'BOTH watchdog constructions (new run and resume) receive the tier limits',
  watchdogConstructions.join(' | '));
ok(/replanBudget: ownerAutonomy\.replanBudget/.test(loopSrc),
  'the replan budget comes from the owner profile');
ok(/const ownerAutonomy/.test(loopSrc) && !/const autonomy: AutonomyProfile/.test(loopSrc),
  'the profile variable does not collide with the AutonomyGate instance named `autonomy`');

// ——— 8. settings API contract ——————————————————————————————————————————————
console.log('\n── settings API contract ──');
ok(/role !== "OWNER"/.test(apiSrc) && /status !== "ACTIVE"/.test(apiSrc),
  'the autonomy endpoint is owner-only and requires an ACTIVE principal');
ok(/mutationOriginError\(req\.headers\)/.test(apiSrc),
  'a mutation is origin-checked before anything is written');
ok(/isAutonomyTier\(tier\)/.test(apiSrc), 'the tier is validated before it is saved');
ok(/Unsupported autonomy field/.test(apiSrc),
  'fields the runtime does not consume are REJECTED, so NEXUS cannot show a dead control');
ok(/repeatLimitFixedAcrossAllTiers/.test(apiSrc),
  'GET publishes that the repeat limit is fixed rather than hiding it');
ok(/grants no permission/.test(apiSrc),
  'GET states plainly that the tier grants no permission');
ok(/"Cache-Control": "no-store"/.test(apiSrc), 'responses are not cached');

// ——— summary —————————————————————————————————————————————————————————————
const total = checks + failures.length;
console.log('');
if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log('  -', f); }
console.log(`AUTONOMY_TIERS ${checks}/${total} ${failures.length ? 'FAIL' : 'PASS'} (offline, mocked database; NOT Windows-native and NOT a live autonomous run)`);
if (failures.length) process.exitCode = 1;

})().catch((err) => {
  console.error('HARNESS ERROR:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
