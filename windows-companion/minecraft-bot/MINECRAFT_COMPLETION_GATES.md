# Minecraft JARVIS — code-only completion gate

**Status:** DEVELOPMENT IN PROGRESS; NOT 100% IMPLEMENTATION-READY; NOT LIVE-CERTIFIED.
**Track:** Prototype JARVIS `main`; this is not the primary PC Work JARVIS product and does not certify a production release.
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
- **Remaining code areas that cannot be certified as done:** open-ended natural-language skill generation beyond the finite goal vocabulary, robust long-duration JVM/Mineflayer state persistence and recovery beyond the new bounded network reconnect, generalized construction/farming and advanced multi-step interactions, integration compatibility across modded/vanilla Minecraft versions, and end-to-end real-game acceptance of Iron through final Netherite. The native trade/enchant paths exist in source but are not compiled or field-accepted. These are not merely test formalities.

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
- Owner chat 'jarvis resume' or authorized auto_resume is still required after a process restart. The same host and port can represent a changed world, so automatically replaying previously authorized actions is unsafe. A bounded, opt-in Windows sidecar reconnect supervisor is now implemented for the native JarvisBuddy engine (requires both `JARVIS_MINECRAFT_LAN_ENABLED=1` and `JARVIS_MINECRAFT_AUTO_RECONNECT=1`): it may rejoin after a transient disconnect, but it never resumes the mission or replays an effect. It stops after five attempts in a rolling ten-minute window and does not apply to the external Mine AI MCP engine. Windows process-lifecycle and real LAN reconnect behavior remain untested.
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

## November 2: stricter client-observed Dragon engagement evidence
- New `dragon_engagement.cjs` tracks the exact observed Ender Dragon entity ID, JARVIS's recent combat attempt, the End dimension, and a bounded death-event interval. A death for a different entity, older encounter, wrong dimension, or with no JARVIS attack no longer sets `dragonDied` or emits a victory event. New missions and player death reset historical combat evidence.
- `late_skills.cjs` links verified arrow consumption and dispatched direct melee attacks to the current Dragon entity; `bot.cjs` accepts a `dragon_death` event only through the stricter predicate. Arrow consumption **does not prove a hit**, and a dispatched melee swing **does not prove damage**.
- `verify_dragon_engagement.cjs`: **16/16 passed**, source-isolated offline checks. Existing `verify_late_skills.cjs` remains **29/29 passed** with the new module connected. Both are mock/source tests, NOT actual Java server proof.
- Important limitation: vanilla client death events do not establish the identity of the final killing player. Even this stricter predicate remains evidence of combat participation plus Dragon death, **not server-side killer attribution**. A real live acceptance must require that the end-to-end mission proceeds without outside players performing the work; use server-side attribution where available.
- The strict full Java empty-survival -> Dragon death -> End return -> equipped Netherite evidence gate is **NOT PASSED**. The project remains NOT 100% accepted.

## November 2: End portal deadlocks, real Eye IDs, bow preflight and final sword gate
- The Java Eye of Ender item name is `ender_eye`. `late_game.cjs` now reads canonical raw item counts, historical `eye_of_ender` aliases, and normalized digest fields without counting a single raw item twice. This fixes possible infinite resource collection after real Eyes have already been crafted.
- Dragon-first and Netherite-first missions now **recognize already activated End portals before demanding additional Eyes**. Both craft actual missing Eyes even after discovering portal frames, instead of treating loose pearls/powder as inserted Eyes.
- If all twelve frame blocks are loaded and server-observed, the planner uses the actual number of unfilled frames. A partially visible portal ring leaves the requirement unknown (conservatively up to twelve Eyes), avoiding misleading partial-ring evidence.
- Both mission orders now plan actual 3x3 workbench, planks, and stick prerequisites before bow crafting; arrow crafting when ingredients are available also requires a workbench. This prevents no-workstation retry loops.
- The final victory requires FOUR currently worn Netherite armor pieces AND a CURRENTLY HELD Netherite sword, not only a historical equip milestone. `digest()` now exposes `heldNetheriteSword` from `bot.heldItem`; `verify_real_java_full_campaign.cjs` requires both armor and sword after the End return. If the sword is switched away, the planner re-equips rather than claiming completion.
- Source-isolated updated late-game decision suite: **200,078/200,078 assertions PASSED**, including 100,000 randomized world snapshots plus focused Eye, portal, archery, partial-frame, and current sword regressions. This is OFFLINE DECISION/OBSERVATION VERIFICATION, NOT REAL MINECRAFT JAVA CAMPAIGN ACCEPTANCE.
- This branch was changed with direct GitHub API commits tagged `[skip ci]`; no GitHub Actions were requested. The strict live Java empty-survival -> Dragon -> End return -> full Netherite campaign remains **NOT PASSED**, and generalized arbitrary Minecraft gameplay is not completed.

