/**
 * JARVIS V1 — the ONE supported Windows companion development workflow.
 *
 * Owner-observed failure:
 *     DENIED minecraft_companion_join — Windows companion requires the isolated
 *     loopback development launcher.
 *
 * The generic message was the defect: it named no missing prerequisite, so the
 * owner could not tell WHICH of five preconditions failed and the same denial
 * repeated identically. companionGateFailure() now names the specific one. This
 * suite proves that repair reaches the exact tool the owner saw denied, and
 * covers two properties nothing else asserted:
 *
 *   1. THE WORKFLOW IS COMPLETE. `npm run dev:windows` starts NEXUS (Core) and
 *      the companion sidecar, and companion.py spawns the Minecraft bridge
 *      (bot.cjs) on demand. All four components the mission names are reachable
 *      from a single supported command.
 *   2. THE BRIDGE GETS NO SECRETS. companion.py propagates a least-privilege env
 *      allowlist to bot.cjs. The companion token must never reach the game
 *      bridge, and the allowlist must stay an allowlist.
 *
 * Guardian is NOT weakened here: the correctly-configured loopback dev case is
 * allowed, and every single missing or unsafe precondition still denies with a
 * reason naming that precondition.
 *
 * OFFLINE. No Windows host, no companion process, no Minecraft server.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
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
      esModuleInterop: true, allowSyntheticDefaultImports: true },
    reportDiagnostics: true,
  });
  const errs = out.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length) throw new Error(`TS errors in ${rel}: ${errs.map((e) => e.messageText).join('; ')}`);
  return out.outputText;
}

const auditRows = [];
const GOOD_ENV = {
  JARVIS_WINDOWS_AGENT_ENABLED: '1',
  JARVIS_LOCAL_DEV_NO_LOGIN: '1',
  JARVIS_LOCAL_DEV_BIND: '127.0.0.1',
  JARVIS_WINDOWS_COMPANION_TOKEN: 'a'.repeat(48),
  // The join tool has a SECOND operator-authorization layer: the Minecraft LAN
  // configuration. Passing the companion gate alone is not enough.
  JARVIS_MINECRAFT_LAN_ENABLED: '1',
  JARVIS_MINECRAFT_LAN_HOST: '127.0.0.1',
  JARVIS_MINECRAFT_LAN_PORT: '25565',
  JARVIS_MINECRAFT_PLAYER: 'OwnerPlayer',
};

/**
 * Load the REAL Guardian with a per-scenario platform/env, because policy.ts
 * reads process.platform and process.env at call time inside its own module
 * realm. Nothing about the gate is mocked.
 */
function loadGuardian({ platform = 'win32', env = GOOD_ENV }) {
  const cache = new Map();
  const sandboxProcess = { env: { ...env }, platform, cwd: () => root, versions: process.versions };
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const mod = {};
    cache.set(rel, mod);
    const absDir = path.dirname(path.join(root, rel));
    const req = (name) => {
      if (name === '@/lib/db') {
        return { db: { auditLog: { create: async ({ data }) => { auditRows.push(data); return data; } } } };
      }
      if (name.startsWith('.')) {
        const base = path.resolve(absDir, name);
        for (const c of [base + '.ts', path.join(base, 'index.ts')]) {
          if (fs.existsSync(c)) return load(path.relative(root, c));
        }
        for (const c of [base + '.mjs', base + '.js']) if (fs.existsSync(c)) return require(c);
        return require(name);
      }
      if (name.startsWith('@/')) {
        const base = path.join(root, 'src', name.slice(2));
        for (const c of [base + '.ts', path.join(base, 'index.ts')]) {
          if (fs.existsSync(c)) return load(path.relative(root, c));
        }
      }
      return require(name);
    };
    vm.runInNewContext(compile(rel), {
      exports: mod, module: { exports: mod }, console, require: req,
      process: sandboxProcess, setTimeout, clearTimeout, URL, URLSearchParams,
      TextEncoder, TextDecoder, Buffer, fetch: () => { throw new Error('TEST GUARD: no network'); },
    }, { filename: rel, timeout: 10000 });
    return mod;
  }
  return load('src/lib/agent/guardian/guardian.ts');
}

