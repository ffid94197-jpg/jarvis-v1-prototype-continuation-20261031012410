# JARVIS — Native Windows Computer Agent (integration candidate)

This build adds **real Windows UI Automation** inspection and controls and opens URLs in the **default installed Windows browser**. It retains the earlier bounded mouse/keyboard input tools, continuously sampled screen viewer and independent Minecraft Java LAN bot. This is **not a completed or security-certified universal agent**.

## Why this changes the behavior

Previously, JARVIS's Playwright actions controlled a **different Chromium session**. The new `windows_native_open_url` dispatches HTTPS links through Windows's default browser association. `windows_native_inspect` observes the **foreground Windows app's real accessibility controls** (Microsoft UI Automation). `windows_native_action` invokes, focuses, or sets text on a recent inspected control. Unlike blind typing, supported text entry includes **exact readback**. If a control is inaccessible, the UIA tool reports that rather than claiming the operation happened. The model can then use a bounded observe–act–verify loop using the screen vision and existing mouse/keyboard tools.

The underlying approach uses the Microsoft UI Automation API through `pywinauto`. It is not a copy of any Codex or other proprietary agent internals.

## 1. Extract to an isolated Windows folder

Example (no overwrites of older projects):

`D:\glm 5.3\GPT6_TEST\JARVIS_V1_NATIVE_PC_AGENT_2026-10-28`

Open PowerShell in that folder. Install the source's pinned dependencies:

```powershell
bun install --frozen-lockfile
python -m pip install -r .\windows-companion\requirements.txt
bunx prisma generate
```

The `requirements.txt` explicitly pins `pywinauto==1.0.0b1` (a **prerelease** with Python 3.14 support). Test its actual behavior on your PC; if it fails, report the error instead of guessing that Windows UI Automation is working.

## 2. Keep your working private configuration

Copy your **private** `.env` from the previous experimental build to the NEW folder **only if the destination does not already have `.env`**. Never publish, zip, paste or share the API key, device token, owner credential hashes or session cookies. The older chat-supplied OmniRoute keys and owner tokens were exposed; rotate them if still valid.

Choose a **new SQLite database name** (e.g. `DATABASE_URL="file:../db/jarvis-native-test.db"`) before the database push; confirm that the file doesn't already exist. Preserve the private Gemini configuration and companion token. Keep these flags in your private `.env`:

```dotenv
JARVIS_PUBLIC_ORIGIN="http://127.0.0.1:3000"
JARVIS_EXPERIMENTAL_DESKTOP_CONTROL="1"
JARVIS_WINDOWS_UI_CONTROL_ENABLED="1"
JARVIS_BROWSER_AGENT_ENABLED="1"
JARVIS_SCREEN_WATCH_ENABLED="1"
# Optional; sends approved screen frames to the configured external Gemini model:
# JARVIS_SCREEN_VISION_TO_CLOUD="1"
```

The no-login launcher is **local developer only**, bound to 127.0.0.1. The Guardian, audit trail, cancellation and emergency stop remain mandatory. Never run exposed to a LAN, tunnel or other users.

## 3. Validate locally

```powershell
bunx prisma db push
bun run test:native-desktop-offline
bun run test:full-desktop-offline
bunx tsc --noEmit
bun run lint
bun run build
```

These should be run against your real Windows installation; the development source was checked in a non-Windows container. All checks must succeed; do not ignore failures.

Stop the previous server occupying 3000, then run:

```powershell
bun run dev:windows
```

Open `http://127.0.0.1:3000`.

## 4. Native acceptance test (do not skip verification)

Submit in NEXUS Text Mode:

> Work in the real Windows applications, not a separate Playwright Chromium browser. Open my default browser at https://www.youtube.com, inspect the native window's accessibility controls, search for MrBeast, open the verified MrBeast channel, choose Oldest and play the oldest visible video. After each action inspect the app and verify the result. If UIA lacks controls, use the locally approved screen perception and bounded mouse/keyboard actions. Do not claim playback unless it is truly observed. Next open Notepad, use a native UIA editable control to enter exactly `JARVIS AUTONOMOUS EXECUTION TEST SUCCESSFUL`, read that text back, save it in the permitted agent workspace, and verify the exact file contents. Stop if you cannot verify the result.

**Expected verification evidence**: no Playwright browser launch for native workflow; an actual default-browser tab; UIA controls with fresh IDs; Notepad text read back exactly; file readback after saving; documented partial failures rather than simulated results.

If Chrome doesn't expose webpage controls to UIA, `pywinauto` documents the `--force-renderer-accessibility` Chromium startup option. Enabling that option is a local operator choice; it does not bypass OS security. Use the screen vision fallback and report any accessibility gaps.

## 5. Minecraft

The `windows_minecraft_input` tool controls short inputs to the **already focused human Minecraft window**. This does **not** create an independent teammate. The separate Mineflayer `JarvisBuddy` bot can attempt to join an **open compatible Minecraft Java LAN world**. It can follow, come, stay, guard briefly, report inventory and gather a small number of logs. It cannot yet reliably create worlds, plan full survival gameplay, build complex structures, or support every modded Minecraft version. See `MINECRAFT_FRIEND_UPGRADE.md`.

The actual LAN port, Java version, host visibility, authentication rules and bot dependency installation matter and must be tested on the laptop.

## 6. Emergency stop and release verdict

`Ctrl+Shift+F12` latches desktop input off until the companion restarts. The new native UI actions respect this latch; the Core also checks task cancellation before dispatch. This is not an LPAC security sandbox and **does not certify native isolation or all effects**.

**Verdict: DEVELOPMENT CANDIDATE, NOT JARVIS V1 COMPLETE.** The native UIA module and route have offline fixture coverage, but a live Windows proof is pending. No real Minecraft join or autonomous game play was performed in the build environment.
