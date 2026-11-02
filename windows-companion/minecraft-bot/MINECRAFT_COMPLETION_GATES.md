# Minecraft JARVIS — code-only completion gate

**Status:** DEVELOPMENT IN PROGRESS; NOT 100% IMPLEMENTATION-READY; NOT LIVE-CERTIFIED.
**Track:** Isolated GLM prototype feature branch and draft PR #8 only, not production PC Work JARVIS.
**Owner constraint:** Do not start/rerun/schedule/enable GitHub Actions workflows. Do not consume GitHub-hosted runner minutes. Run tests locally on the owner's PC when authorized.

## Scope of currently implemented campaign
- One `dragon_then_netherite_run` goal from real empty Java survival inventory through wooden, stone, iron, diamond equipment, Nether/End access, witnessed Dragon death, witnessed actual End exit, five Netherite upgrades and currently equipped four Netherite armor slots and sword.
- Pure planner and bounded action executor with real inventory/block/position/dimension/equipment proof, cancellation, time/step limits, and fail-closed decisions.
- Continued code-only fixes: independent survival without visible owner; safer tree scouting and loot recovery; single-item furnace smelting with inventory receipt; safe furnace/workbench placement; dual-axis portal frame layout; template-chest retry integrity; End-return proof; Dragon/Nether threat avoidance; smithing result settlement.

## Tests run without GitHub Actions in source-isolated JavaScript execution
- `verify_progression.cjs`: PASS, updated rules including Dragon low-health retreat and independent wood scouting.
- `verify_late_game.cjs`: PASS, 200,052 planner assertions including 100,000 random snapshots, **not 100,000 real games**.
- `verify_late_skills.cjs`: PASS, 17/17 mocks (before the last smithing receipt/chest changes).
- `verify_drop_pickup.cjs`: PASS 8/8.
- `verify_crafting_site.cjs`: PASS 9/9.
- `verify_inventory_settlement.cjs`: PASS 5/5.
- `verify_wood_pickup_access.cjs`: PASS 3/3.
- `verify_stone_access.cjs`: PASS 12/12.
- `verify_portal_layout.cjs`: PASS 7/7.
These use an isolated adapter for CommonJS, assertions and Vec3; **not a full Node installation or real Minecraft**.

Run the actual Node offline gate on a development checkout (no hosted minutes):
```powershell
cd "D:\glm 5.3\GPT6_TEST\JARVIS_V1_GPT6_MINECRAFT_AUTONOMY_2026-10-28"
# Select the real updated checkout containing windows-companion/minecraft-bot first.
node windows-companion/minecraft-bot/run_offline_minecraft_gates.cjs
```
Do not assume this historical directory still contains the current GitHub branch; fetch/checkout before invoking.

## NOT complete (must not be marked PASS)
- Real Java Iron, diamond, Nether portal, Blaze/Ender supply, stronghold portal, Ender Dragon, End return, and post-Dragon equipped Netherite progression in a *single* uninterrupted actual survival mission.
- Adaptation to arbitrary Minecraft maps/seeds, biome/resource scarcity, lava/loss/deaths, and diverse gameplay instructions; code has a finite allowlisted goal set, not an unlimited natural-language Minecraft planner.
- Genuine manual-free long-horizon tool interaction and recovery across Minecraft server restarts and disconnects.
- Independent end-to-end Node integration tests for latest code edits, followed later by live field tests on the user PC without GitHub Actions, if approved.

**Acceptance invariant:** NEVER infer complete from source presence, a planning assertion, a sent action packet, or a simulated mission. Need actual ordered server-observed Dragon death → End exit → full Netherite armor equipped and Netherite sword, with no creative, teleport/admin cheat or manual gameplay.

## Additional code-only autonomy expansion (no GitHub Actions)
- Finite owner-authorized `gather` goal: `auto_goal` accepts `resource` and `targetCount` (1–64), validates the allowlist and executes prerequisite progression without a human reissuing each craft/mine command. Minecraft owner chat also supports `jarvis gather 16 cobblestone` and aliases like `diamonds`, `wood` and `stone`.
- Supported target classes: logs, planks, sticks, cobblestone, raw iron, iron ingots, diamonds, obsidian, flint and netherrack. More resources and open-ended language are **not implemented**.
- `resource_goal.cjs` is a read-only planner. The existing Guardian-bounded Minecraft action executor must still prove inventory changes before the resource goal reports success. It never guesses successful mining.
- Nether, End and Overworld threat recognition now use the **same** hostile allowlist as the retreat executor. `retreat_access.cjs` selects only observed solid-ground escape positions that increase separation, and the executor requires actual movement before success.
- Added `verify_resource_goal.cjs` (31/31 offline assertions) and `verify_retreat_access.cjs` (6/6 offline geometry assertions) to the local-only runner. Source-isolated testing passed those, the progression checks, `verify_late_game.cjs` (200,052 assertions) and `verify_late_skills.cjs` (17/17 mocks). **No GitHub Actions workflows executed.**
- These tests are not a substitute for production Node/Mineflayer integration, a real multi-hour Java game or an arbitrary Minecraft instruction benchmark. Do not claim 100% universal autonomy or that live testing is the sole possible remaining work.

## Further zero-Actions code-only continuation — owner travel and Nether material settlement
- `auto_goal {goal:"travel", destination:{x,y,z}, arrivalRange:1..8}` and owner chat `jarvis travel 100 64 -50` provide a bounded persistent target. Only a physically observed Pathfinder arrival produces `travel_arrival`; both proof and current position are required before completion.
- `verify_travel_goal.cjs`: **16/16** source-isolated protocol/controller checks, including invalid positions, no fake movement success and actual-arrival milestone.
- `retreat_access.cjs`: all Nether/End hostile escape routes now require loaded, safe floor, increased separation and real player displacement. Offline geometry **6/6**.
- Nether gold: sufficient `raw_gold` or `gold_nugget` now counts as *unprocessed* loot so the bot can return to Overworld, build/use a real furnace or crafting table there, and convert it into physically verified gold ingots. No gold output is ever inferred from raw inventory alone.
- `verify_late_game.cjs`: **200,057/200,057** local planner assertions after adjusting raw-gold/fuel/station tests. These are 100,000 randomized snapshots, not playthroughs.
- `verify_resource_goal.cjs`: **31/31**, `verify_progression.cjs`: PASS; tests executed without GitHub Actions.
- **Remaining code areas that cannot be certified as done:** open-ended natural-language skill generation beyond the finite goal vocabulary, robust long-duration JVM/Mineflayer reconnect/state persistence, generalized construction/farming/trading, integration compatibility across modded/vanilla Minecraft versions, and end-to-end real-game acceptance of Iron through final Netherite. These are not merely test formalities.
