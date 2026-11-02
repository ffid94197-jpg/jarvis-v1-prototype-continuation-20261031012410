# JARVIS V1 — Minecraft Java LAN Autonomous Gameplay Candidate

## Actual scope

This edition integrates an independent Mineflayer bot (`JarvisBuddy`) with a bounded, local observe → decide → act → verify loop. It is an **experimental autonomous-survival foundation**, **not** a fully autonomous, general-purpose Minecraft player. The existing LAYA/Guardian/Core and companion remain in place. The bot runs alongside your character as another LAN player, not through your character's input.

### Supported autonomous goals

| Goal | Observed state used | Implemented actions | Completion criterion |
|---|---|---|---|
| `wood` | nearby logs, inventory, owner proximity | navigate, dig and attempt item pickup | 4 logs actually in inventory |
| `tools` | inventories, crafting recipes, workstation | gather timber, make planks/sticks/table, place table, craft wooden pickaxe | pickaxe actually in inventory |
| `survive` | health, hunger, nearby hostiles, owner position, timber | retreat from mobs, eat available food, gather wood, craft planks, scout near owner | continuous until bounded deadline / stop (no claim of full survival) |
| `explore` | owner position and distance, nearby hostiles | visit bounded nearby waypoints, return toward owner | continuous until deadline / stop |
| `follow` | visible owner and distance | navigation near owner | continuous until deadline / stop |
| `guard` | enemies near bot, owner position, health | defensively attack nearby hostile NPCs, retreat when critically wounded | continuous until deadline / stop |

When a task fails repeatedly, a death occurs, the player disconnects, or the time/step limit expires, autonomy stops or waits and logs a reason. Players are not targeted by autonomous combat. The bot does not mine arbitrary property, build arbitrary buildings, solve unknown crafting dependencies, eat unowned food, play multiplayer public servers, or defeat the Ender Dragon. Those require further development and real-world acceptance.

### Install and run on your dedicated Windows test PC

1. Extract source into a new folder under `D:\glm 5.3\GPT6_TEST`, preserving the previous build and private `.env` (do not touch `D:\jarvis_pc_work`).
2. In `windows-companion\minecraft-bot`, run `npm install` to install Mineflayer and Pathfinder. This is a separate dependency directory.
3. Open Minecraft Java world → **Open to LAN** and read its assigned port. In `.env`, configure `JARVIS_MINECRAFT_LAN_ENABLED="1"`, `JARVIS_MINECRAFT_LAN_PORT="<LAN port>"` and `JARVIS_MINECRAFT_PLAYER="<your actual in-game username>"`. Set `JARVIS_MINECRAFT_LAN_HOST="127.0.0.1"` for Minecraft running on the same PC or an RFC1918 private IPv4 address (for example `192.168.1.10`) for a trusted LAN host. The Windows companion forwards this host to the bot. It uses an offline-username protocol; online-mode servers, Microsoft-authenticated accounts, modded worlds and incompatible versions may require separate integration.
4. Start the JARVIS Windows companion via `bun run dev:windows` after normal setup.
5. To enable JARVIS-native natural-language gameplay planning, set `JARVIS_MINECRAFT_AI_PLANNER_ENABLED="1"` in the same local `.env` file. This uses the normal LAYA-selected JARVIS model through the existing Core/Guardian path; it does not start a second Mindcraft agent or require a separate Ollama service. Leave it unset/off to keep the existing deterministic goal mode only.
6. In NEXUS, first join the already-open LAN world as JarvisBuddy. Then use ordinary language, for example: "In Minecraft, follow me and protect me", "Mine diamonds and make a sword", or "Build a small shelter from the blocks available." JARVIS will observe first, plan one bounded action at a time, and report unsupported requests or missing world evidence. The action set remains bounded; natural language does not mean unlimited gameplay autonomy.

5. In NEXUS: "Join my Minecraft LAN world as JarvisBuddy. After actual spawn, use minecraft_companion_command auto_goal with goal tools, durationSeconds 300. Poll auto_status, observe, and report what was verified."
6. For an experimental six-hour late-game mission, owner chat: `jarvis auto netherite_dragon_run` or the Guardian command `minecraft_companion_command` with `{"command":"auto_goal","goal":"netherite_dragon_run","durationSeconds":21600}`. This is a code-path attempt, not a guaranteed successful playthrough. For simpler goals: `jarvis auto tools`, `jarvis auto wood`, `jarvis auto survive`, `jarvis auto explore`, `jarvis auto follow`, `jarvis auto guard`; query progress using `jarvis status` or JARVIS `auto_status`; stop with `jarvis pause` or `jarvis stop` (stay).

### Verification requirements (do not mark full autonomy complete prematurely)

- [ ] Actual LAN spawn observed (not just bot process launched)
- [ ] Owner chat authorized and non-owner ignored
- [ ] Four logs physically picked up and seen in inventory
- [ ] Planks, sticks, crafting table, wooden pickaxe crafted with actual recipes and verified inventory
- [ ] Owner-follow pathfinding in real terrain for 15+ minutes; bridge/tunnel/doors and water cases
- [ ] Hunger eating and low-health retreat observed
- [ ] No attacks on players, no unsafe exploration, no duplicate actions after cancel/reconnect
- [ ] Real Minecraft version/loader compatibility tested
- [ ] Extended unattended gameplay with survival, farming, building, mining, and recovery verified; NOT COVERED by this edition

### Repeat offline tests

From the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN_MINECRAFT_AUTONOMY_STRESS.ps1 -Rounds 12
```

Mock and synthetic tests check code execution only, **not** a running Minecraft world. `auto_goal` returns STARTED; `auto_status` reports completion/blocking and evidence. Live scene and gameplay acceptance remain outstanding.

### Technical foundation

- Mineflayer bot API: https://github.com/PrismarineJS/mineflayer
- Pathfinder: https://github.com/PrismarineJS/mineflayer-pathfinder
- Native survival planner: `windows-companion/minecraft-bot/autonomy_engine.cjs`
- Bot execution: `windows-companion/minecraft-bot/bot.cjs`
- Authorized tool: `minecraft_companion_command` through Guardian / Windows policy / Python companion

## Integrated late-game candidate (October 28)

**Experimental, not certified.** The `netherite_dragon_run` and `dragon_run` planning paths now extend beyond diamond equipment and request real actions to mine obsidian, build/enter a Nether portal, find bastion templates, branch-mine ancient debris, collect gold and blaze rods/pearls, duplicate templates, smith Netherite equipment, equip armor, craft/locate End eyes, activate the End portal, shoot End crystals and fight the Ender Dragon. State transitions require observed world/inventory/UI events; dragon completion requires a server death event and an End exit portal. Long-run sessions can attempt bounded respawn recovery (three retries). The JavaScript bot and both Python/TypeScript Gateway policies accept the extended command set.

The new skill executors **are prototypes, not fully reliable players**. Nether traversal, lava avoidance, cave logistics, fortress/bastion search, stronghold descent, portal building, proper bow geometry and boss combat are not live-validated. A chance of death, blocked progress, or unreachable resources remains. Offline state fixtures are not gameplay wins. Universal redstone/creative building, every recipe, all bosses, multiplayer authentication and arbitrary mod content are outside this verified scope.

Run `RUN_MINECRAFT_AUTONOMY_STRESS.ps1 -Rounds 1` for test suite, then perform real LAN acceptance using a compatible vanilla Minecraft Java world. Do not claim complete until JARVIS proves a zero-to-Netherite-and-dragon sequence on a world it actually joined, with server-side evidence.
