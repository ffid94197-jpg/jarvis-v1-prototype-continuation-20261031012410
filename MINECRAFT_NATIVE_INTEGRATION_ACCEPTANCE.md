# JARVIS Prototype — Native Minecraft integration acceptance (2026-11-03)

## Authority and scope
- **One JARVIS:** Minecraft is a native capability of the existing Core, LAYA model selection and Guardian; the existing Mineflayer process is a game-connection adapter, not a second reasoning agent.
- Prototype repository only. Never copy into, reset or rewrite the primary Windows PC Work JARVIS checkout at `D:\jarvis_pc_work`.
- Strict opt-in, local/private Java survival world; no unrestricted LLM-generated executable skills, command shells, external player attacks or creative/teleport cheats.
- This integration recovers selected source-isolated Minecraft capabilities from the historical experimental branch, not the entire experimental PR and not its GitHub workflows.

## Integrated development capabilities (code present, not live-certified)
- Survival mission planner, late-game path, Dragon evidence rules and verified Netherite equipment goals.
- Finite resource gathering; inventory-grounded crafting and equipment; bounded navigation and building; wheat farming; declarative multi-step sequences; owner-bound mission checkpoint and explicit resume.
- In-game owner chat and main JARVIS/NEXUS natural-language model route. No separate Mindcraft bot instance or second application.
- Cross-language command schemas: TypeScript Guardian -> Windows Python companion -> Node bot. Invalid, extra and prototype-object goal fields denied; all authorized mission parameters preserved.
- Server-observed final proof now exposes both worn Netherite armor and actually held Netherite sword.

## Evidence obtained while preparing this integration
- Source-isolated CJS command-contract checks: 22/22 accepted/rejected as intended.
- Source-isolated controller checks: 1,218/1,218 across nine goal types, including false-completion guards. Simulated observations, not a real Minecraft server.
- Type-erased V8 exercise of the actual TypeScript bounded goal validator: 5,019/5,019 tests. This is not a complete TypeScript type-check or deployed Windows test.
- Source-isolated held-sword observation projection: 5/5 checks.
- Selected production and test CommonJS source files parsed in V8; full installed Node suite and Python validation suite remain to be executed on a compatible checkout.

## Single local offline acceptance (no hosted Actions minutes)
On the Windows developer/test checkout, with existing project dependencies installed:
```powershell
node scripts/run-minecraft-native-gates.cjs
```
This launches only project-local offline tests. It forces `MINECRAFT_LIVE_ACCEPTANCE=0`, and returns nonzero on any failed test. There is no GitHub Actions invocation.

## Dragon-first + Netherite simulator regression (2026-11-03)
- Reproduced an actual offline acceptance failure: the separate survival world model changed from End to Overworld but failed to return the explicit `end_return` receipt, causing JARVIS's strict controller to reject the completed step. **The strict controller was correct to reject unverified transition; the modeled action receipt was repaired.**
- Reproduced a second failure after that correction: the test world combined worn armor and held sword into one boolean and did not expose the separate `heldNetheriteSword` field that the production planner requires. The simulation now models the real Mineflayer observation contract, keeping four worn armor slots and actively held sword separate.
- Executed the production planner plus this independent, recipe-grounded world model in an isolated V8 harness using **1,000 seeded runs, 948,314 assertions and 269,390 modeled action ticks — all passed**. No actual Java server was contacted or Minecraft won.
- Added the seed campaign test to the existing developer-PC offline test runner so future changes cannot omit this crucial Dragon/End-return/Netherite regression.
- No code change weakens any real Dragon/Netherite acceptance criteria. An unverified or missing End return remains **NOT ACCEPTED**.

## Real-game strict final acceptance — NOT PASSED
Only after the owner starts an approved compatible vanilla Java survival world on the test PC, with empty inventory, local LAN opt-in and no cheats, may the owner separately run:
```powershell
$env:MINECRAFT_LIVE_ACCEPTANCE = "1"
node windows-companion/minecraft-bot/verify_real_java_full_campaign.cjs
```
The gate must prove a genuine Java spawn, server-backed survival and empty inventory; autonomous progression without owner intervention; witnessed Dragon death in the End; witnessed End exit to Overworld; and **subsequently** all four Netherite armor pieces actually worn plus Netherite sword actually held. The written live evidence JSON and SHA-256 digest must be reviewed, not accepted solely from process exit or a simulator.

## Targeted post-merge engineering corrections (2026-11-03)