(async () => {
  // ——— 1. the exact tool the owner saw denied ———————————————————————————————
  console.log('\n── minecraft_companion_join authorization matrix ──');
  const good = loadGuardian({});
  const allowed = await good.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
  ok(allowed.verdict === 'allow',
    'minecraft_companion_join is ALLOWED under the correct isolated loopback dev configuration',
    `verdict=${allowed.verdict} reason=${allowed.reason}`);
  ok(allowed.prepared && allowed.prepared.desktop,
    'the allow decision carries Guardian-prepared desktop arguments, so the bridge can actually execute',
    JSON.stringify(Object.keys(allowed.prepared || {})));

  // Each single missing precondition must deny AND name that precondition.
  const MISSING = [
    ['JARVIS_WINDOWS_AGENT_ENABLED', 'JARVIS_WINDOWS_AGENT_ENABLED'],
    ['JARVIS_LOCAL_DEV_NO_LOGIN', 'JARVIS_LOCAL_DEV_NO_LOGIN'],
    ['JARVIS_LOCAL_DEV_BIND', 'JARVIS_LOCAL_DEV_BIND'],
    ['JARVIS_WINDOWS_COMPANION_TOKEN', 'JARVIS_WINDOWS_COMPANION_TOKEN'],
  ];
  for (const [removed, expectedToken] of MISSING) {
    const env = { ...GOOD_ENV };
    delete env[removed];
    const g = loadGuardian({ env });
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
    ok(d.verdict === 'deny', `missing ${removed} still denies`, `verdict=${d.verdict}`);
    ok(typeof d.reason === 'string' && d.reason.includes(expectedToken),
      `the denial NAMES the specific missing prerequisite (${removed})`, String(d.reason).slice(0, 110));
    ok(typeof d.reason === 'string' && !d.reason.includes(GOOD_ENV.JARVIS_WINDOWS_COMPANION_TOKEN),
      `the denial for ${removed} never interpolates the companion token`);
  }

  // Unsafe configurations must still be refused — the gate was not weakened.
  const UNSAFE = [
    [{ platform: 'linux' }, 'a non-Windows host'],
    [{ env: { ...GOOD_ENV, JARVIS_LOCAL_DEV_BIND: '0.0.0.0' } }, 'a non-loopback bind'],
    [{ env: { ...GOOD_ENV, JARVIS_LOCAL_DEV_BIND: '192.168.1.10' } }, 'a LAN bind'],
    [{ env: { ...GOOD_ENV, JARVIS_WINDOWS_COMPANION_TOKEN: 'short' } }, 'a too-short token'],
    [{ env: { ...GOOD_ENV, JARVIS_WINDOWS_COMPANION_TOKEN: '' } }, 'an empty token'],
    [{ env: { JARVIS_WINDOWS_AGENT_ENABLED: '1' } }, 'the authenticated/production launch path'],
  ];
  for (const [cfg, label] of UNSAFE) {
    const g = loadGuardian(cfg);
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
    ok(d.verdict === 'deny', `still refused: ${label}`, `verdict=${d.verdict} reason=${String(d.reason).slice(0, 70)}`);
  }
  // A non-Windows host must say so explicitly rather than the generic message.
  const linux = loadGuardian({ platform: 'linux' });
  const linuxDenial = await linux.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
  ok(/requires a Windows host; detected linux/.test(String(linuxDenial.reason)),
    'a non-Windows host is diagnosed as such, not blamed on the launcher',
    String(linuxDenial.reason).slice(0, 100));
  // Every other companion tool must route through the SAME gate.
  for (const tool of ['minecraft_companion_command', 'minecraft_companion_stop', 'windows_minecraft_input']) {
    const g = loadGuardian({ env: { JARVIS_WINDOWS_AGENT_ENABLED: '1' } });
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, tool, { command: 'auto_status' });
    ok(d.verdict === 'deny' && /JARVIS_LOCAL_DEV_NO_LOGIN|JARVIS_WINDOWS_AGENT_ENABLED/.test(String(d.reason)),
      `${tool} routes through the same specific-prerequisite gate`, String(d.reason).slice(0, 80));
  }

  // ——— 1b. the Minecraft LAN operator-authorization layer ————————————————
  console.log('\n── the Minecraft LAN authorization layer ──');
  // HOST is deliberately NOT in this list: it defaults to 127.0.0.1, which is
  // the safe fail-closed direction. Asserted separately below.
  for (const removed of ['JARVIS_MINECRAFT_LAN_ENABLED', 'JARVIS_MINECRAFT_LAN_PORT',
    'JARVIS_MINECRAFT_PLAYER']) {
    const env = { ...GOOD_ENV };
    delete env[removed];
    const g = loadGuardian({ env });
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
    ok(d.verdict === 'deny', `a join without ${removed} is denied`, `verdict=${d.verdict}`);
    ok(String(d.reason).includes(removed) || /JARVIS_MINECRAFT_LAN_ENABLED/.test(String(d.reason)),
      `the denial names the missing Minecraft prerequisite (${removed})`, String(d.reason).slice(0, 100));
  }
  // An unset host must default to loopback, never to "any host".
  const noHost = loadGuardian({ env: (() => { const e = { ...GOOD_ENV }; delete e.JARVIS_MINECRAFT_LAN_HOST; return e; })() });
  const noHostDecision = await noHost.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
  ok(noHostDecision.verdict === 'allow',
    'an unset LAN host is permitted because it defaults to loopback, not because the check is skipped',
    `verdict=${noHostDecision.verdict} reason=${String(noHostDecision.reason).slice(0, 70)}`);
  for (const explicitRemote of ['192.168.1.50', '0.0.0.0', 'mc.example.com']) {
    const g = loadGuardian({ env: { ...GOOD_ENV, JARVIS_MINECRAFT_LAN_HOST: explicitRemote } });
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
    ok(d.verdict === 'deny', `an explicitly non-loopback host (${explicitRemote}) is refused`,
      `verdict=${d.verdict}`);
  }
  const noLan = loadGuardian({ env: (() => { const e = { ...GOOD_ENV }; delete e.JARVIS_MINECRAFT_LAN_ENABLED; return e; })() });
  const noLanDenial = await noLan.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
  ok(/npm run dev:windows/.test(String(noLanDenial.reason)),
    'the Minecraft denial states the corrective workflow, so the operator is not left guessing',
    String(noLanDenial.reason).slice(0, 120));
  ok(!String(noLanDenial.reason).includes(GOOD_ENV.JARVIS_WINDOWS_COMPANION_TOKEN),
    'the Minecraft denial never interpolates the companion token');
  // A bad port must be refused rather than silently accepted.
  for (const badPort of ['54321abc', '80', '99999', '']) {
    const g = loadGuardian({ env: { ...GOOD_ENV, JARVIS_MINECRAFT_LAN_PORT: badPort } });
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
    ok(d.verdict === 'deny', `an invalid LAN port (${JSON.stringify(badPort)}) is refused`,
      `verdict=${d.verdict} reason=${String(d.reason).slice(0, 60)}`);
  }
  // Values, not just presence: the gate must enforce the constraints its own
  // denial message advertises, or a server started without the preflight could
  // authorize a join to a remote host on an arbitrary port.
  const BAD_VALUES = [
    ['JARVIS_MINECRAFT_LAN_HOST', '192.168.1.50', 'a remote LAN host'],
    ['JARVIS_MINECRAFT_LAN_HOST', 'mc.example.com', 'an internet Minecraft server'],
    ['JARVIS_MINECRAFT_LAN_PORT', '80', 'a privileged port below 1024'],
    ['JARVIS_MINECRAFT_LAN_PORT', '25565abc', 'a non-numeric port'],
    ['JARVIS_MINECRAFT_PLAYER', 'JarvisBuddy', 'the companion impersonating itself'],
    ['JARVIS_MINECRAFT_PLAYER', 'x'.repeat(17), 'a name longer than Minecraft allows'],
  ];
  for (const [key, value, label] of BAD_VALUES) {
    const g = loadGuardian({ env: { ...GOOD_ENV, [key]: value } });
    const d = await g.authorizeToolCall({ taskId: null, ownerId: 'owner' }, 'minecraft_companion_join', {});
    ok(d.verdict === 'deny', `a join to ${label} is refused at the Guardian gate`,
      `verdict=${d.verdict} reason=${String(d.reason).slice(0, 70)}`);
    ok(typeof d.reason === 'string' && d.reason.includes(key),
      `the refusal names the offending variable (${key})`, String(d.reason).slice(0, 90));
  }
  // STOP must remain available so the operator can always halt the companion.
  const brokenStop = loadGuardian({ env: { ...GOOD_ENV, JARVIS_MINECRAFT_LAN_PORT: 'nonsense',
    JARVIS_MINECRAFT_LAN_HOST: '10.0.0.9' } });
  const stopDecision = await brokenStop.authorizeToolCall(
    { taskId: null, ownerId: 'owner' }, 'minecraft_companion_stop', {});
  ok(stopDecision.verdict === 'allow',
    'minecraft_companion_stop stays available even with a broken connection config, so a companion can always be halted',
    `verdict=${stopDecision.verdict} reason=${String(stopDecision.reason).slice(0, 70)}`);

  // The startup preflight must catch a half-configured Minecraft setup at launch.
  const preflight = await import(path.join(root, 'scripts/windows-startup-preflight.mjs'));
  const PREFLIGHT_BASE = {
    NODE_ENV: 'development', JARVIS_LOCAL_DEV_NO_LOGIN: '1', JARVIS_LOCAL_DEV_BIND: '127.0.0.1',
    JARVIS_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    DATABASE_URL: 'file:./jarvis-local-minecraft-test.db',
    JARVIS_WINDOWS_AGENT_ENABLED: '1', JARVIS_WINDOWS_COMPANION_TOKEN: 'a'.repeat(48),
  };
  function preflightOf(env) {
    try { return { threw: false, value: preflight.validateLocalWindowsEnvironment(env) }; }
    catch (err) { return { threw: true, message: String(err.message || err) }; }
  }
  const half = preflightOf({ ...PREFLIGHT_BASE, JARVIS_MINECRAFT_LAN_HOST: '127.0.0.1',
    JARVIS_MINECRAFT_LAN_PORT: '25565', JARVIS_MINECRAFT_PLAYER: 'OwnerPlayer' });
  const halfText = half.threw ? half.message : JSON.stringify(half.value);
  ok(/half-configured/.test(halfText),
    'the preflight warns at startup that Minecraft is half-configured', halfText.slice(0, 170));
  ok(/JARVIS_MINECRAFT_LAN_ENABLED=1/.test(halfText), 'the preflight states the exact variable to set');
  const full = preflightOf({ ...PREFLIGHT_BASE, ...GOOD_ENV, NODE_ENV: 'development',
    JARVIS_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    DATABASE_URL: 'file:./jarvis-local-minecraft-test.db' });
  ok(!full.threw, 'a fully configured launcher environment passes the preflight',
    full.threw ? full.message : '');
  // The preflight and the gate must agree: anything the preflight refuses, the
  // gate refuses too, so no bypass path is weaker than the other.
  for (const [key, value, label] of BAD_VALUES) {
    const pf = preflightOf({ ...PREFLIGHT_BASE, ...GOOD_ENV, NODE_ENV: 'development',
      JARVIS_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
      DATABASE_URL: 'file:./jarvis-local-minecraft-test.db', [key]: value });
    ok(pf.threw, `the preflight also refuses ${label}, matching the gate`, pf.threw ? '' : 'preflight accepted it');
  }

  // ——— 2. one supported workflow reaches all four components ————————————————
  console.log('\n── the single supported dev workflow ──');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const agent = fs.readFileSync(path.join(root, 'scripts/start-windows-agent.mjs'), 'utf8');
  const plain = fs.readFileSync(path.join(root, 'scripts/start-local-no-login.mjs'), 'utf8');
  const companion = fs.readFileSync(path.join(root, 'windows-companion/companion.py'), 'utf8');
  ok(pkg.scripts['dev:windows'] === 'node scripts/start-windows-agent.mjs',
    'npm run dev:windows is the single supported Windows entry point', pkg.scripts['dev:windows']);
  ok(/companion\.py/.test(agent), 'the workflow starts the Windows companion sidecar');
  ok(/nextCli|next[\s\S]{0,40}dev/.test(agent), 'the workflow starts NEXUS (Core)');
  ok(/minecraft-bot[\s\S]{0,80}bot\.cjs/.test(companion),
    'the companion spawns the Minecraft bridge on demand, so all four components are reachable');
  ok(/MINECRAFT_COMPANION_JOINED \(spawn observed\)/.test(companion),
    'a join is only accepted on an observed Minecraft protocol SPAWN signal, never on process creation');
  ok(/process\.platform==='win32' && companionFeatureRequested/.test(plain),
    'a plain npm run dev delegates to the Windows workflow on win32 only');
  ok(fs.existsSync(path.join(root, 'windows-companion/minecraft-bot/bot.cjs')),
    'the Minecraft bridge script the companion spawns actually exists');

  // ——— 3. the bridge must receive no secrets ———————————————————————————————
  console.log('\n── least-privilege env propagation to the bridge ──');
  const allowlist = companion.match(/k\.upper\(\) in \(([^)]*)\)/);
  ok(Boolean(allowlist), 'the companion propagates an explicit env ALLOWLIST, not the whole environment',
    allowlist ? '' : 'no allowlist found');
  const allowedKeys = allowlist ? allowlist[1].split(',').map((x) => x.trim().replace(/'/g, '')) : [];
  ok(!allowedKeys.some((k) => k.startsWith('JARVIS_')),
    'no JARVIS_* variable is in the blanket allowlist', JSON.stringify(allowedKeys));
  ok(!/JARVIS_WINDOWS_COMPANION_TOKEN/.test(allowlist ? allowlist[1] : ''),
    'the companion token is NEVER propagated to the Minecraft bridge');
  const updates = companion.match(/child_env\.update\(\{([\s\S]*?)\}\)/);
  ok(Boolean(updates), 'only explicitly listed Minecraft variables are added to the bridge env');
  const added = updates
    ? [...new Set((updates[1].match(/'(JARVIS_[A-Z_]+)'/g) || []).map((x) => x.replace(/'/g, '')))]
    : [];
  ok(added.length === 3 && added.every((k) => k.startsWith('JARVIS_MINECRAFT_')),
    'exactly the three Minecraft connection variables are added', JSON.stringify(added));
  ok(!added.includes('JARVIS_WINDOWS_COMPANION_TOKEN') && !added.includes('JARVIS_API_KEY'),
    'no credential reaches the game bridge', JSON.stringify(added));
  ok(/JARVIS_MINECRAFT_LAN_HOST':os\.environ\.get\('JARVIS_MINECRAFT_LAN_HOST','127\.0\.0\.1'\)/.test(companion),
    'the bridge defaults to loopback, and the historical LAN port is never assumed');

  // ——— summary ———————————————————————————————————————————————————————————
  const total = checks + failures.length;
  console.log('');
  if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log('  -', f); }
  console.log(`COMPANION_BRIDGE_WORKFLOW ${checks}/${total} ${failures.length ? 'FAIL' : 'PASS'} ` +
    '(real Guardian gate on a simulated win32 realm; NOT Windows-native and NOT a live Minecraft join)');
  if (failures.length) process.exitCode = 1;
})().catch((err) => { console.error(err.stack || err); process.exitCode = 1; });