## November 2 — General-purpose goal expansion and massive local event simulation

- Added typed autonomous `craft` and `equip` high-level goals to the **secondary Prototype JARVIS**, not production PC Work JARVIS. `general_goal.cjs` allows exactly eight bounded crafting recipes (stick, crafting_table, chest, furnace, ladder, bread, shield, torch) and destination-compatible equipment types. These are reusable primitives, **not unrestricted arbitrary Minecraft gameplay**.
- Both goals are integrated into owner/Guardian command validation, the core controller, server-observed inventory/equipment completion, ordered composite sequences, durable intent-only checkpoint recovery, and Mineflayer's action executor. Owner chat accepts `jarvis craft 2 chest` and `jarvis equip iron_helmet head`; unsupported items, destinations, quantities, and extra parameters are rejected.
- Confirmed and fixed general-goal runtime validation over internal controller metadata, preserving strict validation of external input. Preserved `farm_wheat` command validity after adding craft/equip quantity validation.
- Identified and fixed a real **long-running reliability bug**: per-action failure counts previously remained accumulated after successful, server-verified actions. These counts now reset on each verified success, preserving the consecutive unverified-attempt limit and cancellation fail-closed rules.
- Focused source-isolated tests: `verify_general_goal.cjs` 218/218 PASS; `verify_mission_sequence.cjs` 32/32; `verify_autonomous_gameplay.cjs` 151,361/151,361 (60,000 randomized states); `verify_progression.cjs` 52/52; `verify_wheat_goal.cjs` 26/26; `verify_structure_goal.cjs` 17/17. All offline; earlier late-game tests 200,078/200,078 remain recorded.
- **Additional local massive event stress** using the actual checked-in core and general-goal JavaScript in an isolated V8 runtime (no GitHub Actions minutes): 800,000 randomized world snapshots plus 20,000 evolving crafting/equipment mission episodes, 133,154 simulated action ticks, 1,278,071 assertions, **0 false completions**, **0 unhandled simulated actions**. 19,381 missions ended with observed simulated goal state; 594 were deliberately owner-cancelled; 25 correctly fail-closed after consecutive unverified receipts. The engine observed 106,236 verified virtual actions, 6,918 unverified receipts, and rejected 38,096 unsupported/hostile command samples. The high-volume test advanced an accelerated simulated clock and **did not connect to a real Minecraft server**.
- A first stress attempt uncovered a faulty randomized test-generator expectation, which was corrected, plus the actual failure-streak bug described above; the final corrected stress outcome is PASS for safety invariants. Local wall-clock execution of the final accelerated stress was around 4.2 seconds, **not** Minecraft real time.
- **Acceptance boundary:** General-purpose game capability remains **bounded** to supported operations and cannot honestly be described as doing *anything* in Minecraft. No external plugins or native Java/Mineflayer server were available to this isolated runtime. **Real-world movement, item crafting, equipment, combat, and the complete Dragon-to-Netherite victory remain unverified end-to-end.** Do not report 100% completion.
- All development commits contain `[skip ci]`; no GitHub Actions workflows were requested or needed.

## 2026-11-03 local source-isolated regression run

Using the exact current Prototype `main` source files fetched from the repository, a local V8/CommonJS compatibility harness executed:

- Dragon-first survival-rule campaign model: **40/40 seeds PASS**; 10,753 simulated steps; maximum 278 steps in a seed.
- Late-game planner: **200,078/200,078 assertions PASS**, including 100,000 randomized state snapshots.
- Progression regression: PASS.
- Generic resource goals: **31/31 PASS**.
- Multi-step mission sequence: **32/32 PASS**.

The harness loads the actual planner/controller modules and tests; its CommonJS and assertion adapters are source-isolated. This is not a full Node/Mineflayer installation, not the entire offline gate runner, and not real Java gameplay. Do not interpret model campaigns or randomized snapshots as actual games.

Separately, the Internet-corpus validator's Node.js 22.16.0 regression harness passed **12/12** cases, including source-path traversal and non-HTTPS URL rejection. This validates the validator only; no 200,000-record corpus exists or has been executed.

## 2026-11-06: Core-to-Mineflayer typed command field parity

