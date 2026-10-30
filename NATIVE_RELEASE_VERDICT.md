# JARVIS Native Windows Agent — verification ledger

- Source baseline: `JARVIS_V1_GPT6_Minecraft_Friend_2026-10-28` (latest consolidated user-facing source previously produced).
- Existing Python Win32 input and Guardian/effect pipeline preserved.
- Added native HTTPS browser launch via Windows default browser, Windows UI Automation foreground inspection (opaque 25s control references), native invoke/focus/text with UIA exact-readback checks.
- Added companion route and independent, second-tier input validation; native actions share the emergency stop and task-cancel checks.
- Included `pywinauto==1.0.0b1` as an explicitly identified prerelease because the user's Windows Python is 3.14.
- Focused tests: mock-backed Python native UIA and TypeScript/Guardian companion wiring. Existing full-desktop, Minecraft and browser policy regressions run offline.

## Not established

- Real UI Automation on the user's Chrome, Notepad, Windows Settings, or custom app
- Exact Notepad entry/save/readback from the real GUI
- Native YouTube search, Oldest sort and actual playback
- Full autonomous visual agent behavior across arbitrary apps
- Full autonomous Minecraft multiplayer survival
- Production Windows LPAC isolation, security certification, cross-device integration

**Release decision: NOT COMPLETE.** User must run Windows integration acceptance before any live capability is marked verified.

## Verification results in build environment

- `windows-companion/verify_native_uia_offline.py`: 20/20 pass (mock UI Automation)
- `scripts/verify-native-tool-wiring.cjs`: 25/25 pass (Guardian, executor, TS policy and sidecar wiring)
- 10 prior regression scripts (including Minecraft Friend): all exited zero; detailed log in accompanying run report
- 102 TS/TSX source files: syntax transpilation 0 errors; full project typecheck not run
- Python sources: compilation 0 syntax errors
- Live Windows/Prisma/Gemini/NEXUS: NOT TESTED in this build environment
