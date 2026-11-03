# JARVIS V1 — Minecraft Pathfinder lifecycle repair and harness recovery

**Date:** 2026-10-30
**Branch:** `arena/aa15eff2-jarvis-v1-prototype-continuati` (from baseline `c3f8e51`)
**Release verdict: NOT COMPLETE.** Nothing here is a real Minecraft result, a
Windows-native certification, or an owner acceptance. `npm run verify:v1-release`
still returns `NOT COMPLETE` with exit code 1 and still reports 18/18 mandatory
release gates as not independently accepted. It was not weakened.

---

## 1. Files changed

| File | Change |
|---|---|
| `windows-companion/minecraft-bot/pathfinder_lifecycle.cjs` | **NEW** — documents and implements correct mineflayer-pathfinder cancellation |
| `windows-companion/minecraft-bot/bot.cjs` | `halt()`, `navigate()` timeout, pre-route latch clear, stance navigation budget, stance-arrival diagnostics |
| `windows-companion/minecraft-bot/verify_pathfinder_lifecycle_offline.cjs` | **NEW** — 41-assertion high-fidelity lifecycle regression |
| `windows-companion/minecraft-bot/verify_mine_ai_mcp_live_bridge.cjs` | Deterministic busy-window gate; 6 → 9 assertions |
| `windows-companion/minecraft-bot/verify_friend_offline.cjs` | Stale literal replaced with a stronger honesty contract; 34 → 36 |
| `scripts/verify-provider-offline.cjs` | Relative-import resolution in the vm loader |
| `scripts/security/verify-core-guardian-laya-boundaries.cjs` | Same loader fix + fail-loud effect-settlement stubs |
| `scripts/verify-core-goal-action-gate.cjs` | Stale closed-form regex → disjunction contract; 17 → 19 |
| `scripts/capability/verify_direct_intent.cjs` | Stale literal → dispatch-precedence contract; 19 → 21 |
| `scripts/verify-production-build-wiring.cjs` | Accept release scripts in the repo root or the historical parent |
| `scripts/verify-v1-gates.mjs` | Wire in the two new Minecraft checks (6 → 8 offline gates) |
| `BUILD_JARVIS_PRODUCTION.ps1` | **NEW** — reconstructed Windows production build driver |
| `INSTALL_JARVIS_V1.ps1` | **NEW** — reconstructed local install driver |
| `INSTALL_JARVIS_V1.cmd` | **NEW** — `%*`-forwarding launcher |
| `eslint.config.mjs`, `package.json`, `package-lock.json` | Lint gate repair; 2 new npm test scripts; 1 new devDependency |

No subsystem was deleted, rewritten, or replaced. Guardian, Core, LAYA, NEXUS,
the Windows companion and the Mineflayer architecture are untouched apart from
the navigation lifecycle described below.

## 2. Engineering objective

Close the named unresolved milestone from `ARENA_CONTINUATION.md`:

> Pathfinder lifecycle patch: installation not independently confirmed.
> Real gameplay: autonomous cobblestone mining not yet verified.

and repair the blocking defect so the first real gameplay acceptance milestone
— **one newly mined and collected cobblestone** — can actually be attempted live.

## 3. Root cause (evidence, not diagnosis-by-assumption)

The mission directed investigation of the current source rather than trusting the
previous diagnosis. Hash evidence first: `PATHFINDER_PATCH_MANIFEST_SHA256.json`
lists `new_test_sha256 = 102be4ae…`, which **matches** the installed
`verify_pathfinder_regression_offline.cjs`, but `modified_bot_sha256 = FCC98243…`
matches **neither** it nor `original_bot_sha256 = 07C1831C…`. So `bot.cjs` is a
third, later revision: the lifecycle patch's test landed, its bot change did not
survive as written, and later deltas moved the file on.

The real defect was then confirmed against the installed library, not assumed:

