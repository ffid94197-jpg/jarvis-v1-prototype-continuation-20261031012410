# JARVIS LAYA — owner instruction priority (October 28, 2026)

## What changed

The actual task router (`src/lib/agent/models/layaRouter.ts`) honors direct user instructions in the task **before** automatic LAYA advice, workload weights, manual profile selection, or the automatic privacy preference. Examples:

- `Use the strongest model to debug this project.` — choose the highest **configured task-relevant capability rating** among all enabled cloud/local profiles; speed and cost sliders ignored.
- `Use cloud model to research this.` or `Use API model...` — choose the strongest task-relevant enabled cloud/API profile, not a local LLM.
- `Use local LLM to play Minecraft.` — choose the strongest task-relevant enabled local profile.
- `Use strongest cloud model ...` — restrict to cloud profiles, then select strongest.
- When **exactly one enabled profile** exists (cloud or local), use it for every task rather than rejecting it based on privacy or capability ratings. This also applies to a lone legacy `.env` provider when no saved profiles exist.

Unspecified tasks with multiple enabled models still use Settings privacy and task-weightage (and local Laya inference, when installed). An explicitly requested location with multiple enabled models but no match returns an actionable failure: it cannot invent a connection or silently substitute a different kind of provider. In the singleton case, the sole configured model wins even if a contradictory location is requested; the routing receipt says why.

> **Privacy implication:** Explicit requests for cloud or use of a single configured cloud model may send task context to the configured provider despite local-only automatic preference. Keep the separate Guardian action-authorization rules and use only providers you trust. There is no guarantee that task text is private when cloud is chosen.

## Scope and limits

- Strongest is determined from **operator-entered 1–5 ratings** (`reasoning`, `coding`, `vision`), not a measured real-world evaluation. Real model strengths and price may differ.
- Enabled is a *configured state*, not a real-time availability probe. A provider that is disabled is never chosen; a provider that is offline, rate-limited, or misconfigured will still fail at actual HTTP execution, with a truthful error.
- Recognition is intentionally scoped to explicit model directives in the first part of the request. It does not try to interpret instructions hidden in attached files or arbitrary copied content.
- Saved profiles and encryption are preserved. New tasks are pinned to their selected model in the durable journal; already-running or resumed tasks keep their original pin.
- Neither a selected model nor Laya itself bypasses Guardian permissions, emergency stop, or task cancellation.
- The simulator uses **synthetic** model responses and synthetic cloud/local profiles. It does not test proprietary live providers, real Laya weights, Windows desktop actions, or Minecraft.

## Repeatable test

```powershell
cd "<new JARVIS project folder>"
node scripts/model-manager/verify-owner-priority.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN_LAYA_OWNER_MASSIVE_TEST.ps1 -Rounds 12 -DecisionsPerRound 8000
```

For full app acceptance, also run `bun install --frozen-lockfile`, `bunx prisma generate`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`, and `bun run dev:windows` on Windows with real model credentials. The isolated Linux test cannot certify those steps.