- Fixed a real sidecar integration gap: the Windows companion previously filtered the JSON sent to the Mineflayer child through an incomplete field list. That silently removed valid parameters for villager trading (`tradeIndex`, `times`), enchanting (`choice`), container transfer (`operation`), crop farming (`crop`), volume construction (`height`, `shape`), and bounded hostile attacks (`maxSwings`).
- Added one strict transport projection shared by the companion and offline contracts. It requires and strips the Windows `operation=minecraft_command` envelope, removes `taskId` metadata from the child payload, maps Guardian-prepared `operationDirection` to the child's `operation` field only for transfer goals, forwards every supported child field, rejects unknown/reserved fields, and adds only the sidecar-generated 16-hex request correlation ID. The child `friend_protocol.cjs` remains the canonical per-command validator.
- Added offline contracts for trade, enchant, transfer, crop, volume-build and hostile parameters, plus unknown-field and invalid-ID rejection.
- Local policy/contract harness: 9/9 typed-field projection checks passed, including Windows-envelope stripping, transfer-direction mapping and parity against the actual child-protocol field declarations. No Windows companion, Node child, Java server or Minecraft world was launched. Run the checked-in contract with `python windows-companion/verify_minecraft_command_contract.py` from repository root. This fixes transport-field loss; it does not certify those gameplay operations end-to-end.

## 2026-11-06: responsive stop during Minecraft language interpretation

- The sidecar previously held the global Minecraft process lock while waiting for a child ACK (up to 16 seconds for `natural_goal`). That could delay an explicit owner stop while local Ollama was interpreting a request.
- The sidecar now holds the lock only while binding the exact child, registering the correlated ACK waiter and writing the bounded request. It releases the lock before waiting; `minecraft_stop` and service shutdown can terminate the child while interpretation/action is in flight.
- ACK waiters remain bound to the exact child process, and the existing child-reader EOF path resolves pending calls as outcome-unknown rather than routing stale ACKs to a replacement process.
- The Windows companion offline verifier now includes an AST contract that fails if an ACK wait is moved back inside the global process lock. The updated command handler passed local AST syntax parsing. No Windows stop-latency or live game test was run.

## 2026-11-06: command-specific bounded Minecraft ACK deadlines

- The sidecar now uses a 30-second ACK window for local-model `natural_goal` interpretation and real inventory/window transactions (`craft_item`, villager inspection/trading, container transfer, enchanting and bounded hostile attacks). Short status, observation, goal-admission and dig commands retain an 8-second window.
- This remains bounded below the existing 79-second HTTP companion deadline. The bot lock is not held during the ACK wait, so the longer transaction window does not delay explicit stop.
- Local typed-command/timeout harness: 10/10 tests passed, including protocol parity and command-specific deadlines. Offline contracts do not prove a particular server operation finishes within its deadline or certify real Minecraft transactions.

## 2026-11-06: repair owner-grounded wheat natural-language routing

- The November 5 wheat-language edit left a malformed `wheatRequest` expression and duplicated the remainder of `language_goal.cjs`. The companion imports that module at startup, so the malformed source was a blocking integration regression.
- Restored the last clean parser baseline and reapplied the wheat intent as one bounded typed goal. Natural requests must name the wheat count, 1x1–4x4 field dimensions and exact origin; the existing `friend_protocol.cjs` and `wheat_goal.cjs` validators enforce target count 1–16 and world-coordinate bounds. No field origin is inferred.
- Executed the actual `verify_language_goal.cjs` suite in a source-isolated V8/CommonJS harness: **33/33 PASS**, including all five new wheat-intent cases. The harness loaded the actual current language, protocol, resource, recipe, smelt, crop, sequence, structure, combat, container and wheat modules; only Node's assert/process boundary was shimmed. The test file also syntax-compiles after stripping its Node shebang.
- This remains source-isolated regression evidence, not a full installed Node/Mineflayer runtime. The full Minecraft offline gate runner, Windows companion/Node startup, Java server and real wheat farming were **not run**. No GitHub Actions were used. Live Minecraft acceptance remains separate.

## 2026-11-06: align Core AI farm instructions with native goal schemas

- The Core Minecraft system prompt incorrectly directed wheat farming to `farm_crop`, even though the native schema has a separate `farm_wheat` goal and `farm_crop` accepts carrots/potatoes only. This mismatch could cause an otherwise valid owner wheat request to be rejected by the Core goal gate.
- Corrected the model instructions: wheat maps to `farm_wheat` with owner-supplied origin, 1–4 width/depth and targetCount 1–16; carrots/potatoes map to `farm_crop` with exact crop, origin, dimensions and count.
- Added six assertions to `scripts/verify-minecraft-natural-language-routing.cjs`: explicit prompt routing, removal of the old mismatch, carrot admission and crop/wheat substitution denials. A source-contract check passed **7/7**, and the modified CJS test script syntax-compiles.
- The full TypeScript transpile/Guardian natural-language test, full Minecraft offline gate runner, Windows companion, and live crop farming were **not run**. No GitHub Actions were used.

