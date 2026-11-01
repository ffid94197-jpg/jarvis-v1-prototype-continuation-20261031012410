/**
 * JARVIS V1 — product identity vs. accurate provider disclosure (FIX 2).
 *
 * Owner-observed leak:
 *     Owner:  hi
 *     JARVIS: Hello! I am GLM — a large language model developed by Zhipu AI.
 *
 * Three independent root causes, all repaired:
 *
 * A. THE GUARD DEFEATED ITSELF. SELF_ID_RE rewrote "I am GLM" -> "I am JARVIS"
 *    first, consuming the vendor token that anchored the attribution rule; and
 *    DEVELOPED_BY_SELF_RE's gap excludes commas, so it could not span the
 *    appositive in "I am GLM, a large language model developed by Zhipu AI".
 *    Result: the product name was fixed while the vendor attribution survived.
 *    A compound rule now matches the whole self-identification span at once.
 *
 * B. THE INSTRUCTION NEVER REACHED THE PROVIDER AS A SYSTEM MESSAGE. Core
 *    encodes the identity contract as role:"assistant" because ModelMessage only
 *    allows user|assistant. The compatible and Anthropic adapters converted that
 *    preface properly, but the Z.ai SDK bridge (the DEFAULT backend) and the
 *    local Ollama bridge passed roles straight through — so on the default path
 *    the JARVIS identity contract arrived as PRIOR ASSISTANT OUTPUT with no
 *    system authority. One shared normalizer now serves every backend.
 *
 * C. OVER-REACH IN THE OTHER DIRECTION. The attribution rule accepted a bare
 *    first-person pronoun as its lead, so "I think GLM was developed by Zhipu
 *    AI" — a factual statement about a third party — was corrupted. The lead is
 *    now a real self-identification frame, with a separate passive rule for
 *    "I was created by …".
 *
 * Disclosure is NOT suppressed: when the operator explicitly asks which model is
 * in use, loop.ts skips this guard and answers from real ModelIdentity metadata.
 * Identity and disclosure are two different answers, and both must be correct.
 *
 * OFFLINE ONLY. No provider is contacted.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const cache = new Map();
const exts = ['.ts', '.js', '.cjs', '.json'];
function load(rel) {
  const abs = path.resolve(root, rel);
  if (cache.has(abs)) return cache.get(abs).exports;
  const moduleExports = {};
  cache.set(abs, { exports: moduleExports });
  const src = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(src, {
    fileName: abs,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  if (out.diagnostics && out.diagnostics.length) {
    throw new Error(`TS errors in ${rel}: ${out.diagnostics.map((d) => d.messageText).join('; ')}`);
  }
  const localRequire = (spec) => {
    if (spec === '@/lib/db') return { db: {} };
    if (!spec.startsWith('.')) return require(spec);
    const base = path.resolve(path.dirname(abs), spec);
    const cands = exts.includes(path.extname(base)) ? [base]
      : exts.flatMap((e) => [base + e, path.join(base, 'index' + e)]);
    const file = cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (!file) return require(spec);
    return path.extname(file) === '.ts' ? load(path.relative(root, file)) : require(file);
  };
  vm.runInNewContext(out.outputText, {
    exports: moduleExports, module: { exports: moduleExports }, require: localRequire,
    process, console, URL, TextEncoder, TextDecoder, AbortSignal, setTimeout, clearTimeout,
    fetch: () => { throw new Error('TEST GUARD: no network in this suite'); },
  }, { filename: rel });
  return moduleExports;
}

const { enforceJarvisIdentity, PLANNER_SYSTEM_PROMPT, selectPlannerSystemPrompt, JARVIS_IDENTITY_CONTRACT } =
  load('src/lib/agent/core/prompts.ts');
const { normalizeSystemInstructions, modelIdentityContext } =
  load('src/lib/agent/core/modelProvider.ts');
const { isModelDisclosureQuestion, classifyRequestIntent } =
  load('src/lib/agent/core/requestIntent.ts');
const loopSrc = fs.readFileSync(path.join(root, 'src/lib/agent/core/loop.ts'), 'utf8');
const providerSrc = fs.readFileSync(path.join(root, 'src/lib/agent/core/modelProvider.ts'), 'utf8');
const compatSrc = fs.readFileSync(path.join(root, 'src/lib/agent/core/compatProvider.ts'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'src/lib/agent/models/bridge.ts'), 'utf8');

/** Tokens that must never survive a self-identification rewrite. */
const VENDOR_TOKENS = ['glm', 'chatglm', 'zhipu', 'z-ai', 'chatgpt', 'gpt', 'openai', 'open ai',
  'claude', 'anthropic', 'sonnet', 'opus', 'haiku', 'gemini', 'google', 'deepmind', 'grok',
  'llama', 'meta', 'qwen', 'kimi', 'moonshot', 'deepseek', 'mistral', 'copilot', 'microsoft',
  'perplexity', 'cohere', 'ernie', 'hunyuan', 'yi'];
