# JARVIS V1 — 2026-10-29 additional engineering delta

**VERDICT: NOT COMPLETE.** This is an isolated development source candidate, not a
fully integrated or production-certified V1 build. The archived source may be
older than the owner's active Windows working directory. Never overwrite that
checkout if hash checks fail.

## Implemented

1. Core completion arbiter (`src/lib/agent/core/verifier.ts`) no longer
   mistakes durable transport/effect receipts for proof that an unstructured
   external objective succeeded. It now reports `partial` when no independent
   predicates can establish end-to-end success, including Minecraft STARTED,
   `inGameOutcomeVerified:false`, generic desktop acknowledgments, or no effects.
   A file/other artifact with real matching predicates still verifies;
   a failed sibling effect cannot be concealed by passing predicates.
   Game objectives now require real actions before the planner may produce a
   terminal conversational response: no fabricated dragon win without tools.
2. Task UI settlement (`src/lib/agent/core/loop.ts`) distinguishes
   executor receipts from goal completion and explicitly flags partial outcomes.
3. Effect classification (`src/lib/agent/core/effects.ts` and Core loop)
   separates read-only Minecraft status/inventory/auto_status/observe from
   effectful actions so repeated observations are fresh, not stale duplicate
   receipts. Gameplay effects have durable per-step identities: a retry of
   the SAME step is deduplicated, while a new collection step can run.
4. Minecraft bot (`windows-companion/minecraft-bot/bot.cjs`) rejects its own
   username as the configured owner and resolves player-name capitalization
   changes without authorizing unrelated players.
5. Added focused offline regression tests and a **deliberately fail-closed**
   `npm run verify:v1-release` assessment. This command returns exit code 1
   until all mandatory native/independent gate evidence has been supplied.

## Executed evidence (this isolated source)

- `verify-task-outcome-honesty.cjs`: 15/15 PASS. This uses a mock effect journal
  with real temporary filesystem readback for artifact predicates, not a live DB.
- `verify-core-goal-action-gate.cjs`: 17/17 PASS, action intent source rules.
- `verify-minecraft-effect-identity.cjs`: 22/22 PASS, repeatable Minecraft action and fresh status policy.
- `verify_owner_identity_offline.cjs`: 7/7 PASS, VM and fake Mineflayer.
- `verify_friend_offline.cjs`: 34/34 PASS, fake Mineflayer.
- `verify_pathfinder_regression_offline.cjs`: PASS (fake Pathfinder).
- Adjacent scripts: 10/10 PASS, including memory contracts, Guardian tool
  wiring, model privacy, authenticated-owner fixture, autonomy session, and
  Minecraft action bridge. See raw logs and ADJACENT_TEST_RESULTS.json.
- `verify-v1-gates.mjs --self-test`: 4/4 PASS on deliberate fake failure
  injection. The real release assessment correctly returns `NOT_COMPLETE`
  with exit code 1 and marks all 18 mandatory release gates unaccepted.

## Still missing

This delta does **not** implement every V1 requirement, nor does it close
Windows LPAC/RLM protected control, production authenticated enrollment,
end-to-end BYOK/local/cloud concurrency, real Windows app/video/game control,
complete face/voice/gesture hardware integration, REA, cross-device continuity,
release signing/install, security adversarial certification, or independent
owner signoff. No live tree-log collection, Netherite set, End portal entry,
or Dragon kill has been demonstrated. These gates remain open.

## Integration rule

The earlier top-level SHA-256 manifests are historical snapshots and are stale
for modified paths. `CURRENT_SOURCE_MANIFEST_SHA256_20261029.json` records the
new isolated candidate's current file hashes, excluding itself.

Use the hash-guarded patch installer on a preserved, separately backed-up
Windows checkout. The installer refuses mismatched files, rather than replacing
newer work. A native Windows release acceptance pass is still mandatory.
