# JARVIS V1 — Session 4 Repair Delivery

**Date:** 2026-10-31
**Branch:** `arena/aa15eff2-jarvis-v1-prototype-continuati`
**Pull request:** https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/pull/1 (OPEN, base `main`, not merged)
**Commits this session:** `2a790f2`, `59c09be`, `5c4ca91` (on top of `cd4fbed`)
**Diffstat:** 26 files changed, 2797 insertions(+), 64 deletions(-)

> **V1 IS NOT COMPLETE.** Every offline gate in this document passes, and
> `npm run verify:v1-release` still exits **1** with 18/18 mandatory release gates
> unaccepted. Nothing here changes that verdict. The evidence classes below are
> kept strictly separate — an offline pass is never presented as Windows-native or
> live-Minecraft verification.

---

## 1. Evidence classes used in this document

| Class | Meaning |
| --- | --- |
| SOURCE VERIFIED | Read in this checkout and quoted; behaviour not executed |
| OFFLINE TEST PASSED | Executed here against mocks/fixtures |
| BUILD PASSED | `tsc --noEmit` / lint / dev-server compile clean |
| WINDOWS LIVE VERIFIED | Executed on a real Windows host |
| MINECRAFT LIVE VERIFIED | Executed against a real running Minecraft world |
| BLOCKED | Cannot be attempted from this environment |
| NOT VERIFIED | Not attempted |

**No item in this session reached WINDOWS LIVE VERIFIED or MINECRAFT LIVE
VERIFIED.** Both are BLOCKED from this sandbox (no Windows host, no reachable LAN
world) and have precise acceptance procedures in §8 and §9.

---

## 2. Defect 1 — JARVIS identified itself as the underlying model

### Root cause (four contributing faults, not one)

1. **`ModelBridge` carried no provenance metadata at all.** Core literally could
   not know which provider or model was serving a request, so no accurate answer
   was possible even in principle. — SOURCE VERIFIED
2. **The default backend was `zai`** (`JARVIS_MODEL_BACKEND`, the Z.ai SDK), so
   the base model self-described as GLM/Zhipu. — SOURCE VERIFIED
3. **`PLANNER_SYSTEM_PROMPT` never forbade adopting the underlying model's
   identity.** `FINAL_REPORT_INSTRUCTION` (which does specify the JARVIS voice) is
   pushed only on the tool-assisted path; the zero-step path emitted the model's
   answer verbatim. — SOURCE VERIFIED