## 2026-11-06: contextual natural-language routing for opted-in Minecraft mode

- Previously, the Core Minecraft classifier required an explicit Minecraft reference or a narrow resource term. Ordinary in-game phrases such as “build me a small house” or “farm wheat” were not routed to the AI planner even when the owner had explicitly enabled both the Minecraft LAN companion and AI planner. This contradicted the natural-language prompt.
- Added an explicit context parameter to the classifier. The Core supplies it only when both `JARVIS_MINECRAFT_LAN_ENABLED=1` and `JARVIS_MINECRAFT_AI_PLANNER_ENABLED=1`; without that opt-in, generic house/farm language remains outside the Minecraft route. Contextual routing requires a known Minecraft gameplay noun plus an action intent, and explicit browser/workspace terms block the contextual match. Exact “stop/pause/cancel/halt” and inventory readback questions are recognized in the opted-in context; punctuation is normalized for readback questions.
- The bounded native shelter goal now accepts “small/simple/basic house” as an alias for shelter/hut. An unqualified “build me a house” is still not silently reduced to a small shelter; the owner must specify a bounded size/shape.
- The opted-in context is propagated through the Core loop into the per-task `MinecraftAiGate`, native goal authorization and restart revalidation; it is not only a classifier hint. Regression cases cover small-house admission only in opted-in mode and default-context denial.
- Added twelve regression assertions to `scripts/verify-minecraft-natural-language-routing.cjs` covering contextual routing, browser/workspace/media false positives (including resource words in a spreadsheet), read-only inventory questions, small-house admission and unbounded-house denial. Executed the actual extracted classifier source in a source-isolated V8 harness: **11/11 PASS**; separately exercised the exact shelter/house regexes extracted from Core source: **5/5 PASS**. The updated CJS test script syntax-compiles.
- The complete TypeScript transpile/Guardian natural-language suite, full Minecraft offline gate runner, Windows companion and live house build were **not run**. No GitHub Actions were used.

## 2026-11-06: align PlayerEngine gather coverage with the native resource catalog

- Found a cross-layer mismatch: the Core gate and native companion accepted 33 safe vanilla gather resources, while the Windows Guardian policy and PlayerEngine executor each hard-coded only ten. Valid owner requests for sand, gravel, coal, copper, redstone, lapis, emerald, quartz, and other supported resources could therefore be rejected before reaching AltoClef.
- Added `src/lib/agent/core/minecraftResources.ts` as the shared 33-item safe vanilla catalog and wired both the Guardian policy and PlayerEngine executor to it. The Core prompt now describes the same catalog. The Java bridge still independently requires `TaskCatalogue.taskExists(item)`; the companion protocol remains authoritative and unchanged.
- Extended `scripts/verify-minecraft-bridge-policy.cjs` to enforce exact catalog parity with `resource_goal.cjs`, verify all 33 resources across Core/Guardian/companion, and reject bedrock, barrier, command blocks and TNT.
- Source-isolated validation: **8/8 cross-layer contract checks passed**; actual companion `friend_protocol.cjs` accepted **33/33** safe resource goals and denied all four unsafe examples. The updated CJS policy test syntax-compiles.
- Full TypeScript transpilation, Windows PlayerEngine IPC, Java/Fabric build and live resource gathering were **not run**. No GitHub Actions were used.

## 2026-11-06: unify bounded construction materials across Core, Guardian and native engines

- Found another cross-layer mismatch: Core, Windows Guardian and the Mineflayer structure controller allowed seven construction materials, while the Java PlayerEngine bridge allowed a different ten-item set. This meant a material could be admitted by one layer and rejected by another, and Core's build-volume gate did not independently check the bounded material catalog.
- Added `MINECRAFT_SAFE_BUILD_MATERIALS` to the shared catalog with twelve safe vanilla blocks: cobblestone, cobbled deepslate, stone, dirt, oak/spruce/birch planks, stone bricks, oak logs, glass, sandstone and netherrack. Wired PlayerEngine and Windows Guardian to the shared catalog; aligned Mineflayer `structure_goal.cjs`, Java `BUILD_BLOCKS`, `JarvisNativeSequenceTask.BUILD_BLOCKS`, `JarvisNativeVolumeTask.MATERIALS`, and the Core `SAFE_BUILD_MATERIALS` gate. The owner must still explicitly name the requested material, dimensions, shape and local origin.
- Unsafe materials including TNT, bedrock, barrier, lava and command blocks remain denied.
- Source-isolated cross-layer check: **9/9 PASS**; actual companion protocol accepted **12/12** safe build materials and denied all five unsafe examples. Both updated CJS regression scripts syntax-compile.
- Full TypeScript transpilation, Windows Guardian/PlayerEngine execution, Java/Fabric build and live construction were **not run**. No GitHub Actions were used.

