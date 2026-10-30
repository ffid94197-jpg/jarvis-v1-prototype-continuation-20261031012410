# Minecraft complete-autonomy acceptance status — 2026-10-28

## Non-negotiable outcome
Connect through actual Minecraft Java LAN, start in survival with empty inventory, obtain full netherite armor and weapon without human commands, activate End portal, and defeat Ender Dragon. Also broader human-like gameplay requested. **NOT ACCEPTED / NOT COMPLETE.**

## Current verified changes
- Iron and diamond ore requests can now fall back to a bounded, new-terrain survey instead of immediately blocking after missing nearby ore.
- After successful survey, mining is retried. Cancellation and pathfinding timeouts apply.
- Mock session and deterministic tests pass, but are NOT live Minecraft gameplay.

## Concrete remaining engineering blockers
- Actual server LAN connection/version compatibility has not been exercised.
- Dynamic spelunking/mineshaft/vertical descent, safe bridging, lighting, food procurement, resource-pickup and robust death recovery.
- Reliable iron & diamond full-progression and inventory accounting in real game.
- Obsidian collection, water/lava handling, portal construction, ignition, dimension travel, Nether pathfinding.
- Ancient debris mining and/or bastion template discovery, gold collection, smelting, smithing-table netherite upgrades.
- Blaze rod combat and Eyes of Ender with stronghold triangulation/portal activation.
- End crystal clearing, dragon attack and damage verification, death/respawn recovery, victory from server events.
- Complete real LAN playthrough of objective with server logs/video evidence, repeated over seeds/versions.

## Test scope
`node verify_survey_recovery.cjs`, `node verify_progression.cjs`, `node verify_general_primitives.cjs`, `node verify_autonomy_session.cjs`, `node verify_autonomous_gameplay.cjs`, `node verify_friend_offline.cjs` (offline/mock only).

No dragon kill is claimed. Do not interpret an inventory simulation as verified full Minecraft autonomy.
