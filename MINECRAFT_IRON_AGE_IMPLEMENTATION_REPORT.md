# Minecraft agent patch — 2026-10-28

## Implemented in this patch
- Permits private IPv4 LAN hosts by `JARVIS_MINECRAFT_LAN_HOST` (10/8, 172.16/12, 192.168/16, loopback). Keeps previous local default. `JARVIS_MINECRAFT_LAN_PORT` and `JARVIS_MINECRAFT_PLAYER` remain mandatory.
- New `iron_age` goal and extended `dragon_run` planner past stone equipment.
- Plans raw iron acquisition, crafting/placing a furnace, smelting iron using coal or planks, and crafting an iron pickaxe.
- Implements Mineflayer action paths with checks of inventory, workstation and block state. Actions remain bounded and cancellable.
- No victory is reported: `dragon_run` explicitly blocks at the unsupported post-iron stages.

## Tests actually run
- `node verify_progression.cjs`: PASS
- `node verify_general_primitives.cjs`: PASS 16 cases
- `node verify_autonomous_gameplay.cjs`: PASS 151345 assertions including 60000 world states
- `node verify_autonomy_session.cjs`: PASS 18 mock-session cases
- `node --check bot.cjs`, `node --check autonomy_engine.cjs`, `node --check friend_protocol.cjs`: PASS

## UNVERIFIED and missing
- No actual LAN Minecraft connection was established; no live in-game mining, smelting or player controls were tested.
- Iron skill code is a candidate, not production proven: navigation to a visible ore block may fail in caves, safe excavation and food procurement are absent, and automated crafting/placement/smelting may need Mineflayer-version corrections. Furnace fuel and raw-iron timing need extended live verification.
- Diamond progression, Nether portal, Nether structures, netherite upgrade, Eye of Ender, stronghold search, End portal activation, crystal destruction, and Ender Dragon combat are not implemented.
- User's requested autonomous empty-inventory to netherite+dragon end-to-end run: NOT COMPLETED.

## How to launch against private LAN Java server
```powershell
$env:JARVIS_MINECRAFT_LAN_HOST = '192.168.1.10' # substitute LAN server IPv4
$env:JARVIS_MINECRAFT_LAN_PORT = '25565' # substitute actual LAN port
$env:JARVIS_MINECRAFT_PLAYER = 'YourMinecraftName'
cd windows-companion/minecraft-bot
npm install
node bot.cjs
```

Do not expose the LAN server to the public internet without authentication and protection. Minecraft version / Java server compatibility is unverified.
