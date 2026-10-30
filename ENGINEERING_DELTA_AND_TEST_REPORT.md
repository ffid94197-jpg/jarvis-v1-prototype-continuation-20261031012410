# GPT-6 Windows Desktop Integration — Actual Evidence

Base: `JARVIS_V1_GPT6_Engineering_Candidate_2026-10-27.zip` with the
`JARVIS_V1_TEMPORARY_LOCAL_NO_LOGIN_PATCH_2026-10-27.zip` applied in an
isolated copy; **not** the owner's unexported live Windows worktree.

## Implemented code (not independently Windows-verified)

- Added guarded tool contracts to Core planner, Guardian audit and executor.
- Added effect admission for desktop actions; no blind replay of external
  effects after a crash. Outcomes with no independent proof remain uncertain.
- Added independent Python localhost sidecar with Playwright browser worker,
  operator-allowlisted executable launching, screened HTTPS routing, live
  lease-gated MJPEG capture, and optional Minecraft LAN join worker.
- Added short explicit cloud vision path that samples evolving screen frames
  and requests Gemini-compatible multimodal interpretation only after opt-in.
- Added Next.js owner-session-protected live screen proxy and a UI viewer.
- Added local Windows supervisor and repeatable setup steps; secret is
  generated per run, and AI keys/owner credentials are not forwarded to
  the companion/browser/optional game bot.
- Kept original production owner login source intact. Only the isolated
  127.0.0.1 development process bypasses password entry through an actual
  scoped owner session. No publicly accessible no-login mode.

## Offline tests performed

- Windows Guardian desktop policy: 30 / 30 PASS.
- Python companion request policy: 17 / 17 PASS.
- Existing model provider and LAYA: 12 / 12 PASS.
- Existing memory contracts: 15 / 15 PASS.
- Existing mocked memory route: 12 / 12 PASS.
- Existing mocked local fallback: 6 / 6 PASS.
- Existing real-temp-filesystem path containment (Linux): 4 / 4 PASS.
- Existing mocked localhost no-login route: 20 / 20 PASS.
- Existing mocked auth contracts: 9 / 9 PASS.
- Python sidecar syntax compilation: PASS.
- Node supervisor and Minecraft bot syntax parse: PASS.
- TypeScript transpilation parser: 103 files / 0 syntax diagnostics.

**Limitations:** The tests above are offline code/contract checks.
They do NOT constitute a real Windows model, Playwright, hardware/vision,
Minecraft, full TypeScript typecheck or application production build test.
The user must run those checks on their Windows laptop.

## Release gate

**NOT COMPLETE:** Windows LPAC/RLM security, universal app control,
full world model and persistence integration, autonomous game playing,
real-time multimodal orchestrator, cross-device runtime and final hardware
certification remain unresolved. No proof of Minecraft new-world creation.