4. **`JARVIS_IDENTITY_CONTRACT` forbade disclosure outright** ("NEVER state,
   confirm, deny or hint at a vendor"). This is the part usually missed: the
   contract made an *accurate* answer impossible, so `enforceJarvisIdentity()`
   would have rewritten "I am running on GLM-5.3 via APINEX" into a lie of
   omission. — SOURCE VERIFIED
5. **`src/app/layout.tsx` branded the browser tab** from
   `https://z-cdn.chatglm.cn/z-ai/static/logo.svg`. — SOURCE VERIFIED

### Repair

Identity and disclosure are now **two different answers**, and both are correct:

- `ModelIdentity {backend, provider, modelId, local, host?}` added to
  `src/lib/agent/core/modelProvider.ts`, populated by the Z.ai, Ollama,
  OpenAI-compatible (`compatProvider.ts`) and Anthropic/profile
  (`models/bridge.ts`) adapters.
- `modelIdentityContext()` renders a `CURRENT ADVISORY PROVIDER` line that
  `loop.ts` injects with `messages.splice(1, 0, …)` **after** the bridge is
  constructed — the message array is assembled before the bridge exists, so it
  cannot be part of the initial array. It is persisted as a `model_identity`
  `AgentStep`, so the provider that actually served a task is on the record.
  It never contains an API key, and when metadata is absent it instructs JARVIS
  to say it **could not confirm** the provider rather than naming one.
- `JARVIS_IDENTITY_CONTRACT` rewritten: never *adopt* a vendor name as your own,
  but **accurate disclosure is required, not forbidden**.
- `isModelDisclosureQuestion()` (`requestIntent.ts`) suppresses the
  `enforceJarvisIdentity()` rewriter *only* for disclosure questions. `"who are
  you?"` is deliberately **not** a disclosure question, so it is still answered
  as JARVIS.
- `layout.tsx` no longer references the external vendor CDN.

**This is not text replacement.** The disclosed provider/model comes from real
runtime configuration. Where the Z.ai SDK selects the model itself and the
operator has not pinned `JARVIS_ZAI_MODEL`, the disclosure reads
`"not specified (selected by the Z.ai SDK)"` — an honest unknown beats an
invented name.

### Tests — OFFLINE TEST PASSED

`scripts/verify-core-conversational-separation.cjs` (**194/194**): real metadata
for the configured APINEX endpoint (`free/glm-5.3`, host `api.apinex.bond`),
key non-leakage, honest unknown handling, disclosure detection in both
directions (6 positive, 7 negative), and the identity/disclosure split.

---

## 3. Defect 2 — actionable tasks reported `completed` with zero tool calls

### Root cause

**Both legacy guards were denylists.** The zero-step guard fired only when
`desktopObjectiveRequiresActions(objective) || requiresExternalActionEvidence(objective)`.
A probe of 14 ordinary actionable objectives found **9 matched neither** —
`turn on bluetooth`, `mute the speakers`, `connect to the LAN world`, `stop the
music`, `restart the companion bot`, `enable the screen capture`, `switch to the
other window`, `print that document`, `lock the workstation`. With
`desktopReq=false ∧ extEvidence=false`, `arbitrateCompletion` classified them
`conversational` and settled **`completed` after zero tool calls**. Verbs missing
from both denylists: turn on/off, enable, disable, connect, send, stop, start,
mute, pause, resume, switch, share, print, restart, lock/unlock. — OFFLINE TEST
PASSED (probe reproduced, then removed)

**The verifier's rejection was correct.** The defect was upstream, in intent
classification. But immediate termination on the first mistake was *also* wrong,
which is what Part 4 asked for.

### Repair

- New `src/lib/agent/core/requestIntent.ts` — `classifyRequestIntent()` fails
  **closed to actionable**. Decision order: empty → conversational; >400 chars →
  actionable; existing guards first; identity/chitchat → conversational;
  social/gratitude lead without an action verb → conversational; ≤5 words ∧ ≤40
  chars ∧ no action verb → conversational; interrogative lead → conversational;
  **default → actionable**.
- Safety direction is one-way: this can only move a verdict
  `completed → partial/failed`. It grants no permission.
- **Recovery before termination.** On the actionable path a zero-step completion
  is rejected and the planner is nudged (`MAX_ACTION_NUDGES = 2`, bounded) to
  choose a real action, call a read-only tool, or **honestly name the missing
  capability**. `emitStatus("replanning")` surfaces it to NEXUS. Only after the
  nudges are exhausted does it fail.
- The legacy zero-step branch text is **preserved verbatim**, so
  `verify-core-goal-action-gate.cjs` still pins it unchanged.
- Scenario E (Guardian denial) was already satisfied: `loop.ts` increments
  denials, persists `guardian_deny`, pushes a corrective message, and at
  `MAX_DENIALS` settles `"denied"` with "No unauthorized side effects occurred."

### Tests — OFFLINE TEST PASSED

`verify-core-conversational-separation.cjs` (**194/194**) covers 20 actionable and
33 conversational classifications **bidirectionally**, including explicit proof
that the legacy denylists MISS them. Re-run of the untouched suites:
`verify-core-goal-action-gate` **19/19**, `verify-task-outcome-honesty` **22/22**,
`verify-core-guardian-laya-boundaries` **14/14**.

---

## 4. Defect 3 — authorized `minecraft_companion_join` denied three times

### Root cause

**Two launchers produced two different authorization contexts, and nothing told
the operator which one they were in.**

- `src/lib/agent/auth/session.ts` checks the *loopback development session*
  contract: `NODE_ENV=development`, `JARVIS_LOCAL_DEV_NO_LOGIN=1`,
  `JARVIS_LOCAL_DEV_BIND=127.0.0.1`, exact origin/host including port 3000.
  `npm run dev` / `dev:no-login` (`scripts/start-local-no-login.mjs`) satisfies
  all of it — hence the owner's **HTTP 200**.
- `src/lib/agent/windows/policy.ts` *additionally* requires
  `JARVIS_WINDOWS_AGENT_ENABLED === "1"` **and** a ≥32-character
  `JARVIS_WINDOWS_COMPANION_TOKEN`. **Only `scripts/start-windows-agent.mjs`
  (`npm run dev:windows`) supplied those.**

Result: a fully authenticated session in which every companion tool — including
an otherwise authorized join — was **permanently denied**. The owner was running
`C:\Users\Aslam\Desktop\JARVIS_ARENA_PR1_TEST` under the wrong launcher.
Secondary fault: `policy.ts` returned **one generic reason** for five distinct
preconditions, so the denial message blamed "the isolated loopback development
launcher" even when that launcher *was* in use. — SOURCE VERIFIED

### Repair — the gate was NOT weakened

`companionGateFailure()` in `policy.ts` now reports **which** precondition failed
(platform / agent flag / no-login flag / bind address / token presence) and
**never interpolates the token value** into the audit log. The LAN denial names
the exact variables the operator must set. All five conditions remain enforced.

`companionAuthorizationContext()` in `scripts/local-dev-bootstrap.mjs` is now the
**single source of truth** for those two keys; `start-windows-agent.mjs` consumes
it instead of generating its own token.

`scripts/start-local-no-login.mjs` now loads `.env` **before deciding** (via
`@next/env`, matching the Windows launcher — otherwise `.env`-configured flags
are invisible and the decision is made against an incomplete environment) and, on
Windows with any companion feature configured, **hands over to the coordinated
launcher**. When it does not delegate it states plainly that companion tools will
be denied. **The broken half-state is now unreachable.**

`scripts/windows-startup-preflight.mjs` asserts the agent flag is exactly `"1"`,
the token is ≥32 characters, and throws on half-configured Minecraft.

### Tests — OFFLINE TEST PASSED

New `scripts/verify-companion-launcher-authorization.mjs` (**36/36**) proves the
repair **cross-layer**: one launcher context satisfies the startup preflight
*and* the runtime gate, actually authorizing `minecraft_companion_join`
(`prepared.operation === "minecraft_join"`), plus `minecraft_companion_stop`,
a read-only companion command, and capability discovery.

It equally proves the gate was not lowered: a plain dev session is **still
refused**, now with a precise reason; nine unsafe configurations are still
refused (non-loopback bind, authenticated path, production, weak token, companion
disabled, Minecraft not enabled, non-loopback LAN host, bot named as its own
owner, non-Windows host); production still rejects passwordless development; and
no denial reason leaks the token.

`verify-windows-startup-preflight` **30/30**; `verify-windows-policy` **56/56**.

---

## 5. Part 2 — Full Autonomy Mode

### Root cause of the "arbitrary limits"

Not Guardian. Two hardcoded constants:

- the continuous step budget was a **literal in the task route** (12 default,
  24/48 cap keyed off `JARVIS_EXPERIMENTAL_DESKTOP_CONTROL`);
- the in-scope replan budget was a **hardcoded `revisions >= 2`** inside
  `GoalProgressWatchdog`.

A long authorized objective was therefore paused or declared blocked by a
constant rather than by the owner's intent. — SOURCE VERIFIED

### Repair

New `src/lib/agent/core/autonomyPolicy.ts` with three tiers
(**normal / advanced / full**), persisted as an owner-scoped `JarvisMemory` row.

**Exactly two levers are exposed, and both are genuinely consumed.**
Per-capability, per-device, per-filesystem, per-application and per-session
grants are deliberately **not** exposed here: those belong to Guardian, and
surfacing them as an "autonomy preference" would invite the bypass this must not
provide. The API **rejects** fields the runtime does not consume rather than
storing them, so NEXUS can never present a dead control.

What it does **not** do:

- no `allow` / `permit` / `bypass` / `skipGuardian` field exists anywhere;
- Guardian authorizes every individual tool call at every tier;
- destructive, irreversible, financial and out-of-scope actions still require
  explicit authorization under `full`;
- `repeatLimit` (identical unverified actions before the run stops) is
  **identical in all three tiers** and is not an owner knob — stopping a spin
  loop is a safety property, not an autonomy preference;
- `MAX_STEPS_HARD_CEILING` (48) and `GOAL_WATCHDOG_MAX_REVISIONS` (4) are
  absolute; clamping is per-tier, so a hand-edited row cannot smuggle in more
  than its own tier allows.

**Trust model:** only rows stamped `OWNER_EXPLICIT` are applied. A
`MODEL_DERIVED` or `TOOL_OBSERVED` row claiming `tier=full` is **ignored and
reported**, so model output, tool output and retrieved memories cannot raise
JARVIS's own autonomy. Unknown tier, corrupt JSON, non-numeric or out-of-range
values all fail **closed to `normal`**.

**Non-regression by construction:** `normal` reproduces the previous behaviour
exactly (12-step default, 24/48 cap under the flag, 2 replans), and
`deriveStepBudget()` takes the **maximum** against the legacy environment values,
so adopting tiers can never silently shorten a run that works today.

**Wiring:**

- `src/app/api/jarvis/task/route.ts` — `loadOwnerAutonomyProfile(ctx.principalId)`,
  resolved from the **server-derived** principal, never the untrusted
  `body.ownerId` that the request interface already documents as untrusted. Both
  the new-task and resume paths derive their budget from the tier.
- `src/lib/agent/core/loop.ts` — optional `autonomy` on `RunTaskOptions`
  (absent → `normal`). **Also fixed a latent trap:** clamping to the legacy
  `MAX_STEPS_HARD` alone would have silently pulled a `full` budget of 48 back to
  24 whenever the experimental flag was unset, making the setting decorative. The
  legacy constant is now a **floor** via `Math.max`, with the absolute ceiling
  still enforced.
- `src/lib/agent/core/goalPlanner.ts` — `GoalProgressWatchdog` takes an optional
  replan budget, clamped to the absolute bound, defaulting to today's 2. **Both**
  construction sites in `loop.ts` (new run and resume) receive it. The durable
  validation bound was widened to the absolute maximum, because durability bounds
  and policy bounds are different things: a checkpoint legitimately persisted at
  a high tier must still load after the owner downgrades.
- New `src/app/api/jarvis/autonomy/route.ts` — GET returns the profile actually in
  effect plus warnings; POST is owner-only, ACTIVE-principal-only and
  origin-checked before any write.

Prisma is imported **lazily** in `autonomyPolicy.ts`, so the pure policy can be
consumed by `loop.ts` and the offline security harnesses without dragging in a
database client. (A top-level import broke
`verify-core-guardian-laya-boundaries.cjs`, whose VM loader passes no mocks to
siblings.)

### Tests — OFFLINE TEST PASSED

New `scripts/verify-autonomy-tiers.cjs` (**87/87**): tier table, absence of any
permission-like field, fail-closed resolution and clamping, the durable trust
model, non-regression of every legacy budget combination, the watchdog replan
budget at each tier including clamp and zero cases, durability across a tier
downgrade, and the route/loop/API wiring contracts.

---

## 6. Part 7 — provider reliability and failover

### Root cause

- `FAILOVER_CODES` in `localFallback.ts` contained **only `RATE_LIMITED`**, so
  `MODEL_UNAVAILABLE`, timeouts, transient network errors and empty responses all
  killed the objective instead of failing over.
- `modelErrors.ts` already defined a `retryable` flag on `ModelFailure` — and
  **nothing used it**.
- Bridge construction had no retry, so a transient blip while *constructing* the
  provider discarded the entire objective: a provider fault treated as a task
  fault.

### Repair

- `localFallback.ts` rewritten: `FAILOVER_CODES` = `RATE_LIMITED`, `TIMEOUT`,
  `NETWORK_ERROR`, `UNAVAILABLE`, classified by `isFailoverCandidate()`.
  **`AUTH_FAILED` and `PRIVACY_ROUTE_BLOCKED` are deliberately excluded** — a
  privacy-route refusal must never be retried into a different backend.
  `FailoverBridge` exposes `identity` as a **getter following the active
  backend**, so disclosure remains accurate *after* a failover, plus `failovers`
  and `lastFailureCode` counters.
- Failover direction remains **cloud → local only** (a privacy invariant;
  broadening the triggers cannot widen egress).
- The primary is still attempted **exactly once per call**. This is deliberate:
  re-hammering a 429 is useless and abusive, and the existing
  `verify-local-fallback.cjs` asserts `cloud === 1`. Bounded retry belongs in
  Core, not in this wrapper.
- `createModelBridgeWithRetry()` in `loop.ts`: 3 attempts, backoff 600/1800 ms,
  retrying **only** failures the taxonomy marks `retryable`; a permanent fault is
  rethrown immediately and reported honestly.
- Guardian context, authorization and JARVIS identity are preserved across a
  switch because the failover happens **inside** the bridge, below Core — the
  task, its journal and its authorizations are untouched.

**APINEX availability is not assumed.** `free/glm-5.3` on
`https://api.apinex.bond/v1` was never contacted from this sandbox; the endpoint
appears in tests only as configuration data. No claim is made that it works.

### Tests — OFFLINE TEST PASSED

`verify-local-fallback` **6/6**, `verify-provider-offline` **12/12**, plus the
failover-classification and identity-follows-active-backend assertions inside
`verify-core-conversational-separation.cjs`.

---

## 7. Part 9 — NEXUS settings

New `src/components/AutonomyTierPanel.tsx`, mounted inside the **existing**
"Autonomy & Routines" tab above the untouched `RoutineManager`.

- Renders the profile **actually in effect** (tier, step budget, replans, and
  source: `owner-settings` / `environment` / `default`) and re-reads after a save,
  so the panel never shows a value the server did not accept.
- Tier choices and their budgets come from the **server response**, not from
  hardcoded UI strings.
- Surfaces server-side clamping warnings and an explicit alert when a stored row
  was ignored for not being `OWNER_EXPLICIT`.
- States plainly what it cannot do: grants no permission; the repeat watchdog is
  fixed at every tier and not adjustable; a run that reaches its budget is
  durably **paused** (resumable without redoing completed steps), not failed.

**The NEXUS design, the animated orb and the two top-level modes are unchanged** —
the orb is still the default view and the console still appears only after
navigation. ULTRON orb provenance/licensing untouched.

### Tests — OFFLINE TEST PASSED

`scripts/verify-nexus-settings.cjs` **34 → 42** checks; `NEXUS_ORB_NAVIGATION`
**11/11**; the 100 000-scenario `NEXUS_UI_STATE_MODEL_STRESS` **PASS**.

**Still missing from Part 9** (NOT VERIFIED, not built): provider health, Windows
companion status, Minecraft connection status, live autonomous task status, and
pause/resume/cancel/emergency-stop controls in Settings. The `system` tab's
existing "CHECK SESSION & PROVIDERS" diagnostic is unchanged.

---

## 8. Windows validation requirements — BLOCKED from this sandbox

This session ran on Linux with no Windows host. Nothing below was executed.

**Minimal live acceptance procedure:**

1. From the project root: `npm install`, then
   `npx prisma generate && npx prisma db push` (both need network access this
   sandbox does not have).
2. Confirm `.env` sets the loopback contract:
   `NODE_ENV=development`, `JARVIS_LOCAL_DEV_NO_LOGIN=1`,
   `JARVIS_LOCAL_DEV_BIND=127.0.0.1`, `JARVIS_PUBLIC_ORIGIN=http://127.0.0.1:3000`.
3. **Start with `npm run dev:windows`.** This is now the single supported
   workflow: it starts NEXUS, JARVIS Core, the Windows companion, the tool bridge
   and the Minecraft capability, each with the correct narrow authorization
   context, and refuses to reuse an occupied service port.
   - If `.env` has any companion feature enabled, plain `npm run dev` now
     **announces the handover and delegates** to the same launcher.
   - If no companion feature is configured, `npm run dev` starts normally and
     prints that companion tools will be denied by design.
4. Acceptance A (authorized): in NEXUS, ask JARVIS to join the Minecraft LAN
   world. Expect the join to reach the permitted companion.
5. Acceptance B (unauthorized): run `npm run dev` with **no** companion flags in
   `.env`, then request the same join. Expect a denial whose reason names the
   missing precondition, and confirm **no** companion process started.
6. Acceptance C (remote): attempt the same from a non-loopback origin. Expect
   denial — the loopback-only bypass must not have widened.
7. Confirm the denial reason never contains the companion token value.

The three PowerShell/CMD artifacts from Session 1
(`BUILD_JARVIS_PRODUCTION.ps1`, `INSTALL_JARVIS_V1.ps1`, `INSTALL_JARVIS_V1.cmd`)
remain **PENDING LIVE WINDOWS ACCEPTANCE** and have never been executed.

---

## 9. Minecraft live-test requirements — BLOCKED from this sandbox

**No claim of real-game acceptance is made anywhere in this session.** Cloud mocks
are not real-game acceptance, and an offline simulated victory is not a real
Minecraft victory.

The historical LAN port `54321` was **not** assumed active and was **not**
contacted.

### SOURCE VERIFIED: `Dig STARTED` is never reported as completed mining

In `windows-companion/minecraft-bot/bot.cjs`:

- line 624 — `Dig VERIFIED: … inventory before -> after` is returned **only**
  when `rawCount(bot, dropName) > before`, i.e. a real inventory increase;
- line 629 — otherwise `Block removed but … pickup NOT VERIFIED; target
  quarantined`;
- lines 337 / 360 / 425 — cobblestone, raw iron and diamond each return
  `{ok:false, verified:false, detail:'… dug, but … pickup not verified'}`;
- line 163 — `Log dug but item pickup not verified`;
- lines 536-537 and 552 — `STARTED` is returned only for autopilot/navigation
  dispatch, each with an explicit instruction to verify progress via
  `auto_status`. `STARTED` is never a completion claim.

`verify_autonomous_gameplay.cjs` — **151347/151347 PASS** over 60 000 diverse
world states (pure engine; **not** a live server).
`verify_pathfinder_lifecycle_offline.cjs` — **41/41**.

### Minimal live acceptance procedure (Windows side)

1. Start the LAN world and **confirm the actual port** — do not reuse `54321`
   blindly. In the world: `Esc → Open to LAN`, note the printed port.
2. In `.env` set `JARVIS_MINECRAFT_LAN_ENABLED=1`, `JARVIS_MINECRAFT_LAN_HOST=127.0.0.1`,
   `JARVIS_MINECRAFT_LAN_PORT=<the port you just confirmed>`,
   `JARVIS_MINECRAFT_PLAYER=Aslam0704`, and the bot name `JarvisBuddy`.
   The preflight **throws** if Minecraft is half-configured.
3. `npm run dev:windows`.
4. **One instruction:** "Join my Minecraft LAN world." Accept only if JARVIS
   detects the capability, confirms the authorized local companion, uses the
   configured LAN host/port, starts or reuses **exactly one** bot process (check
   Task Manager — no duplicate uncontrolled agents), verifies the actual
   connection and observes player state.
5. **Then:** "Mine exactly one cobblestone." Accept **only** on all five
   observations: a suitable target exists, a valid stance was reached, an actual
   stone block broke, pickup was confirmed, and the inventory quantity increased.
   A `Dig STARTED` or dispatch acknowledgment is **not** acceptance.

---

## 10. Part 8 — continuous execution: honest status

Already present in the checkout and unchanged (SOURCE VERIFIED): the explicit
task state machine in `taskState.ts` with compare-and-set status writes and
version fencing; durable `AgentStep` journaling; `EffectRecord` admission with a
deterministic no-duplicate-effect guarantee; `buildReplayFromJournal` resume;
`reconcileCrashedTasks`; the cancellation registry and emergency stop;
`GoalProgressWatchdog` replan accounting; and the `AgentRoutine` /
`AgentWorkerPulse` fenced scheduler lease.

**No claim is made that a task continues after this agent session ends.** A real
persistent scheduler/worker was **not** verified active here, so that specific
acceptance criterion is **NOT VERIFIED**. Resource budgets are now owner
configurable via the autonomy tier; recovery policies remain code-level.

---

## 11. Exact commands and results

All executed in this checkout on Linux (node v22.22.3, npm 10.9.8).

```
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit          → exit 0   BUILD PASSED
npx eslint .                                            → exit 0, 0 errors / 34 warnings
npm run test:core-conversational-separation             → 194/194 PASS
npm run test:companion-launcher-authorization           → 36/36 PASS
npm run test:autonomy-tiers                             → 87/87 PASS
npm run test:nexus-settings                             → 42/42 + 11/11 + stress PASS
npm run test:core-guardian-laya-boundaries              → 14/14 PASS
npm run test:core-game-gate                             → 19/19 PASS
npm run test:outcome-honesty                            → 22/22 PASS
npm run test:local-fallback                             → 6/6 PASS
npm run test:provider-offline                           → 12/12 PASS
npm run test:windows-policy                             → 56/56 PASS
npm run test:windows-startup-preflight                  → 30/30 PASS
npm run test:local-dev-no-login                         → 20/20 PASS
npm run test:local-dev-bootstrap                        → 10/10 PASS
(full battery, all 34 test:* scripts)                   → SUITE TOTAL: 34 PASS / 0 FAIL
npm run verify:v1-release                               → exit 1, NOT COMPLETE, 18/18 unaccepted
curl http://127.0.0.1:3000/                             → HTTP 200, compiles clean
```

`verify:v1-release` now runs **11** offline gates, all PASS (8 at the start of
Session 1, 9 after `CORE-CONVERSATIONAL-SEPARATION`, 11 after
`COMPANION-LAUNCHER-AUTHORIZATION` and `AUTONOMY-TIERS`). It still prints
`V1 RELEASE: NOT COMPLETE — 18/18 mandatory release gates not independently
accepted.` and still exits 1 by design: offline fixtures cannot certify a
platform release.

**Lint delta:** 33 → 34 warnings, **0 errors**. The single new warning is
`react-hooks/set-state-in-effect` at `AutonomyTierPanel.tsx:64` — the same rule
and the same fetch-in-`useCallback`-then-`useEffect` pattern already present in
`RoutineManager`, `ModelManager`, `DeviceManager`, `MemoryManager` and
`IntegrationsPanel`. Reported rather than suppressed; **no rule was disabled**.

`next build` and `prisma generate` remain **BLOCKED** by the sandbox network
allowlist (`fonts.googleapis.com`, `binaries.prisma.sh`). `next/font/google`
failures are warnings, not fatal; the dev server serves `GET / 200`.

---

## 12. Security implications

**Nothing was weakened.** Specifically:

- Guardian still authorizes every tool call; the autonomy tier carries no
  permission and has no `allow`/`bypass` field.
- All five companion preconditions are still enforced; a plain dev session is
  still refused, now with a precise reason. Nine unsafe configurations verified
  still refused.
- The loopback-only development bypass is unchanged and still cannot apply to a
  remote or production host; `localDevNoLoginAllowed` still pins the host to
  `localhost:3000` / `127.0.0.1:3000`. Preview-host API calls return 401 **by
  design** and were not relaxed.
- Failover direction remains cloud → local only; `PRIVACY_ROUTE_BLOCKED` and
  `AUTH_FAILED` are never failed over or retried.
- Only `OWNER_EXPLICIT` memory rows can set autonomy; model and tool output
  cannot.
- No API key is logged, disclosed or committed. The disclosure line is asserted
  key-free; the companion token value is asserted absent from denial reasons;
  `GoalProgressWatchdog` still stores a **hashed** fingerprint, never raw
  arguments.
- The autonomy endpoint is owner-only, ACTIVE-principal-only and origin-checked
  before any write.
- Face/biometric matching still never auto-authenticates the owner.

`public/logo.svg` (the GLM/Z.ai mark) was left byte-identical; only the external
CDN reference in `layout.tsx` was removed.

---

## 13. Provider and model compatibility

Adapters now report `ModelIdentity`: Z.ai SDK (`zai`), Ollama (`ollama`),
OpenAI-compatible (`openai-compatible`, which is what APINEX uses), Anthropic
(`anthropic`), and owner model profiles (`profile`, using the owner's own label
as the provider name). `createProfileBridge` dispatches on `protocol`. An
OpenAI-compatible label is honest about the **protocol** without claiming to be
the protocol's vendor — asserted explicitly. No provider was contacted; no
working provider, subscription or API access is claimed, and no "Max" model
access is asserted.

---

## 14. Remaining blockers

1. **No Windows host** — every Windows-native claim is BLOCKED. §8 is the
   procedure.
2. **No reachable Minecraft LAN world** — every live-game claim is BLOCKED. §9 is
   the procedure, and the historical port was not assumed active.
3. **`next build` / `prisma generate` blocked** by the sandbox network allowlist,
   so there is no production-build artifact from this session.
4. **Part 9 incomplete** — provider health, companion status, Minecraft
   connection status, live task status and pause/resume/cancel/emergency-stop
   controls are not in Settings yet.
5. **Part 6 code path** for "mine exactly one cobblestone" was not re-examined
   end-to-end this session beyond the SOURCE VERIFIED fail-closed checks in §9.
6. **No persistent worker verified active**, so no continued-background-execution
   claim is made.
7. **V1 release gates remain 18/18 unaccepted.** These repairs do not complete V1.

---

## 15. Named next task

**Finish Part 9 before anything else.** The autonomy tier is the only setting in
NEXUS that is genuinely wired to the runtime this session. Still to build, in
priority order:

1. **Companion + Minecraft status in Settings** — the owner's original failure was
   invisible in the UI: NEXUS showed a working session while every companion tool
   was denied. A status panel calling the preflight and reporting
   `companionGateFailure()` per precondition would have made the root cause
   obvious in seconds. Highest value, and the backend reason strings already
   exist.
2. **Provider health panel** — surface `ModelIdentity`, `failovers` and
   `lastFailureCode` from `FailoverBridge` so a failover is visible instead of
   silent.
3. **Live autonomous task status with pause/resume/cancel/emergency stop** —
   `taskState.ts`, the cancellation registry and `/api/jarvis/task/status` already
   exist; this is presentation, not new machinery.

Then §8 (Windows live acceptance) and §9 (Minecraft live acceptance), which are
the only two items that can move BLOCKED evidence to WINDOWS LIVE VERIFIED and
MINECRAFT LIVE VERIFIED. Neither can be done from this sandbox.
