# JARVIS Settings + LAYA Router — Verification Verdict

Date: 2026-10-28

## Status

**PASS: offline source + simulated protocol / regression tests. NOT VERIFIED: Windows live production and genuine model inference.**

- Three rounds: **66/66 suite runs passed** (22 suites per round).
- Per round: **534 PASS markers**, total **1,602 PASS markers**.
- Source syntax: **100 TypeScript/TSX/JavaScript files** transpilation validated, no parse errors.
- Windows companion: **12 Python files** compiled for syntax, no errors.
- Real-encrypted-vault persistence, route settings, authentication checks and local mock-Laya `POST /v1/systemone` interactions were tested.
- Privacy tested: sensitive task blocks cloud; one eligible local model chosen; unknown legacy env provider denied for private task; remote Laya endpoints rejected; invalid/malicious Laya suggestions rejected; manually selected cloud blocked from receiving private request.
- Capability weighting tested: task category, heavy coding, and speed/cost priorities change model selection as intended.
- Task Core changed to insert `model_route` and `model_pin` journal entries; a resumed task retains prior pinned profile version. The new integration's actual database write path was not live-tested with Prisma in this sandbox.
- UI moved from AI MODELS header button into Settings with LAYA ROUTING and AI MODELS subpanels; source syntax passed; browser render was not live-tested.

## Limits

- Laya Python model weights and server were **not** installed here. The observed Laya HTTP result came from a local stub following upstream API format. The actual model must be installed and tested separately on the user's Windows PC.
- Full `bun run build`, `bunx tsc --noEmit` with application dependencies and ESLint were **not** available in this isolated source environment because `node_modules` was not installed. The Windows acceptance script runs those checks on the owner's PC.
- No live cloud request, local Ollama model inference, production model switch, Windows desktop control or Minecraft session is claimed.
- Keyword-based privacy detection is not a formal PII detection/data loss prevention system. For genuinely private workflows select LOCAL ONLY in Settings.
- Saving an enabled model does not prove it is online. The owner can use TEST CONNECTION and TEST LOCAL LAYA SERVER.
- Laya routing is intentionally bounded by owner quality/cost settings and privacy requirements. Laya does not authorize JARVIS tools.

## How to reproduce

Inside the unpacked project on Windows:

`bun install --frozen-lockfile` then `bunx prisma generate` and `powershell -ExecutionPolicy Bypass -File .\RUN_LAYA_ACCEPTANCE.ps1`.

See `LAYA_SETTINGS_AND_ROUTING_GUIDE.md` for installation and Laya localhost server setup.