- Fixed an actual `bot.cjs` execution bug: the autonomous travel destination had been overwritten by the equipment destination slot. A typed-goal dispatch helper now distinguishes travel coordinates from the equipment slot and clones nested parameters.
- Replaced `auto_status` character truncation with a bounded, always-valid JSON receipt. Crucial milestones `dragonKilled`, `exitPortalObserved` and `netheriteEquipped` survive oversized intermediate state.
- Fixed loaded ore observations: buried iron/diamond ore is no longer advertised as an exposed mining target; compact inventories prioritize evidence-relevant items.
- Added conservative independently observed resource quantities for simple inventory goals. Compound tasks are not marked complete from possession of only one ingredient.
- Added main-JARVIS model access to existing finite `auto_goal` missions **only** after genuine `observe`, strict owner-intent/quantity matching and Guardian validation. Unrelated Dragon/Netherite escalation, invented travel coordinates, ungrounded build/farm positions and low-health nondefensive missions fail closed.
- Added new tests to the existing **offline-only** runner, without requiring another bot, code-generated tools or GitHub Actions.

Source-isolated checks actually executed in this development session: `verify_goal_dispatch` 29/29; equipment/ore observation checks 24/24; status receipts 22/22; six language adapter prototype-denial checks plus one normal craft; native goal matcher 13/13 after fixes. These checks are **not** a full installed TypeScript/Windows build or a live Minecraft Java victory, and should not be represented as release certification.

## Remaining limitations and release blockers
- Real Windows companion + Node + LLM + Java server end-to-end acceptance has not been performed in this chat; private test PC and live world are unavailable here.
- Unknown Minecraft world seeds, prolonged navigation/recovery, new items/recipes, advanced redstone builds, villager trading, enchanting, modded/online servers, arbitrary instructions, general-purpose skill creation and indefinite autonomy are **not certified**.
- Main JARVIS core capabilities and speech are not automatically proven end-to-end merely because Minecraft native routing exists.
- Do **not** claim a fully completed universal Minecraft AI or V1 production certification without those independent proofs.

## Milestone-action proof binding and held-sword event repair (2026-11-03)

- The autonomous controller now credits `nether_portal` only to `build_nether_portal`, `dragon_seen` only to dedicated dragon observation/search/fight actions, `end_exit_portal` only to `verify_dragon`, and `netherite_equipped` only to `equip_netherite`. `dragon_victory` and `end_return` remain separately guarded by their exact actions and existing milestone prerequisites. A verified result from an unrelated action cannot create a Dragon or equipment milestone.
- A live `netherite_equipped` event is emitted only when the bot's latest server-backed observation finds *both* four worn Netherite armor slots and a Netherite sword actually held. The independent real-Java evidence consumer additionally requires `held: true` from the post-End-return event, rather than inferring the sword from the armor-only event.
- The existing `verify_general_goal.cjs` offline regression includes deliberately mismatched successful action/receipt pairs, a fake unverified Netherite receipt, and checks that legitimate real-action receipts still work.
- **Checks performed in a source-isolated JavaScript evaluator on the repository branch:** modified source parsed; controller 4 mismatched proof cases denied and 6 legitimate proof checks accepted; the actual general-goal suite reported **226/226 assertions PASS**; the actual controller and independent recipe/world-model Dragon-first campaign reported **40/40 seeds, 37,878 assertions PASS**. This evaluator ran project CommonJS with controlled Node built-in shims and mocked game observations; it was not an installed Node/Windows or game-server run.
- GitHub Actions was not invoked; PC Work JARVIS was not modified.
- **Release status unchanged: NOT ACCEPTED.** Real Windows companion/GUARDIAN/LLM-to-game interaction, one-instruction survival from an empty inventory, observed Dragon death, End return, and subsequent equipped Netherite gear still require a genuine unassisted Minecraft Java server run and review of durable live evidence.

## 2026-11-06 native PlayerEngine craft-method and task-bound status proof

- Native `craft` no longer treats generic item acquisition as a successful craft. It accepts only the pinned AltoClef `CraftInInventoryTask` / `CraftInTableTask` types and wraps their actual `onResourceTick` calls to count output inserted into the companion's own inventory. Mining, pickup, smelting, pre-existing inventory or unrelated storage changes cannot create the craft witness.
- The Java status snapshot now resolves the exact requested run UUID with `tasks.get(taskId)` rather than selecting an arbitrary matching task by `coreTaskId` from a HashMap. This binds craft/trade/enchant/sequence receipts to the run being polled.
- Core requires matching same-run mission status, exact item and target count, task-witness output count, and fresh inventory delta before accepting craft completion.
- Local source-isolated contract: 28/28 checks passed; strict TypeScript check passed for the receipt helper. The full repository typecheck, Fabric/Gradle build, Windows PlayerEngine IPC test and live Minecraft crafting were **not run**. No GitHub Actions were used.

