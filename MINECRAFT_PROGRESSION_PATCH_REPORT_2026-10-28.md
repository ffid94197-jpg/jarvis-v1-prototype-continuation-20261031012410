# Minecraft progression patch — 2026-10-28

## Implemented in this delta

- Added `stone_age` goal and an explicitly non-completing `dragon_run` experimental goal.
- Extended live-inventory observations to cobblestone and stone tools.
- Introduced state-dependent planning for cobblestone gathering, workstation, stone pickaxe and sword.
- Added actual Mineflayer stone dig / pickup verification and stone crafting implementations. These actions need a **live Minecraft server** for acceptance.
- Added offline verification file `windows-companion/minecraft-bot/verify_progression.cjs`.

## Verification performed

- `node verify_progression.cjs` — PASS, 10 assertions.
- `node verify_autonomous_gameplay.cjs` — PASS, 151344 assertions, synthetic only.
- `node --check bot.cjs` — PASS.

## NOT COMPLETE / blocking work

This is not autonomous game completion. **Iron gear, furnace/smelting, food acquisition/farming, shelter, hostile-combat mastery, lava/water portal building, Nether navigation, blaze rods, Ender pearls, Eyes of Ender, stronghold navigation, portal activation, End entry, End-crystal management, dragon fight, death/recovery, game version integration, and end-to-end live certification** remain unimplemented or unverified.

The `dragon_run` goal intentionally performs only implemented early-game progression and then returns `blocked`, without pretending to have finished Minecraft. Its 1200-second maximum is insufficient for a real complete run; a future implementation needs checkpointed sessions, persistence, and owner-authorized long-running execution.

Test on an isolated Minecraft Java LAN world. Back up the world and preserve your existing project before replacing code. Existing historical SHA256 manifest documents no longer describe the changed files; use current checksums for this patch, and regenerate baseline manifests only after final acceptance.