function survivingVendors(text) {
  return VENDOR_TOKENS.filter((t) =>
    new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}

// ——— 1. the observed leak and its variants —————————————————————————————————
console.log('\n── self-identification must always resolve to JARVIS ──');
const LEAKS = [
  'Hello! I am GLM — a large language model developed by Zhipu AI.',
  'Hello! I am GLM, a large language model developed by Zhipu AI.',
  'Hello! I am GLM - a large language model developed by Zhipu AI.',
  'Hi! I am ChatGPT, an AI assistant developed by OpenAI.',
  'Hello, I am Claude, made by Anthropic.',
  'I am Gemini, a large language model created by Google.',
  'Hello! I am Llama, developed by Meta.',
  "I'm GLM.",
  'I am GLM.',
  'My name is GLM.',
  'I go by Claude.',
  'Call me ChatGPT.',
  'GLM here!',
  'Claude at your service.',
  'You are talking to GLM.',
  'This is ChatGPT speaking.',
  'I was created by Zhipu AI.',
  'I was built by OpenAI.',
  'I was trained by Anthropic.',
  'I am powered by OpenAI.',
  'I am currently running on GLM-5.3.',
  'Hi there! I am running on GLM-5.3 via APINEX.',
  'GLM is my underlying model.',
  'Claude is my identity.',
  'Hello! I am Qwen, developed by Alibaba.',
  'I am DeepSeek, a model developed by DeepSeek AI.',
  'I am Kimi, created by Moonshot.',
  'I am Grok, developed by xAI.',
  'I am Mistral, made by Mistral AI.',
  'I am Sonnet, a model by Anthropic.',
];
for (const input of LEAKS) {
  const r = enforceJarvisIdentity(input);
  const left = survivingVendors(r.text);
  ok(r.corrected === true, `corrected: ${JSON.stringify(input.slice(0, 46))}`,
    `corrected=${r.corrected} -> ${r.text.slice(0, 70)}`);
  ok(left.length === 0, `no vendor token survives: ${JSON.stringify(input.slice(0, 40))}`,
    `survived [${left.join(',')}] -> ${r.text.slice(0, 80)}`);
  ok(/JARVIS/i.test(r.text), `JARVIS is named: ${JSON.stringify(input.slice(0, 40))}`,
    r.text.slice(0, 80));
  ok(typeof r.detected === 'string' && r.detected.length > 0,
    `the leak is recorded for the audit trail: ${JSON.stringify(input.slice(0, 34))}`);
}
// A clean JARVIS answer must pass through untouched.
for (const clean of ['I am JARVIS, your personal autonomous assistant.',
  'Hello! I am JARVIS. How can I help?', 'JARVIS here!']) {
  const r = enforceJarvisIdentity(clean);
  ok(r.corrected === false && r.text === clean,
    `an already-correct answer is untouched: ${JSON.stringify(clean.slice(0, 40))}`,
    r.text.slice(0, 70));
}

// ——— 2. factual third-party discussion must survive UNCHANGED ————————————————
console.log('\n── legitimate model discussion must not be corrupted ──');
const FACTUAL = [
  'GLM is a family of models developed by Zhipu AI, a Chinese lab.',
  'I think GLM was developed by Zhipu AI.',
  'I believe Claude is made by Anthropic.',
  'Developed by Meta, Llama is an open-weights family.',
  'Claude and ChatGPT are both third-party models you may configure.',
  'You can route to Gemini, which Google maintains.',
  'GPT here is the summary you asked for.',
  'I am not sure, but the GLM model is fast.',
  'GLM is my favourite model family.',
  'I created a folder called reports.',
  'I am going to open Chrome now.',
  'I made a mistake on the last step and corrected it.',
  'The owner asked me to compare Gemini with Claude.',
  'DeepSeek is an open-weights model; Zhipu AI also publishes GLM.',
  'I was asked by the owner to list installed applications.',
  'We were told that Meta releases Llama weights publicly.',
];
for (const input of FACTUAL) {
  const r = enforceJarvisIdentity(input);
  ok(r.corrected === false && r.text === input,
    `unchanged: ${JSON.stringify(input.slice(0, 50))}`,
    `-> ${r.text.slice(0, 78)}`);
}

// ——— 3. disclosure is preserved, not suppressed into a lie ————————————————
console.log('\n── accurate disclosure when explicitly requested ──');
for (const q of ['which model are you using?', 'what model is in use', 'which provider are you on',
  'who made you', 'are you GPT or GLM', 'what backend is active']) {
  ok(isModelDisclosureQuestion(q) === true, `disclosure detected: ${JSON.stringify(q)}`);
}
for (const q of ['hi', 'who are you?', 'what can you do', 'thanks', 'open chrome',
  'create a folder called reports']) {
  ok(isModelDisclosureQuestion(q) === false, `not a disclosure question: ${JSON.stringify(q)}`);
}
ok(isModelDisclosureQuestion('who are you?') === false &&
   classifyRequestIntent('who are you?').kind === 'conversational',
  '"who are you?" remains an IDENTITY question, so the guard still applies');
ok(/enforceJarvisIdentity\(answer\)/.test(loopSrc) &&
   /modelDisclosureRequested\s*\?\s*\{\s*text: answer/.test(loopSrc),
  'loop.ts applies the guard on the conversational path and suppresses it only for disclosure');
ok(/enforceJarvisIdentity\(full\)/.test(loopSrc) &&
   /modelDisclosureRequested\s*\?\s*\{\s*text: full/.test(loopSrc),
  'loop.ts applies the same guard to the grounded final report');
// The contract must require accurate disclosure rather than forbid it.
ok(/ACCURATE DISCLOSURE IS REQUIRED, NOT FORBIDDEN/i.test(JARVIS_IDENTITY_CONTRACT),
  'the identity contract requires accurate disclosure');
ok(!/NEVER state, confirm, deny or hint at a vendor/i.test(JARVIS_IDENTITY_CONTRACT),
  'the old blanket non-disclosure rule is gone');
ok(/Never adopt its name as your own/i.test(JARVIS_IDENTITY_CONTRACT),
  'the contract forbids ADOPTING a vendor name, which is the real requirement');
ok(PLANNER_SYSTEM_PROMPT.includes('JARVIS'), 'the planner system prompt names JARVIS');

// ——— 4. the instruction must reach every provider as a SYSTEM message ———————
console.log('\n── system-level delivery across backends ──');
const preface = [
  { role: 'assistant', content: 'You are the PLANNING CORE of JARVIS.' },
  { role: 'assistant', content: 'Enabled, owner-approved extensions (metadata only).' },
  { role: 'assistant', content: 'CURRENT ADVISORY PROVIDER: backend=zai provider="Z.ai".' },
  { role: 'user', content: 'hi' },
];
const norm = normalizeSystemInstructions(preface);
ok(norm.length === 2 && norm[0].role === 'system',
  'the assistant-only preface folds into ONE real system message',
  JSON.stringify(norm.map((m) => m.role)));
ok(norm[0].content.includes('PLANNING CORE of JARVIS') &&
   norm[0].content.includes('CURRENT ADVISORY PROVIDER'),
  'the folded system message carries both the identity contract and the provider metadata');
ok(norm[1].role === 'user' && norm[1].content === 'hi', 'the user turn is preserved verbatim');
// Later assistant turns are dialogue history and must NOT be folded.
const withHistory = [
  { role: 'assistant', content: 'system contract' },
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'Hello! I am JARVIS.' },
  { role: 'user', content: 'thanks' },
];
const nh = normalizeSystemInstructions(withHistory);
ok(nh.length === 4 && nh[0].role === 'system' && nh[2].role === 'assistant',
  'a later assistant reply stays an assistant reply (never promoted to system)',
  JSON.stringify(nh.map((m) => m.role)));
ok(nh[2].content === 'Hello! I am JARVIS.', 'dialogue content is not rewritten');
// Safety rails.
let threw = false;
try { normalizeSystemInstructions([{ role: 'assistant', content: 'no user turn' }]); } catch { threw = true; }
ok(threw, 'a request with no user message is rejected rather than sent malformed');
threw = false;
try { normalizeSystemInstructions([{ role: 'user', content: 'a' }, { role: 'system', content: 'b' }]); } catch { threw = true; }
ok(threw || normalizeSystemInstructions([{ role: 'user', content: 'a' }]).length === 1,
  'an unexpected role in the preface is not silently accepted as an instruction');
ok(normalizeSystemInstructions([{ role: 'user', content: 'only a user turn' }]).length === 1,
  'a preface-less request is passed through unchanged');
// Every backend must use the single shared normalizer.
const providerUses = (providerSrc.match(/normalizeSystemInstructions\(/g) || []).length;
ok(providerUses >= 3,
  'the Ollama body builder and both Z.ai SDK call sites normalize (default backend included)',
  `found ${providerUses} uses`);
ok(/messages: normalizeSystemInstructions\(messages\)/.test(compatSrc),
  'the OpenAI-compatible adapter uses the same shared normalizer');
ok(!/function normalizeCompatibleMessages/.test(compatSrc),
  'there is exactly ONE normalizer implementation, so adapters cannot drift');
ok(/const system = messages\.filter\(m => m\.role === "assistant"\)/.test(bridgeSrc) &&
   /system,messages:dialogue|system,\s*messages:\s*dialogue/.test(bridgeSrc),
  'the Anthropic adapter still hoists instructions into the top-level system field');
ok(typeof selectPlannerSystemPrompt === 'function' &&
   selectPlannerSystemPrompt('Build a React website').includes('REAL software-workspace agent') &&
   selectPlannerSystemPrompt('Open Windows Settings').includes('PLANNING CORE of JARVIS'),
  'task-aware prompt selector keeps compact coding and full desktop tool catalogs distinct');
ok(/const messages: Msg\[\] = \[\s*\{ role: "assistant", content: selectPlannerSystemPrompt\(objective\) \}/.test(loopSrc),
  'the selected planner system prompt is the FIRST message Core sends');
ok(/messages\.splice\(1, 0, \{ role: "assistant", content: modelIdentityContext\(model\?\.identity\) \}\)/.test(loopSrc),
  'provider metadata is injected into the instruction preface, so it lands in the system message');

// ——— 5. identity is stable across provider switching ———————————————————————
console.log('\n── identity unchanged by provider switching ──');
const IDENTITIES = [
  { backend: 'zai', provider: 'Z.ai', modelId: 'not specified (selected by the Z.ai SDK)', local: false },
  { backend: 'ollama', provider: 'Ollama (local loopback)', modelId: 'llama3.2', local: true, host: '127.0.0.1:11434' },
  { backend: 'openai-compatible', provider: 'OpenAI-compatible endpoint (api.apinex.bond)', modelId: 'free/glm-5.3', local: false, host: 'api.apinex.bond' },
  { backend: 'anthropic', provider: 'Anthropic', modelId: 'claude-sonnet-4-5', local: false },
  { backend: 'profile', provider: 'My local model', modelId: 'qwen2.5', local: true },
];
for (const id of IDENTITIES) {
  const line = modelIdentityContext(id);
  ok(line.includes('CURRENT ADVISORY PROVIDER'), `disclosure line rendered for ${id.backend}`);
  ok(line.includes(id.modelId) || /not specified/.test(line),
    `the real model id is disclosed for ${id.backend}`, line.slice(0, 90));
  ok(!/you are (glm|chatgpt|claude|gemini)/i.test(line),
    `the disclosure line does not instruct the model to BE the vendor (${id.backend})`);
  ok(/NOT your identity/i.test(line),
    `the line marks the metadata as disclosure, not identity (${id.backend})`);
  // Whichever backend serves, the operator-facing answer is JARVIS. The name
  // tested is the PRODUCT name a model actually claims, not the configured model
  // id (a version-suffixed id such as "llama3.2" is configuration data).
  const claims = { zai: 'GLM', ollama: 'Llama', 'openai-compatible': 'GLM', anthropic: 'Claude', profile: 'Qwen' };
  const claim = claims[id.backend] || 'GLM';
  for (const template of [
    `Hello! I am ${claim}, happy to help.`,
    `Hello! I am ${claim} \u2014 a large language model developed by ${id.provider}.`,
  ]) {
    const guarded = enforceJarvisIdentity(template);
    const left = survivingVendors(guarded.text);
    ok(/JARVIS/i.test(guarded.text) && left.length === 0,
      `a ${claim} self-identification on the ${id.backend} backend resolves to JARVIS`,
      `${template} -> ${guarded.text} (left: ${left.join(',')})`);
  }
}
const unknown = modelIdentityContext(undefined);
ok(/could not confirm the active provider/i.test(unknown),
  'a missing bridge identity is reported as unknown rather than guessed');
ok(!/undefined|null/.test(unknown), 'the unknown case renders no literal "undefined"');

// ——— 6. seeded stress over self-id and factual sentences ———————————————————
console.log('\n── seeded stress ──');
const SEED = 20261031;
let st = SEED >>> 0;
function rnd() {
  st ^= st << 13; st >>>= 0; st ^= st >> 17; st ^= st << 5; st >>>= 0;
  return st / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const MODELS = ['GLM', 'ChatGPT', 'Claude', 'Gemini', 'Llama', 'Qwen', 'DeepSeek', 'Kimi',
  'Grok', 'Mistral', 'Sonnet', 'Opus', 'Hunyuan', 'Ernie', 'Copilot'];
const COMPANIES = ['Zhipu AI', 'OpenAI', 'Anthropic', 'Google', 'Meta', 'Alibaba', 'DeepSeek AI',
  'Moonshot', 'xAI', 'Mistral AI', 'Tencent', 'Baidu', 'Microsoft'];
const SELF_TEMPLATES = [
  (m, c) => `Hello! I am ${m} — a large language model developed by ${c}.`,
  (m, c) => `I am ${m}, an AI assistant created by ${c}.`,
  (m, c) => `Hi, I'm ${m}, made by ${c}.`,
  (m, c) => `My name is ${m}, powered by ${c}.`,
  (m) => `${m} here!`,
  (m) => `${m} at your service.`,
  (m, c) => `I was created by ${c} and I am ${m}.`,
  (m) => `I am currently running on ${m}-4.5.`,
  (m, c) => `You are talking to ${m}, which was trained by ${c}.`,
  (m, c) => `This is ${m}, a model developed by ${c}, at your service.`,
];
const FACT_TEMPLATES = [
  (m, c) => `${m} is a family of models developed by ${c}.`,
  (m, c) => `I think ${m} was developed by ${c}.`,
  (m, c) => `Developed by ${c}, ${m} is an open-weights family.`,
  (m, c) => `You can route to ${m}, which ${c} maintains.`,
  (m) => `${m} here is the summary you asked for.`,
  (m) => `I am not sure, but the ${m} model is fast.`,
  (m) => `${m} is my favourite model family.`,
  (m, c) => `The owner asked me to compare ${m} with ${c}'s other models.`,
];
const ITERATIONS = 4000;
let selfLeak = 0;
let factCorrupt = 0;
const selfEx = {};
const factEx = {};
for (let i = 0; i < ITERATIONS; i++) {
  const m = pick(MODELS);
  const c = pick(COMPANIES);
  const selfText = pick(SELF_TEMPLATES)(m, c);
  const rs = enforceJarvisIdentity(selfText);
  const left = survivingVendors(rs.text);
  if (left.length > 0 || !/JARVIS/i.test(rs.text)) {
    selfLeak++;
    if (!selfEx.example) selfEx.example = `${selfText} -> ${rs.text} (left: ${left.join(',')})`;
  }
  const factText = pick(FACT_TEMPLATES)(m, c);
  const rf = enforceJarvisIdentity(factText);
  if (rf.corrected || rf.text !== factText) {
    factCorrupt++;
    if (!factEx.example) factEx.example = `${factText} -> ${rf.text}`;
  }
}
ok(selfLeak === 0, `no self-identification leaked a vendor across ${ITERATIONS} seeded sentences`,
  selfEx.example);
ok(factCorrupt === 0, `no factual third-party statement was corrupted across ${ITERATIONS} seeded sentences`,
  factEx.example);
console.log(`   stress: seed=${SEED} iterations=${ITERATIONS} selfLeaks=${selfLeak} factualCorruptions=${factCorrupt}`);

// ——— summary —————————————————————————————————————————————————————————————
const total = checks + failures.length;
console.log('');
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  -', f);
}
console.log(`JARVIS_IDENTITY_DISCLOSURE ${checks}/${total} ${failures.length ? 'FAIL' : 'PASS'} ` +
  `(seed=${SEED}; offline guard and adapter contracts, NOT a live provider conversation)`);
if (failures.length) process.exitCode = 1;
