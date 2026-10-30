# JARVIS NEXUS V1 — Console-First Settings UI Upgrade

## Scope

- Main window now displays the JARVIS chat console only. Open **Settings** from the chat-header corner; the orb and standalone wake/screen widgets no longer cover the main window.
- Settings is a full-height, keyboard-accessible workspace with desktop sidebar / mobile horizontal navigation and a dedicated independently scrollable content region.
- API provider page opens first, with a Google Gemini preset and prominently positioned **GEMINI API KEY** password input before the URL/model fields. Enter the key there, choose a real supported model ID, select **SAVE MODEL**, and use **TEST CONNECTION** on the saved profile. Existing server-side vault and Guardian authorization remain unchanged. Never paste API keys in chat.
- Settings categories: AI Providers & API Keys, LAYA Routing, Face/Voice Owner Identity, Voice & Wake, Skills/MCP/Tools, Memory, Routines, Screen & Devices, Guardian & Security, System/Diagnostics.
- Paired device management uses existing owner-authorized API `/api/jarvis/auth/devices` for listing/approving/revoking paired devices.
- Voice wake component stays mounted but hidden when Settings is dismissed, so explicitly enabled wake listening can continue. Screen preview stops on exit from the screen tab or dismissal.
- Unsaved API-key input is cleared on closing Settings. Keys remain encrypted by the **existing** provider backend; this upgrade does not introduce its own credential store.
- `npm run dev` continues to use the existing isolated, loopback-only no-passphrase development launcher; production auth is unchanged.

## Tested in this environment

- NEXUS source contracts: **34/34 PASS**.
- Deterministic abstract UI model: **100,000 scenarios / 1,200,000 state transitions PASS**. This exercises a state-machine approximation of navigation, provider form requirements, session closure, and secret lifecycle. It does **not** execute React, prove CSS scrolling in a browser, or test real API credentials.
- Existing provider & model routing, LAYA, owner auth, memory, Windows policy, autonomy and Minecraft offline checks were rerun and passed. Individual raw logs are included in `NEXUS_UI_TEST_EVIDENCE/`.
- All changed/new TSX files passed TypeScript compiler *syntactic parsing* with zero parse diagnostics.

## Unverified / required final acceptance on Windows

- Browser-rendered scroll behavior at 1920×1080, 1366×768 and 390×844; focus trapping, keyboard navigation, and actual UI click behavior.
- Real API key save/read/redaction and model invocation with the owner's authenticated and configured Windows database/vault.
- Local camera, mic, Piper, paired-device approvals, screen stream and Guardian flows connected to real Windows processes.
- Next.js production build and TypeScript semantic typecheck (the dependency registry was unavailable in this execution environment, so node_modules could not be installed here).
- Minecraft real LAN mission remains unverified; this release targets NEXUS Settings, not gameplay logic.

## Recommended install

**New folder:** extract complete-source ZIP to a new Windows directory, run `npm install`, `npm run test:nexus-settings`, then `npm run dev`. Open `http://127.0.0.1:3000`. Stop earlier JARVIS servers on port 3000 before launching.

**Existing installation:** extract the SAFE_PATCH zip anywhere and run its bundled `APPLY_NEXUS_UI_PATCH.ps1` script with `-ProjectRoot "D:\glm 5.3\GPT6_TEST\JARVIS_V1_NEXUS_FIXED"` (or your actual installed path). It compares SHA256 against the previous full-source release before any writes, then backs up matching originals. If the local files differ, it refuses to overwrite.

Do not paste an API key into the command line, upload .env secrets, clear your existing database, or run `npm audit fix --force` as part of this UI update.
