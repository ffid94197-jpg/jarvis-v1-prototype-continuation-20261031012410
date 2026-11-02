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

## Declarative multi-step autonomous mission support
- `goal:"sequence"` accepts 1–8 typed steps: safe resource goals, coordinate travel, wooden tools, Stone Age or Iron Age. There is **no executable user-authored script evaluation** and no implicit admin/creative access.
- Authorized `steps` are deeply copied and stored in the goal controller; the planner works across stage transitions without asking the owner to issue new single-step commands. Each stage must pass its real inventory/arrival proofs before moving on.
- Travel proof cannot be recycled at the next waypoint. On real respawn, the stage cursor resets and previously fulfilled goals are **re-evaluated against actual surviving inventory**. The bot remains subject to owner stop, Guardian preflight, time/step budgets, fail-closed security and verified game state.
- `verify_mission_sequence.cjs` **27/27 offline assertions** passed without GitHub Actions. `verify_travel_goal.cjs` **16/16**, `verify_resource_goal.cjs` **31/31**, `verify_late_game.cjs` **200,057/200,057** (100,000 planner snapshots), all independently rechecked in source-isolated JS. This is not a real Node/Minecraft integration proof.
- The open-ended instruction requirement **remains unsatisfied**. Sequence composition works only within the finite, verified action vocabulary. Arbitrary construction, biome tasks, farming, trading, exploration reasoning and novel crafting chains still require additional planning and real-world testing.


## November 2 continuation: restart intent and safer pickup, no hosted minutes
- Commit 594103e33e54ced95987de0206f866115055da9a: added a bounded atomic local mission-intent lease. auto_resume requires owner/Guardian authorization, matching configured LAN host/port/owner, unexpired deadline, and a newly verified survival mode. Stale Dragon, End, inventory or sequence success evidence is NEVER restored. auto_checkpoint reports restart availability.
- Commit 08d6e6c23d53d03b82837234305435e6df020a23: physical item-drop recovery now rotates among observed safe pickup footprints; no walking or packet acknowledgement is treated as inventory proof.
- Offline regression verify_mission_checkpoint.cjs and two candidate-starvation assertions in verify_drop_pickup.cjs are registered in the local runner. ACTUAL FULL NODE REGRESSION ON THESE CHANGES: NOT RUN. Committed test source is not a passing test.
- GitHub Actions list showed zero workflow runs attached to either commit. No hosted workflow was dispatched.
- Owner chat 'jarvis resume' or authorized auto_resume is required after a process restart. The same host and port can represent a changed world, so automatically replaying previously authorized actions is unsafe. An automatic restart supervisor was NOT implemented.
- Remaining mandatory gates: actual Java stone drop pickup; Iron, diamond, Nether, End, Dragon victory, End return, post-Dragon Netherite. Finite goal vocabulary is not arbitrary construction, farming, trading, novel crafting or genuinely universal gameplay.

Run offline with zero Actions minutes from the isolated, updated checkout: node windows-companion/minecraft-bot/run_offline_minecraft_gates.cjs

## Code-only construction continuation (no GitHub-hosted minutes)
- Branch changes `0e1858bfacd6e203b4c440d78ce49eca1ac8d1bd` and `fd8d7436c83c76868f5aeb55b5cce410939619e3`: bounded `build` goal (1–8 horizontally adjacent cells), for approved common survival blocks only. Owner-authorized positions must begin within 12 blocks. Every required cell must be loaded, empty and safely supported; any obstructed or hazardous target fails closed. Existing blocks are never replaced.
- A missing cobblestone item delegates to the ordinary survival resource-gathering planner; placing a block must change observed Minecraft block state AND consume a real inventory item before success. `sequence` may combine gather, travel and build without accepting stale waypoint or structure proofs.
- Owner chat syntax: `jarvis build 4 cobblestone x+ 10 65 10`; coordinates should be an observed safe local area. The typed `auto_goal` command also supports `goal:"build", block, position, axis, length`. A checkpoint contains only typed mission intent, not previously placed-block receipts.
- `verify_structure_goal.cjs`: 17/17 focused standalone Node checks PASSED in isolated local test execution. The full real-repository Node regression suite was **not run**, and no Java server was involved. This is a **finite building primitive**, not arbitrary architectural design or general-purpose Minecraft creative intelligence.
- New zero-Actions local command (on the updated isolated Windows checkout): `.\\scripts\\minecraft\\run-local-acceptance.ps1 -Mode Code`. It invokes the complete existing Minecraft offline regression gate. **Not claimed passed until actually run on the owner checkout.**
- Remaining: actual Java stone/iron/diamond, Nether/End, Dragon victory, post-Dragon Netherite, reconnect/cancellation resilience, generalized farming/trading/building and open-ended gameplay. Full Minecraft is **NOT COMPLETE**.

