# JARVIS V1 — continuation checkpoint and gate delta (2026-10-30)

**Branch:** `arena/aa15eff2-jarvis-v1-prototype-continuati`
**Baseline:** `c3f8e51` · **Commits:** `945cf96`, `62f183c`, `a48019b`, `a6a8b5c`
**Repository:** Prototype JARVIS checkout. This is **not** the separate Real
Product engineering checkout under `D:\jarvis_pc_work`, and nothing here was
validated against, or applied to, that checkout.

**VERDICT: JARVIS V1 NOT COMPLETE.** `npm run verify:v1-release` still exits 1
with 18/18 mandatory release gates unaccepted. It was not weakened, and no gate
was deleted or re-marked to make a demonstration pass.

Companion document: `MINECRAFT_PATHFINDER_LIFECYCLE_REPAIR_2026-10-30.md`
carries the full 12-part completion evidence for this session.

---

## 1. What actually changed this session

Four defects were confirmed from evidence and repaired. All four were
pre-existing at `c3f8e51`.

1. **Minecraft pathfinder stop-latch** (blocking the first real gameplay
   milestone). `bot.pathfinder.stop()` in mineflayer-pathfinder 2.4.5 only arms a
   sticky `stopPathing` latch; `halt()` armed it *after* consuming it, so the next
   `goto()` killed itself before the bot moved. Every manual action's first
   navigation died, and one timeout poisoned all later stance retries. Fixed by
   arming-then-consuming, plus a stance budget that respects the library's own
   5000 ms A\* `thinkTimeout` (it was 4500 ms).
2. **Six silently dead security assertions.** `verify-core-guardian-laya-boundaries.cjs`
   crashed while loading `loop.ts` (unresolved `./minecraftIntent`), so only 7 of
   14 checks ever ran. Dead checks included *"Core refuses replay with missing
   durable model pin"* and *"LAYA rejects remote advisory endpoint without
   fetching"*. All 14 now run and pass.
3. **Three permanently-failing canonical gates** (`test:provider-offline`,
   `test:core-game-gate`, `test:capability-discovery`) caused by harnesses
   asserting stale string literals or unable to resolve relative TypeScript
   imports. In every case the **source was correct or stricter** than the
   assertion; the assertions were repaired and strengthened, never relaxed.
4. **Missing Windows release artifacts.** `BUILD_JARVIS_PRODUCTION.ps1`,
   `INSTALL_JARVIS_V1.ps1` and `INSTALL_JARVIS_V1.cmd` lived one level *above* the
   app in the owner's Windows layout, so they were never committed and
   `test:production-build-gate` failed with ENOENT forever. Reconstructed from the
   contract the wiring test asserts and the schema of the committed
   `PRODUCTION_BUILD_STATUS.json`. **PENDING LIVE WINDOWS ACCEPTANCE.**

Canonical suite status moved **28 PASS / 3 FAIL → 31 PASS / 0 FAIL**.
`npx eslint .` moved **172 problems / exit 1 → 0 errors / exit 0**.
`npx tsc --noEmit` from a clean incremental cache: **exit 0**, and proven
non-vacuous by injecting a deliberate type error (`TS2322`, exit 2) and restoring it.

## 2. Gate board delta

Against `V1_FULL_RELEASE_GATES_2026-10-29.md`. That board is preserved unchanged;
this is a delta, not a rewrite.

| Gate | Previous | Now | Evidence |
|---|---|---|---|
| G00 reproducible source/toolchain/typecheck | NOT TESTED for production build; offline syntax only | **PARTIAL — improved** | `tsc --noEmit` exit 0 from clean cache (real typecheck, not transpile-only); `eslint .` exit 0. Production build still BLOCKED on external hosts |
| G02 fail-closed release ledger | PARTIAL, offline run logged | **PARTIAL — improved** | `verify-v1-gates.mjs --self-test` 4/4; real assessment still `NOT COMPLETE`/exit 1; offline gates 6 → 8, all PASS |
| G03 Guardian/Core/effect/settlement/cancellation | PARTIAL, offline fixtures pass | **PARTIAL — improved** | 14/14 boundary assertions now execute (was 7/14); cancellation authority re-proven post-repair |
| G08 skills/MCP/connectors | PARTIAL | **PARTIAL — improved** | `MINE_AI_MCP_BRIDGE_E2E` 9 PASS deterministic, incl. fail-safe busy contract |
| G10-ish Minecraft progression | live cobblestone unverified | **UNCHANGED — PENDING LIVE ACCEPTANCE** | Blocker repaired and regression-guarded offline; **no real gameplay executed** |
| G04 Windows LPAC/RLM | BLOCKED | **BLOCKED (unchanged)** | no Windows host |
| G01, G05, G06, G07, G09, G11–G17 | as recorded | **UNCHANGED** | not touched this session |

No gate was moved to accepted. Nothing is claimed as Windows-native or live.

## 3. Capability ledger (internal, evidence-based)

**IMPLEMENTED AND VERIFIED (offline/typecheck evidence only)**
- Core task state machine, effect admission/settlement, outcome honesty arbiter
- Guardian authorization, audit redaction, fail-closed-on-audit-unavailable
- LAYA deterministic owner-weighted routing, privacy-before-inference, loopback-only advisory
- Model provider bridge: loopback/SSRF rejection, stream reassembly, error normalisation without secret leakage
- Minecraft companion command protocol, owner identity resolution, dig-target quarantine, route preflight, inventory-delta verification
- **Pathfinder cancellation lifecycle** — now matches installed library semantics
- Capability discovery, NEXUS settings/orb navigation contracts, browser egress guard