```
node_modules/mineflayer-pathfinder/index.js
  :31   let stopPathing = false
  :163  bot.pathfinder.stop = () => { stopPathing = true }        // ARMS ONLY
  :139  resetPath(): if (stopPathing) return stop()               // consumes
  :390  function stop () { stopPathing = false; stateGoal = null;
                           path = []; bot.emit('path_stop'); fullStop() }
node_modules/mineflayer-pathfinder/lib/goto.js
        bot.on('path_stop', pathStopped)          // registered FIRST
        bot.on('goal_updated', goalChangedListener)
        bot.pathfinder.setGoal(goal)              // then the goal is set
```

`bot.pathfinder.stop()` **does not stop navigation**. It sets a sticky latch that
only the internal `stop()` clears, and that runs on the *next* `resetPath()` —
i.e. the next `setGoal()`. `lib/goto.js` registers its `path_stop` listener
*before* calling `setGoal(goal)`.

`halt()` did this:

```js
++actionEpoch; bot.pathfinder.setGoal(null);      // would consume a latch…
if (typeof bot.pathfinder.stop === 'function') bot.pathfinder.stop();  // …then re-arms it
```

The order is backwards. The latch was left armed, so the **next `goto()` tripped
its own stale latch** and rejected instantly with
`'Path was stopped before it could be completed! Thus, the desired goal was not
reached.'` — before the bot took a single step. `navigate()` mapped that to
`Pathfinder stopped unexpectedly while approaching …`, which is precisely the
reported live symptom.

Because `halt()` runs at the start of every `setMode()`/`startAction()`, the
first navigation of **every** manual action (`dig_block`, `collect_wood`, `come`,
`navigate`) was killed. Two secondary sites had the same flaw:

- `navigate()`'s timeout handler called a bare `stop()`, arming the latch with no
  consumer — so **one timeout poisoned every later stance retry** in the same action.
- `doFollow()` uses `setGoal(GoalFollow, true)` directly; an armed latch
  nullified the follow goal immediately, producing a ~2 s stall each cycle.

A third, independent defect: the stance navigation budget was **4500 ms**, below
the library's own `bot.pathfinder.thinkTimeout = 5000` (index.js:39). The leg
expired while A\* was still computing the route.

**Why this went unseen:** `verify_pathfinder_regression_offline.cjs` stubbed
`stop(){…}` and `setGoal(){}` as no-ops, so it could not model the latch and
passed 13/13 with the defect present. Worse, a *multi-stance* dig masks it: the
killed first attempt consumes the latch, so the second stance succeeds. Only a
target with a single routable stance reproduces the live failure — which is why
the new test includes exactly that case.

## 4. Implementation summary

`pathfinder_lifecycle.cjs` encodes the invariant *arm then consume*:

```js
function stopPathfinder(bot){          // cancel correctly
  if (typeof pf.stop === 'function') pf.stop();     // 1. arm   (index.js:163)
  if (typeof pf.setGoal === 'function') pf.setGoal(null); // 2. consume → path_stop, latch cleared
}
function clearStaleStop(bot){ pf.setGoal(null); }   // self-heal before a new route
```

`halt()` and `navigate()`'s timeout both use `stopPathfinder()`; `navigate()`
calls `clearStaleStop()` before committing to a route. The stance budget is now
`max(12000, pathfinder.thinkTimeout + 7000)`, so it adapts if the owner tunes
`thinkTimeout`. Stance-arrival failures now report where the bot actually stood
versus the stance it wanted.

**Cancellation is not weakened.** `halt()` still increments `actionEpoch` first,
so `navigate()` still rejects with `'Navigation cancelled by another command'`
regardless of which library error surfaces, and `clearControlStates()`/`fullStop()`
still run. Guardian, effect admission, epoch fencing, dig-target quarantine and
inventory-delta verification are unchanged. No success path was added.

## 5. Exact tests executed

Environment: Linux container, Node v22.22.3, npm 10.9.8, `npm install` from
`registry.npmjs.org` (root: 860 packages; `windows-companion/minecraft-bot`:
92 packages, mineflayer-pathfinder **2.4.5**). No Windows, no Minecraft server,
no microphone/camera, no provider credentials, no owner database.

