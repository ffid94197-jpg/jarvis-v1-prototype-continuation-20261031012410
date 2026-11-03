#!/usr/bin/env node
'use strict';
/**
 * JARVIS V1 — Core execution honesty regressions.
 *
 * Covers three observed defects:
 *   1. Greeting identified as the underlying base model ("I am GLM") instead of
 *      JARVIS.
 *   2. Planner finished ACTIONABLE tasks with zero independently verified tool
 *      execution, because the guard was a denylist of actionable phrasings.
 *   3. minecraft_companion_join denied with one undifferentiated message, so an
 *      operator already using the isolated loopback development launcher could
 *      not tell which precondition was missing.
 *
 * OFFLINE ONLY. This proves source contracts and deterministic classification.
 * It is NOT Windows-native acceptance, NOT a live Minecraft result, and NOT
 * evidence about any real model's behaviour.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
let passed = 0;
const failures = [];

function ok(condition, label, detail) {
  if (condition) { passed++; console.log('PASS', label); return true; }
  failures.push(label + (detail ? ` — ${detail}` : ''));
  console.log('FAIL', label, detail ? `— ${detail}` : '');
  return false;
}

// Everything below runs inside an async main: the provider-failover checks
// await real promise-returning bridges, and top-level await is not valid in
// CommonJS.
(async () => {

// ——— transpiling loader with sibling resolution ——————————————————————————
const cache = new Map();
function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const abs = path.join(root, rel);
  const moduleExports = {};
  cache.set(rel, moduleExports);           // register BEFORE eval: cycle-safe
  const source = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(source, {
    fileName: abs,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  if (out.diagnostics && out.diagnostics.length) {
    throw new Error(`TypeScript syntax errors in ${rel}: ${out.diagnostics.map((d) => d.messageText).join('; ')}`);
  }
  const dir = path.dirname(abs);
  const localRequire = (spec) => {
    if (typeof spec === 'string' && spec.startsWith('.')) {
      const base = path.resolve(dir, spec);
      for (const candidate of [base + '.ts', base + '.js', path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
        if (fs.existsSync(candidate)) return load(path.relative(root, candidate));
      }
    }
    return require(spec);                   // bare specifier → host require
  };
  vm.runInNewContext(out.outputText, {
    exports: moduleExports,
    module: { exports: moduleExports },
    require: localRequire,
    process,
    console,
    URL,
    TextEncoder,
    TextDecoder,
    AbortSignal,
    setTimeout,
    clearTimeout,
    Buffer,
    fetch: globalThis.fetch,
  }, { filename: rel });
  return moduleExports;
}

const { classifyRequestIntent, isConversationalRequest } = load('src/lib/agent/core/requestIntent.ts');
const { enforceJarvisIdentity, PLANNER_SYSTEM_PROMPT, JARVIS_IDENTITY_CONTRACT } = load('src/lib/agent/core/prompts.ts');
const { desktopObjectiveRequiresActions } = load('src/lib/agent/core/autonomyGate.ts');
const { requiresExternalActionEvidence } = load('src/lib/agent/core/goalPlanner.ts');

// ——— 1. ACTIONABLE requests must require real execution evidence ————————————
// The first nine were measured as reaching a zero-step "conversational" =>
// completed verdict at the parent commit, i.e. fabricated success.
console.log('\n── actionable objectives must NOT settle conversationally ──');
const ACTIONABLE = [
  'turn on bluetooth',
  'mute the speakers',
  'connect to the LAN world',
  'stop the music',
  'restart the companion bot',
  'enable the screen capture',
  'switch to the other window',
  'print that document',
  'lock the workstation',
  'send that to my email',
  'set the volume to zero',
  // already caught before this repair — must stay caught
  'pause the download',
  'join my minecraft world',
  'defeat the ender dragon',
  'mine ten cobblestone blocks',
  'create a folder called reports',
  'please delete the old build',
  'jarvis, launch notepad',
  'good, now open chrome',
  'Open Windows Settings',
  'complete it fully',
  'finish it',
  'do it',
  'do the remaining',
  'can you complete it?',
  'can you do it?',
  'can you help me complete it?',
  'could you please finish this?',
  'can you open chrome?',
];
for (const objective of ACTIONABLE) {
  const r = classifyRequestIntent(objective);
  ok(r.kind === 'actionable', `actionable: ${JSON.stringify(objective)}`, `got ${r.kind} (${r.reason})`);
}

// BIDIRECTIONAL PROOF that this test is load-bearing. The legacy guard was a
// denylist: for the objectives below BOTH legacy classifiers return false, so
// before this repair they reached arbitration with no predicates and no
// effects, which returned "conversational" and settled the task COMPLETED with
// zero tool calls. Asserting the legacy miss alongside the new catch proves the
// suite fails against the pre-repair source instead of passing vacuously.
console.log('\n── bidirectional: legacy denylist missed these, the classifier does not ──');
const PREVIOUSLY_SLIPPING = [
  'turn on bluetooth',
  'mute the speakers',
  'connect to the LAN world',
  'stop the music',
  'restart the companion bot',
  'enable the screen capture',
  'switch to the other window',
  'print that document',
  'lock the workstation',
];
for (const objective of PREVIOUSLY_SLIPPING) {
  const legacy = desktopObjectiveRequiresActions(objective) || requiresExternalActionEvidence(objective);
  ok(legacy === false, `legacy denylist does NOT catch ${JSON.stringify(objective)} (this was the defect)`);
  ok(classifyRequestIntent(objective).kind === 'actionable',
    `new classifier DOES catch ${JSON.stringify(objective)}`);
}
// And the legacy guard must not have been weakened to achieve that.
for (const objective of ['join my minecraft world', 'defeat the ender dragon', 'Open Windows Settings']) {
  ok(desktopObjectiveRequiresActions(objective) === true,
    `legacy denylist still catches ${JSON.stringify(objective)} (not weakened)`);
}

// ——— 2. genuine conversation must still be answerable directly ———————————————
console.log('\n── conversational objectives must remain conversational ──');
const CONVERSATIONAL = [
  'hello', 'hi', 'hey jarvis', 'good morning', 'good evening jarvis',
  'who are you?', 'what is your name', 'what can you do', 'are you jarvis',
  'tell me about yourself', 'what do you do',
  'thanks', 'thank you', 'ok', 'okay', 'nice', 'good job', 'got it', 'cool', 'sure', 'hmm',
  'what is the capital of France?', 'why is the sky blue',
  'explain what a Guardian policy is', 'compare sqlite and postgres',
  'how do I open chrome', 'how do I defeat the Ender Dragon?',
  'do you know how to make a cake?',
  'can you explain how to create a folder?',
  'can you tell me how to open chrome?',
  'how are you', 'what do you think about automation', 'tell me a joke',
  'bye', 'good night',
];
for (const objective of CONVERSATIONAL) {
  const r = classifyRequestIntent(objective);
  ok(r.kind === 'conversational', `conversational: ${JSON.stringify(objective)}`, `got ${r.kind} (${r.reason})`);
}
ok(isConversationalRequest('hello') === true, 'isConversationalRequest helper agrees');
ok(classifyRequestIntent('').kind === 'conversational', 'empty objective is not actionable');
ok(classifyRequestIntent('x'.repeat(500)).kind === 'actionable', 'over-long objective is treated as a task specification');

// ——— 3. operator-facing identity must be JARVIS ————————————————————————————
console.log('\n── base-model self-identification must be corrected ──');
const LEAKS = [
  ['I am GLM.', 'JARVIS'],
  ["Hello! I'm GLM, your AI assistant.", 'JARVIS'],
  ['I am ChatGPT, how can I help?', 'JARVIS'],
  ['You are talking to Claude.', 'JARVIS'],
  ['I was created by Zhipu AI.', 'installation'],
  ['My name is GLM-4.6.', 'JARVIS'],
  ['GLM is my underlying model.', 'JARVIS'],
  ['I am an AI assistant called GLM.', 'JARVIS'],
  ['Powered by OpenAI.', 'installation'],
  ['I\u2019m DeepSeek, ready to help.', 'JARVIS'],
  ['As your assistant, I am Gemini.', 'JARVIS'],
];
for (const [input, expect] of LEAKS) {
  const r = enforceJarvisIdentity(input);
  ok(r.corrected === true && r.text.includes(expect) && r.detected !== null,
    `identity corrected: ${JSON.stringify(input)}`, `got ${JSON.stringify(r.text)} corrected=${r.corrected}`);
}

console.log('\n── factual third-party model discussion must survive ──');
const KEEP = [
  'I am not sure but the GLM model is fast.',
  'GLM is my favourite model family for Chinese text.',
  'GLM is a family of models developed by Zhipu AI, a Chinese lab.',
  'You can route this task to a local Ollama model or a cloud provider.',
  'The bridge returned HTTP 401 from the provider.',
  'I am JARVIS, your assistant runtime on this machine.',
  'Nothing was verified; the task is PARTIAL.',
  'Claude and ChatGPT are both third-party models you may configure.',
  'Created by the operator: a routine that runs nightly.',
];
for (const input of KEEP) {
  const r = enforceJarvisIdentity(input);
  ok(r.corrected === false && r.text === input,
    `identity untouched: ${JSON.stringify(input.slice(0, 52))}`, `got ${JSON.stringify(r.text)}`);
}
ok(enforceJarvisIdentity('').corrected === false, 'empty text is not "corrected"');

// ——— 4. source-contract wiring —————————————————————————————————————————————
console.log('\n── Core wiring ──');
const loop = fs.readFileSync(path.join(root, 'src/lib/agent/core/loop.ts'), 'utf8');
ok(/import \{[^}]*\bclassifyRequestIntent\b[^}]*\} from "\.\/requestIntent"/.test(loop),
  'loop.ts imports the intent classifier');
ok(/import \{[^}]*\bisModelDisclosureQuestion\b[^}]*\} from "\.\/requestIntent"/.test(loop),
  'loop.ts imports the model-disclosure detector');
ok(/const intent = classifyRequestIntent\(objective\)/.test(loop),
  'loop.ts classifies the objective on the zero-step final path');
ok(/if \(intent\.kind === "actionable"\)/.test(loop),
  'loop.ts branches on the actionable classification');
// The actionable zero-step branch must settle a non-completed state.
const actionableBranch = loop.slice(loop.indexOf('if (intent.kind === "actionable")'));
const settleAfterBranch = actionableBranch.slice(0, actionableBranch.indexOf('// ——— PHASE 03'));
ok(/settleAndReport\(taskId, "failed"/.test(settleAfterBranch),
  'actionable-with-zero-execution settles FAILED, never completed');
ok(!/settleAndReport\(taskId, "completed"/.test(settleAfterBranch),
  'actionable-with-zero-execution cannot settle completed');
ok(/ZERO verified tool calls/.test(settleAfterBranch) && /BLOCKED, not completed/.test(settleAfterBranch),
  'denial text states nothing was verified and names the honest alternative');
ok(/unverified response, recorded as such/.test(settleAfterBranch),
  'the model answer is still surfaced to the operator, labelled unverified');
// The pre-existing denylist guard must remain — the new classifier ADDS to it.
ok(/if \(desktopObjectiveRequiresActions\(objective\) \|\| requiresExternalActionEvidence\(objective\)\)/.test(loop),
  'the pre-existing action gate is still enforced (not replaced)');
// The guard is now conditional: it must fire by default, and must be SUPPRESSED
// for an explicit model-disclosure question, where naming the real provider is
// the correct answer rather than a leak.
ok(/const identity = modelDisclosureRequested\s*\?\s*\{ text: answer, corrected: false, detected: null \}\s*:\s*enforceJarvisIdentity\(answer\)/.test(loop),
  'the conversational answer passes the identity guard, except for a disclosure question');
ok(/const modelDisclosureRequested = isModelDisclosureQuestion\(objective\)/.test(loop),
  'disclosure suppression is driven by the objective, not by the model output');
ok(/emit\(\{ type: "delta", text: identity\.text \}\)/.test(loop),
  'the operator sees the guarded identity text, not the raw model answer');
ok(/settleAndReport\(taskId, "completed", stepsUsed, identity\.text/.test(loop),
  'the durable record stores the guarded identity text');
ok(/const reportIdentity = modelDisclosureRequested\s*\?\s*\{ text: full, corrected: false, detected: null \}\s*:\s*enforceJarvisIdentity\(full\)/.test(loop),
  'the grounded report path is guarded too, with the same disclosure exception');
ok(/IDENTITY CORRECTION/.test(loop),
  'an identity correction is disclosed in the settlement digest, not silent');

const prompts = fs.readFileSync(path.join(root, 'src/lib/agent/core/prompts.ts'), 'utf8');
ok(typeof JARVIS_IDENTITY_CONTRACT === 'string' && JARVIS_IDENTITY_CONTRACT.length > 200,
  'prompts.ts exports an identity contract');
ok(PLANNER_SYSTEM_PROMPT.includes('You are JARVIS'),
  'the planner system prompt pins JARVIS as the only operator-facing identity');
ok(PLANNER_SYSTEM_PROMPT.includes(JARVIS_IDENTITY_CONTRACT),
  'the identity contract is actually embedded in the planner system prompt');
// The contract must do BOTH things: forbid adopting a vendor identity, and
// require accurate disclosure when the owner asks. A contract that only forbade
// mentioning providers would make JARVIS lie about its own configuration.
ok(/Never adopt its name as your own/.test(prompts),
  'the contract forbids adopting the base model name as JARVIS identity');
ok(/ACCURATE DISCLOSURE IS REQUIRED, NOT FORBIDDEN/.test(prompts),
  'the contract REQUIRES accurate provider disclosure when asked');
ok(/CURRENT ADVISORY PROVIDER/.test(prompts),
  'the contract points the model at the real provider metadata for disclosure');
ok(/Identity and disclosure are different answers/.test(prompts),
  'the contract separates "who are you" from "which model are you using"');
ok(/never invent a model name, subscription tier or provider access/.test(prompts),
  'the contract forbids inventing a model, tier or provider access');
ok(/\$\{JARVIS_IDENTITY_CONTRACT\}/.test(prompts),
  'the contract is injected from turn one (not only in the report phase)');

// ——— 5. app shell must not carry third-party model branding ————————————————
console.log('\n── app shell branding ──');
const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
// Strip comments first: the explanatory comment deliberately NAMES the removed
// third-party CDN so the next reader knows why it is gone. Only executable code
// must be free of the branding.
const layoutCode = layout
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
ok(!/chatglm\.cn/i.test(layoutCode), 'layout.tsx code no longer references the chatglm.cn CDN');
ok(!/z-cdn/i.test(layoutCode), 'layout.tsx code no longer references the Z.ai asset CDN');
ok(!/z-ai/i.test(layoutCode), 'layout.tsx code no longer references z-ai branding');
ok(!/icons\s*:/.test(layoutCode), 'layout.tsx ships no third-party icon metadata');
ok(/chatglm\.cn/.test(layout), 'the removed branding is documented in a comment for the next reader');
ok(/JARVIS/.test(layout), 'layout.tsx still brands the console as JARVIS');

// ——— 6. companion gate must name the missing precondition ————————————————
console.log('\n── Windows companion gate diagnosability ──');
const policySource = fs.readFileSync(path.join(root, 'src/lib/agent/windows/policy.ts'), 'utf8');
const compiledPolicy = ts.transpileModule(policySource, {
  fileName: 'policy.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
if (compiledPolicy.diagnostics && compiledPolicy.diagnostics.length) {
  throw new Error('TypeScript syntax errors in windows/policy.ts');
}
function gateWith(env, platform = 'win32') {
  const exports = {};
  vm.runInNewContext(compiledPolicy.outputText, {
    exports, URL, require,
    process: { platform, env, cwd: () => root },
  }, { timeout: 1000 });
  return exports.validateDesktopTool;
}
const fullEnv = {
  JARVIS_WINDOWS_AGENT_ENABLED: '1',
  JARVIS_LOCAL_DEV_NO_LOGIN: '1',
  JARVIS_LOCAL_DEV_BIND: '127.0.0.1',
  JARVIS_WINDOWS_COMPANION_TOKEN: 'a'.repeat(64),
  JARVIS_MINECRAFT_LAN_ENABLED: '1',
  JARVIS_MINECRAFT_LAN_HOST: '127.0.0.1',
  JARVIS_MINECRAFT_LAN_PORT: '25565',
  JARVIS_MINECRAFT_PLAYER: 'OwnerPlayer',
};
ok(gateWith(fullEnv)('minecraft_companion_join', {}).ok === true,
  'authorized minecraft_companion_join is permitted through the isolated loopback launcher');
ok(gateWith(fullEnv)('minecraft_companion_stop', {}).ok === true,
  'authorized minecraft_companion_stop is permitted through the isolated loopback launcher');

// Every precondition still fails closed — the repair changed only the message.
const DENIALS = [
  [{ ...fullEnv, JARVIS_WINDOWS_AGENT_ENABLED: '0' }, 'JARVIS_WINDOWS_AGENT_ENABLED'],
  [{ ...fullEnv, JARVIS_LOCAL_DEV_NO_LOGIN: '0' }, 'JARVIS_LOCAL_DEV_NO_LOGIN'],
  [{ ...fullEnv, JARVIS_LOCAL_DEV_BIND: '0.0.0.0' }, '127.0.0.1'],
  [{ ...fullEnv, JARVIS_WINDOWS_COMPANION_TOKEN: 'short' }, 'JARVIS_WINDOWS_COMPANION_TOKEN'],
  [{ ...fullEnv, JARVIS_WINDOWS_COMPANION_TOKEN: undefined }, 'JARVIS_WINDOWS_COMPANION_TOKEN'],
];
for (const [env, expectedToken] of DENIALS) {
  const r = gateWith(env)('minecraft_companion_join', {});
  ok(r.ok === false, `still denied when ${expectedToken} is wrong`);
  ok(typeof r.reason === 'string' && r.reason.includes(expectedToken),
    `denial names the missing precondition (${expectedToken})`, `got ${JSON.stringify(r.reason)}`);
}
const linuxDenial = gateWith(fullEnv, 'linux')('minecraft_companion_join', {});
ok(linuxDenial.ok === false && /Windows host/.test(linuxDenial.reason),
  'non-Windows host still denied and says so');
ok(!/a\.repeat|aaaa/.test(linuxDenial.reason) && !linuxDenial.reason.includes('a'.repeat(32)),
  'denial reasons never leak the companion token value');

const lanDenial = gateWith({ ...fullEnv, JARVIS_MINECRAFT_LAN_ENABLED: '0' })('minecraft_companion_join', {});
ok(lanDenial.ok === false, 'Minecraft opt-out is still enforced');
ok(/JARVIS_MINECRAFT_LAN_ENABLED=1/.test(lanDenial.reason) &&
   /JARVIS_MINECRAFT_LAN_PORT/.test(lanDenial.reason) &&
   /JARVIS_MINECRAFT_PLAYER/.test(lanDenial.reason),
  'the LAN denial lists every variable the operator must set');
ok(/dev:windows/.test(lanDenial.reason), 'the LAN denial names the correct launcher');

// The gate must not be weakened: the five conditions are all still required.
ok(/process\.platform !== "win32"/.test(policySource) &&
   /JARVIS_WINDOWS_AGENT_ENABLED !== "1"/.test(policySource) &&
   /JARVIS_LOCAL_DEV_NO_LOGIN !== "1"/.test(policySource) &&
   /JARVIS_LOCAL_DEV_BIND !== "127\.0\.0\.1"/.test(policySource) &&
   /\.length < 32/.test(policySource),
  'all five companion preconditions remain enforced in source');

// ——— 7. launcher preflight must fail at startup, not mid-task ——————————————
console.log('\n── launcher preflight ──');
const preflight = fs.readFileSync(path.join(root, 'scripts/windows-startup-preflight.mjs'), 'utf8');
ok(/JARVIS_WINDOWS_AGENT_ENABLED !== '1'/.test(preflight),
  'preflight asserts the companion enable flag');
ok(/JARVIS_WINDOWS_COMPANION_TOKEN/.test(preflight) && /length < 32/.test(preflight),
  'preflight asserts the companion token length');
ok(/half-configured/.test(preflight),
  'preflight detects Minecraft configured without the enable flag');

// ——— 8. provider provenance and honest disclosure —————————————————————————
console.log('\n── provider identity metadata (Core owns identity, adapter reports provenance) ──');
const { modelIdentityContext } = load('src/lib/agent/core/modelProvider.ts');
const { createCompatibleBridge } = load('src/lib/agent/core/compatProvider.ts');
const { isFailoverCandidate, withLocalQuotaFallback } = load('src/lib/agent/core/localFallback.ts');

// A throwing fetch stub: constructing a bridge must not touch the network, and
// this guarantees the suite cannot make a real provider call.
const noNetwork = () => { throw new Error('TEST GUARD: the bridge must not perform network I/O in this suite'); };
const compat = createCompatibleBridge(
  { url: 'https://api.apinex.bond/v1/chat/completions', model: 'free/glm-5.3', key: 'sk-SECRET-VALUE-DO-NOT-LEAK' },
  noNetwork,
);
ok(compat.identity && compat.identity.modelId === 'free/glm-5.3',
  'the OpenAI-compatible bridge reports its real configured model id',
  JSON.stringify(compat.identity));
ok(compat.identity && compat.identity.host === 'api.apinex.bond',
  'the bridge reports the configured endpoint host');
ok(compat.identity && compat.identity.local === false,
  'a public HTTPS provider is not reported as local');
// The label must be derived from the operator's own configuration, not an
// invented marketing name. Claiming to be "OpenAI" because the protocol is
// OpenAI-compatible would be exactly the kind of fabrication this forbids.
ok(compat.identity && compat.identity.provider === 'OpenAI-compatible endpoint (api.apinex.bond)',
  'the provider label is the honest protocol plus the configured host',
  JSON.stringify(compat.identity && compat.identity.provider));
ok(compat.identity && !/^openai$/i.test(compat.identity.provider) &&
   !/official|inc\.|corp/i.test(compat.identity.provider),
  'the bridge does not claim to BE the protocol vendor');
const compatLine = modelIdentityContext(compat.identity);
ok(compatLine.includes('free/glm-5.3') && compatLine.includes('CURRENT ADVISORY PROVIDER'),
  'the injected disclosure line names the real model');
ok(!compatLine.includes('sk-SECRET-VALUE-DO-NOT-LEAK') && !/SECRET/i.test(compatLine),
  'the disclosure line never contains the API key');
ok(!modelIdentityContext(undefined).includes('undefined') &&
   /could not confirm the active provider/.test(modelIdentityContext(undefined)),
  'a missing bridge identity is reported as unknown, never guessed');
ok(/not specified/.test(modelIdentityContext({ backend: 'zai', provider: 'Z.ai', modelId: 'not specified (selected by the Z.ai SDK)', local: false })),
  'an SDK-selected model is disclosed as "not specified" rather than invented');

// Disclosure detection must be accurate in both directions.
const { isModelDisclosureQuestion } = load('src/lib/agent/core/requestIntent.ts');
for (const q of ['which model are you using?', 'what model is in use', 'which provider are you on',
  'who made you', 'are you GPT or GLM', 'what backend is active']) {
  ok(isModelDisclosureQuestion(q) === true, `disclosure detected: ${JSON.stringify(q)}`);
}
for (const q of ['hi', 'who are you?', 'open chrome', 'what can you do', 'thanks',
  'GLM is a third-party model family', 'create a folder called reports']) {
  ok(isModelDisclosureQuestion(q) === false, `not a disclosure question: ${JSON.stringify(q)}`);
}
// "who are you?" is identity, NOT disclosure: it must still be guarded.
ok(isModelDisclosureQuestion('who are you?') === false &&
   classifyRequestIntent('who are you?').kind === 'conversational',
  '"who are you?" stays an identity question, so the JARVIS guard still applies');

// ——— 9. provider failover must broaden without crossing privacy boundaries ——
console.log('\n── provider failover classification ──');
const errWith = (message, status) => Object.assign(new Error(message), status === undefined ? {} : { status });
for (const [e, want] of [
  [errWith('quota exhausted', 429), true],
  [errWith('request timed out'), true],
  [errWith('fetch failed ECONNREFUSED'), true],
  [errWith('model returned an empty response'), true],
  [errWith('invalid api key', 401), false],
  [Object.assign(new Error('blocked'), { name: 'PrivacyRouteError' }), false],
]) {
  ok(isFailoverCandidate(e) === want,
    `failover candidate=${want} for ${JSON.stringify(e.message.slice(0, 34))}`);
}
ok(isFailoverCandidate(Object.assign(new Error('blocked'), { name: 'PrivacyRouteError' })) === false,
  'a privacy-route refusal is NEVER failed over to another backend');

// The wrapper must report the backend that is ACTUALLY serving after failover.
let cloudCalls = 0;
const cloudBridge = { identity: { backend: 'zai', provider: 'Z.ai', modelId: 'cloud-x', local: false },
  complete: async () => { cloudCalls++; throw errWith('quota exhausted', 429); }, report: async () => '' };
const localBridge = { identity: { backend: 'ollama', provider: 'Ollama (local loopback)', modelId: 'local-y', local: true },
  complete: async () => 'local answer', report: async () => 'local answer' };
const failover = withLocalQuotaFallback(cloudBridge, localBridge);
ok(failover.identity && failover.identity.provider === 'Z.ai', 'before failover the identity is the primary provider');
const failoverResult = await failover.complete([]);
ok(failoverResult === 'local answer', 'a rate-limited primary fails over to the authorized local model');
ok(failover.identity && failover.identity.provider === 'Ollama (local loopback)',
  'after failover the reported identity follows the ACTIVE backend');
ok(failover.failovers === 1, 'the failover is counted for diagnostics');
ok(cloudCalls === 1, 'the primary is attempted exactly once (never re-hammered while rate-limited)');

// ——— 10. recovery before termination, and bounded retry ————————————————
console.log('\n── Core recovery behaviour ──');
ok(/const MAX_ACTION_NUDGES = 2/.test(loop),
  'the planner is sent back to act instead of the task dying on the first mistake');
ok(/actionNudges < MAX_ACTION_NUDGES/.test(loop) && /actionNudges\+\+/.test(loop),
  'the recovery nudge is bounded, so it cannot spin');
ok(/function actionRequiredNudge/.test(loop) && /REJECTED COMPLETION — NO VERIFIED EXECUTION/.test(loop),
  'the nudge states the rejection and demands a real tool call');
ok(/name the missing capability|naming the missing capability/.test(loop),
  'the nudge offers the honest BLOCKED alternative instead of a fabricated action');
ok(/emitStatus\("replanning"\)/.test(loop), 'replanning is surfaced to NEXUS as a status phase');
ok(/const MODEL_ROUTE_ATTEMPTS = 3/.test(loop) && /MODEL_ROUTE_BACKOFF_MS/.test(loop),
  'provider route construction retries with bounded backoff');
ok(/createModelBridgeWithRetry\(opts\.ownerId, pinnedId\)/.test(loop),
  'the Core actually uses the retrying route constructor');
ok(/if \(!failure\.retryable \|\| lastAttempt\) throw err/.test(loop),
  'a permanent provider fault is rethrown immediately and reported honestly');
ok(/MODEL_PRIVACY_ROUTE_BLOCKED/.test(loop) || /privacy/i.test(loop.slice(loop.indexOf('createModelBridgeWithRetry'), loop.indexOf('createModelBridgeWithRetry') + 1800)),
  'the retry path documents that a privacy refusal is never retried into another backend');
ok(/messages\.splice\(1, 0, \{ role: "assistant", content: modelIdentityContext\(model\?\.identity\) \}\)/.test(loop),
  'real provider metadata is injected into the planner context after the bridge exists');
ok(/kind: "model_identity"|persistStep\(taskId, seq \+ 1, "model_identity"/.test(loop),
  'the provider that actually served the task is recorded durably');

// ——— summary —————————————————————————————————————————————————————————————
const total = passed + failures.length;
console.log('');
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  -', f);
}
console.log(`CORE_CONVERSATIONAL_SEPARATION ${passed}/${total} ${failures.length ? 'FAIL' : 'PASS'} (offline source and classifier contracts; NOT Windows or live Minecraft acceptance)`);
if (failures.length) process.exitCode = 1;

})().catch((err) => {
  console.error('HARNESS ERROR:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