## 2026-11-06: native PlayerEngine goal parity and multi-stage build expansion (build-only)

- Expanded the native Java gather allowlist to match the shared 33-resource Core/Guardian catalogue. The pinned AltoClef overlay now registers mud and moss_block in TaskCatalogue, so these two shared entries have actual upstream task definitions rather than allowlist-only names. The native sequence gather catalogue matches the same set.
- Added native PlayerEngine auto_goal routing for the already-typed craft, equip, travel, and defeat_hostile goals. These use the existing task-backed craft/equip/travel/combat operations, explicit owner-selected item/slot/destination or exact observed hostile ID/name, bounded mission duration, and task-bound completion receipts. Core proof checks require a same-task receipt plus fresh world observation.
- Expanded native multi-stage sequences to admit up to 16 typed stages: farm_wheat, farm_crop (carrots, potatoes and beetroot), build_volume, shelter, defeat_hostile, transfer, trade and enchant alongside the existing gather/craft/smelt/equip/travel/tool/build stages. The full stage list is validated before the first effect. Farm stages are constrained to the exact owner field, loaded farmland cells and mature-crop harvest transitions; construction delegates to the existing bounded per-cell volume task; combat is bound to one live allowlisted hostile entity ID and name. Transfer/trade stages re-read the exact loaded container or live villager offer and require inventory-conservation/offer-use receipts; enchant stages require explicit owner XP consent, the opt-in flag, the exact observed table/item/choice, and the vanilla owner-XP/lapis transaction. Each stage must satisfy its native postcondition before the sequence advances.
- Aligned the Core sequence grammar, Windows Guardian schema, PlayerEngine sequence adapter and Java task-stage validator for the expanded stage vocabulary. Expanded the Java hostile catalogue to match the Core's 18 explicitly allowed hostile types.
- Made the pinned companion overlay installer capable of applying the new TaskCatalogue registrations and upgrading overlay files only when their existing content matches a known repository version; unrecognized local edits remain protected.
- **No tests, Gradle build, TypeScript build, full offline gate, Windows startup, or live Minecraft session were run in this build-only continuation.** These are implementation changes only. Runtime compilation, integration, and live gameplay acceptance remain unverified and must not be represented as passed.

## 2026-11-06: broaden native PlayerEngine bounded sequence coverage

- The pinned AI Companion/AltoClef bridge now exposes one JARVIS-owned typed sequence across gather, craft, smelt, equip, travel, tools/stone-age/iron-age presets, bounded block building, wheat/carrot/potato farming, bounded volume/shelter construction and observed hostile defeat. Sequences are limited to 1-8 stages and the entire stage list is validated before the first world effect.
- Stage validation is exact-field and bounded: resource/item counts, local coordinates, travel range, equipment slot/item, crop type/field dimensions/target count, build footprint/shape/material, and currently observed hostile entity ID/type. Extra fields on gather/craft/smelt/equip/travel stages now fail closed.
- Each stage advances only after its physical postcondition: new inventory delta, actual equipment slot, arrival within range, age-seven crop harvest plus new crop inventory, actual block placement, or the exact observed hostile no longer alive. A failed/ambiguous stage stops the sequence; it is not silently retried.
- The pinned upstream `TaskCatalogue` overlay registers mud and moss blocks so the expanded 33-item gather catalog can be executed by AltoClef. The native sequence's build-stage allowlist is now aligned with the same 12 safe build materials used by Core, Guardian and the Java bridge.
- Source inspection confirms the sequence task, status snapshot and overlay are wired into the pinned bridge. The CJS policy regression checks sequence gather/build catalog parity and strict stage-field guards. An additional source-parity harness verified the 33 gather resources and 12 build materials match across the shared catalog, native sequence, native volume task and Java bridge: **7/7 PASS**. **No Java/Fabric compile or live in-game sequence was run**; this is implementation evidence, not gameplay acceptance.

