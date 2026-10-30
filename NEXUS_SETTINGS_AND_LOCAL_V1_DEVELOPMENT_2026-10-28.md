# JARVIS V1 — NEXUS Settings and local development access

## What was fixed

- A persistent `⚙ SETTINGS` button now appears in the upper-right of the NEXUS orb and assistant experience once a valid local owner session is established. Click or use Esc to close. Settings is a modal with keyboard focus management and a mobile layout.
- Existing functional backend-connected settings have been made directly accessible: cloud API/BYOK provider profiles (stored in the encrypted local model vault), Ollama and other local OpenAI-compatible models, LAYA model routing, face enrollment/check/delete, owner voice sample enrollment/check/delete, Skills/MCP/Tools integration.
- System/Voice Output tab adds an owner-session/model-manager diagnostic and a Piper speech playback test. Speech requires separately installed local Python/Piper model assets and can report not ready. Camera/voice enrollment requires installed local perception models and vault configuration; this patch cannot supply those model binaries or attest biometric verification.
- `npm run dev` and `npm run dev:no-login` now use the temporary *loopback-only* local test launcher; `npm run dev:authenticated` remains an explicit authenticated development option. The ordinary production `npm start` is unchanged. The dev launcher creates an isolated local SQLite test DB only on first use (without deleting/migrating existing DBs), uses the test DB on subsequent runs, sets the correct public origin, and enables owner-only local perception/Piper endpoints.
- Login failure in this local test mode shows a setup/database error rather than demanding an undiscoverable owner passphrase. Guardian and the real database-backed owner session remain mandatory.

## Limits and security

- **NO universal password bypass.** This launcher cannot bind to the LAN; it refuses `NODE_ENV=production`. Remote/production sessions still require normal authentication.
- The dev owner is a **temporary local testing identity** in `prisma/jarvis-local-minecraft-test.db`. This is not recovery of the real production owner/passphrase, and no production database is modified or reused. Do not expose it to other users.
- Existing owner conflict/revocation remains fail-closed. The launcher will not overwrite old database files. Model API keys are encrypted in `.jarvis-private/model-vault` and do not appear in API responses. Keep `.jarvis-private` and `prisma/*.db` private; preserve them through upgrades.
- The face/voice code is not secure login and does not replace Guardian authorization. Device login/authentication will be reviewed for final V1 acceptance.

## Local Windows run

1. Close previously running JARVIS server sessions, especially a Node process listening on TCP 3000. In PowerShell use `Get-NetTCPConnection -LocalPort 3000 -State Listen` to identify it; stop *only* the process known to be the old JARVIS server.
2. In the updated project folder run `npm install`, then `npm run test:nexus-settings` and `npm run test:local-dev-no-login`.
3. Run `npm run dev` (or `npm run dev:no-login`). Open **http://127.0.0.1:3000**, not a public URL.
4. On the NEXUS orb, use the new top-right `⚙ SETTINGS` button. Navigate to `AI MODELS · API / LOCAL`, `LAYA ROUTING`, `OWNER IDENTITY · FACE / VOICE`, `SKILLS · MCP · TOOLS`, and `SYSTEM · VOICE OUTPUT`.
5. For real voice/face usage install the existing local model prerequisites; health checks tell you if components are missing. API and local LLM endpoints must be configured and available before connection tests can pass.

## Verification performed on this patch

- `LOCAL_DEV_NO_LOGIN` mock policy and session route: 20/20 PASS.
- Offline model manager: 32/32 PASS.
- Offline model route: 16/16 PASS.
- Offline provider/selection: 12/12 PASS.
- New NEXUS Settings source integration checks: 17/17 PASS.
- Launcher smoke tests with fake Next/Prisma: 3/3 PASS (first-run DB creation, DB preservation, reject production).
- TypeScript/JSX parsing of modified components: PASS.
- Minecraft bridge offline policy tests: 60/60 PASS (unchanged code).

**Not performed:** real browser clickthrough, Windows Prisma runtime with a live database and full `next build`. The archive does not bundle `node_modules` or a user's credentials, database, models or vault. Full face/voice enrollment, external provider connectivity, and Minecraft LAN gameplay require local integration tests.
