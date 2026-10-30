# JARVIS Minecraft Java LAN Friend — 2026-10-28

This is a **source-level experimental feature**, not proof of a successful Minecraft LAN session.

## What changed

The separate Mineflayer `JarvisBuddy` client now supports a short companion gameplay loop: joining a locally hosted compatible Java LAN world, following the named owner, coming to the last seen owner position, standing by, looking at the owner, guarded combat against a small set of nearby hostile mobs (never against players), bounded gathering of up to two log blocks, chat, and reporting observed position/health/food/inventory.

- From NEXUS, first ask **Join my Minecraft LAN world as JarvisBuddy**. Wait for a real `spawn` receipt.
- Then try **Have JarvisBuddy follow me** or **Ask JarvisBuddy to collect wood near us and report the result**.
- Or use Minecraft's own chat as the named owner: `jarvis help`, `jarvis follow`, `jarvis come`, `jarvis stay`, `jarvis guard`, `jarvis gather`, `jarvis status`, `jarvis inventory`, `jarvis say Hello`, `jarvis stop`.
- `come` and `collect_wood` are asynchronous tasks: a STARTED acknowledgement **does not mean the action completed**. Ask for `status` afterward to inspect lastAction.
- `guard` only targets nearby common hostile mobs (zombie/skeleton/spider/husk/drowned) for 60 seconds; it does not attack other players.
- Bot navigation depends on world chunks, Minecraft version, terrain, and Mineflayer support. The bot cannot yet invent shelter/build bases, craft sophisticated tools, or perform open-ended survival.

## Setup on Windows

Use your existing isolated JARVIS full-desktop folder or extract the new complete source to a fresh sibling folder. Preserve private `.env` and SQLite databases. In `windows-companion\minecraft-bot`, run `npm install` to install Mineflayer + Pathfinder dependencies. Ensure the launcher actually starts **Minecraft Java Edition**, choose an existing local world, **Open to LAN**, and note the port.

Set in the active JARVIS `.env` (no credentials in chat):

```dotenv
JARVIS_MINECRAFT_LAN_ENABLED="1"
JARVIS_MINECRAFT_LAN_PORT="<actual in-game port>"
JARVIS_MINECRAFT_PLAYER="<your exact Java player name>"
```

JARVIS and Minecraft must run on the same Windows host for the configured `127.0.0.1` bot connection. The test LAN world must permit an offline-mode extra player. Multiplayer authentication, mod incompatibilities, server whitelist, and version mismatch can prevent joining. If Minecraft is running on another computer, this package does not connect to it without a separately reviewed network policy.

Restart `bun run dev:windows` after changing `.env`. There is no claim of verification until the owner actually sees `JarvisBuddy` join and can observe movement in-game. Use CTRL+SHIFT+F12 to stop desktop injection and JARVIS STOP to cancel ongoing JARVIS tasks; for bot activity use `jarvis stop` or the companion stop tool.

## Optional: control the human Minecraft window

For short focused gameplay inputs to **your own** Minecraft window, configure `JARVIS_MINECRAFT_GAME_INPUT_ENABLED="1"` alongside `JARVIS_EXPERIMENTAL_DESKTOP_CONTROL="1"`. JARVIS can then request `windows_minecraft_input` with `action` `forward`, `back`, `left`, `right`, `jump`, `sneak`, `attack`, `use`, or `inventory` and `durationMs` from 100 to 1500. The foreground window must actually be titled Minecraft (not TLauncher or a web page). Each input is released even on errors or the Ctrl+Shift+F12 emergency stop. Input dispatch is not proof of an actual in-game effect; verify visually. This controls your own game client, not the independent LAN friend.

## Important limitation

The bot is a **separate network player**, not an AI simultaneously logged into the owner's normal game client. Its gathering/defense rules are bounded automation, not a generally intelligent Minecraft player. Additional autonomous Minecraft gameplay requires real world interaction tests and richer crafting, mining, building, survival, long-term state, and hazard navigation.
