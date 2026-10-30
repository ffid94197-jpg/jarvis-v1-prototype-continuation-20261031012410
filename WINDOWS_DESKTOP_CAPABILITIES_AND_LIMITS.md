# JARVIS V1 Windows desktop companion — runnable development candidate

## Important release status

This is **source code**, NOT an independently certified full V1. It extends the current
GPT-6 Track B NEXUS/Core with an opt-in Windows user-session companion. It does not
include a Windows LPAC sandbox, a system-wide app automation framework, a general
Minecraft world-creation agent, or a production-ready Minecraft AI teammate.

- Windows browser actions: visible Playwright Chromium session, not arbitrary
  actions against your pre-existing personal Chrome profile.
- Windows apps: explicitly allowlisted **Notepad, Calculator, Explorer, Paint**,
  and operator-configured **TLauncher .exe**. Opening TLauncher is not proof of
  successful game startup or a new world.
- YouTube `Oldest`: browser searches channel name, navigates the channel videos
  tab, clicks the **actual** Oldest option, and attempts to play the top video.
  It checks video playback; may fail on changed UI, consent interstitials,
  regional restrictions, or ads. Does not fabricate success.
- Live screen: MJPEG feed captures successive frames ~3 fps while actively
  viewed or while a bounded `windows_watch_screen` call runs. It is not a
  single saved screenshot. Semantic AI observation samples up to eight frames;
  it needs an explicit separate cloud-vision opt-in and a compatible model.
- Minecraft Java: optional Mineflayer companion bot can join an **already
  opened, compatible localhost LAN server** as a separate player and follow
  the user. The operator opens an existing world to LAN manually and supplies
  LAN port and Minecraft username. It does **not** generate a Minecraft world,
  automatically install mods, support every version, or play independently.
  Current bot emits a `spawn` event only upon actual world connection.
- Guardian: all new effects still pass existing `authorizeToolCall`, durable
  audit admission and settlement. Crash residues for external desktop effects
  are **EFFECT_UNKNOWN**, never automatically replayed. Browser STOP is
  best-effort; cannot be instantly certified for in-progress navigation.
- Passwordless: only with the dedicated opt-in `dev:windows` launcher bound to
  `127.0.0.1`. Production owner authentication code remains intact.

## Setup from a fresh extracted source directory

1. Make a separate folder under `D:\glm 5.3\GPT6_TEST` and extract this ZIP there.
   **Do not overwrite** `D:\jarvis_pc_work` or your already working project.
2. Install Python 3.12/3.13 if not already available. Node 24 and Bun already
   worked on the owner's machine in earlier checks.
3. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\SETUP_WINDOWS_DESKTOP.ps1`
   inside the extracted project. This installs Python dependencies and a
   Playwright Chromium browser; no private DB is copied.
4. Create your OWN `.env`. Copy the database and working **Gemini API model**
   lines from the previous private `.env`, replacing any leaked credentials.
   This ZIP does not include .env or private keys. Choose a fresh dedicated
   `DATABASE_URL="file:../db/jarvis-windows-dev.db"` for this project and
   `bun run db:push` once; do not point at the protected Track A DB.
5. Keep `JARVIS_PUBLIC_ORIGIN="http://127.0.0.1:3000"` exactly.
   Copy the optional items from `WINDOWS_DESKTOP_COMPANION.env.example`.
   To see screen **locally**, set `JARVIS_SCREEN_WATCH_ENABLED="1"`.
   To permit sending frames to Gemini **only with your consent**, set
   `JARVIS_SCREEN_VISION_TO_CLOUD="1"`. Otherwise visual understanding remains
   unavailable, but the local live MJPEG viewer works.
6. From the project root run:
   `bunx prisma generate`, `bun run db:push`, `bun run test:windows-policy`,
   `python windows-companion\verify_companion_offline.py`,
   `bunx tsc --noEmit`, `bun run lint`, and `bun run build`.
   Fix any failures before claiming those gates pass.
7. Start using `bun run dev:windows` **instead of** `bun run dev` or
   `bun run dev:no-login`. The launcher starts BOTH NEXUS (127.0.0.1:3000)
   and the authenticated Python companion (127.0.0.1:20189). The companion
   secret is freshly generated for every launch and is not stored in .env.
8. Visit **http://127.0.0.1:3000**. The development test-owner session is
   established via the existing localhost-only no-login mechanism; do not
   make the server accessible on LAN/VPN/tunnel/public Internet.

## Functional acceptance tasks

1. `Open https://www.youtube.com` — verify a visible automated Chromium window.
2. `Search for MrBeast on YouTube and play the oldest video on the channel` —
   verify real video URL, title and playback on the screen, not just text.
3. `Open Windows Notepad` — verify the window actually appears. Launch receipt
   alone is insufficient for UI proof.
4. Click **LIVE SCREEN VIEW (LOCAL)** in Text Mode. Verify frames visibly update
   with motion. Close it and confirm capture stops shortly afterward.
5. `Watch my screen for 8 seconds and describe the changes` requires the cloud
   vision opt-in. If not enabled, report `framesObserved` but no semantics.
6. Optional Minecraft: `cd windows-companion\minecraft-bot` then `npm install`.
   Configure `JARVIS_MINECRAFT_LAN_ENABLED=1`, actual LAN port and player name.
   Open an existing Minecraft **Java Edition** world to LAN, then request
   `Join my Minecraft LAN world as the companion and follow me.`
   The bot joins as `JarvisBuddy` only for compatible offline LAN worlds.
   TLauncher can be opened via `windows_open_app` only if its executable path
   is configured. New-world GUI automation is NOT implemented here.
7. STOP during navigation or live watching and inspect task status. Browser
   cancellation is best-effort and not a Windows-native hard-kill guarantee.

## Privacy, security and limitations

No raw screen image is stored by the Python companion and no frames go to an
outside API unless the explicit cloud-vision switch is on. With cloud-vision
on, sampled visual frames (which may contain private onscreen data) are sent
via your configured compatible API key. The same PC user can potentially
access local services; localhost is not a Windows security isolation boundary.

Do not expose ports 3000 or 20189. Use a non-admin Windows user, and avoid
capturing passwords, tokens or sensitive documents. Restoring production
owner authentication and completing LPAC/RLM are still mandatory before V1
release. Other unimplemented V1 requirements remain NOT COMPLETE.

## What was verified during packaging (Linux authoring container)

- Desktop allowlist/URL/opt-in policy: 30/30 pure offline probes PASS.
- Independent Python-side companion request validation: 17/17 probes PASS.
- Python sidecar syntax: `python -m py_compile` PASS.
- JS startup + Minecraft script Node syntax checks: PASS.
- 103 TS/TSX files parse through the global TypeScript transpiler with
  0 syntax diagnostics. This is NOT `tsc --noEmit`.
- NOT RUN: full Next.js build (dependencies unavailable in packaging container),
  Windows launching, live Playwright browsing, live MJPEG screen, real Gemini
  image analysis, Minecraft LAN join, LPAC/RLM, security adversarial tests.

**Release verdict: Windows desktop capability prototype; JARVIS V1 NOT COMPLETE.**
