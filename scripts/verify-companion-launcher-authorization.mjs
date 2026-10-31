/**
 * JARVIS V1 — Windows companion launcher authorization.
 *
 * Observed defect: an owner-authorized `minecraft_companion_join` was DENIED
 * three times with "Windows companion requires the isolated loopback
 * development launcher" even though the owner HAD started the isolated local
 * development launcher and the local auth endpoint returned HTTP 200.
 *
 * Root cause: two launchers produced two different authorization contexts.
 * session.ts checks the loopback development contract (NODE_ENV, no-login flag,
 * bind address, exact origin/host), which `npm run dev` satisfies — so the
 * session authenticated. policy.ts additionally requires
 * JARVIS_WINDOWS_AGENT_ENABLED=1 and a >=32-character companion token, which
 * ONLY start-windows-agent.mjs supplied. The result was a session that logged in
 * successfully and could never use a single companion tool.
 *
 * This suite proves the repair end to end at the contract level: ONE launcher
 * context now satisfies the startup preflight AND the runtime companion gate,
 * while every unsafe configuration is still refused.
 *
 * OFFLINE ONLY. This is not Windows-native acceptance and not a live Minecraft
 * join: no companion process, no Minecraft server and no LAN world is contacted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  COMPANION_TOKEN_MIN_LENGTH,
  companionAuthorizationContext,
  companionFeatureRequested,
  localDevEnvironment,
} from './local-dev-bootstrap.mjs';
import { validateLocalWindowsEnvironment } from './windows-startup-preflight.mjs';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
const failures = [];
function ok(condition, label, detail) {
  if (condition) { checks++; console.log('PASS', label); return true; }
  failures.push(label + (detail ? ` — ${detail}` : ''));
  console.log('FAIL', label, detail ? `— ${detail}` : '');
  return false;
}

// ——— load the real runtime gate (TypeScript) into a fake win32 process ————————
// policy.ts requires ./desktopPolicy and ./minecraftBridgePolicy. A plain
// createRequire rooted at scripts/ cannot resolve those, and modules must be
// cached BEFORE evaluation because minecraftBridgePolicy's static initialisers
// call back into desktopPolicy. Both behaviours are reproduced here.
const policyPath = path.join(root, 'src/lib/agent/windows/policy.ts');
const tsCache = new Map();
const extensions = ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json'];

function resolveSibling(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = extensions.includes(path.extname(base)) ? [base]
    : extensions.flatMap((ext) => [base + ext, path.join(base, 'index' + ext)]);
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

function loadTs(absPath) {
  const key = path.resolve(absPath);
  if (tsCache.has(key)) return tsCache.get(key).exports;
  const moduleExports = {};
  tsCache.set(key, { exports: moduleExports });
  if (!fs.existsSync(key)) throw new Error('cannot load ' + key);
  const source = fs.readFileSync(key, 'utf8');
  if (path.extname(key) === '.json') { Object.assign(moduleExports, JSON.parse(source)); return moduleExports; }
  if (/\.m?js$/.test(key)) return require(key);
  const compiled = ts.transpileModule(source, {
    fileName: key,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.length) {
    throw new Error(`TypeScript syntax errors in ${path.relative(root, key)}: ${compiled.diagnostics.map((d) => d.messageText).join('; ')}`);
  }
  const localRequire = (specifier) => {
    const resolved = resolveSibling(key, specifier);
    return resolved ? loadTs(resolved) : require(specifier);
  };
  vm.runInNewContext(compiled.outputText, {
    exports: moduleExports,
    module: { exports: moduleExports },
    require: localRequire,
    process: { platform: 'win32', env: {}, cwd: () => root },
    console,
    URL,
    TextEncoder,
    TextDecoder,
  }, { filename: path.relative(root, key), timeout: 5000 });
  return moduleExports;
}

function runtimeGate(env, platform = 'win32') {
  // Re-evaluate policy.ts per scenario: it captures process.platform/env at call
  // time, but the module-level shims must reflect this scenario's host.
  tsCache.delete(policyPath);
  const compiled = ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), {
    fileName: policyPath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.length) {
    throw new Error(`TypeScript syntax errors in policy.ts: ${compiled.diagnostics.map((d) => d.messageText).join('; ')}`);
  }
  const exports = {};
  const localRequire = (specifier) => {
    const resolved = resolveSibling(policyPath, specifier);
    return resolved ? loadTs(resolved) : require(specifier);
  };
  vm.runInNewContext(compiled.outputText, {
    exports,
    module: { exports },
    require: localRequire,
    URL,
    console,
    process: { platform, env, cwd: () => root },
  }, { filename: 'policy.ts', timeout: 5000 });
  return exports.validateDesktopTool;
}

const LAN = {
  JARVIS_MINECRAFT_LAN_ENABLED: '1',
  JARVIS_MINECRAFT_LAN_HOST: '127.0.0.1',
  JARVIS_MINECRAFT_LAN_PORT: '54321',
  JARVIS_MINECRAFT_PLAYER: 'Aslam0704',
};
const LOOPBACK_DEV = {
  NODE_ENV: 'development',
  JARVIS_LOCAL_DEV_NO_LOGIN: '1',
  JARVIS_LOCAL_DEV_BIND: '127.0.0.1',
  JARVIS_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  DATABASE_URL: 'file:./jarvis-local-minecraft-test.db',
};

// ——— 1. the shared context is complete and fresh ————————————————————————————
console.log('\n── companion authorization context ──');
const ctx = companionAuthorizationContext({});
ok(ctx.JARVIS_WINDOWS_AGENT_ENABLED === '1', 'context enables the Windows companion agent');
ok(typeof ctx.JARVIS_WINDOWS_COMPANION_TOKEN === 'string' &&
   ctx.JARVIS_WINDOWS_COMPANION_TOKEN.length >= COMPANION_TOKEN_MIN_LENGTH,
  `context supplies a token of at least ${COMPANION_TOKEN_MIN_LENGTH} characters`,
  `got length ${String(ctx.JARVIS_WINDOWS_COMPANION_TOKEN ?? '').length}`);
ok(/^[0-9a-f]+$/.test(ctx.JARVIS_WINDOWS_COMPANION_TOKEN),
  'the token is hex key material, not a predictable placeholder');
ok(companionAuthorizationContext({}).JARVIS_WINDOWS_COMPANION_TOKEN !==
   companionAuthorizationContext({}).JARVIS_WINDOWS_COMPANION_TOKEN,
  'each launch generates a distinct token (no shared static secret)');
const pinned = 'p'.repeat(48);
ok(companionAuthorizationContext({ JARVIS_WINDOWS_COMPANION_TOKEN: pinned }).JARVIS_WINDOWS_COMPANION_TOKEN === pinned,
  'an operator-pinned token is reused rather than silently replaced');
ok(companionAuthorizationContext({ JARVIS_WINDOWS_COMPANION_TOKEN: 'weak' }).JARVIS_WINDOWS_COMPANION_TOKEN !== 'weak',
  'a too-short operator token is replaced, never passed through');
ok(Object.keys(ctx).length === 2, 'the context adds only the two companion keys (no scope creep)');

// ——— 2. ONE context satisfies preflight AND the runtime gate ————————————————
console.log('\n── cross-layer authorization (the actual defect) ──');
const launcherEnv = { ...LOOPBACK_DEV, ...companionAuthorizationContext({}), ...LAN };
ok(validateLocalWindowsEnvironment(launcherEnv) === true,
  'the launcher context passes the startup preflight');
const gate = runtimeGate(launcherEnv);
const join = gate('minecraft_companion_join', {});
ok(join.ok === true, 'the SAME context authorizes minecraft_companion_join at runtime',
  join.ok ? '' : `denied: ${join.reason}`);
ok(join.ok && join.prepared?.operation === 'minecraft_join',
  'the authorized join prepares the minecraft_join operation');
ok(gate('minecraft_companion_stop', {}).ok === true, 'the same context authorizes minecraft_companion_stop');
ok(gate('minecraft_companion_command', { command: 'status' }).ok === true,
  'the same context authorizes a read-only companion command');
ok(gate('windows_discover_apps', {}).ok === true,
  'the same context authorizes companion capability discovery');

// The pre-repair state: a plain `npm run dev` session authenticated but could
// not use the companion. Prove that combination is still refused (it must be —
// the fix is to launch correctly, not to lower the gate).
const plainDevEnv = { ...LOOPBACK_DEV, ...LAN };
ok(companionFeatureRequested(plainDevEnv) === true,
  'the plain-launcher environment is recognized as wanting companion features');
const plainGate = runtimeGate(plainDevEnv);
const plainJoin = plainGate('minecraft_companion_join', {});
ok(plainJoin.ok === false, 'a plain dev session still cannot join (gate not weakened)');
ok(/JARVIS_WINDOWS_AGENT_ENABLED/.test(plainJoin.reason ?? ''),
  'and now says exactly which precondition is missing, instead of blaming the launcher',
  plainJoin.reason);

// ——— 3. unsafe configurations are still refused ————————————————————————————
console.log('\n── fail-closed behaviour is preserved ──');
const UNSAFE = [
  [{ ...launcherEnv, JARVIS_LOCAL_DEV_BIND: '0.0.0.0' }, 'a non-loopback bind'],
  [{ ...launcherEnv, JARVIS_LOCAL_DEV_NO_LOGIN: '0' }, 'the authenticated launch path'],
  [{ ...launcherEnv, NODE_ENV: 'production' }, 'production'],
  [{ ...launcherEnv, JARVIS_WINDOWS_COMPANION_TOKEN: 'short' }, 'a weak companion token'],
  [{ ...launcherEnv, JARVIS_WINDOWS_AGENT_ENABLED: '0' }, 'the companion disabled'],
  [{ ...launcherEnv, JARVIS_MINECRAFT_LAN_ENABLED: '0' }, 'Minecraft not enabled by the operator'],
  [{ ...launcherEnv, JARVIS_MINECRAFT_LAN_HOST: '192.168.0.5' }, 'a non-loopback LAN host'],
  [{ ...launcherEnv, JARVIS_MINECRAFT_PLAYER: 'JarvisBuddy' }, 'the bot named as its own owner'],
];
for (const [env, label] of UNSAFE) {
  let preflightThrew = false;
  try { validateLocalWindowsEnvironment(env); } catch { preflightThrew = true; }
  const decision = runtimeGate(env)('minecraft_companion_join', {});
  ok(preflightThrew || decision.ok === false, `refused: ${label}`,
    preflightThrew ? '' : `allowed with reason ${decision.reason}`);
}
ok(runtimeGate(launcherEnv, 'linux')('minecraft_companion_join', {}).ok === false,
  'refused: a non-Windows host');
// localDevEnvironment reads the REAL process.env.NODE_ENV, so the refusal has to
// be exercised by actually setting it (and restoring it afterwards).
const savedNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
let productionRefused = false;
try { localDevEnvironment(process.env); } catch { productionRefused = true; }
if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
ok(productionRefused, 'the shared bootstrap still refuses passwordless development in production');

// ——— 4. launcher wiring ———————————————————————————————————————————————————
console.log('\n── launcher wiring ──');
const plain = fs.readFileSync(path.join(root, 'scripts/start-local-no-login.mjs'), 'utf8');
const windows = fs.readFileSync(path.join(root, 'scripts/start-windows-agent.mjs'), 'utf8');
ok(/companionFeatureRequested\(process\.env\)/.test(plain) &&
   /delegateToWindowsLauncher/.test(plain),
  'the plain launcher delegates to the coordinated launcher when companion features are configured');
ok(/loadEnvConfig/.test(plain),
  'the plain launcher loads .env BEFORE deciding, so .env-configured flags are visible');
ok(/process\.platform==='win32' && companionFeatureRequested/.test(plain),
  'delegation is scoped to Windows, leaving other platforms untouched');
ok(/NOT authorized in this mode/.test(plain) && /dev:windows/.test(plain),
  'when it does not delegate, it states plainly that companion tools will be denied');
ok(/companionAuthorizationContext\(process\.env\)/.test(windows),
  'the Windows launcher uses the same shared authorization context');
ok(!/randomBytes\(48\)/.test(windows),
  'token generation is no longer duplicated inside the Windows launcher');
ok(/assertWindowsServicesFree/.test(windows),
  'the launcher still refuses to reuse an occupied service port');
ok(/JARVIS_MINECRAFT_LAN_ENABLED/.test(windows),
  'the launcher still forwards Minecraft LAN configuration to the companion child');

// The token must reach the companion child but never the audit log.
ok(/JARVIS_WINDOWS_COMPANION_TOKEN/.test(windows),
  'the companion child receives the token');
const policy = fs.readFileSync(policyPath, 'utf8');
ok(!/reason:.*JARVIS_WINDOWS_COMPANION_TOKEN\s*[}\)]/.test(policy) &&
   !/reason:.*\$\{process\.env\.JARVIS_WINDOWS_COMPANION_TOKEN\}/.test(policy),
  'no denial reason interpolates the token value into the audit log');

// ——— summary ————————————————————————————————————————————————————————————
const total = checks + failures.length;
console.log('');
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  -', f);
}
console.log(`COMPANION_LAUNCHER_AUTHORIZATION ${checks}/${total} ${failures.length ? 'FAIL' : 'PASS'} (offline contract checks; NOT Windows-native and NOT a live Minecraft join)`);
if (failures.length) process.exitCode = 1;
