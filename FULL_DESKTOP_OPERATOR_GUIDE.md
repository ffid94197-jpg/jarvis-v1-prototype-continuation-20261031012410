# JARVIS — Experimental Full Desktop Control, Windows

## What this edition actually adds

This is an **experimental full-desktop testing build**, based on the Windows App Control edition from 27 October 2026. It is **not a certified complete JARVIS V1 release**.

1. Open Windows Settings and built-in/approved applications as before.
2. Discover additional installed applications from the **local Windows Start Menu** and launch them by the ID returned by discovery. This is no longer limited to the original five app names. Some apps without Start Menu shortcuts will still require manual setup.
3. List visible windows, focus a selected window using an expiring token, get primary-screen dimensions and current foreground title.
4. Move/click/double/right-click the real mouse, type text, send limited keyboard combinations, and scroll. These controls affect the actual foreground Windows session; they are not browser-only.
5. Continue using the browser search/inspect/navigate tools, continuous local screen viewer, and opt-in Gemini multi-frame visual observation.
6. After joining an **already open** compatible Minecraft Java LAN world, control an independent Mineflayer `JarvisBuddy` bot: follow, stop, look at the user, jump, move short distances, and report status.
7. Up to 48 bounded tool steps per run when the experimental option is enabled and an appropriately sized step budget is supplied; the runtime still pauses durably rather than looping forever.

## Deliberate operating boundaries

The user explicitly authorizes broad control of their **dedicated test laptop**, but these protections remain in place:

- `bun run dev:windows` binds NEXUS and the companion to **127.0.0.1 only**. No remote access, no tunnel and no LAN exposure.
- The operator must explicitly set `JARVIS_EXPERIMENTAL_DESKTOP_CONTROL="1"`. This is OFF by default.
- Each tool still goes through Guardian, its durable effect admission and a recorded receipt. We have **not** removed the authority gate, authenticated loopback companion IPC, or task cancellation.
- **Emergency stop: Ctrl + Shift + F12**, simultaneously, latches injected desktop input OFF until restarting the JARVIS Windows companion. The STOP button also requests task cancellation. Neither control can undo an action already completed.
- Input injection is limited to the normal user’s interactive desktop. Windows UAC/secure desktops, anti-cheat protected games and inaccessible applications may refuse it. No shell or arbitrary code execution tool has been added.
- Browser website text is untrusted. On-screen prompts, password boxes and purchases must not be followed just because a webpage asks for them. Mouse and keyboard actions are not automatically reversible. Screen content is **not** sent to Gemini unless `JARVIS_SCREEN_VISION_TO_CLOUD=1` is explicitly configured.
- Minecraft uses **an independent offline-LAN compatible bot**; it cannot claim to be your signed-in Minecraft account, independently create worlds, use every mod or play survival autonomously. These are larger, unverified requirements.
- Multi-monitor negative coordinates, protected/special input paths and flawless arbitrary-app interaction are not established.

## Install into a separate folder (full source ZIP)

Use the exact extracted project folder. Preserve your previous installation and database.

```powershell
cd "D:\glm 5.3\GPT6_TEST\JARVIS_V1_GPT6_Experimental_FullDesktop_2026-10-27"
bun install --frozen-lockfile
bunx prisma generate
```

Create a new private `.env` from your **already working latest Windows App Control** `.env` (copy locally; never paste keys into a chat). Keep your own working Gemini API key, public origin, and installed companion configuration. Use an *independent* SQLite database file for the new build and run `bunx prisma db push` only on that fresh test database.

Add/confirm the following entries (keep your already-working values for the provider and database):

