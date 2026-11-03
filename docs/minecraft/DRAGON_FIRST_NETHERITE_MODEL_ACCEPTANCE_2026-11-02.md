# Minecraft Dragon-first → post-game Netherite simulation acceptance

Date: 2026-11-02. Scope: JARVIS **Prototype** only; no change to the primary PC Work JARVIS.

## User-ordered success contract
1. Start from a simulated Java survival player with **zero inventory items**, health and hunger.
2. Use the real JARVIS `autonomy_engine.cjs` controller and `late_game.cjs` planner, not scripted actions. The simulation owns the game-world state separately from the planner.
3. Mine/gather, craft wooden/stone/iron and full diamond equipment. Construct/ignite a Nether portal, collect Blaze rods and Ender pearls, craft Eyes, find and activate a 12-frame stronghold End portal.
4. Enter the End with real inventory, equip four diamond armor slots, destroy healing crystals, bring the modeled Dragon's **200 HP** to 0 and emit a death event. Require Dragon previously seen and an observed generated End exit portal; no mere entity disappearance/receipt passes.
5. Exit the End portal and return to Overworld. **Only after verified Dragon victory**, mine Ancient Debris, obtain gold and a bastion Netherite upgrade template, smelt 20 scraps, craft five Netherite ingots, duplicate templates using seven diamonds and netherrack per extra template, smith diamond armor/sword, and equip all four actual armor slots plus sword.
6. Fail if victory or armor is missing, out of order, unequipped, resource costs are unmet, a step is blocked, or the mission's bounded steps expire. Recorded proof must originate from the appropriate action.

## Verified CI result
- GitHub Actions: https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/actions/runs/41398112885
- Linux: **1000/1000 modeled campaigns PASS**; 293,390 modeled steps; longest 304 steps.
- Windows: **1000/1000 modeled campaigns PASS**; 293,390 modeled steps; longest 304 steps.
- Both platforms also passed `PROGRESSION EXTENDED`, `LATE_GAME_PLANNER 200044/200044` assertions (100,000 random snapshots, **not** 100,000 playthroughs), and `LATE_SKILLS_MOCK 16/16`.
- Fix loop included: first run failed due unregistered goal; next full campaign reached Dragon victory but blocked on Nether food; modeled Nether survival food and live Hoglin feeding were fixed. Subsequent CI exposed an inconsistency: live combat required Netherite before the Dragon, so real skill now equips/verifies diamond armor and accepts diamond-tier sword. An unrelated `dragon_death` proof is no longer enough to set victory.
- This isolated PR must remain a **draft**; no live release or merge is authorized merely by model simulation.

## Not equivalent to Minecraft Java
This is a **separate deterministic survival-rule simulator**, not a reimplementation of Mojang's server, Minecraft chunk generation, Mineflayer's movement/pathfinding, GUI windows, ore exploration, multiplayer packets, hostile combat AI, hunger saturation, item durability, bastion loot probabilities, or Dragon damage physics. Its resource encounters and travel are deliberately simplified. It tests **planner progression, constraints, legal recipes, proof order and termination**. Simulated victories are **not** verified Minecraft achievements.

**Live acceptance remains OPEN** until an independently observed vanilla Minecraft Java survival playthrough, from empty inventory through a real Ender Dragon kill and then full Netherite armor equipped, succeeds without commands/creative mode, human interventions, or fabricated proofs. The optional Mine AI MCP bridge still lacks a published `smith_item` extension and several late-stage tool mappings. Its success cannot be inferred from the model. More real-game integration and protocol testing are required.