**IMPLEMENTED BUT NOT VERIFIED (needs Windows / hardware / credentials)**
- Windows UIA inspection and action, native browser control, app discovery/launch
- Continuous ~3 FPS screen feed and multi-frame cloud vision
- Piper TTS with `jgkawell/jarvis` / `jarvis-high.onnx`, wake word, sherpa-onnx STT
- YuNet face detection, SFace matching, MediaPipe hand gestures, voice/face enrollment
- Real BYOK cloud and local (Ollama / LM Studio / llama.cpp / vLLM) routing
- Prisma persistence against a real SQLite database; long-run worker
- `BUILD_JARVIS_PRODUCTION.ps1`, `INSTALL_JARVIS_V1.ps1`, `INSTALL_JARVIS_V1.cmd`
- Minecraft LAN join, follow/come/stay/guard, wood gathering, iron/diamond survey,
  late-game and Nether skills, MCP bridge against a real Mine AI MCP host

**PARTIALLY IMPLEMENTED**
- Real screen perception toward continuously sampled visual observation
- Cross-device clients (mobile/tablet/watch/TV) — architecture and pairing only
- Minecraft progression beyond primitive gathering: no demonstrated portal,
  Nether traversal, Ancient Debris, Netherite set, stronghold, End portal or dragon

**MISSING**
- Demonstrated multi-model collaboration on a single task
- REA, release signing/packaging, adversarial security certification
- Verified death/respawn recovery and inventory-loss reconciliation in a live world

**BLOCKED BY EXTERNAL HARDWARE OR ENVIRONMENT**
- Windows LPAC/RLM protected supervisor (G04)
- Production build in this sandbox: `binaries.prisma.sh` and `fonts.googleapis.com` unreachable
- All live Minecraft, microphone, camera and GPU-dependent work

**REQUIRES OWNER AUTHORIZATION**
- Any live LAN world test; experimental full-desktop control flag
- Self-hosting Geist fonts via `next/font/local` (changes NEXUS typography)
- `git rm --cached tsconfig.tsbuildinfo`
- Integrating any of this into the live Windows installation or `D:\jarvis_pc_work`

## 4. Next task, in priority order

**NEXT (Priority 3, owner-gated): live one-cobblestone acceptance.**
The blocker is repaired and regression-guarded, but it is unproven in a real
world. Procedure and the exact PASS criteria are in
`MINECRAFT_PATHFINDER_LIFECYCLE_REPAIR_2026-10-30.md` §11. If it fails, the new
diagnostics distinguish `Pathfinder stopped unexpectedly` / `Navigation timeout
after …ms` / `Arrival at verified mining stance not confirmed (stood at …)` /
`Block removed but cobblestone pickup NOT VERIFIED` — capture `lastAction`
verbatim and fix only the failing path.

Then, without owner hardware:
1. **Priority 0/1:** make the production build hermetic so G00 can close —
   self-host Geist via `next/font/local` (needs owner sign-off, B2).
2. **Priority 5:** refactor the 10 `react-hooks` findings once a live UI can be
   observed; keep them as warnings until then (B3).
3. **Priority 0 hygiene:** untrack `tsconfig.tsbuildinfo` (B4).
4. **Priority 3:** extend the lifecycle fixture to `collect_wood` and the
   autonomous `mine_cobblestone`/`mine_iron` paths, which share `navigate()` and
   therefore share the repaired latch semantics but are not yet individually
   guarded by a faithful pathfinder model.
5. **Priority 4:** live BYOK/local provider routing (G05) once credentials exist.

## 5. Reproducing this session's evidence

```bash
npm install
cd windows-companion/minecraft-bot && npm install && cd ../..
npx tsc --noEmit                       # exit 0 (remove tsconfig.tsbuildinfo first for a clean-cache run)
npx eslint .                           # exit 0, 0 errors, 33 warnings
node windows-companion/minecraft-bot/verify_pathfinder_lifecycle_offline.cjs   # 41/41
npm run verify:v1-release              # NOT COMPLETE, exit 1 — expected and required
```

To re-confirm the repair is load-bearing, temporarily restore the pre-fix bot and
rerun the lifecycle test; it must fail 11 assertions:

```bash
git show c3f8e51:windows-companion/minecraft-bot/bot.cjs > /tmp/bot_orig.cjs
cp windows-companion/minecraft-bot/bot.cjs /tmp/bot_fixed.cjs
cp /tmp/bot_orig.cjs windows-companion/minecraft-bot/bot.cjs
node windows-companion/minecraft-bot/verify_pathfinder_lifecycle_offline.cjs   # 11 FAIL, exit 1
cp /tmp/bot_fixed.cjs windows-companion/minecraft-bot/bot.cjs                  # restore
```

## 6. Standing constraints honoured

Existing source, architecture, identity and the NEXUS orb were preserved; nothing
was rebuilt or replaced. No success was fabricated, no test hidden, no acceptance
requirement deleted, no benchmark invented. Guardian was not weakened to make
anything pass. No secrets, credentials, enrollment data, databases or owner world
data were added, read or committed. The loopback development authentication bypass
was not extended, and the new build driver explicitly forces it off. The separate
`D:\jarvis_pc_work` production checkout was not touched and no claim is made about it.

## 7. Pull request

See the pull request opened from
`arena/aa15eff2-jarvis-v1-prototype-continuati` into `main`. It has not been
merged, and nothing here should be merged into the owner's live Windows
installation without the live acceptance in §4 and the owner's own review.
