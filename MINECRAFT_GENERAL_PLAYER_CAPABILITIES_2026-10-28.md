# Minecraft General Player Capability Expansion — 2026-10-28

## Actual delta
Preserved prior source and stone-age autonomy. Added validated owner/Guardian-command player primitives to the Mineflayer companion: inspect_block, navigate, dig_block, equip_item, craft_item, place_block, interact_block, interact_entity (non-player), use_item. Added bounded parameter contracts and 16 offline argument validation cases. Explicit vec3 package dependency. Existing autonomous planner still knows only fixed goals and is **not** a general autonomous Minecraft expert.

## Verification performed
- `node --check bot.cjs`: PASS
- `node verify_general_primitives.cjs`: 16/16 PASS (offline contract)
- `node verify_progression.cjs`: 10/10 PASS (offline planner)
- `node verify_autonomous_gameplay.cjs`: 151344/151344 PASS (pure simulated states)
- `node verify_autonomy_session.cjs`: 18/18 PASS (mock)
- `node verify_friend_offline.cjs`: 34/34 PASS (mock)
No live Minecraft server or game runtime was available. New primitives were **not live-tested**. Not all Mineflayer API/server-version edge cases are validated.

## Strict acceptance — not yet achieved
General player skill coverage across Minecraft versions (locomotion, jump/swim/boats/elytra, mining/enchanting/equipment, combat/projectiles/shields, crafting/smelting/brewing, farming/breeding/trading, building/redstone, inventory/chests, exploration/maps/biomes/structures, Nether/End/bosses, multiplayer cooperation, death/recovery, GUI interactions) requires independent tested action implementations, integrated bounded strategy, world model, robust recovery and real-world objective-completion evidence.
Ender Dragon from a clean survival world: NOT IMPLEMENTED / NOT VERIFIED.
All Minecraft player abilities: NOT IMPLEMENTED / NOT VERIFIED.
The agent should never claim these as completed until live end-to-end demonstrations pass.

## Next exact work
Add adaptive world-state task graph and skill registry with recipe/version awareness; implement iron/food/smelting first, then Nether blaze and pearl procurement, Eye of Ender stronghold search, End battle logic; add interactive simulation and real LAN test harness with structured trace replay. Keep each successful proof, rerun only relevant checks; preserve existing dirty-source and security boundaries.

## 2026-11-06 current source status — supersedes the historical snapshot above

The October 28 statement that the planner only knew fixed goals and that Dragon progression was not implemented is historical. The current prototype source has since grown substantially. The following are **source-implemented on the current development branch, not live-certified**:

- Owner/Guardian-bound Minecraft actions and a bounded native PlayerEngine sequence (1-8 stages): gather, craft, smelt, equip, travel, tool/stone-age/iron-age presets, bounded block building, wheat/carrot/potato farming, shelter/volume construction and observed hostile defeat.
- Survival resource progression, equipment, Nether/End/Dragon and Netherite mission logic, plus villager trade, enchanting and inventory transfer paths.
- Context-aware ordinary-language routing when both the Minecraft LAN companion and AI planner are explicitly enabled; exact non-game browser/workspace/media language is excluded.
- Shared safe catalogs across Core, Guardian, PlayerEngine and companion: 33 gather resources and 12 construction materials. Native stages advance only after task-specific physical postconditions.

### Remaining JARVIS action domains not yet exposed as owner-authorized typed goals

- Fishing and sleep-through-night missions.
- Animal breeding/taming and husbandry.
- Brewing and potion preparation/use.
- Boat/elytra/vehicle navigation.
- Advanced redstone circuits and arbitrary blueprint/structure construction beyond bounded volume/shelter/line primitives.
- Map/biome/structure discovery beyond the current exploration/stronghold/endgame paths.
- General multiplayer cooperation and arbitrary in-game GUI workflows.
- Modded-server/version-generalized support.

Some upstream projects contain code for individual tasks, but that does not mean JARVIS has integrated, authorized or verified those capabilities. They remain build gaps until a typed Core/Guardian route and physical receipt exist.

### Acceptance remains separate from implementation

- No full Windows TypeScript/Node suite, PlayerEngine IPC session, Java/Fabric Gradle build or live Minecraft campaign was executed in this development session.
- The clean-survival Netherite armor + Ender Dragon objective remains **NOT LIVE-ACCEPTED** until an actual Java server run independently proves the required in-game state.
- Do not interpret source-isolated contract counts or simulations as real gameplay acceptance.
- PR #92 contains the current implementation changes; main remains unchanged until review/merge.