## November 2 farming expansion — evidence-limited outcome
- Added a validated finite farm_wheat goal targeting an owner-specified 1–4 by 1–4 patch at explicit coordinates (up to 16 wheat items). The observer accepts only loaded, mature age-seven wheat on observed farmland; immature wheat is never harvested. Unknown/missing/impossible crop age fails closed.
- Planner can replant verified wheat seeds, harvest mature wheat, and wait for growth. Executor requires both server-observed crop state and real seed consumption for planting, or crop removal plus actual wheat inventory pickup for harvesting. Owner cancellation interrupts physical actions.
- The goal is available from authorized auto_goal, in bounded sequence steps, and owner-chat 'jarvis farm 2 10 65 10 2 2'. Mission restart checkpoints persist authorized intent only, not historical harvest receipts.
- Source-isolated evaluation of actual committed CommonJS modules with restricted requires passed: verify_wheat_goal.cjs **26/26**; verify_mission_sequence.cjs **32/32**; verify_structure_goal.cjs **17/17**. Existing verify_progression.cjs also passed earlier in this development session. The actual bot.cjs parsed successfully in JavaScript. These are offline checks, not complete Node/Mineflayer or vanilla Java game evidence.
- New work committed: ccd310e7b561f3cc17d86c8436c06da2ce367e87 and proof-hardening f42ecfdb57fc5f8a320e0d8e8bcdc10db853af19. No GitHub Actions workflow was dispatched.
- Still NOT satisfied: general-purpose game instructions, self-generated unfamiliar skills, arbitrary farming/trading/building, full real Java stone/iron/diamond/Nether/End gameplay, Dragon kill, post-Dragon Netherite equipment, full field acceptance. Neither an approximate percentage nor passing model simulations certify these gates.

Next without hosted Actions: in the isolated Windows prototype checkout run .\scripts\minecraft\run-local-acceptance.ps1 -Mode Code, then -Mode Stone against an approved live Java survival world, and finally -Mode Full only after blockers are fixed. Never run these against the dirty production PC Work JARVIS.

## November 2 follow-up: pickup and bounded mission authority
- Item-drop pickup now rotates **several independently observed, standable positions for each item**. The first preferred position for every visible item is tried before fallback positions; this prevents a difficult first drop from starving other drops. Success continues to require server-backed inventory gain; a navigation ACK alone is never proof. Mock regression `verify_drop_pickup.cjs`: **12/12 passed** in source-isolated JavaScript execution (Vec3 behavior modeled; no Java server).
- Long Dragon/Netherite/companion missions may renew a 6-hour execution window **only within 12 hours of the original owner authorization**. After that the mission expires and checkpoint is cleared; no indefinite authorization extension. Paused, blocked and completed goals are not renewed.
- Adjusted obsolete autonomous-engine regression inputs for total crafting recipe budget, independent survival, and bounded wood-scout fallback. Source-isolated evaluation of `verify_autonomous_gameplay.cjs`: **151,359/151,359 assertions passed** across 60,000 modeled world states. These remain engine-only cases.
- Local no-hosted-Actions mode `-Mode Iron` invokes the existing REAL Java survival smoke extended from empty inventory to wood, stone gear and iron pickaxe. It requires an owner-approved Java LAN world and **has not been executed**. Command: `.\\scripts\\minecraft\\run-local-acceptance.ps1 -Mode Iron -OwnerName YOUR_JAVA_USERNAME -Port YOUR_LAN_PORT`.
- Full Java Dragon defeat + End return + Netherite remains NOT ACCEPTED. The rough '20% remaining' number is not a measured engineering acceptance ratio.

## November 2: targeted real-survival blocker and long-session fixes
- `drop_pickup.cjs` now finds up to five distinct safe pickup feet positions for EACH observed item, rejecting distant or vertically unreachable pseudo-positions. The primary candidate for each visible drop is tried before fallback positions. The prior real Java stone gate stalled after digging because actual cobblestone pickup was not confirmed; this is a **targeted fix, not a passing live retest**.
- `verify_drop_pickup.cjs` source-isolated JavaScript execution: **12/12 assertions PASS** (mock Vec3 and Mineflayer world). Includes unreachable first item, alternatives around a single drop, inventory proof, hazards, and cancellation.
- `autonomy_engine.cjs` caps long-mission automatic renewals at **12 hours from the original owner authorization** instead of renewing indefinitely. Paused, blocked and completed goals do not renew.
- `verify_autonomous_gameplay.cjs`: historical recipe/survival/wood-fallback expectations were updated to match verified current planner rules. Source-isolated run **151,359/151,359 assertions PASS** across 60,000 simulated world states; this is pure decision-engine coverage, not a live Java server.
- `late_skills.cjs` now checks real physical displacement and waypoint arrival before granting successful Nether scouting or thrown-eye stronghold bearing travel. Previously navigation acknowledgments alone could create false progress. Source-isolated `verify_late_skills.cjs` **21/21 mocked assertions PASS** (timing emulated, not live Minecraft).
- Added Windows local `Iron` mode to `scripts/minecraft/run-local-acceptance.ps1`, which uses the existing empty-inventory wood -> stone -> iron-pickaxe real Java gate without GitHub Actions. Iron mode has not yet been run on the owners real Minecraft server.
- **NOT ACCEPTED:** uninterrupted empty-survival Java stone, iron, diamond, Nether, Dragon defeat, Overworld End return and post-Dragon equipped Netherite remain unverified; open-ended universal Minecraft autonomy also remains incomplete. An approximate percent is not an acceptance score.

