# JARVIS V1 LAYA — owner-priority verification verdict

**Date:** 2026-10-28  
**Source:** Latest LAYA Stress-Verified JARVIS V1 source (October 28), patched with explicit model-owner routing priority.  
**Verdict:** **PASS — offline, simulated model-routing and regression checks.** **NOT CERTIFIED** for live provider reliability or Windows desktop/gameplay.

## Requirements verified

1. Explicit `use the strongest model` ignores automated privacy filtering, the Settings speed/cost weighting and local LAYA advice. It chooses the highest *operator-rated task-relevant quality* among enabled configured profiles.
2. Explicit `use cloud/API model` chooses from cloud/API profiles; `use local LLM` chooses from local profiles. These instructions take priority over automatic settings. If there is more than one enabled profile and none matches a requested provider type, a specific actionable error is returned instead of silently choosing an incompatible type.
3. **Exactly one enabled configured model**, API or local, is selected regardless of task category, quality ratings, privacy classifier or conflicting location preference. The legacy `.env` fallback is also attempted when no saved profiles exist.
4. No LAYA HTTP calls are made when a direct owner routing instruction (or sole model) settles selection.
5. Default automatic privacy routing still applies when multiple models are available and the user gives no explicit override. Guardian permissions remain separate.
6. A model marked enabled is assumed available **for selection**; the router does not verify real network reachability. HTTP failures must remain visible to the operator.

## Completed tests

- **126,000/126,000** simulated routing decisions in **12 rounds**.
  - Owner-priority randomized task matrix: **96,000 decisions**, **231,959 assertions**.
  - Previous LAYA router regression matrix: **30,000 decisions**, **540 scenario checks**.
- **72/72** full offline regression script runs passed (24 scripts × 3 rounds).
- Syntax parsed: **112 TS/TSX, 30 JS/CJS/MJS and 12 Python** source files.
- One simulated model HTTP endpoint responded to real test prompts over localhost. **No real Gemini, Claude, GPT, Laya weights, Minecraft client or Windows desktop was operated.**
- Encryption/owner separation/disabled profile and wrong-type selection cases checked.

## Limits and remaining acceptance gates

These tests are broad, but there is no mathematically exhaustive "no loopholes" guarantee. Task-intent parsing remains heuristic; the model capability ratings are operator-entered, not independent benchmark measurements. Enabled configurations can point to disconnected providers. Full Next.js production build, actual Windows task control, and live provider connections still need on-device acceptance.

## Example owner test prompts

```
Use the strongest model to debug this TypeScript project.
Use cloud model to research this topic, even though I normally prefer local.
Use local LLM to describe my desktop.
Use strongest cloud model to review this coding task.
```

With one enabled profile (cloud OR local):
```
Read the following sample private document using the model currently connected.
```

The Console → Settings → LAYA Routing → Preview selection will show the selected model and explicit override reason. Do not use real secrets as test content with a cloud model.