```
node windows-companion/minecraft-bot/verify_pathfinder_lifecycle_offline.cjs
node windows-companion/minecraft-bot/verify_pathfinder_regression_offline.cjs
node windows-companion/minecraft-bot/verify_mine_ai_mcp_live_bridge.cjs
node windows-companion/minecraft-bot/verify_friend_offline.cjs
(all 19 windows-companion/minecraft-bot/verify_*.cjs)
npm run verify:v1-release ; node scripts/verify-v1-gates.mjs --self-test
(all 31 canonical npm test:*/verify:* suites)
npx tsc --noEmit          (incremental cache removed first)
npx eslint .
npm run db:generate ; npm run build
```

## 6. Test results

| Check | Result |
|---|---|
| `verify_pathfinder_lifecycle_offline.cjs` | **41/41 PASS**, exit 0 |
| Same test vs. pre-fix `bot.cjs` from `HEAD` | **11 FAIL** / 30 pass, exit 1 |
| All 19 `minecraft-bot/verify_*.cjs` | **0 failing** |
| `verify_mine_ai_mcp_live_bridge.cjs` | 9 PASS (was failing at HEAD) |
| `verify_friend_offline.cjs` | 36/36 (was failing at HEAD) |
| 31 canonical npm suites | **31 PASS / 0 FAIL** (baseline: 28/3) |
| `verify-v1-gates.mjs --self-test` | 4/4 PASS (failure injection intact) |
| `npm run verify:v1-release` | `NOT COMPLETE`, **exit 1** — correctly still fail-closed |
| `npx tsc --noEmit` (clean cache) | **exit 0**, no diagnostics |
| typecheck non-vacuity probe | injected error → `TS2322`, exit 2; restored → exit 0 |
| `npx eslint .` | **exit 0**, 0 errors, 33 warnings |
| lint delta vs pristine `c3f8e51` | **0** (172 problems before, 172 after, same 48 files) |
| `npm run db:generate` | **FAIL — environmental** (needs `binaries.prisma.sh`) |
| `npm run build` | **FAIL — environmental** (needs `fonts.googleapis.com`) |

Pre-fix failures that the new test detects, verbatim:
`the FIRST route attempt is not wasted on a stale-latch abort`,
`LIVE-SYMPTOM REGRESSION: the only routable stance is reached on the first attempt`,
`single-stance dig actually collected one cobblestone`,
`single-stance target block was really removed`,
`halt() leaves the pathfinder latch disarmed`,
`the FIRST navigation after halt() reaches its goal instead of dying instantly`,
`timeout disarms the latch instead of leaving it armed`,
`RECOVERY: the navigation after a timeout is not killed by a stale latch`,
`cancellation disarms the latch for the next command`,
`the follow goal survives halt() instead of being nullified by a stale latch`,
`single-stance navigation is not aborted by the pathfinder stop latch`.

Every fail-closed assertion (cancellation authority, no fabricated collection,
route-proof refusal, buried-block refusal) passed **both** before and after, so
the repair did not simply flip the whole file green.

### Evidence tier, stated precisely

| Tier | Status |
|---|---|
| Static inspection | PASS |
| Type checking (`tsc --noEmit`, clean cache) | **PASS** — first real evidence for this gate |
| Lint | **PASS** (exit 0; 10 real UI findings retained as warnings) |
| Production build | **BLOCKED** — external hosts unreachable in this sandbox |
| Offline test | **PASS** (31/31 suites) |
| Integration test | PASS at mock/loopback level only |
| Simulated task | PASS — one cobblestone mined and collected **in a fixture** |
| Windows-native live test | **NOT TESTED** |
| Minecraft real-world test | **NOT TESTED — PENDING LIVE ACCEPTANCE** |
| Owner acceptance | **NOT TESTED** |

These are not interchangeable. A fixture cobblestone is **not** a real
cobblestone, and no dragon, Netherite, stronghold or End-portal progress is
claimed or implied.

## 7. Security impact

**None negative; net positive.** No Guardian, authentication, permission,
cancellation or owner-identity control was altered or relaxed.

