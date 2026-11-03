# JARVIS V1 — Independent Test Findings & Critical Repair (Session 5)

**Date:** 2026-10-31
**Branch:** `arena/aa15eff2-jarvis-v1-prototype-continuati`
**PR:** https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/pull/1 (OPEN, base `main`, 15 commits)
**Baseline reviewed:** `b94e68c` (latest accepted branch state, including PR #1 and all Session 1–4 work)
**Checkout:** Prototype. Nothing in this document refers to the separate production checkout `D:\jarvis_pc_work`.

Commits added by this mission, in order:

| Commit | Fix | Production source changed? |
|---|---|---|
| `9329608` | FIX 1 — provider error classification | **Yes** (`modelErrors.ts`, `localFallback.ts`) |
| `4698ffe` | FIX 2 — identity leakage | **Yes** (`prompts.ts`, `modelProvider.ts`, `compatProvider.ts`) |
| `caeac57` | FIX 3 — Core execution without real actions | No production change (repair already present); **repaired a silently rotted harness** |
| `03a3d93` | FIX 4 — companion / Minecraft authorization | **Yes** (`windows/policy.ts`) — new root cause found while verifying |
| `2bd71cb` | FIX 5 — autonomy reliability | No production change (repairs already present) |

Every defect below was **reproduced on the current branch before any code was
changed**. Where a repair was already present, it was verified rather than
re-implemented. The supplied `MODEL_ERROR_STATUS_PRECEDENCE_FIX.diff` from the
October 29 evidence package was **not applied** — the current source was
inspected instead, and the older diff was not available in this workspace.

---

## FIX 1 — Provider error classification: message text beat HTTP status

**Status: SOURCE VERIFIED · OFFLINE TEST PASSED · BUILD PASSED**

### Root cause (reproduced unmodified: 3 of the 6 reported cases failed)
`classifyModelFailure` built a single lowercased blob
`` `${status} ${code} ${message}` `` and tested the **rate-limit text heuristic
first**, so provider prose overrode a definitive HTTP status.

| Provider response | Before | After / expected |
|---|---|---|
| `401` + "quota exceeded" | `MODEL_RATE_LIMITED` ✗ | `MODEL_AUTH_FAILED` ✓ |
| `403` + "upstream rate limit" | `MODEL_RATE_LIMITED` ✗ | `MODEL_AUTH_FAILED` ✓ |
| `504` + "invalid API key in provider log" | `MODEL_AUTH_FAILED` ✗ | `MODEL_TIMEOUT` ✓ |
| `429` + "invalid API key" | already correct | `MODEL_RATE_LIMITED` ✓ |
| `401` + "Unauthorized" | already correct | `MODEL_AUTH_FAILED` ✓ |
| `429` + "Rate limited" | already correct | `MODEL_RATE_LIMITED` ✓ |

**Impact beyond the label.** A credential fault was classified as retryable, so it
was retried with backoff **and** triggered cloud→local failover — burning owner
quota on a fault that cannot self-heal, while telling the operator "try again
later". That consequence is now proven fixed behaviourally (see FIX 5 §2).

### Repair
- `STATUS_DECISIONS` is consulted **before any text heuristic**: 401/403 →
  `MODEL_AUTH_FAILED`, 429 → `MODEL_RATE_LIMITED`, 408/504 → `MODEL_TIMEOUT`.
- Deliberately minimal: 400/404/422/500/502/503 are **not** treated as
  authoritative and still fall through to the text heuristics.
- `FAILURE_TAXONOMY` is the single source of truth for retryability and the static
  `publicMessage`, so raw provider text is never echoed — **secret redaction is
  preserved** (the two pinned 429/401 redaction contracts still pass).
- Status-less errors keep sensible handling; `authoritativeStatus()` also accepts a
  finite numeric string and Node's `statusCode`, and ignores NaN/Infinity/boolean/
  object/array. Every property read is inside `try/catch`.
- `PrivacyRouteError` still short-circuits first — a privacy refusal is never
  retried into a different backend.
- `localFallback.isFailoverCandidate` is now **membership-only** in the exported
  `FAILOVER_CODES` set. The previous form `ALLOWLIST.has(code) || err.retryable`
  would let any future retryable code bypass the deliberate exclusions.
  `FAILOVER_CODES` excludes `AUTH_FAILED` and `PRIVACY_ROUTE_BLOCKED`.

### Tests
`scripts/verify-model-error-status-precedence.cjs` — **238/238**, wired as
`test:model-error-status-precedence` and the `MODEL-ERROR-STATUS-PRECEDENCE` gate.
All six reported cases are permanent regressions.
Stress: `seed=20261031 iterations=20000 throws=0 badCode=0 leaks=0
statusViolations=0 nondeterminism=0` over 27 status shapes × 40 message fragments
(including prompt-injection payloads, HTML, prototype-pollution keys and embedded
secrets) × 8 error names × 6 codes.

---

## FIX 2 — Identity leakage: "Hello! I am GLM … developed by Zhipu AI."

**Status: SOURCE VERIFIED · OFFLINE TEST PASSED · BUILD PASSED · live provider NOT VERIFIED**

### Root cause A — the identity guard defeated itself
`SELF_ID_RE` rewrote `I am GLM` → `I am JARVIS` **first**, consuming the vendor
token that anchored the attribution rule. `DEVELOPED_BY_SELF_RE`'s gap
(`[^.!?,;\n]{0,40}?`) also excludes commas, so it could not span the appositive in
"I am GLM, a large language model developed by Zhipu AI". The two rules actively
defeated each other and the output was:

```
Hello! I am JARVIS, a large language model developed by Zhipu AI.
```

Product name fixed, **vendor attribution still leaked**. Reproduced for OpenAI,
Anthropic and Meta variants too; `created by Google` survived entirely because
`google` was absent from `VENDORS`; `GLM here!` was not corrected at all.

### Root cause B — the instruction never reached the provider as a `system` message
Core encodes the planner contract, extension catalogue, LAYA advisory and the
JARVIS identity contract as `role:"assistant"`, because the internal `Msg.role`
union is only `"user" | "assistant"`. The OpenAI-compatible adapter folded that
preface into a real `system` message and the Anthropic adapter hoisted it into the
top-level `system` field — but the **Z.ai SDK bridge (the DEFAULT backend,
`JARVIS_MODEL_BACKEND=zai`) and the local Ollama bridge passed the roles straight
through**. On exactly the path that produced the owner's leak, the identity
contract therefore arrived as *prior assistant output* with no system authority.

`role:"assistant"` here is **not** a bug to fix in `loop.ts` — it is an internal
instruction marker. The fix belongs in the adapters.

### Root cause C — over-reach found by stress testing (previously unknown)
`DEVELOPED_BY_INITIAL_RE` matched a sentence-initial attribution with no
self-reference at all, corrupting legitimate prose **and mangling the vendor name**:

```
Developed by Mistral AI, ChatGPT is an open-weights family.
→ Built as JARVIS for this installation AI, ChatGPT is an open-weights family.
```

`DEVELOPED_BY_SELF_RE` also accepted a bare first-person pronoun as its lead, so
"I think GLM was developed by Zhipu AI" — a factual statement about a third party
that the docblock promised to leave untouched — was corrupted.

### Repair
- New compound `SELF_ID_ATTRIBUTION_RE` matches the **whole self-identification
  span at once** and runs *before* the rules that consume its anchor. Commas and
  semicolons are allowed inside the span (that is the point); sentence terminators
  are not, and the span is length-capped so it cannot bridge into an unrelated
  clause. A first-person frame is mandatory.
- `ATTRIBUTION_PHRASE` accepts a bare identity-noun attribution ("a model by
  Anthropic", "an assistant from OpenAI"), not only a provider verb.
- `PASSIVE_SELF_RE` covers "I was created by Zhipu AI", where the provider verb
  *is* the predicate so the self-id lead cannot also supply it.
- `BACKEND_SELF_RE` covers an unprompted "I am running on GLM-5.3".
  `VENDOR_GREETING_RE` covers "GLM here!".
- `DEVELOPED_BY_INITIAL_RE` now requires the vendor name to be followed
  **immediately by sentence end**, so a bare attribution counts as
  self-identification only when it stands alone.
- `DEVELOPED_BY_SELF_RE`'s lead is now a real self-identification frame
  (`SELF_LEAD`), not a bare pronoun.
- `SELF_ID_FRAMES` is shared by the individual and compound rules so they cannot
  drift. `ATTRIBUTION_COMPANIES` (google deepmind, meta, microsoft, aws, ibm,
  nvidia, baidu, alibaba, tencent, bytedance, 01.ai …) is used **only** in
  attribution slots — never in `DEVELOPED_BY_INITIAL_RE`, which would otherwise
  corrupt "Developed by Meta, Llama is an open-weights family".
- **One shared `normalizeSystemInstructions()`** now lives in `modelProvider.ts`
  next to the `ModelMessage` type it operates on, and serves **every** backend:
  Ollama's body builder and both Z.ai SDK call sites, with `compatProvider.ts`
  importing the same implementation so the adapters cannot drift. Safety rules are
  unchanged: only the assistant-only preface before the first user message is
  folded, later assistant turns stay dialogue history, user text is never promoted
  to system, and a request with no user message is rejected.
  `modelProvider` → `compatProvider` remains a lazy `await import`, so there is no
  load-time cycle.

**This is not string replacement.** Rewrites are anchored on self-identification
frames, and the disclosed provider comes from runtime `ModelIdentity` metadata.

### Disclosure is preserved, not suppressed
When the operator explicitly asks which model is in use, `loop.ts` skips the guard
entirely and answers from real `ModelIdentity` metadata. `JARVIS_IDENTITY_CONTRACT`
states **ACCURATE DISCLOSURE IS REQUIRED, NOT FORBIDDEN**; the old blanket
non-disclosure rule is gone. `"who are you?"` remains an *identity* question (so
the guard still applies) and is **not** a disclosure question.

### Before / after

| Input | Before | After |
|---|---|---|
| `Hello! I am GLM — a large language model developed by Zhipu AI.` | corrected but leaked the em-dash attribution | `Hello! I am JARVIS.` |
| `Hello! I am GLM, a large language model developed by Zhipu AI.` | **leaked** `developed by Zhipu AI` | `Hello! I am JARVIS.` |
| `I am Gemini, a large language model created by Google.` | **uncorrected** | `I am JARVIS.` |
| `GLM here!` | **uncorrected** | `JARVIS here!` |
| `I was created by Zhipu AI.` | **uncorrected** | `I was built as JARVIS for this installation.` |
| `Hi there! I am running on GLM-5.3 via APINEX.` | **uncorrected** | `Hi there! I am JARVIS.` |
| Z.ai / Ollama delivery channel | identity contract sent as **assistant** | sent as a real **system** message |
| `I think GLM was developed by Zhipu AI.` | **corrupted** | unchanged |
| `Developed by Mistral AI, ChatGPT is an open-weights family.` | **corrupted + mangled** | unchanged |
| `GLM is my favourite model family.` | unchanged | unchanged |
| `Hello! I am an AI assistant powered by APINEX.` | unchanged | unchanged *(deliberate: APINEX is the owner's aggregator, not a competing product identity)* |

### Tests
`scripts/verify-jarvis-identity-disclosure.cjs` — **206/206**, wired as
`test:jarvis-identity-disclosure` and the `JARVIS-IDENTITY-DISCLOSURE` gate.
30 self-identification forms × zero surviving vendor tokens × recorded audit
detection; 16 factual third-party statements byte-for-byte unchanged;
`normalizeSystemInstructions` tested functionally (fold to one system message,
later assistant turns not promoted, no-user-message and unexpected-role rejected);
every backend's use of the single shared normalizer asserted, including the
Anthropic top-level `system` field; disclosure detection in both directions plus
the `loop.ts` wiring on both the conversational and grounded-report paths;
identity stability across `zai`, `ollama`, `openai-compatible`, `anthropic` and
`profile`, with honest "could not confirm" when metadata is absent.

**Seeded stress:** `seed=20261031`, xorshift32, **4,000 iterations** composing 10
self-identification templates and 8 factual templates over 15 model names and 13
company names → `selfLeaks=0 factualCorruptions=0`. **The same seed produced 360
leaks and 249 corruptions before the repair.**

**NOT VERIFIED:** proving the Z.ai and Ollama backends now receive a `system`
message requires calling them. No provider was contacted from this sandbox.

---

## FIX 3 — Core execution without real actions

**Status: SOURCE VERIFIED · OFFLINE TEST PASSED · BUILD PASSED**

### Finding
The owner-observed message was **correct** and the completion verifier is
**unchanged**. The defect was that Core treated the verifier's rejection as
terminal: it surfaced the message once and stopped, instead of sending the planner
back to choose a real action. Bounded replanning (`MAX_ACTION_NUDGES = 2`) was
already present from earlier work — but **nothing proved the chain actually works
end to end**. Every existing test asserted *source text* (the nudge constant
exists, the guard is wired), never behaviour.

### Hidden failure found and repaired
`scripts/verify-goal-loop-integration-offline.cjs` — the only functional `runTask`
harness — threw on any unmocked specifier, so it **broke the moment `loop.ts`
gained a dependency** (`./minecraftAiGate`, then `./requestIntent` and
`./autonomyPolicy`). It was also **never registered in `package.json`**, so no
battery ever caught it. It now resolves **real** sibling modules by default and
applies mocks only at the boundaries it needs to control, so it cannot rot the same
way again, and it is wired in as `test:goal-loop-integration` (**5/5**). Its stale
`./prompts` and `./modelProvider` mocks were filled in.

### Tests
`scripts/verify-core-actionable-execution.cjs` — **33/33**, wired as
`test:core-actionable-execution` and the `CORE-ACTIONABLE-EXECUTION` gate. Drives
`runTask` against the **real** verifier, requestIntent, prompts, autonomyGate,
goalPlanner, the real `guardian/policy` scoped-path gate and a **real `mkdtemp`
filesystem**. The Guardian mock reproduces the real decision shape
(`guardian.ts` prepares `{ path: p.abs, relPath: p.rel, content }`) using the real
`resolveScopedPath`, so the scoped-path security property is genuinely exercised.

- **A — `hi`**: zero tool executions, Guardian never consulted, **no nudge sent**,
  status `completed`. A conversational request requires no external tool action.
- **B — the mission's acceptance scenario**, `Create file sample.txt containing
  "expected"`, planner first proposes `final` with zero steps: exactly **one**
  bounded nudge → a **real** `write_file` → an independent `read_file` →
  `completed`. The file is asserted to exist on disk with **byte-exact** contents,
  the effect ledger is `SETTLED` with nothing left `ADMITTED`/`EFFECT_UNKNOWN`, and
  the **real** `arbitrateCompletion` independently returns `verified`.
- **B2 — same run with wrong contents**: not `completed`, and the real verifier
  rejects it. This is what makes B non-vacuous — the success assertion cannot be
  satisfied by a hardcoded pass.
- **C — transient tool failure then retry**: the run continues (not `failed`), all
  three attempts execute, the file genuinely lands, the failure text is recorded in
  the audit trail rather than hidden, and the durable ledger keeps **both** the
  `FAILED` attempt and the `SETTLED` retry.
- **D — Guardian denies repeatedly**: **zero** executor calls, the denied file is
  never written, the run settles `denied`, identical denials are **bounded** (≤ 4
  of 8 scripted), every denial is audited as `guardian_deny`, and the summary
  states that no unauthorized side effects occurred.

**The verifier was not weakened anywhere.** Scenario C deliberately asserts
`status = 'partial'` rather than `'completed'`: the real verifier reports *"all 1
predicates currently hold, but 1 effect attempt(s) failed"*, which is the honest
outcome once a real side-effect attempt failed. Asserting `completed` there would
have required suppressing the failed-effect rule, so the assertion instead proves
recovery happened **and** that the failed attempt is still reported.

---

## FIX 4 — Windows companion / Minecraft authorization

**Status: SOURCE VERIFIED · OFFLINE TEST PASSED · BUILD PASSED · WINDOWS LIVE **BLOCKED** · MINECRAFT LIVE **BLOCKED****

### Already repaired — verified, not re-implemented
`minecraft_companion_join` routes through `validateDesktopTool` →
`companionGateFailure()` (`guardian.ts:235-238`), which names the **specific**
failed precondition out of five — host platform, `JARVIS_WINDOWS_AGENT_ENABLED`,
`JARVIS_LOCAL_DEV_NO_LOGIN`, `JARVIS_LOCAL_DEV_BIND`, companion token length —
each with the corrective command, and **never interpolates the token**. The single
supported workflow already exists and is complete: `npm run dev:windows` starts
NEXUS (Core) and `companion.py`, and `companion.py` spawns the Minecraft bridge
(`minecraft-bot/bot.cjs`) on demand (line 603-616), accepting a join only on an
observed `MINECRAFT_COMPANION_JOINED` spawn signal.

### NEW root cause found while verifying — the gate was weaker than the preflight
The join branch returned `ok:true` as soon as `JARVIS_MINECRAFT_LAN_ENABLED` was
`'1'`, validating **nothing else**, even though its own denial message advertises
`JARVIS_MINECRAFT_LAN_HOST (127.0.0.1 or localhost)`,
`JARVIS_MINECRAFT_LAN_PORT (1024-65535)` and
`JARVIS_MINECRAFT_PLAYER (the human Java player, not JarvisBuddy)`.
`scripts/windows-startup-preflight.mjs` validates all three — so the **runtime gate
was weaker than the launcher preflight**. Any path that starts the server without
the preflight (a plain `next dev`, a restored `.env`, a manual process) would
authorize a join to an arbitrary **remote** Minecraft host on an arbitrary port,
defeating the loopback-only isolation this launcher exists to guarantee, then fail
deep inside the bridge as an obscure connection error — precisely the failure mode
the earlier repair's own comment says it wants to avoid. It would also permit
`JARVIS_MINECRAFT_PLAYER=JarvisBuddy`, letting the companion **impersonate the
owner**.

**Repair** (`src/lib/agent/windows/policy.ts`): the join now enforces exactly the
preflight's rules — host must be `127.0.0.1` or `localhost` (unset defaults to
`127.0.0.1`, the fail-safe direction); port must be a safe integer in 1024–65535,
with a message telling the operator to copy the port the Java world reports **now**
(a port from an earlier session is not assumed to still be active); the player must
match `^[A-Za-z0-9_]{1,16}$` and not be `JarvisBuddy` in any casing. Each refusal
names the offending variable. **This tightens Guardian; it grants nothing new.**
`minecraft_companion_stop` is deliberately **exempt** so a running companion can
always be halted even with a broken connection config.

### Pinned fixtures corrected — disclosed, not hidden
`scripts/verify-windows-policy.cjs` `base` and
`scripts/verify-core-conversational-separation.cjs` `fullEnv` both set
`JARVIS_MINECRAFT_LAN_ENABLED=1` while supplying **no** host, port or player — a
configuration the supported launcher refuses at startup. That incomplete fixture is
exactly why the gate's missing validation went unnoticed. Both now carry a valid
loopback LAN config, so the pinned assertion *"local Minecraft opt-in permitted"*
keeps its original meaning (opt-in **with a valid config** is permitted) instead of
passing on an unsupported one. **No assertion was relaxed or removed**, and
`core-conversational-separation` is back to **194/194**.

### Tests
`scripts/verify-companion-bridge-workflow.cjs` — **76/76**, wired as
`test:companion-bridge-workflow` and the `COMPANION-BRIDGE-WORKFLOW` gate. Drives
the **real** Guardian `authorizeToolCall` on a simulated `win32` realm (nothing
about the gate is mocked):

- join **allowed** under the correct isolated loopback dev config, with
  Guardian-prepared desktop arguments present so the bridge can actually execute;
- each of the four missing companion preconditions denies **and names that
  variable**, and never leaks the token;
- each missing Minecraft prerequisite denies and names it; the denial states the
  corrective workflow (`npm run dev:windows`);
- bad **values** refused at the gate: `192.168.1.50`, `0.0.0.0`, `mc.example.com`,
  port `80`, non-numeric ports, `JarvisBuddy` in three casings plus padded,
  17-character names;
- unset host defaults to loopback and is permitted (fail-safe, **not** a skipped
  check);
- `minecraft_companion_stop` still allowed with a nonsense port and a non-loopback
  host;
- six unsafe configurations still refused; a Linux host is diagnosed as
  *"requires a Windows host; detected linux"* rather than blamed on the launcher;
- `minecraft_companion_command` / `_stop` / `windows_minecraft_input` all route
  through the same specific-prerequisite gate;
- the preflight **functionally** warns *"Minecraft is half-configured"*, names
  `JARVIS_MINECRAFT_LAN_ENABLED=1`, passes a full config, and **refuses every value
  the gate refuses** — so no bypass path is weaker than the other;
- workflow: `dev:windows` is the single entry point, it starts the companion and
  NEXUS, `companion.py` spawns `bot.cjs` which exists, a join needs an observed
  SPAWN signal, and plain `npm run dev` delegates on `win32` only;
- **least-privilege propagation**: `companion.py` uses an explicit env allowlist,
  no `JARVIS_*` variable is in it, the **companion token never reaches the game
  bridge**, and exactly the three Minecraft connection variables are added.

`scripts/verify-windows-policy.cjs` extended **56 → 80** assertions covering the new
host/port/player bounds (including the 1024 and 65535 boundaries), impersonation
rejection, and stop-stays-available.

---

## FIX 5 — Full autonomy reliability

**Status: SOURCE VERIFIED · OFFLINE TEST PASSED · BUILD PASSED · live autonomy NOT VERIFIED**

The tier machinery, step-budget derivation, provider failover and watchdog replan
budgets were all repaired in earlier commits and are unit-tested
(`verify-autonomy-tiers` 87/87, `verify-local-fallback` 6/6). What was **not**
proven is that a real run actually survives the fault conditions the owner cares
about, and that FIX 1's classification changes real retry behaviour rather than
just a label. **No autonomy source was changed**: the findings confirmed the
existing repairs are correct. Nothing here disables Guardian, hardcodes
`allow=true`, or weakens the completion verifier.

`scripts/verify-autonomy-reliability.cjs` — **23/23**, wired as
`test:autonomy-reliability` and the `AUTONOMY-RELIABILITY` gate. Drives `runTask`
with the **real** `modelErrors` classifier (deliberately not mocked), the real
completion verifier, requestIntent, prompts, autonomyGate, goalPlanner, the real
scoped-path gate and a real `mkdtemp` filesystem.

1. **Transient provider failure.** The bridge constructor throws a 504 first.
   Observed log: `[model-route] transient MODEL_TIMEOUT; retrying in 600ms
   (attempt 1/2)`. The bridge is constructed twice, the run does not throw, the
   objective completes, and the work genuinely lands on disk. A transient blip
   while **routing** no longer discards the whole objective.
2. **Credential failure is not retried.** The constructor throws 401 three times
   over. Observed log: `[model-route] MODEL_AUTH_FAILED HTTP_401; no tools
   executed.` Exactly **one** construction attempt — no backoff loop burning owner
   quota, no cloud→local failover on a credential fault. The run does not report
   success, nothing is fabricated on disk, and the raw provider text
   (`401 Unauthorized: invalid api key`) is **never echoed** to the operator.
   *This is FIX 1's most important consequence, now proven through the loop.*
3. **Rate limit retried.** A single 429 inside a completion is retried rather than
   treated as fatal; the objective completes and the completion call count shows
   the retry genuinely happened.
4. **Durable checkpoint and resumption.** With `budget=1` the run exhausts its
   steps and settles **`paused`** — not `completed`, not `failed`. Every step is
   durably persisted, the file already written **survives** the pause (a real
   checkpoint, not a rollback), and the effect ledger keeps the `SETTLED` row. A
   second `runTask` with `stepsUsedOffset` set to the persisted count then **adds**
   to the same durable step history and completes after independent verification.
   Interrupted work resumes instead of restarting.
5. **Cancellation / emergency stop.** Cancelling mid-run settles as `cancelled`,
   stops further tool execution (≤ 2 of 6 scripted attempts), reports to the
   operator, and **never emits a `completed` final event**.

Scenarios 1–3 use the same `Create file notes.txt containing "checkpoint"`
objective and assert the file's real contents, so recovery is measured by durable
on-disk effect rather than by a status string.

---

## Security verification

No security property was relaxed by any change in this mission.

| Property | Evidence |
|---|---|
| Denied actions never execute | FIX 3 §D: zero executor calls, denied file never written |
| Guardian not bypassed / no hardcoded `allow=true` | No `autonomyPolicy` field grants permission; tiers govern persistence only |
| Loopback-only isolation preserved (and **strengthened**) | FIX 4: non-loopback Minecraft hosts now refused at the gate, not only at the preflight |
| Companion cannot impersonate the owner | FIX 4: `JARVIS_MINECRAFT_PLAYER=JarvisBuddy` refused in any casing |
| Stop/halt always available | FIX 4: `minecraft_companion_stop` exempt from connection validation |
| Keys never logged, committed or echoed | FIX 1 taxonomy `publicMessage`; FIX 4 denials never interpolate the token; FIX 5 §2 raw 401 text not surfaced |
| Secrets never reach the game bridge | FIX 4: env allowlist, token never propagated |
| Privacy-route refusal never retried into another backend | `PrivacyRouteError` short-circuits first; excluded from `FAILOVER_CODES` |
| Failed operations never reported complete | FIX 3 §B2, §C; FIX 5 §2, §4, §5 |
| Completion verifier not weakened | `verifier.ts` unchanged; `partial` asserted where honesty demands it |
| Path containment | Real `resolveScopedPath` + `assertWithinRoot` exercised in every filesystem scenario |
| Cancellation interrupts safely | FIX 5 §5 |

`gpt6-offline-security-probe.mjs` 12/12 · `verify-core-guardian-laya-boundaries`
14/14 · `verify-browser-egress-guard` 23/23 · `verify-privacy-route-policy` 10/10 ·
`verify-path-containment` 4/4 — all pass unchanged.

## Build and typecheck results

- `npx tsc --noEmit` with `rm -f tsconfig.tsbuildinfo` first (the file is
  git-tracked and `incremental:true`, so a cached green result would be a no-op):
  **exit 0**, re-verified after every commit.
- `npx eslint .`: **exit 0 — 0 errors, 34 warnings**, unchanged from the baseline.
  The new suites are `.cjs`, where `no-require-imports` is scoped off, so they add
  no warnings.
- Full battery: **40/40 suites PASS** (was 34 at baseline; +6 this mission).
- `npm run verify:v1-release`: **13 offline gates PASS**, exits **1** with
  `V1 RELEASE: NOT COMPLETE — 18/18 mandatory release gates not independently
  accepted`. That is the correct result and was **not** changed.
- `next build` and `prisma generate` remain **BLOCKED** by the sandbox network
  allowlist (`fonts.googleapis.com`, `binaries.prisma.sh`). `next/font/google`
  failures are warnings only; the runtime was **not** switched to
  `next/font/local`.

### Test totals added this mission

| Suite | Checks |
|---|---|
| `verify-model-error-status-precedence.cjs` | 238 |
| `verify-jarvis-identity-disclosure.cjs` | 206 |
| `verify-companion-bridge-workflow.cjs` | 76 |
| `verify-core-actionable-execution.cjs` | 33 |
| `verify-autonomy-reliability.cjs` | 23 |
| `verify-windows-policy.cjs` (extended 56 → 80) | +24 |
| `verify-goal-loop-integration-offline.cjs` (repaired, newly wired) | 5 |
| **Total new/restored** | **605** |

Seeded stress: FIX 1 `seed=20261031`, 20,000 iterations, 0 violations.
FIX 2 `seed=20261031`, 4,000 iterations, 0 leaks / 0 corruptions
(was 360 / 249 before the repair).

---

## Outstanding live-test blockers

These cannot be resolved from this sandbox and require the owner's Windows machine.

| Blocker | Why it is blocked here |
|---|---|
| Live provider conversation (Z.ai / APINEX / GLM / GPT / Claude / Gemini) | No provider credentials, and outbound network is restricted to github.com, npmjs.org and pypi.org. FIX 2's system-message delivery is proven at the adapter boundary but not against a live model. |
| Windows-native runtime | No Windows host and no `pwsh`/`powershell`. The three `.ps1`/`.cmd` install artifacts have still never been executed. |
| Live Minecraft join, mining and inventory | No Minecraft server, no Java world open to LAN, no companion process. |
| `next build` / `prisma generate` | Blocked by the network allowlist (`fonts.googleapis.com`, `binaries.prisma.sh`). |
| Continuous autonomy across a session boundary | No persistent scheduler or worker verified active here; the longrun worker requires `bun`. **No continued background execution is claimed.** |
| APINEX availability | Not assumed from its model name alone; no working endpoint was verified. |

## Exact Windows acceptance commands

Run from the repository root on the owner's Windows machine.

### 1. Offline gates (must pass before any live attempt)

```powershell
npm ci
npx tsc --noEmit
npx eslint .
npm run test:model-error-status-precedence
npm run test:jarvis-identity-disclosure
npm run test:core-actionable-execution
npm run test:companion-bridge-workflow
npm run test:autonomy-reliability
npm run test:windows-policy
npm run test:core-conversational-separation
npm run test:goal-loop-integration
npm run verify:v1-release
```

`verify:v1-release` is **expected to exit 1** with `NOT COMPLETE`. That is correct:
offline gates passing is not release acceptance.

### 2. `.env` for the isolated loopback development launcher

The startup preflight requires this **exact** configuration; anything else fails at
startup with an actionable message rather than mid-task as a Guardian denial.

```
NODE_ENV=development
DATABASE_URL=file:./jarvis-local-minecraft-test.db
JARVIS_PUBLIC_ORIGIN=http://127.0.0.1:3000
JARVIS_LOCAL_DEV_NO_LOGIN=1
JARVIS_LOCAL_DEV_BIND=127.0.0.1
JARVIS_WINDOWS_AGENT_ENABLED=1
JARVIS_WINDOWS_COMPANION_TOKEN=<at least 32 characters; dev:windows generates one>

JARVIS_MINECRAFT_LAN_ENABLED=1
JARVIS_MINECRAFT_LAN_HOST=127.0.0.1
JARVIS_MINECRAFT_LAN_PORT=<copy the port the Java world reports NOW>
JARVIS_MINECRAFT_PLAYER=<the human Java player name, 1-16 of A-Z a-z 0-9 _>
```

`JARVIS_MINECRAFT_LAN_PORT` must be between 1024 and 65535 and must be read from the
currently open world. **Do not assume a port from an earlier session is still
active** — the historical `54321` is not assumed anywhere in the code, and the gate
now refuses a stale or malformed value instead of allowing it.
`JARVIS_MINECRAFT_PLAYER` must be the human player, **not** `JarvisBuddy`.

### 3. The one supported startup workflow

```powershell
npm run dev:windows
```

This starts NEXUS (Core) on `http://127.0.0.1:3000` and the private local companion
(`windows-companion/companion.py`), which spawns the Minecraft bridge
(`windows-companion/minecraft-bot/bot.cjs`) on demand. A plain `npm run dev`
delegates to the same workflow on `win32`. Open the Java world to LAN **before**
requesting a join.

### 4. Live acceptance steps — evidence must be recorded separately

| Step | What counts as acceptance |
|---|---|
| Identity | Send `hi`. The reply must identify as JARVIS with **no** vendor attribution. Then ask `which model are you using?` — the reply must accurately disclose the real configured provider/model. |
| Real action | Ask JARVIS to create a file in the authorized workspace. Acceptance requires the file to exist on disk with the requested contents, an independent read-back in the step log, and success reported **after** verification. |
| Companion join | Request a Minecraft join. Acceptance requires an **actual in-game player connection** — the `MINECRAFT_COMPANION_JOINED (spawn observed)` signal, plus the player visible in the world and in the server's player list. Process creation alone is **not** acceptance. |
| Mining | Mine **one** cobblestone. Acceptance requires `Dig VERIFIED: … inventory before -> after` with a genuine count increase, **and** independent confirmation of the pickup. `Dig STARTED` is **never** completion, and "block removed but pickup NOT VERIFIED" is a failure, not a success. |
| Denial diagnosis | Temporarily unset `JARVIS_MINECRAFT_LAN_ENABLED` and retry. The denial must name that exact variable and the corrective command — it must **not** repeat an identical generic message. |

Record the results as `WINDOWS LIVE VERIFIED` / `MINECRAFT LIVE VERIFIED` only from
real observation on the owner's machine.

## Evidence categories

| Area | Category |
|---|---|
| FIX 1 classification, retryability, redaction | **OFFLINE TEST PASSED** (238/238 + 20,000-iteration stress) |
| FIX 2 identity guard and system-message delivery | **OFFLINE TEST PASSED** (206/206 + 4,000-iteration stress) |
| FIX 2 against a live provider conversation | **NOT VERIFIED** |
| FIX 3 create / read-back / verify / report chain | **OFFLINE TEST PASSED** (33/33, real verifier + real filesystem) |
| FIX 4 companion gate diagnosis and join authorization | **OFFLINE TEST PASSED** (76/76 + 80/80) |
| FIX 4 on a Windows host | **BLOCKED** |
| FIX 4 live in-game join and cobblestone pickup | **BLOCKED** |
| FIX 5 provider recovery, checkpoints, resumption, cancellation | **OFFLINE TEST PASSED** (23/23) |
| FIX 5 continuous long-running autonomy | **NOT VERIFIED** |
| TypeScript and lint | **BUILD PASSED** |
| `next build` / `prisma generate` | **BLOCKED** |
| V1 release as a whole | **NOT COMPLETE** — 18/18 mandatory release gates not independently accepted |

## Explicitly not claimed

No real Minecraft acceptance, no Windows-native certification, no verified
autonomous mining, no Netherite / stronghold / End-portal / dragon progress, no
end-to-end live autonomous run under a non-default tier, no working APINEX
endpoint, no continued background execution after this session ends, and no change
to `D:\jarvis_pc_work`. The 151,347-assertion Minecraft engine suite is a **pure
engine simulation**, not a live victory. Offline and simulated results are not
treated as Windows or Minecraft certification, and **V1 is not declared complete**.
