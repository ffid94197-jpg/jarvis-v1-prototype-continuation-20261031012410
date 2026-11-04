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

## Prototype build delta — natural survival crafting and bounded construction (2026-11-04)

The following implementation work is now present on the isolated prototype acceptance branch:

- **Coal as a real survival resource:** natural-language coal/coal-ore requests normalize to the coal inventory target. The Mineflayer executor selects only exposed coal ore with a safe adjacent stance, equips a real pickaxe, mines it, and requires an observed inventory increase. After repeated failures it scouts a fresh safe waypoint before retrying; a survey never claims coal by itself.
- **Expanded vanilla recipes:** the general crafting registry now includes wooden/stone/iron/diamond pickaxes, axes, shovels, swords and hoes; iron and diamond armor pieces; shears, bucket, flint-and-steel, oak door, trapdoor, fence, fence gate and sign, in addition to the previous chest, furnace, ladder, bread, shield and torch recipes. Missing coal, flint, diamond, iron and cobblestone ingredients delegate to the existing bounded survival resource planner; unsupported ingredients still fail closed.
- **Natural-language defaults:** requests such as "gather coal", "get me some logs", "make me a stone pickaxe", and "craft an iron helmet" no longer require a numeric quantity or internal command syntax. The safe default quantity is one.
- **Observed language context:** the interpreter now receives a sanitized, valid-JSON snapshot (maximum 4,000 characters) containing the current game mode, dimension, position, health/hunger, owner distance, bounded inventory, equipment slots, nearby hostiles, workstations, portal observations and active mission summary. This is read-only context; Guardian and the existing typed command validator still authorize every action.
- **Simple wall construction:** "build a wall" maps to a bounded 4-block-by-2-block wall. The runtime derives its anchor from the live player position and facing, selects only an allowed block already owned, requires all eight blocks before starting, and builds bottom-up. Each cell must be loaded, empty, supported and nonhazardous; an existing nonmatching block is never overwritten. The underlying build goal now supports up to 8 blocks long and 4 blocks high.
- **Flat platform construction:** "build a platform" maps to a grounded 3×3 platform by default, with bounded length/width up to 8×8. The runtime expands it into validated rows aligned to the observed player facing, checks the complete material budget and local build radius before starting, and only places blocks over loaded safe support. Unsupported gaps, water and hazards block the build; it is not treated as a bridge.

Offline source-isolated regressions added/updated for these changes: general recipes and equipment, coal resource planning, coal mining stance selection, natural-language intent, bounded language context, layered construction, and goal dispatch. These checks do not prove real Ollama interpretation or real Java server execution.

**Still not built/certified:** complete houses/shelters, bridges over unsupported gaps, redstone machinery, villager trading, enchanting, arbitrary schematic construction, modded-server support, and unrestricted open-ended gameplay. These remain explicit capability gaps rather than claims of universal Minecraft control. The Dragon/End-return/Netherite live acceptance gate is unchanged and still requires a genuine server-backed run.


## Follow-up build regression update (2026-11-04)

- Added bounded flat-platform construction and natural-language routing alongside simple wall construction. Platform rows are executed as a validated sequence of grounded build stages; no floating blocks or bridge claims are allowed.
- Current source-isolated regressions on this branch: general recipes 432/432; resource goals 35/35; mining recovery 9/9; language 40/40; language context 14/14; structure 28/28; goal dispatch 32/32; progression extended PASS; late-game planner 200,078/200,078; multi-step sequence 32/32. These are offline/source-isolated results, not real Windows, Ollama, or Minecraft Java acceptance.
- Full Minecraft acceptance remains NOT PASSED. The live Ollama-to-Java and Ender Dragon/Netherite gates still require a genuine server-backed run.