- Cancellation still bumps `actionEpoch` before touching pathfinder state, so an
  in-flight navigation is still rejected and cannot complete after a stop.
- `BUILD_JARVIS_PRODUCTION.ps1` forces `$env:JARVIS_LOCAL_DEV_NO_LOGIN='0'` for
  the entire build, so a production attestation can never be produced by a
  process that had the loopback development authentication bypass enabled. Its
  `WriteStatus` uses `ValidateSet('PASS','FAIL')`, so a failed build cannot be
  attested as anything else. It warns and records if
  `JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1` is present.
- `verify-core-guardian-laya-boundaries.cjs` previously executed only 7 of 14
  assertions — six security checks were silently dead, including *"Core refuses
  replay with missing durable model pin"*, *"Core denies version change before
  constructing model bridge"* and *"LAYA rejects remote advisory endpoint without
  fetching"*. All 14 now run and pass. Its new `reconcileEffect`/`settleEffect`
  stubs **throw**, so any future path reaching effect settlement during the
  replay-refusal scenario fails loudly instead of passing silently.
- The dig-target quarantine, route preflight (`reachableStances` accepts only a
  fully solved `GoalBlock` route) and inventory-delta verification are untouched.
- No secrets, keys, enrollment data, databases or `.env` files were added, read
  or committed. `package-lock.json` changed by exactly one added line.

## 8. Integration impact

- `bot.cjs` public contract unchanged: same stdin JSON protocol, same `BOT_ACK`
  shape, same command set, same `MINECRAFT_COMPANION_JOINED` marker, same
  in-game chat grammar. `windows-companion/companion.py` needs no change.
- `mine_ai_mcp_bot.cjs`, `mine_ai_mcp_transport.cjs` and
  `mine_ai_mcp_mission.cjs` were **not modified**; only their test's sequencing.
- `scripts/verify-production-build-wiring.cjs` remains backward compatible with
  the owner's existing Windows layout (scripts one level above the app).
- New checks are wired into `verify-v1-gates.mjs` (6 → 8 offline gates) and into
  `npm run test:minecraft-pathfinder-lifecycle` / `test:minecraft-bridge-e2e`.
- `eslint.config.mjs` adds a `**/*.cjs` scoped override and a `**/*.ts(x)` block
  registering `eslint-plugin-react-hooks` (same instance `eslint-config-next`
  uses, deduped — no plugin redefinition).

## 9. Unverified environmental requirements

1. **Real Minecraft Java LAN world** — the one-cobblestone milestone, sustained
   survival, and all later progression.
2. **Windows host** — `npm run dev:windows`, the companion sidecar, UIA, and the
   three reconstructed PowerShell scripts (no PowerShell exists here).
3. **Network egress** to `binaries.prisma.sh` (Prisma engines) and
   `fonts.googleapis.com` (`next/font/google` Geist + Geist Mono in
   `src/app/layout.tsx`) — both blocked in this sandbox, so `npm run build`
   cannot complete here. This is **not** a source defect.
4. **Provider credentials** — no real LAYA cloud/local routing was exercised.
5. **Microphone, camera, Piper/`jgkawell/jarvis` ONNX voice, sherpa-onnx,
   YuNet/SFace, MediaPipe** — not present.
6. **Owner SQLite database and Prisma-generated client** — absent by design.

## 10. Remaining blockers

- **B1 (owner action).** Live cobblestone acceptance — see §11.
- **B2.** Production build unverifiable here (item 3 above). Remediation for a
  hermetic build: self-host the two Geist faces via `next/font/local`. This was
  **not** done, because it changes NEXUS typography and the font files are not
  obtainable in this sandbox; it needs an owner decision.
- **B3.** 10 NEXUS `react-hooks` findings (8 `set-state-in-effect`, 2 `refs` in
  `OwnerVoice.tsx`) are retained as **warnings**, not fixed. They need a live UI
  to refactor against safely. Do not silence them.