## November 2: Dragon-first equipped-armor Netherite upgrade blocker
- Identified a concrete progression deadlock: `equip_diamond` puts the four diamond armor pieces into Minecraft equipment slots before the Ender Dragon fight, but `smith_netherite` formerly searched only `bot.inventory.items()`. Mineflayer excludes worn armor from that backpack list, so post-Dragon Netherite armor smithing failed despite the owner actually possessing the four required diamond bases.
- `late_skills.cjs` `smithGear` now checks observed template and Netherite ingot **before** touching worn armor, identifies the exact corresponding equipment destination, verifies the correct diamond item in the server-backed slot, only unequips in the Overworld, and requires the diamond base to appear in the backpack before opening the smithing UI. Unsupported slots, unavailable Mineflayer unequip API, absent material, and unconfirmed slot changes fail closed.
- Official Mineflayer API confirms `bot.unequip(destination)` is supported (see https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md ).
- Source-isolated `verify_late_skills.cjs` passed **25/25** mocked assertions, covering successful smithing of a worn diamond helmet, wrong-dimension denial, missing-ingot denial without stripping armor, plus pre-existing smithing layout/Dragon event/Nether navigation gates. This test is not a real server or actual GUI compatibility proof.
- Existing `verify_real_java_full_campaign.cjs` still owns the strict external acceptance condition: one actual empty-inventory Java survival session, Ender Dragon death observed, genuine End portal return, and subsequent equipped full Netherite. **NOT PASSED; code fix is not a victory.**

## Further November 2 stronghold-proof fix
- `late_skills.cjs` stronghold staircase descent now verifies server-observed block removal after each dig and actual displacement toward the next lower step. The previous path counted digging as progress even if the bot never descended; this is now denied without physical movement.
- After the equipped-diamond-armor upgrade fix and this movement hardening, source-isolated `verify_late_skills.cjs` passed **26/26** mocked checks. The suite specifically covers missing smithing materials, worn diamond armor, Nether/Overworld boundary, and digging-without-moving failure.
- The end-to-end empty-survival Minecraft Java Dragon-first victory gate remains unrun and **NOT ACCEPTED**. No GitHub Actions minutes have been used for this continuation.

## November 2: protect player armor after smithing
- Added same-epoch post-smithing armor restoration in `late_skills.cjs`. After verified equipped-diamond upgrade, the bot closes the smithing GUI and attempts to equip the newly crafted Netherite armor. If upgrade fails but the original diamond piece remains in inventory, it attempts to re-equip that original piece. Owner cancellation prevents further inventory mutations. The final mission continues to require independent in-game armor-slot proof.
- Updated the smithing regression to assert upgraded Netherite helmet is worn again after a successful verified GUI output. Source-isolated suite: **26/26 mock checks PASS**. This does NOT prove the real 1.21.1 GUI behavior or run the Ender Dragon campaign.
- All development commits on this branch use `[skip ci]`; no GitHub Actions workflow was requested.

## November 2 — Smithing GUI failure and ranged-combat verification
- `smithGear` now covers failures **before a smithing GUI opens**: if equipped diamond armor is removed and opening the smithing interface throws, a same-action finally cleanup attempts to restore the actually observed original armor (or the obtained Netherite upgrade). It also handles a failed inventory-settlement check without inventing success. Owner cancellation does not authorize extra armor mutations.
- `verify_late_skills.cjs` includes the specific GUI-open-failure-and-armor-restoration regression, using server-inventory movement modeled in a local mock.
- `shootVisibleEntity` now requires a measured reduction in the survival inventory's arrow count before recording a verified bow shot. Pressing the item-use button alone never proves a shot, and even an actual consumed arrow does **NOT** prove damage or a Dragon kill. The current mission must still observe real Dragon death and its portal.
- In source-isolated offline test execution the updated `verify_late_skills.cjs` suite passed **29/29 checks**. This suite executes actual updated CommonJS source with test mocks, but not Mineflayer or a real Minecraft Java server.
- This is a significant source-level reliability improvement, **not** a full autonomous Minecraft acceptance pass. The unbroken empty-inventory Minecraft Java Dragon-first-to-Netherite mission has not been run here.
