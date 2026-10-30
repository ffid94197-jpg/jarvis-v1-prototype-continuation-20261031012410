# JARVIS V1 — LAYA Model Routing Stress Release (28 Oct 2026)

This is the existing integrated LAYA Console Settings + AI Models build, with three **targeted routing hardening changes** and reusable stress/diagnostic tools. It is an **offline-validated candidate**, NOT a complete JARVIS V1 or a verified real-inference release.

## Real defects found and repaired

1. Privacy auto-detection missed obvious sensitive phrases (passport, credit card number, Aadhaar, UPI PIN, home address, patient records). Extended conservative keyword handling; this remains heuristic rather than comprehensive DLP.
2. With 24 enabled models, Laya could only see the **first 20 saved profiles**. It now receives the **20 best-rated eligible profiles**, selected by the owner's actual weights and task classification.
3. Local Laya received candidate descriptions but not the configured **quality/speed/cost weightage**. It now receives `state.ownerWeights` and an explicit weights instruction. Owner privacy and the 15% score guard still apply.

## Verified in isolated Linux tests

- 12 stress rounds × 2,500 task decisions: **30,000/30,000 property-valid decisions**.
- **540/540 additional named scenario checks** (45 per round).
- **2,496** localhost mock LAYA HTTP requests and **48** localhost mock model HTTP requests.
- **2,412** LAYA advice acceptances (including concurrent requests); the score guard prevents low-ranked suggestions.
- **23/23 legacy regression scripts**, one full round, with 534 `PASS` log lines.
- **24/24 focused regression runs**, three rounds × eight suites, with 690 `PASS` log lines.
- Static syntax: **108 TypeScript/TSX**, **27 JavaScript**, **12 Python** files parsed cleanly.
- ZIP contents and hashes recorded separately in the evidence bundle.

The original untouched build had **8 failed stress assertions** (6 privacy phrases + 1 candidate coverage + 1 owner weight propagation). After patching: 0 failures in the above stress suite.

## Use the diagnostic test models

In a terminal, from the JARVIS project root:

```powershell
node .\scripts\model-manager\mock-model-test-server.cjs
```

This binds **only 127.0.0.1** and exposes:

- `http://127.0.0.1:18765/v1` — mock OpenAI-compatible chat-completions, IDs `fixture-fast`, `fixture-deep`, `fixture-private`, `fixture-coding`, `fixture-vision`.
- `http://127.0.0.1:18765` — mock native Ollama API (same fixture IDs).
- `http://127.0.0.1:18766` — mock local Laya `POST /v1/systemone` and `GET /healthz`.

Open NEXUS → Assistant Console → **SETTINGS → AI MODELS**. Add a **Local LLM** profile with protocol **OpenAI-compatible**, base URL `http://127.0.0.1:18765/v1`, model `fixture-fast`, **no API key**. Repeat with model IDs `fixture-deep`, `fixture-private`, `fixture-coding`, `fixture-vision` and different owner-entered capability ratings (e.g. fast: speed 5, coding 2; coding: coding 5, speed 2; vision: vision 5, speed 2). Test Connection confirms the transport.

Then **SETTINGS → LAYA ROUTING**: choose Auto, set local Laya URL `http://127.0.0.1:18766`, enable Laya, test the Laya service, and try routing previews for `debug the entire TypeScript architecture`, `open my private medical notes`, and `search for a channel on YouTube`. It is expected that mock Laya advice may be overridden by owner ratings.

**THIS MOCK SERVER IS NOT A REAL GENERATIVE LLM OR THE ACTUAL LAYA MODEL.** It produces fixed canned replies and a deterministic choice. It is for connection/routing and UI testing ONLY. Do not use these fixtures for autonomous PC tasks; they cannot plan or control a computer. For real Laya inference, install the upstream Python model separately and replace the URL with its localhost service.

## Re-run the massive test on Windows

After installing the project dependencies and preserving your private `.env` and encrypted model vault, open PowerShell in the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN_LAYA_MASSIVE_TEST.ps1 -Rounds 10 -DecisionsPerRound 2000
```

The script creates new temporary per-round model vaults under the system temp directory, with **synthetic test keys only**, without modifying your real profiles. It aborts on failed rounds and writes JSON reports under `evidence/laya-massive-stress`.

## Acceptance still required on your Windows laptop

- Install dependencies, verify `bunx tsc --noEmit`, `bun run lint`, and `bun run build`.
- Run real Laya model weights (not a mock) and independently verify its choices.
- Test a real cloud model plus a real local model, including local-only privacy behavior and connection failures.
- Test NEXUS Settings rendering, real task creation, pinning and resume behavior.
- Verify real desktop control and Minecraft LAN separately; this release did not simulate those game/client conditions.

**Do not call this release universally autonomous or production-certified.** The stress results prove tested routing contracts in a simulated environment, not all hardware, models, providers, languages, tasks, or privacy cases.