```dotenv
JARVIS_PUBLIC_ORIGIN="http://127.0.0.1:3000"
JARVIS_MODEL_BACKEND="openai-compatible"
JARVIS_COMPAT_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
JARVIS_COMPAT_MODEL="gemini-3.5-flash-lite"
# JARVIS_COMPAT_API_KEY=...  (your private working key)
JARVIS_BROWSER_AGENT_ENABLED="1"
JARVIS_WINDOWS_UI_CONTROL_ENABLED="1"
JARVIS_EXPERIMENTAL_DESKTOP_CONTROL="1"
JARVIS_SCREEN_WATCH_ENABLED="1"
# Only set if you consent to transmitting short frame sequences to Gemini:
# JARVIS_SCREEN_VISION_TO_CLOUD="1"
# Optional Minecraft LAN companion:
# JARVIS_MINECRAFT_LAN_ENABLED="1"
# JARVIS_MINECRAFT_LAN_PORT="51234"  # replace with the port Minecraft displays
# JARVIS_MINECRAFT_PLAYER="YourGameName"
```

Run checks before starting:

```powershell
bun run test:agent-tools-offline
bun run test:full-desktop-offline
bunx tsc --noEmit
bun run lint
bun run build
```

Only use `bun run dev:windows` when port **3000 is free**. Stop the prior JARVIS server with Ctrl+C in its terminal. Keep the supervisor terminal visible to monitor errors. Open **http://127.0.0.1:3000**.

## Test tasks in NEXUS

1. `List the applications installed on this PC and open Chrome from the Start Menu if available.`
2. `Open Windows Settings; verify it has a visible window.`
3. `List my current visible windows, focus Notepad, type "Jarvis desktop test" and tell me whether typing was requested or actually verified.`
4. `Observe the current screen for 8 seconds and tell me what changed.` **Requires screen watch**, and Gemini visual interpretation also requires cloud vision opt-in.
5. `Open YouTube, navigate to MrBeast's official channel, switch to oldest videos and play one.`
6. `Open TLauncher`, using the installed Start Menu shortcut returned by discovery or configure `JARVIS_TLAUNCHER_PATH` to a legitimate installed `.exe`.

## Minecraft Java LAN independent companion

In the included `windows-companion\minecraft-bot` folder, run `npm install` (requires Node). In Minecraft Java, start a world in a compatible **offline-capable local test environment**, choose **Open to LAN**, and read the port Minecraft actually shows. Configure `JARVIS_MINECRAFT_LAN_ENABLED=1`, `JARVIS_MINECRAFT_LAN_PORT` and your in-game `JARVIS_MINECRAFT_PLAYER`. Restart JARVIS after changing the environment.

Request in NEXUS: `Join my Minecraft LAN world as JarvisBuddy.` The bot must actually report a spawn. Then test `Tell your Minecraft companion to follow me`, `jump`, `stop`, `move forward briefly` or `look at me`. Bot commands have bounded movement and report **acknowledged input**, not guaranteed navigational success.

This does **not** automatically create a new world or grant the independent bot a separate licensed online Minecraft account. The local offline-compatible LAN world must actually permit it.

## Why "open any app" is not a promise of 100% success

General desktop control now exists in source, but individual Windows apps can use inaccessible UI frameworks, elevated windows, uncooperative focus handling or raw game input. Launch results are marked `launchRequested` and `windowVisibleVerified=false` until observed. This edition is a significant technical extension, **not** proof of universal autonomy.

## Troubleshooting

- `DENIED ... full desktop control not enabled`: check `.env` operator flag, save it, then restart `bun run dev:windows`.
- Port `EADDRINUSE`: stop **only the previous JARVIS** server running on `127.0.0.1:3000`.
- Minecraft join refused: check the game's exact LAN port, bot npm dependencies, Minecraft Java protocol/mod version, and offline-login support.
- No screen interpretation: screen watching + explicit vision-to-cloud setting are separate flags.
- `Ctrl+Shift+F12` was pressed: desktop injection stays disabled until restarting the companion; never bypass this by sending a different tool call.
- The tests run in the ZIP authoring environment were **offline**. The *real* Windows GUI, Minecraft LAN game and Gemini tasks must be verified on the user's device.
