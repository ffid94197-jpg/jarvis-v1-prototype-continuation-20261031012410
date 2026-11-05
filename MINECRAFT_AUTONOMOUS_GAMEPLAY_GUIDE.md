# JARVIS Prototype — Minecraft Java autonomous gameplay backends

## Preferred PlayerEngine integration

The prototype now includes a pinned source integration for **AI Companion / PlayerEngine** (Fabric 1.21.11). In this mode, the AI Companion entity is JARVIS's single in-world body. JARVIS Core remains the only natural-language planner and Guardian authority; the upstream PlayerEngine / AltoClef / Automatone task runtime performs navigation, mining, gathering, crafting, combat, farming and building.

The upstream `gamer` task is mapped only from an explicit owner-authorized Dragon goal. JARVIS then asks PlayerEngine's native item/smithing catalogue for the Netherite armor, sword and pickaxe. Every result still requires JARVIS's independent server-observed inventory, equipment and End-fight evidence. A task receipt or a completed command chain is not acceptance proof.

The AI Companion source is pinned in `integrations/ai-companion`; its memory dependency is pinned in `integrations/ai-companion-memory`. Build the JARVIS overlay with `integrations/build-ai-companion.ps1`. Install the resulting mod into a trusted Fabric 1.21.11 instance with the dependencies listed in `integrations/AI_COMPANION_PIN.md`. The first server start creates `config/jarvis-bridge.json`; set `JARVIS_MINECRAFT_AI_COMPANION_CONFIG` in the JARVIS environment to that exact file.

Configure:
1. `JARVIS_MINECRAFT_ENGINE="ai-companion"`
2. `JARVIS_MINECRAFT_LAN_ENABLED="1"`
3. `JARVIS_MINECRAFT_PLAYER="YourHumanJavaName"` (the actual owner, not JarvisBuddy)
4. `JARVIS_MINECRAFT_AI_COMPANION_CONFIG="C:\\Path\\To\\Instance\\config\\jarvis-bridge.json"`
5. If the owner has multiple companion entities, set `JARVIS_MINECRAFT_AI_COMPANION_NAME` to select exactly one.

No Mineflayer player is launched in this mode. The Java bridge binds only to 127.0.0.1, requires the generated bearer token, auto-spawns through the upstream owner-scoped `/companion spawn` command when possible, and disables the mod's independent chat-brain loop while JARVIS bridge mode is enabled. The bridge accepts only typed allowlisted tasks; unsupported direct actions are rejected rather than simulated.

## Existing Mineflayer backend

The original Mineflayer implementation remains available as the default/legacy backend. It connects as an independent LAN player (`JarvisBuddy`) and uses its existing bounded observe → decide → act → verify loop. It is an experimental autonomous-survival foundation, not a claim of full general-purpose gameplay.

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
3. Open Minecraft Java world → **Open to LAN** and read its assigned port. In `.env`, configure `JARVIS_MINECRAFT_LAN_ENABLED="1"`, `JARVIS_MINECRAFT_LAN_PORT="<LAN port>"` and `JARVIS_MINECRAFT_PLAYER="<your actual in-game username>"`. Set `JARVIS_MINECRAFT_LAN_HOST="127.0.0.1"` (or `localhost`) for Minecraft running on the same Windows PC. The managed Windows JARVIS join policy currently allows **loopback only**; do not use remote LAN addresses for this integration even though the underlying Mineflayer library supports them. It uses an offline-username protocol; online-mode servers, Microsoft-authenticated accounts, modded worlds and incompatible versions may require separate integration.
4. Start the JARVIS Windows companion via `bun run dev:windows` after normal setup.
5. To enable JARVIS-native natural-language gameplay planning, set `JARVIS_MINECRAFT_AI_PLANNER_ENABLED="1"` in the same local `.env` file. This uses the normal LAYA-selected JARVIS model through the existing Core/Guardian path; it does not start a second Mindcraft agent or require a separate Ollama service. Leave it unset/off to keep the existing deterministic goal mode only.
6. In NEXUS, first join the already-open LAN world as JarvisBuddy. Then use ordinary language, for example: "In Minecraft, follow me and protect me", "In Minecraft, mine diamonds and make a sword", or "In Minecraft, build a small shelter from the blocks available." JARVIS observes first and can either execute one bounded, Guardian-approved action at a time or launch a **single existing, owner-matched `auto_goal`** such as an explicitly requested resource count, nearby construction, wheat field or Dragon mission. It then monitors `auto_status` and real observations instead of assuming STARTED means complete. Low health, invented coordinates, mismatched quantities, or unsupported goals are rejected. The action set remains bounded; natural language does not mean unlimited gameplay autonomy.
7. For an experimental six-hour late-game mission, owner chat: `jarvis auto netherite_dragon_run` or the Guardian command `minecraft_companion_command` with `{"command":"auto_goal","goal":"netherite_dragon_run","durationSeconds":21600}`. This is a code-path attempt, not a guaranteed successful playthrough. For simpler goals: `jarvis auto tools`, `jarvis auto wood`, `jarvis auto survive`, `jarvis auto explore`, `jarvis auto follow`, `jarvis auto guard`; query progress using `jarvis status` or JARVIS `auto_status`; stop with `jarvis pause` or `jarvis stop` (stay).

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
