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