- **B4.** `tsconfig.tsbuildinfo` is committed even though `.gitignore` lists
  `*.tsbuildinfo`. With `incremental: true` this lets `npm run typecheck` report
  a **cached** result. Left in place to avoid churn in a machine-specific
  artifact; every typecheck claim in this report was produced with the cache
  removed. Recommended: `git rm --cached tsconfig.tsbuildinfo`.
- **B5.** Everything already listed as open in `V1_FULL_RELEASE_GATES_2026-10-29.md`
  (G04 LPAC/RLM, G01 production enrollment, G05 live BYOK/local routing, and the
  rest) remains open. This branch closes none of them.
- **B6.** 23 lint warnings are now-redundant file-level
  `eslint-disable @typescript-eslint/no-require-imports` comments. Harmless and
  left as defence-in-depth; `npx eslint . --fix` removes them.

## 11. Required owner-side live acceptance (Windows)

The offline fixture proves the state machine matches the library. It does **not**
prove a real block broke. To close B1:

1. Back up the working tree. Stop the JARVIS launcher and any running companion bot.
2. `cd windows-companion\minecraft-bot && npm install` (needs mineflayer,
   mineflayer-pathfinder **2.4.5**, vec3).
3. Set `JARVIS_MINECRAFT_LAN_PORT`, `JARVIS_MINECRAFT_LAN_HOST` and
   `JARVIS_MINECRAFT_PLAYER` to your own username (must differ from `JarvisBuddy`).
4. Open your Java survival world to LAN and start `npm run dev:windows`.
   Wait for the literal `MINECRAFT_COMPANION_JOINED (spawn observed)` line —
   process creation is not join proof.
5. In-game send `jarvis stay`, then confirm `status` reports `"mode":"stay"`.
6. Stand within ~16 blocks of **exposed** stone (a natural outcrop or cave wall,
   not fully buried), and confirm the bot holds a pickaxe.
7. Issue `dig_block` at freshly observed stone coordinates through the normal
   Guardian-authorized tool path.
8. **PASS** requires all four, observed independently in the real game:
   the bot walks to a stance and stops on it; the block visibly breaks;
   `status` shows `Dig VERIFIED: cobblestone inventory 0 -> 1`; and the
   cobblestone is visible in JarvisBuddy's actual inventory screen.
9. **On FAIL**, capture and report: the full `lastAction` string, `status` JSON,
   the bot's `ownerName`/`botName`, whether the message was
   `Pathfinder stopped unexpectedly`, `Navigation timeout after …ms`,
   `Arrival at verified mining stance not confirmed (stood at …)`, or
   `Block removed but cobblestone pickup NOT VERIFIED`, and the Minecraft and
   mineflayer-pathfinder versions. The new diagnostics distinguish these cases
   deliberately — please do not paraphrase them.
10. Do **not** restart the six-hour autonomous goal to work around a failure, and
    do not treat a dispatched `dig_block` as a collection.

Also pending on Windows, separately: run `BUILD_JARVIS_PRODUCTION.ps1` and
`INSTALL_JARVIS_V1.cmd` once to validate the reconstructed release scripts, and
`RUN_AUTONOMY_ACCEPTANCE.ps1` now that the lint gate passes.

## 12. Commit identifiers

| Commit | Subject |
|---|---|
| `945cf96` | Fix Minecraft pathfinder stop-latch that killed the first navigation |
| `62f183c` | Repair four verification harnesses broken by source drift |
| `a48019b` | Restore the missing Windows release scripts and make the gate reproducible |
| `a6a8b5c` | Unblock the lint gate without hiding any finding |
| `309e825` | Document the repair evidence, gate delta and continuation checkpoint |

**Pull request #1:** https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/pull/1
from `arena/aa15eff2-jarvis-v1-prototype-continuati` into `main` — open,
unmerged, awaiting owner review.

---

**JARVIS V1 remains NOT COMPLETE.** This branch repairs the confirmed blocker on
the first real gameplay milestone and turns three permanently-failing canonical
gates green with real evidence. It does not certify Windows-native behaviour,
live model routing, biometrics, or any Minecraft progression beyond a simulated
cobblestone in an offline fixture.
